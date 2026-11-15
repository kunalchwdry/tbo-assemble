# Directional Indian passenger traffic: retrospective validation

This research test uses the same DGCA-derived city-pair data as [India Travel Data](india-market-data.md), served by `/api/india-market/traffic`. The upstream database is [Vonter/india-aviation-traffic](https://github.com/Vonter/india-aviation-traffic), licensed ODbL 1.0; see that project's licence and attribution requirements. These are *industry-wide passengers carried*, not TBO searches or bookings, purchasable seats, airfares or hotel demand. No results feed the procurement allocator. This is not a commercially validated forecasting system.

## Rules and timing

The target is total passengers for one calendar month in one directional city pair. A target month `t` uses only records for `t−2` or earlier: it assumes the final totals for `t−2` became available by the month before `t`, a one-month reporting delay. This is an **assumption**, not verified historical publication timing. Actual release delays may be longer, and the source may contain revisions that were not known at that historical date. Therefore these results are retrospective and potentially optimistic. Values from target month or later are never used in that target's forecast. Missing, invalid, conflicting or duplicate monthly records are excluded, not interpreted as zeros.

Three fixed rules are considered:

1. **Last observed:** use `t−2` passengers.
2. **Last year:** use `t−12` passengers.
3. **Seasonal ratio:** multiply `t−2` by `t−12 / t−14`, with the seasonal ratio limited to 0.5–2.0. This requires a positive `t−14` value.

For each target, evaluate those rules on the 12 earlier completed target months from `t−13` to `t−2`. Each replay itself can use only data up to its own `t−2`. Compare the rules on the same months with all three predictions present; choose the lowest mean absolute error (MAE) if at least eight comparable examples exist. Otherwise fall back to last year, or last observed if the year is missing. This selection rule is applied separately for every historical target; no aggregate holdout outcomes are used to tune its parameters.

## Fixed retrospective comparison and display gate

The app tests January 2024 through December 2025. The model was designed after examining the source, so this is not an untouched holdout. It reports MAE for the adaptive procedure and both baseline rules on the same target months. Missing months are omitted. At least 12 matched outcomes must exist. For the adaptive estimate to be displayed, its MAE must be **more than 5% lower than both** baselines, at least eight prior replay examples must be available for the current choice, and the latest usable source month must be exactly the month before the current UTC month. If the adaptive method does not pass the comparison, the display falls back to the baseline with the lower retrospective MAE; the same data are used to select and score this baseline, so its displayed error is not independent. The forecast target is two months after that latest observation, strictly in the future. Otherwise the current estimate is withheld; the historical benchmark comparison is still shown. This strict gate is a conservative product rule, not a statistical guarantee or prospective validation.

Tests use the modern retrieved CSV, not archived month-by-month publication snapshots. Input data, the model rules, the fixed 2024–25 period and gate were chosen for a prototype; future performance is unknown. Even a passing route is not evidence of accuracy for other routes, periods, prices or TBO. Passenger totals can be constrained by available capacity and cannot identify unmet demand, cancellations or search-to-book conversion. A descriptive historical-error range is shown only when a current estimate is eligible; it is not independently calibrated. Do not substitute these figures for net inventory demand or treat them as evidence that a supplier has seats.

## Reproduction

`studyTraffic` in `src/lib/india-traffic-forecast.ts` implements the replay and gate. Synthetic tests in `tests/india-traffic-forecast.test.ts` check temporal isolation, common-baseline comparison, missing/duplicate handling, benchmark failure and freshness withholding. Live values depend on the source CSV at retrieval time and may change after revisions. Every display includes the source retrieval time on the traffic chart.

## Baseline fallback, illustrative range and dated evidence

The current display uses the adaptive procedure only if its retrospective MAE beats both baselines by more than 5%. Otherwise it uses whichever baseline had lower retrospective MAE. This choice is made using the same retrospective outcomes being reported; it is **not an untouched test**. A rough 80% error radius is the `ceil((n+1)*0.8)`-th sorted absolute error on those same historical outcomes, clipped to the sample length; the lower endpoint is clipped at zero. This is descriptive, not an independently calibrated prediction interval. A fresh data observation is still required, and the feature pauses if the data retrieval timestamp is later than the viewer's clock by more than five minutes.

Signed-in users can manually save up to 100 account-scoped snapshots, at most one per route per UTC day. The server verifies the user, directly re-fetches the public source, stores the extracted directional series and a SHA-256 of the UTF-8 source text, then saves a future forecast only if the freshness and completeness gates pass. The browser cannot directly insert or read the underlying table; server access is scoped by verified user ID. No automatic provider calls or background forecast captures occur. A later snapshot taken after the target month ends can show the recorded forecast's absolute error. Later data can be revised and are not necessarily first-release actuals. Snapshots are retained until the associated account is deleted; there is currently no self-service snapshot deletion. The source is ODbL 1.0: consult the upstream license before redistribution or commercial use.

Server, database and device clocks must agree within five minutes for a capture. This detects major disagreement but does not establish independent trusted time. Historical publication timestamps before capture are not reconstructed. Previously observed clock inconsistencies remain unresolved; do not treat timestamps or saved forecasts as audit-grade evidence. Snapshots/forecasts are not TBO demand, supplier seats, or allocator inputs.
