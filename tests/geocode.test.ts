/**
 * Geocoding accuracy and provenance. Every provider call is mocked: the live Nominatim service is never contacted
 * (a guard fails the test if any unmocked fetch happens).
 */
import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { NextRequest } from 'next/server';
import { GET } from '../src/app/api/geocode/route';
import { geocode, knownDestinationIn, normaliseQuery, parseNominatim, resetGeocodeState, type GeocodeDeps, KNOWN_DESTINATIONS } from '../src/lib/geocode';
import { resetRouteLimiters } from '../src/lib/route-limits';

const BLR = KNOWN_DESTINATIONS.bengaluru;
const blocked: typeof fetch = async (input) => { throw new Error(`LIVE NETWORK BLOCKED in tests: ${String(input).slice(0, 60)}`); };
globalThis.fetch = blocked;

type Call = { url: string; at: number };
function provider(replies: Array<(url: string) => Response | Promise<Response>>, calls: Call[], clock = { t: 0 }) {
  let i = 0;
  const f: typeof fetch = async (input, init) => {
    const url = String(input);
    assert.ok(url.startsWith('https://nominatim.openstreetmap.org/search?'), `unexpected URL ${url}`);
    assert.match(String((init?.headers as Record<string, string>)['User-Agent']), /^TBO-Assemble\/1\.0 \(\+https:\/\/github\.com\//);
    calls.push({ url, at: clock.t });
    const reply = replies[Math.min(i++, replies.length - 1)];
    return reply(url);
  };
  return f;
}
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const venue = (lat: number, lng: number, name: string, extra: Record<string, unknown> = {}) => ({ lat: String(lat), lon: String(lng), display_name: name, addresstype: 'hotel', class: 'tourism', type: 'hotel', importance: 0.4, ...extra });
const city = (lat: number, lng: number, name: string) => ({ lat: String(lat), lon: String(lng), display_name: name, addresstype: 'city', class: 'boundary', type: 'administrative', importance: 0.6 });

function deps(fetchImpl: typeof fetch, clock = { t: 0 }, extra: Partial<GeocodeDeps> = {}): GeocodeDeps {
  return {
    fetch: fetchImpl, now: () => clock.t, sleep: async ms => { clock.t += ms; },
    timeoutMs: 200, minIntervalMs: 1100, maxQueueMs: 3000, providerDisabled: false,
    userAgent: 'TBO-Assemble/1.0 (+https://github.com/kunalchwdry/tbo-assemble)', ...extra,
  };
}

beforeEach(() => { resetGeocodeState(); resetRouteLimiters(); globalThis.fetch = blocked; });

test('input validation: missing, blank, too long and control characters are rejected with 400', async () => {
  for (const q of [null, '', '   ', 'x'.repeat(301), 'Venue\u0000, Goa']) {
    const url = 'http://localhost/api/geocode' + (q === null ? '' : `?q=${encodeURIComponent(q)}`);
    const res = await GET(new NextRequest(url));
    assert.equal(res.status, 400, `q=${JSON.stringify(q)}`);
    assert.ok((await res.json()).error);
  }
  assert.deepEqual(normaliseQuery('  The  Leela ,  Bengaluru '), { ok: true, query: 'The Leela , Bengaluru', key: 'the leela , bengaluru' });
});

test('verified: a venue-level match is labelled verified with OpenStreetMap provenance and attribution', async () => {
  const calls: Call[] = [];
  const r = await geocode('The Leela Palace, Bengaluru, Karnataka', deps(provider([json([venue(12.9606, 77.6484, 'The Leela Palace, HAL Airport Road, Bengaluru')])], calls)));
  assert.equal(r.status, 'verified');
  assert.equal(r.source, 'nominatim');
  assert.equal(r.precision, 'venue');
  assert.equal(r.approximate, false);
  assert.equal(r.ambiguous, false);
  assert.deepEqual([r.lat, r.lng], [12.9606, 77.6484]);
  assert.match(String(r.attribution), /OpenStreetMap/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /format=jsonv2/);
  assert.match(calls[0].url, /q=The%20Leela%20Palace%2C%20Bengaluru%2C%20Karnataka/);
});

test('an area-level match for the full query is approximate (locality), never presented as the venue', async () => {
  const r = await geocode('Bengaluru, Karnataka', deps(provider([json([city(12.97, 77.59, 'Bengaluru, Karnataka, India')])], [])));
  assert.equal(r.status, 'approximate');
  assert.equal(r.precision, 'locality');
  assert.equal(r.approximate, true);
});

test('locality fallback: unknown venue in a known city returns the city, labelled approximate (locality)', async () => {
  const calls: Call[] = [];
  const clock = { t: 0 };
  const r = await geocode('Obscure Banquet Hall, Jaipur, Rajasthan', deps(provider([json([]), json([city(26.91, 75.79, 'Jaipur, Rajasthan, India')])], calls, clock), clock));
  assert.equal(r.status, 'approximate');
  assert.equal(r.source, 'nominatim');
  assert.equal(r.precision, 'locality');
  assert.equal(r.matchedQuery, 'Jaipur, Rajasthan');
  assert.match(r.message, /venue was not found/);
  assert.equal(calls.length, 2);
  // Provider etiquette: the second request waited for the 1-request-per-second slot.
  assert.ok(calls[1].at - calls[0].at >= 1100, `requests ${calls[1].at - calls[0].at} ms apart`);
});

test('no result and no known destination: unresolved, no coordinates, and NOT Bengaluru', async () => {
  const r = await geocode('Unknown Banquet Hall, Nowhereville', deps(provider([json([])], [])));
  assert.equal(r.status, 'unresolved');
  assert.equal(r.lat, null);
  assert.equal(r.lng, null);
  assert.equal(r.source, null);
  assert.equal(r.precision, null);
  assert.notDeepEqual([r.lat, r.lng], [BLR.lat, BLR.lng]);
});

test('route: unresolved place answers 200 with null coordinates (previously central Bengaluru labelled "nominatim")', async () => {
  globalThis.fetch = provider([json([])], []);
  const res = await GET(new NextRequest('http://localhost/api/geocode?q=' + encodeURIComponent('Another Unknown Venue, Atlantis')));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'unresolved');
  assert.equal(body.lat, null);
  assert.equal(body.lng, null);
  assert.notEqual(body.source, 'nominatim');
});

test('network failure without a known destination: error (503), no coordinates, not cached', async () => {
  let n = 0;
  globalThis.fetch = async () => { n++; throw new TypeError('fetch failed'); };
  const url = 'http://localhost/api/geocode?q=' + encodeURIComponent('Unknown Banquet Hall, Nowhereville');
  const res = await GET(new NextRequest(url));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, 'error');
  assert.equal(body.lat, null);
  assert.equal(body.providerError, 'provider unreachable');
  resetGeocodeState();   // only the throttle; errors were never cached
  await GET(new NextRequest(url));
  assert.equal(n, 2, 'a provider error must be retried, not served from cache');
});

test('network failure with a known destination: approximate regional centre, labelled known-destination', async () => {
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const res = await GET(new NextRequest('http://localhost/api/geocode?q=' + encodeURIComponent('Taj Exotica, Goa')));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'approximate');
  assert.equal(body.source, 'known-destination');
  assert.equal(body.precision, 'region-centroid');
  assert.equal(body.approximate, true);
  assert.deepEqual([body.lat, body.lng], [KNOWN_DESTINATIONS.goa.lat, KNOWN_DESTINATIONS.goa.lng]);
  assert.match(body.message, /not the venue/);
  assert.equal(body.providerError, 'provider unreachable');
});

test('known destinations match whole words only ("Goalpara, Assam" is not Goa; "Balina" is not Bali)', async () => {
  assert.equal(knownDestinationIn('Hotel Goalpara Residency, Assam'), null);
  assert.equal(knownDestinationIn('Balina Resort, Somewhere'), null);
  assert.equal(knownDestinationIn('Some Hotel, North Goa')?.key, 'goa');
  assert.equal(knownDestinationIn('Grand Hyatt, New Delhi')?.key, 'delhi');
  assert.equal(knownDestinationIn('ITC Gardenia, Bangalore')?.key, 'bengaluru');
  const r = await geocode('Hotel Goalpara Residency, Assam', deps(async () => { throw new TypeError('offline'); }));
  assert.equal(r.status, 'error');
  assert.equal(r.lat, null);
});

test('provider HTTP errors, 429 and timeouts are provider errors (fallback rules apply)', async () => {
  const r500 = await geocode('Unknown Hall, Nowhere', deps(provider([json({ error: 'x' }, 500)], [])));
  assert.equal(r500.status, 'error');
  assert.equal(r500.providerError, 'provider HTTP 500');
  resetGeocodeState();
  const r429 = await geocode('Some Resort, Bali', deps(provider([json([], 429)], [])));
  assert.equal(r429.status, 'approximate');
  assert.equal(r429.source, 'known-destination');
  assert.equal(r429.providerError, 'provider rate limit (HTTP 429)');
  resetGeocodeState();
  const hang: typeof fetch = (_input, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  const started = Date.now();
  const rt = await geocode('Unknown Hall, Nowhere', deps(hang, { t: 0 }, { timeoutMs: 50 }));
  assert.equal(rt.status, 'error');
  assert.equal(rt.providerError, 'provider timeout after 50 ms');
  assert.ok(Date.now() - started < 2000);
});

test('malformed provider replies: non-JSON body is an error; malformed rows are ignored', async () => {
  const html = () => new Response('<html>busy</html>', { status: 200, headers: { 'content-type': 'text/html' } });
  const r1 = await geocode('Unknown Hall, Nowhere', deps(provider([html], [])));
  assert.equal(r1.status, 'error');
  assert.equal(r1.providerError, 'malformed provider reply');
  assert.deepEqual(parseNominatim({ not: 'an array' }), { ok: false, error: 'malformed provider reply' });
  const rows = parseNominatim([{ lat: 'abc', lon: '1' }, { lat: '95', lon: '10' }, null, { lat: '12.5', lon: '77.5', display_name: 'ok', addresstype: 'hotel' }]);
  assert.ok(rows.ok && rows.candidates.length === 1 && rows.candidates[0].lat === 12.5);
  resetGeocodeState();
  const r2 = await geocode('Unknown Hall, Nowhere', deps(provider([json([{ lat: 'NaN', lon: 'x' }]), json([])], [])));
  assert.equal(r2.status, 'unresolved');
});

test('ambiguous: far-apart matches with similar confidence are approximate and flagged', async () => {
  const r = await geocode('Springfield Grand Hotel', deps(provider([json([
    venue(39.80, -89.64, 'Springfield Grand Hotel, Illinois', { importance: 0.41 }),
    venue(37.21, -93.29, 'Springfield Grand Hotel, Missouri', { importance: 0.40 }),
  ])], [])));
  assert.equal(r.status, 'approximate');
  assert.equal(r.ambiguous, true);
  assert.equal(r.precision, 'venue');
  assert.match(r.message, /far-apart places/);
  // A clearly more important top match, or a nearby duplicate, is not ambiguous.
  resetGeocodeState();
  const r2 = await geocode('Taj Mahal Palace, Mumbai', deps(provider([json([
    venue(18.9217, 72.8330, 'Taj Mahal Palace, Colaba, Mumbai', { importance: 0.7 }),
    venue(18.9220, 72.8332, 'Taj Mahal Tower, Colaba, Mumbai', { importance: 0.69 }),
    venue(27.17, 78.04, 'Taj Mahal, Agra', { importance: 0.3 }),
  ])], [])));
  assert.equal(r2.status, 'verified');
  assert.equal(r2.ambiguous, false);
});

test('cache keeps provenance (no "cache" source), and unresolved answers are cached', async () => {
  const calls: Call[] = [];
  const clock = { t: 0 };
  const d = deps(provider([json([venue(15.5, 73.8, 'Taj Exotica, Benaulim, Goa')])], calls, clock), clock);
  const a = await geocode('Taj Exotica, Goa', d);
  const b = await geocode('taj exotica,   goa ', d);
  assert.equal(calls.length, 1);
  assert.equal(b.cached, true);
  assert.equal(b.source, 'nominatim');
  assert.equal(b.status, a.status);
  assert.equal(b.precision, a.precision);
  const u1 = await geocode('Unknown Hall, Nowhere', deps(provider([json([])], calls, clock), clock));
  const u2 = await geocode('Unknown Hall, Nowhere', deps(provider([json([])], calls, clock), clock));
  assert.equal(u1.status, 'unresolved');
  assert.equal(u2.cached, true);
});

test('provider throttle: requests are spaced 1.1 s apart; a long queue answers "busy" instead of waiting', async () => {
  const calls: Call[] = [];
  const clock = { t: 0 };
  const f = provider([json([venue(1, 1, 'A')])], calls, clock);
  await geocode('Place A, City', deps(f, clock));
  await geocode('Place B, City', deps(f, clock));
  await geocode('Place C, City', deps(f, clock));
  assert.deepEqual(calls.map(c => c.at), [0, 1100, 2200]);
  // A zero queue budget with a busy slot: answer immediately as a provider error (or approximate when known).
  const busy = await geocode('Place D, Goa', deps(f, clock, { maxQueueMs: 0 }));
  assert.equal(calls.length, 3);
  assert.equal(busy.status, 'approximate');
  assert.equal(busy.providerError, 'provider busy (local rate limit)');
});

test('disabled provider: only labelled known-destination approximations, otherwise unresolved', async () => {
  const d = deps(blocked, { t: 0 }, { providerDisabled: true });
  const a = await geocode('Some Hotel, Dubai', d);
  assert.equal(a.status, 'approximate');
  assert.equal(a.source, 'known-destination');
  const u = await geocode('Some Hotel, Atlantis', d);
  assert.equal(u.status, 'unresolved');
  assert.equal(u.lat, null);
});

test('route: per-client burst limit answers 429 with Retry-After', async () => {
  globalThis.fetch = provider([json([venue(1, 1, 'A')])], []);
  const req = () => new NextRequest('http://localhost/api/geocode?q=' + encodeURIComponent('Taj Exotica, Goa'), { headers: { 'x-forwarded-for': '203.0.113.7' } });
  let last: Response | null = null;
  for (let i = 0; i < 31; i++) last = await GET(req());
  assert.equal(last!.status, 429);
  assert.ok(Number(last!.headers.get('Retry-After')) >= 1);
  const other = await GET(new NextRequest('http://localhost/api/geocode?q=' + encodeURIComponent('Taj Exotica, Goa'), { headers: { 'x-forwarded-for': '198.51.100.9' } }));
  assert.equal(other.status, 200);
});
