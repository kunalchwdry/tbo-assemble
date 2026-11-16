/**
 * Venue geocoding with honest provenance.
 *
 * Every answer says what it is:
 *  - `verified`    — OpenStreetMap Nominatim matched the full query to a specific place (a venue, building, street…).
 *  - `approximate` — only a locality matched (the venue part was not found), several far-apart places matched, or the
 *                    provider was unavailable and the query names a known destination, whose regional centre is used.
 *                    Approximate coordinates are labelled with their `precision` and must never be shown as the venue.
 *  - `unresolved`  — nothing matched. No coordinates are returned (never a default city).
 *  - `error`       — the provider failed (network, timeout, rate limit, malformed reply) and no approximate fallback
 *                    applies. No coordinates are returned; the caller may retry later.
 *
 * Provider etiquette (Nominatim usage policy): at most one request per second from this server instance, an identifying
 * User-Agent, results cached, a short timeout. The throttle and caches are per server instance (best effort on
 * serverless), so they bound — but do not globally guarantee — the request rate.
 * Tests inject `fetch`, `now` and `sleep`; automated tests never call the live service.
 */

export type GeocodeStatus = 'verified' | 'approximate' | 'unresolved' | 'error';
/** venue: a specific place; locality: a city/town/district/state match; region-centroid: a known destination's centre. */
export type GeocodePrecision = 'venue' | 'locality' | 'region-centroid';
export type GeocodeSource = 'nominatim' | 'known-destination';

export type GeocodeResult = {
  status: GeocodeStatus;
  query: string;
  lat: number | null;
  lng: number | null;
  /** Provider display name, or a description of the approximation. Null when unresolved / error. */
  displayName: string | null;
  source: GeocodeSource | null;
  precision: GeocodePrecision | null;
  /** True for anything that is not a verified venue-level match. */
  approximate: boolean;
  /** Several far-apart places matched with similar confidence; the top match is shown as approximate. */
  ambiguous: boolean;
  /** The text that produced the match (the full query, or its locality part). */
  matchedQuery: string | null;
  /** Served from this instance's cache (the provenance fields are those of the original answer). */
  cached: boolean;
  /** Human-readable explanation suitable for the UI. */
  message: string;
  /** Provider failure detail when the provider could not be used (no secrets, no request data). */
  providerError: string | null;
  /** Required attribution when OpenStreetMap data is shown. */
  attribution: string | null;
};

export type GeocodeDeps = {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Per-request timeout (ms). */
  timeoutMs: number;
  /** Minimum spacing between outgoing provider requests (ms); Nominatim allows at most 1 request/second. */
  minIntervalMs: number;
  /** Give up (status `error`, provider "busy") rather than queue longer than this for the provider slot (ms). */
  maxQueueMs: number;
  /** Disable the live provider entirely (only known-destination approximations are returned). */
  providerDisabled: boolean;
  userAgent: string;
};

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
export const OSM_ATTRIBUTION = 'Data © OpenStreetMap contributors (ODbL)';
export const MAX_QUERY_LENGTH = 300;

/**
 * Regional centres for destinations the product works with. They are approximations (a state or metro centre), so a
 * match is always reported as `approximate` with precision `region-centroid`.
 */
export const KNOWN_DESTINATIONS: Record<string, { lat: number; lng: number; label: string; aliases: string[] }> = {
  bengaluru: { lat: 12.9716, lng: 77.5946, label: 'Bengaluru', aliases: ['bengaluru', 'bangalore'] },
  goa: { lat: 15.2993, lng: 74.124, label: 'Goa', aliases: ['goa'] },
  mumbai: { lat: 19.076, lng: 72.8777, label: 'Mumbai', aliases: ['mumbai', 'bombay'] },
  delhi: { lat: 28.6139, lng: 77.209, label: 'Delhi', aliases: ['delhi', 'new delhi'] },
  jaipur: { lat: 26.9124, lng: 75.7873, label: 'Jaipur', aliases: ['jaipur'] },
  kerala: { lat: 10.8505, lng: 76.2711, label: 'Kerala', aliases: ['kerala'] },
  dubai: { lat: 25.2048, lng: 55.2708, label: 'Dubai', aliases: ['dubai'] },
  singapore: { lat: 1.3521, lng: 103.8198, label: 'Singapore', aliases: ['singapore'] },
  bangkok: { lat: 13.7563, lng: 100.5018, label: 'Bangkok', aliases: ['bangkok'] },
  bali: { lat: -8.4095, lng: 115.1889, label: 'Bali', aliases: ['bali'] },
};

/** Nominatim `addresstype` / `type` values that describe an area rather than a specific place. */
const AREA_TYPES = new Set([
  'continent', 'country', 'state', 'region', 'province', 'county', 'state_district', 'district', 'city', 'town',
  'village', 'hamlet', 'municipality', 'city_district', 'borough', 'suburb', 'quarter', 'neighbourhood',
  'administrative', 'island', 'archipelago', 'postcode',
]);
const AMBIGUITY_KM = 25;
const AMBIGUITY_IMPORTANCE = 0.1;

type Candidate = { lat: number; lng: number; displayName: string; area: boolean; importance: number };
type ProviderReply = { ok: true; candidates: Candidate[] } | { ok: false; error: string };

// ------------------------------------------------------------------------------------------------ per-instance state
type CacheEntry = { result: GeocodeResult; expires: number };
const CACHE_LIMIT = 500;
const TTL_FOUND_MS = 24 * 3600_000;
const TTL_UNRESOLVED_MS = 3600_000;
const cache = new Map<string, CacheEntry>();
let nextSlot = 0;

/** Reset caches and the provider throttle (tests only). */
export function resetGeocodeState() {
  cache.clear();
  nextSlot = 0;
}

export function defaultGeocodeDeps(env: Record<string, string | undefined> = process.env): GeocodeDeps {
  const contact = env.GEOCODER_CONTACT?.trim();
  return {
    fetch: (...args) => fetch(...args),
    now: () => Date.now(),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    timeoutMs: 5000,
    minIntervalMs: 1100,
    maxQueueMs: 3000,
    providerDisabled: env.GEOCODER_DISABLED === '1',
    userAgent: `TBO-Assemble/1.0 (+https://github.com/kunalchwdry/tbo-assemble${contact ? `; ${contact}` : ''})`,
  };
}

/** Normalised cache key; also used to validate input. */
export function normaliseQuery(raw: string | null | undefined): { ok: true; query: string; key: string } | { ok: false; error: string } {
  const query = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!query) return { ok: false, error: "Query parameter 'q' is required." };
  if (query.length > MAX_QUERY_LENGTH) return { ok: false, error: `Query is too long (maximum ${MAX_QUERY_LENGTH} characters).` };
  if (/[\u0000-\u001f\u007f]/.test(query)) return { ok: false, error: 'Query contains control characters.' };
  return { ok: true, query, key: query.toLowerCase() };
}

/** Known destination named in the query, matched on whole words (so "Goalpara" is not "Goa"). Last mention wins. */
export function knownDestinationIn(query: string): { key: string; lat: number; lng: number; label: string } | null {
  const text = ` ${query.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  let best: { key: string; lat: number; lng: number; label: string; at: number } | null = null;
  for (const [key, d] of Object.entries(KNOWN_DESTINATIONS)) {
    for (const alias of d.aliases) {
      const at = text.lastIndexOf(` ${alias} `);
      if (at >= 0 && (!best || at > best.at)) best = { key, lat: d.lat, lng: d.lng, label: d.label, at };
    }
  }
  return best ? { key: best.key, lat: best.lat, lng: best.lng, label: best.label } : null;
}

function distanceKm(a: Candidate, b: Candidate) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Parses a Nominatim JSON reply; malformed entries are dropped, a malformed body is an error. */
export function parseNominatim(body: unknown): ProviderReply {
  if (!Array.isArray(body)) return { ok: false, error: 'malformed provider reply' };
  const candidates: Candidate[] = [];
  for (const row of body) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const lat = typeof r.lat === 'string' || typeof r.lat === 'number' ? Number(r.lat) : NaN;
    const lng = typeof r.lon === 'string' || typeof r.lon === 'number' ? Number(r.lon) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const kind = String(r.addresstype ?? r.type ?? '').toLowerCase();
    const cls = String(r.class ?? '').toLowerCase();
    candidates.push({
      lat, lng,
      displayName: typeof r.display_name === 'string' ? r.display_name : '',
      area: AREA_TYPES.has(kind) || (cls === 'boundary' && kind === 'administrative') || (cls === 'place' && AREA_TYPES.has(String(r.type ?? '').toLowerCase())),
      importance: typeof r.importance === 'number' && Number.isFinite(r.importance) ? r.importance : 0,
    });
  }
  return { ok: true, candidates };
}

async function providerSlot(deps: GeocodeDeps): Promise<boolean> {
  const now = deps.now();
  const start = Math.max(now, nextSlot);
  if (start - now > deps.maxQueueMs) return false;
  nextSlot = start + deps.minIntervalMs;
  if (start > now) await deps.sleep(start - now);
  return true;
}

async function queryNominatim(text: string, deps: GeocodeDeps): Promise<ProviderReply> {
  if (!(await providerSlot(deps))) return { ok: false, error: 'provider busy (local rate limit)' };
  const url = `${NOMINATIM_URL}?format=jsonv2&limit=5&addressdetails=0&q=${encodeURIComponent(text)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    const res = await deps.fetch(url, { headers: { 'User-Agent': deps.userAgent, Accept: 'application/json' }, signal: controller.signal });
    if (res.status === 429) return { ok: false, error: 'provider rate limit (HTTP 429)' };
    if (!res.ok) return { ok: false, error: `provider HTTP ${res.status}` };
    let body: unknown;
    try { body = await res.json(); } catch { return { ok: false, error: 'malformed provider reply' }; }
    return parseNominatim(body);
  } catch {
    return { ok: false, error: controller.signal.aborted ? `provider timeout after ${deps.timeoutMs} ms` : 'provider unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

function base(query: string): Omit<GeocodeResult, 'status' | 'message'> {
  return { query, lat: null, lng: null, displayName: null, source: null, precision: null, approximate: true, ambiguous: false, matchedQuery: null, cached: false, providerError: null, attribution: null };
}

function fromCandidates(query: string, matchedQuery: string, list: Candidate[], localityFallback: boolean): GeocodeResult | null {
  if (!list.length) return null;
  const top = list[0];
  const rivals = list.slice(1).filter(c => distanceKm(top, c) > AMBIGUITY_KM && top.importance - c.importance < AMBIGUITY_IMPORTANCE);
  const ambiguous = rivals.length > 0;
  const precision: GeocodePrecision = localityFallback || top.area ? 'locality' : 'venue';
  const verified = precision === 'venue' && !ambiguous;
  const message = verified
    ? 'Matched to a specific place by OpenStreetMap.'
    : ambiguous
      ? `Approximate: ${rivals.length + 1} far-apart places match "${matchedQuery}"; showing the most likely one.`
      : localityFallback
        ? `Approximate: the venue was not found; showing "${matchedQuery}" (city or area level).`
        : 'Approximate: OpenStreetMap matched an area (city, district or region), not the venue.';
  return { ...base(query), status: verified ? 'verified' : 'approximate', lat: top.lat, lng: top.lng, displayName: top.displayName || matchedQuery, source: 'nominatim', precision, approximate: !verified, ambiguous, matchedQuery, message, attribution: OSM_ATTRIBUTION };
}

/** Geocodes a venue query. Never returns coordinates that are not labelled with their precision. */
export async function geocode(rawQuery: string, deps: GeocodeDeps = defaultGeocodeDeps()): Promise<GeocodeResult> {
  const norm = normaliseQuery(rawQuery);
  if (!norm.ok) return { ...base(rawQuery ?? ''), status: 'error', message: norm.error };
  const { query, key } = norm;
  const hit = cache.get(key);
  if (hit && hit.expires > deps.now()) {
    cache.delete(key); cache.set(key, hit);  // LRU touch
    return { ...hit.result, cached: true };
  }
  if (hit) cache.delete(key);

  let providerError: string | null = deps.providerDisabled ? 'live geocoder disabled' : null;
  let result: GeocodeResult | null = null;
  if (!deps.providerDisabled) {
    const full = await queryNominatim(query, deps);
    if (full.ok) result = fromCandidates(query, query, full.candidates, false);
    else providerError = full.error;
    // Locality fallback: drop the leading venue name ("Venue, City, State" -> "City, State").
    const parts = query.split(',').map(s => s.trim()).filter(Boolean);
    if (!result && full.ok && parts.length > 1) {
      const locality = parts.slice(1).join(', ');
      const loc = await queryNominatim(locality, deps);
      if (loc.ok) result = fromCandidates(query, locality, loc.candidates, true);
      else providerError = loc.error;
    }
  }
  if (!result) {
    const known = knownDestinationIn(query);
    if (known) {
      result = {
        ...base(query), status: 'approximate', lat: known.lat, lng: known.lng,
        displayName: `${known.label} (approximate regional centre)`, source: 'known-destination', precision: 'region-centroid',
        matchedQuery: known.label, providerError,
        message: providerError
          ? `Approximate: the map service is unavailable (${providerError}); showing the centre of ${known.label}, not the venue.`
          : `Approximate: the venue was not found; showing the centre of ${known.label}, not the venue.`,
      };
    }
  }
  if (!result) {
    result = providerError && !deps.providerDisabled
      ? { ...base(query), status: 'error', providerError, message: `Location could not be checked right now (${providerError}). Try again later.` }
      : { ...base(query), status: 'unresolved', providerError, message: 'Location not found. Add a fuller address or the city.' };
  } else if (providerError && !result.providerError) {
    result = { ...result, providerError };
  }
  // Cache answers (not provider errors, which should be retried).
  if (result.status !== 'error' && !(result.source === 'known-destination' && providerError && !deps.providerDisabled)) {
    cache.set(key, { result, expires: deps.now() + (result.status === 'unresolved' ? TTL_UNRESOLVED_MS : TTL_FOUND_MS) });
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  }
  return result;
}

/** HTTP status for a geocode result: answers are 200, provider failures without a fallback are 503. */
export function httpStatusFor(result: GeocodeResult): number {
  return result.status === 'error' ? (result.providerError ? 503 : 400) : 200;
}
