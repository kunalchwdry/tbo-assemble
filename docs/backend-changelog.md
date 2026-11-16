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

## 2. Forecast chronology: an explicit data cutoff, separate from the quote review date

**Problem:** `learnDemand` fitted, gated and calibrated on every history row supplied; the only date the plan API took
(`asOf`) was the supplier-quote review date, and the learned-demand cache key had no date. Public-portfolio histories
were scaled with the latest 12 snapshot months regardless of any decision date, and two imputed DGCA months were
filled using the following month. Nothing could produce or test an as-of forecast.

**Change:**
- `src/lib/forecast-cutoff.ts` (new): availability rules (month end, recorded `availableAt` with explicit time zone,
  assumed publication lag, target month never an input, vintages, fail closed on invalid values) and a report of what
  was used, including whether the result is strictly as-of.
- `forecastAsOf` on `PlanOptions`, `Opportunity` and the plan API (optional; never derived from `asOf`), per-item
  `availabilityLagDays` and per-row `availableAt`. `optimizePortfolio`, `optimizePortfolioRisk`, `evaluateDecisions`
  and `checkModelRisk` apply it to every product. The learned-demand cache key includes the cutoff and lag.
- Plan API response: `forecastData` (counts only) — rows supplied, used, after the cutoff, at or after the target,
  assumed availability, strict as-of items — and an explicit note when no cutoff was given.
- `publicPortfolio({ forecastAsOf })`: cutoff applied before scaling, snapshot-implied publication lag per source,
  imputed months dropped while their following month is unavailable. The default call is unchanged.
- `scripts/forecast-rolling-origin.ts` + `docs/forecasting/`: reproducible rolling-origin comparison (planner rule,
  learned model, seasonal-naive, last-observed, online selection) with per-segment n, WAPE, MAE ratio and 80% coverage,
  at three publication-lag assumptions. Results are reported as they came out; nothing was tuned on them.
- Docs: `docs/forecasting/README.md`; `public/research/public-data-portfolio.md` now labels the gate scores as
  selection evidence and links the as-of results.

**Verified:** `npx tsx tests/forecast-cutoff.test.ts` — 14/14, including the plan API POST handler. Mutation checks
(cutoff ignored, cutoff missing from the cache key, scaling from all months, imputed look-ahead kept) each make
1–7 of these tests fail. Rolling-origin output is byte-identical across two runs. Full unit suite: 66 files, 64 pass,
the same 2 environment-dependent failures as the baseline. `tsc` 0 errors; eslint clean on changed files.

**Findings (not fixed here, documented):** under the as-of protocol the planner is no better than "same month last
year" except with fresh data at 3 months ahead, and its 80% band under-covers (53–73%). The backtest uses the target
month's recorded signal (look-ahead if the signal is contemporaneous; the public portfolio has no signal column).

## 3. Optimisation audit: invariants, exhaustive check, bound scope, benchmark (no maths changed)

**Change:** tests and documentation only.
- `tests/optimizer-invariants.test.ts` (9 tests):
  - every row's spend recomputed from its own terms (fixed fee, allotment basis) on both budget bases;
  - an exact-fit minimum order;
  - the quote-expiry boundary (UTC);
  - degenerate and extreme inputs (NaN, negative or infinite budgets, NaN risk, zero capacity or demand, volatility
    0/3, very large capacities);
  - identical plans for identical seeds (both solvers);
  - unreachable service targets (small or zero budget, all quotes expired);
  - plan API vs library consistency;
  - an exhaustive enumeration on 40 three-product instances with allotments, minimums and fees;
  - the scope of objective, bound and gap (optimisation scenarios only).
- `scripts/benchmark-optimizer.ts`: fresh process per size, cold and warm runs, peak RSS, environment and command;
  results in `docs/optimisation/benchmark.{md,json}`.
- `docs/optimisation/README.md`: audit table, independent check, bound scope, modelled vs observed, benchmark, states.

**Verified:** 9/9 pass. The default solver matched the enumerated optimum on all 40 instances (worst shortfall
2 × 10⁻¹⁶); the bound was never below it but can be loose on tiny instances. Benchmark (2 vCPU sandbox): 1,000
products 3.00 s cold / 2.87 s warm, peak RSS 191 MB; 2,000 products 7.77 s, 259 MB; plan API handler at 1,000
products 4.07 s.

**Findings (documented, not changed):** without `asOf` the library uses today's date for quote expiry, so callers
needing reproducibility must pass it (the API requires it). The background-plan hook keeps an old error visible when
budget or risk change after a failure (frontend-owned; fix suggested).

## 4. Multi-user and API: owner-scoped replacement (disabled), plan rate limit, endpoint review

**Problem:** the legacy event, guest and booking routes have no authentication (production probe, counts only: 7
events, 142 guests). Prisma bypasses Supabase RLS, so the RLS policies in `docs/security` do not protect them. The
plan API had no burst limit, although `routeLimiters.plan` already existed.

**Change:**
- `src/lib/access/event-access.ts`: one pure authorization decision.
  - 401 without a session; 404 for missing or other users' resources (identical, no enumeration).
  - Unclaimed (ownerless) events are never exposed by the new API.
  - Narrow public and booking-holder views.
- `src/lib/access/owner-scope-handlers.ts` + `owner-scope-deps.ts` + `src/app/api/v2/{events,events/[eventId],guests,bookings/[bookingId]}`:
  - owner-scoped read API, **off unless `OWNER_SCOPE_API=1`** (503 otherwise);
  - the real wiring is loaded only when enabled. It uses Supabase `getUser()` and code-scoped Prisma queries, and reads
    the draft `Agent."authUserId"` column with parameterised SQL (Prisma schema unchanged).
- Plan API: `routeLimiters.plan` wired in. 20 valid plans per minute per client and instance, then 429 with
  `Retry-After`. Invalid requests are rejected first and do not count.
- `docs/security/owner-scoped-migration.md`: exposure, design, migration steps with approval gates (the 7 ownerless
  events stay as they are by default), shared-link compatibility, public-endpoint resource review.

**Not changed:** legacy routes, public pages, Prisma schema, database, Supabase or Vercel settings.

**Verified:**
- `tests/owner-scope.test.ts`: 7/7 with local mocks. Five deliberate policy and handler breaks are each caught.
- `tests/plan-rate-limit.test.ts`: 2/2.
- Existing plan API tests still pass: risk-v5-extensions 11/11, public-portfolio 5/5, forecast-cutoff 14/14.
- `tsc` 0; eslint clean on changed files.
- The real Supabase/Prisma wiring is **not** tested against a database: no accessible project, and the column does
  not exist yet.

## 5. Verification at the branch tip, and API docs

The branch was rebased onto `origin/main` 58b2275 (three frontend commits: homepage and inventory workspace; no file
overlaps with this branch). Checks ran on 276b782, the code tip; this commit changes docs only.

| Check | Baseline (d9ff229) | Branch tip |
|---|---|---|
| Unit files (`tsx`, one at a time) | 65 files: 63 pass, 2 fail | 69 files: 67 pass, 2 fail (the same 2: `plan-api.test.ts` needs a server on :3000; `booking-capacity.integration` needs an isolated database) |
| Unit test cases in passing files | not recorded | 226 pass, 0 fail (48 new: geocode 16, forecast-cutoff 14, optimizer-invariants 9, owner-scope 7, plan-rate-limit 2) |
| `tsc --noEmit` | 0 errors | 0 errors |
| `eslint .` | 433 files, 49 errors, 40 warnings | 453 files, 49 errors, 40 warnings (identical per file; all new files clean) |
| `next build` (2 GB RAM + 3 GB swap) | exit 0, 49 s, 44/44 static pages | exit 0, 43 s, 44/44 static pages; `/api/v2/*` dynamic |

Docs: the README and `public/research/risk-engine.md` describe `forecastAsOf`/`forecastData` and the plan API's 429
burst limit (per instance; not a substitute for authentication).
