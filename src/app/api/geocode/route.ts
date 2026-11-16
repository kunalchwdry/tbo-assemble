import { NextRequest, NextResponse } from "next/server";
import { defaultGeocodeDeps, geocode, httpStatusFor, normaliseQuery } from "@/lib/geocode";
import { clientKey, rateLimitHeaders } from "@/lib/rate-limit";
import { routeLimiters } from "@/lib/route-limits";

export const dynamic = "force-dynamic";

/**
 * GET /api/geocode?q=Venue, City
 *
 * Response (backward compatible: `lat`, `lng`, `displayName`, `source` keep their names):
 *   { status: 'verified' | 'approximate' | 'unresolved' | 'error', lat, lng, displayName, source, precision,
 *     approximate, ambiguous, matchedQuery, cached, message, providerError, attribution, query }
 * `lat`/`lng` are null unless a place was found; approximate coordinates are always labelled (`precision`).
 * HTTP 200 for answers (including `unresolved`), 400 for an invalid query, 429 when this client exceeds the burst
 * limit, 503 when the provider failed and no labelled approximation applies.
 */
export async function GET(request: NextRequest) {
  const norm = normaliseQuery(request.nextUrl.searchParams.get("q"));
  if (!norm.ok) {
    return NextResponse.json({ error: norm.error, status: "error" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const decision = routeLimiters.geocode.check(clientKey(request.headers));
  if (!decision.allowed) {
    return NextResponse.json(
      { error: "Too many geocoding requests; try again shortly.", status: "error" },
      { status: 429, headers: { "Cache-Control": "no-store", ...rateLimitHeaders(decision) } },
    );
  }
  const result = await geocode(norm.query, defaultGeocodeDeps());
  return NextResponse.json(result, {
    status: httpStatusFor(result),
    headers: { "Cache-Control": "no-store", ...rateLimitHeaders(decision) },
  });
}
