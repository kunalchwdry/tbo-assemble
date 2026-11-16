# Backend / engine change log — branch `backend/engine-reliability`

Base: `origin/main` at `d9ff229` (the deployed production commit). Nothing on this branch has been pushed or deployed.
Each entry lists what changed, why, and how it was verified. Commands are run from the repository root.

## Baseline (d9ff229, before any change)

| Check | Command | Result |
|---|---|---|
| Unit tests | `npx tsx tests/<file>.test.ts` for each of the 65 files | 63 pass, 2 fail: `plan-api.test.ts` needs a running server on 127.0.0.1:3000; `booking-capacity.integration.test.ts` refuses to run without an isolated test database (by design) |
| Type check | `npx tsc --noEmit -p .` | 0 errors |
| Lint (whole repo) | `npx eslint .` | 49 errors, 40 warnings in 433 files: 28 `no-require-imports` (CommonJS test scripts and legacy `.js`), 15 `react-hooks/set-state-in-effect` (dashboard components), 6 `react/no-unescaped-entities` |
| Production build | `npx next build` | passes (Turbopack, 49 s) — the sandbox needed 3 GB of swap; without it the build was killed for memory (exit 137) |

## 1. Geocoding: honest outcomes instead of a silent Bengaluru default

**Problem (reproduced with a mocked, offline geocoder — no live calls):** `/api/geocode` answered every unresolved
query with central Bengaluru (12.9716, 77.5946) labelled `source: "nominatim"`; known-destination guesses were also
labelled `nominatim`; the destination match was a substring test, so "Hotel Goalpara Residency, Assam" was placed in
Goa; cached answers lost their provenance (`source: "cache"`). The event venue map also defaulted to Bengaluru and
dropped a venue pin there when it had no coordinates.

**Change:**
- `src/lib/geocode.ts` (new): structured outcomes `verified | approximate | unresolved | error` with `source`
  (`nominatim | known-destination | null`), `precision` (`venue | locality | region-centroid | null`), `approximate`,
  `ambiguous`, `matchedQuery`, `cached`, `message`, `providerError`, `attribution`. Unresolved and provider-error
  answers carry no coordinates. Area-level and locality-fallback matches are `approximate`; far-apart matches with
  similar confidence are flagged `ambiguous`. Known destinations match whole words only and are always
  `approximate` / `region-centroid`.
- Provider etiquette: ≤ 1 request/second per instance (queued up to 3 s, otherwise answered as "busy"), 5 s timeout,
  identifying User-Agent (repository URL; optional `GEOCODER_CONTACT`), bounded LRU cache (500 entries; 24 h for
  answers, 1 h for unresolved; provider errors are not cached). `GEOCODER_DISABLED=1` turns the live provider off.
- `src/lib/rate-limit.ts`, `src/lib/route-limits.ts` (new): per-instance burst limiter (30 requests/min/client for
  geocoding) with `Retry-After`. Best effort on serverless — not a global limit.
- `src/app/api/geocode/route.ts`: HTTP 200 for answers (including `unresolved`), 400 invalid query, 429 burst limit,
  503 provider failure without a labelled fallback. `lat`, `lng`, `displayName`, `source` keep their names.
- `src/components/dashboard/venue-map-inner.tsx`: no default city; "Location not found" instead of a pin when there
  are no coordinates; approximate matches are zoomed out and labelled "Approximate location".

**Verified:** `npx tsx tests/geocode.test.ts` — 16/16 (success, area-level, locality fallback, no result, network
failure with and without a known destination, HTTP 500/429, timeout, malformed body and rows, ambiguity, cache
provenance, throttle spacing on a fake clock, disabled provider, route burst limit). A guard fails the suite if any
unmocked `fetch` is attempted.
