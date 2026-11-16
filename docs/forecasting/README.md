# Forecast chronology: data cutoff, availability and the rolling-origin check

## Two dates, never interchanged

| Input | Meaning | Used for |
|---|---|---|
| `asOf` (plan API, required, `YYYY-MM-DD`) | Supplier **quote review date** | Quote expiry, days to travel, purchase timing |
| `forecastAsOf` (plan API and `PlanOptions`, optional) | Forecast **data cutoff**: the moment the forecast is made | Which history rows the demand model may use |

`forecastAsOf` is never derived from `asOf`. Without `forecastAsOf`, every supplied history row is used (unchanged
behaviour) and the plan API says so in `forecastData.note` ("not an as-of forecast").

## Availability rules (`src/lib/forecast-cutoff.ts`)

- A month is never usable before it has ended (00:00 UTC on the 1st of the next month).
- `history[].availableAt` (optional) records when a month's figure became available: `YYYY-MM-DD` (read as the end of
  that UTC day) or an ISO timestamp **with** an offset (`Z` or `+05:30`). Timestamps without an offset are rejected.
  A recorded time earlier than the month end is moved to the month end.
- Rows without `availableAt` are assumed available `availabilityLagDays` after the month end (default 0). Such rows
  make the forecast **not strictly as-of**; the API reports how many rows used the assumption (`rowsAssumedAvailability`,
  `strictAsOfItems`).
- The target travel month and later months are never inputs to that month's forecast.
- Several rows for one month with different `availableAt` are treated as vintages: the latest one available by the
  cutoff is used. With one row per month, earlier vintages cannot be reconstructed (stated in `revisionNote`).
- A cutoff given as `YYYY-MM-DD` means the end of that UTC day. For another time zone, pass a timestamp with offset.
- Invalid cutoffs or `availableAt` values are rejected by the API (400). In the library an invalid cutoff disables the
  learned forecast (the typed formula is used) rather than silently using every row.

The learned-demand cache key includes the cutoff and lag. Fitting, the learned-vs-seasonal-naive gate, the error spread,
elasticity and volatility all use only the selected rows. The planner (`optimizePortfolio`, `optimizePortfolioRisk`,
`evaluateDecisions`) and the model-risk check apply the plan's `forecastAsOf` to every product.

### Public-data portfolio

`publicPortfolio({ forecastAsOf })` applies the cutoff before scaling, so no later month affects the history, the scale
factor or the level. The snapshot has no release dates, so each source gets an assumed publication lag: the lag of its
latest month when the snapshot was built (DGCA 108 days, STB 47 days; `impliedLagDays`). Imputed months were filled
using the following month as well, so an imputed month is dropped until that following month is available. COVID shock
windows are defined with hindsight; they only decide which months are left out of fitting, never values.

## Rolling-origin comparison (`scripts/forecast-rolling-origin.ts`)

Reproduce (deterministic, no network, about 50 s per run on this sandbox):

```
npx tsx scripts/forecast-rolling-origin.ts --out docs/forecasting/rolling-origin.json --md docs/forecasting/rolling-origin.md
npx tsx scripts/forecast-rolling-origin.ts --lag dgca=30,stb=30 --out docs/forecasting/rolling-origin-lag30.json --md docs/forecasting/rolling-origin-lag30.md
npx tsx scripts/forecast-rolling-origin.ts --lag dgca=0,stb=0 --out docs/forecasting/rolling-origin-lag0.json --md docs/forecasting/rolling-origin-lag0.md
```

Protocol: forecasts are made on the 1st of each month for the travel month h = 3 or 6 months later, from the months
available on that date. Holdout targets run from 2024-01 to the end of each series (13 public series, 393 scored
forecasts per horizon). The planner candidate is `learnDemand` with `forecastAsOf`, so its own gate chooses between
the learned model and seasonal-naive using only data available at each origin. A separate online selector and the
baseline intervals use only forecasts whose targets were available at the origin. Selection never sees a holdout
outcome early. The full tables per segment are in the `.md` files.

All 13 series pooled. Ratio = MAE ÷ seasonal-naive MAE on the same targets (below 1 is better). Coverage = share of
actuals inside the planner's 80% band:

| Assumed publication lag | h | Planner MAE ratio | Planner 80% coverage | Seasonal-naive conformal 80% coverage |
|---|---|---|---|---|
| Snapshot-implied (DGCA 108 d, STB 47 d) | 3 | 1.073 | 58.8% | 83.7% |
| Snapshot-implied | 6 | 1.343 | 52.9% | 81.7% |
| 30 days | 3 | 1.006 | 66.7% | 83.7% |
| 30 days | 6 | 1.189 | 58.0% | 83.5% |
| 0 days (month available when it ends) | 3 | 0.919 | 73.0% | 83.7% |
| 0 days | 6 | 1.125 | 62.1% | 84.0% |

What this shows, and what it does not:
- When the gate falls back, the planner's forecast is exactly seasonal-naive (verified: identical on all fallback
  targets). The difference comes entirely from the targets where the gate chose the learned model.
- With fresh data and a short horizon, the learned model helps (0.919 at lag 0, h = 3). With realistic publication
  lags or a 6-month horizon, the planner is no better than "same month last year", and worse at h = 6.
- The planner's 80% band, calibrated on its internal backtest, **under-covers** in every setting (53–73%). The
  existing `tests/forecast-calibration.test.ts` reports 81.4% under a different protocol: no publication lag, the
  learned model always, and data up to the origin month. For market-level histories (the public portfolio), the risk
  scenarios use the larger of the learned spread and the typed product volatility (0.26–0.30), so the scenario spread
  there is wider than this band. For product-level histories the learned spread is used directly.
- Nothing was tuned on these results. Changing the gate or the band now would use the holdout for model selection; a
  change should be pre-registered and evaluated on months after 2026-07.
- This is a pseudo-out-of-sample study. Availability is assumed (no release dates in the snapshot), values are the
  latest revisions, and the series are market-level proxies (air passengers, room nights), not TBO bookings.
  Consecutive monthly forecasts overlap, so n counts forecasts, not independent tests. It makes no prospective claim.

## Known leakage channel not changed on this branch

The planner's internal backtest projects each fold with the **target month's recorded price and signal**. This is
designed as a conditional forecast: the planner sets its own price, and the signal is meant to be forward-looking. If a
history's `signal` column is contemporaneous (measured during the month itself), this is look-ahead: the gate and
error spread for that product would be optimistic. The public-data portfolio has no signal or price columns and is
unaffected. Fixing it would change v5 gating for existing histories with signals, so it is left as a documented
follow-up: use the signal known at each origin in the backtest.
