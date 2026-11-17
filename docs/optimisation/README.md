# risk-cvar-v5 audit: invariants, independent checks, bound scope and benchmark

Every number here comes from `tests/optimizer-invariants.test.ts`, the existing optimiser tests or
`scripts/benchmark-optimizer.ts`. All portfolios are synthetic: these results describe the **model's** behaviour, not
observed outcomes. No optimisation maths was changed on this branch.

## What the engine does (as audited)

| Area | Behaviour | Evidence |
|---|---|---|
| Scenarios | Correlated demand and price multipliers per product and region; deterministic by seed. Optimisation (500, seed) and evaluation (2,000, seed + 7919) are separate draws **from the same model**. | `risk-optimizer.test.ts` (determinism, correlation), invariants "seeds" |
| Budget basis | `cash` (default): allotment units count at the full allotment cost. `capital-at-risk`: at deposit × allotment cost. The fixed order fee counts once per product when any unit is ordered. | invariants: spend recomputed from each row's own terms on both bases |
| Joint price and quantity | Price options: the reference price ±15% in 2.5% steps. The bound covers every price option. | `risk-v5-extensions.test.ts`; invariants: exhaustive check at the chosen prices |
| Allotments | Allotment units ≤ allotment capacity, prepaid + allotment ≤ capacity, no allotment units without allotment terms; unsold allotment units forfeit the deposit. | invariants, `risk-optimizer.test.ts` |
| Minimum order and fee | Prepaid units are 0 or at least the minimum. A budget of exactly one minimum order plus its fee buys it; ₹1 less buys nothing. | invariants |
| Service target | Status `off`, `not-binding`, `met` or `unreachable`. Unreachable is reported for a small budget, a zero budget and when every quote has expired. | invariants, `risk-v5-extensions.test.ts`, `risk-large.test.ts` |
| Quote expiry | UTC date comparison against `asOf`: valid through the expiry date, excluded from the next day (capacity 0, "Quote expired"). Without `asOf` the library uses today's UTC date, so a plan can change from one day to the next; the plan API requires `asOf`. | invariants |
| Degenerate inputs | Non-finite or negative budgets plan as zero budget; non-finite risk as 0; zero-capacity and zero-demand products (no salvage) are never bought; volatility 0 or 3 and 1,000,000-unit capacities stay finite and feasible. | invariants |
| API vs library | The plan API returns the same decisions, objective and totals as calling the library with the same parsed inputs. | invariants |

## Independent check on small instances

`tests/optimizer-invariants.test.ts` enumerates every feasible quantity combination (prepaid and allotment, minimum
orders, fees, budget on both bases) for 40 random three-product instances. It uses the same scenario set and the
plan's chosen prices.
- The default solver's plan equals the enumerated optimum in all 40 cases (worst shortfall 2 × 10⁻¹⁶).
- The plan's `objective` equals the optimisation-scenario objective recomputed from its own decisions.
- `upperBound` is never below the enumerated optimum. The bound can be loose on tiny instances, though: in one case
  it was 231 against an optimum of 137.5, while the plan itself was optimal.

`risk-optimizer.test.ts` and `risk-large.test.ts` add the same check on 60 two-product cases for both solvers.

## Scope of `objective`, `upperBound` and `gap`

- They are computed on the **optimisation scenario set**, over the model's discrete price options. `gap` is absolute
  (₹ of objective): `max(0, upperBound − objective)`.
- They certify how close the plan is to the best plan **for that sampled model**. They say nothing about:
  - sampling error against the model's true distribution;
  - the reported risk metrics, which come from the separate 2,000-scenario evaluation draw (tested);
  - model error (demand, prices, correlations). For model error, see the model-risk check.
- All plan metrics (expected profit, CVaR10, P(loss), served share) are **modelled**. The evaluation draw is "out of
  sample" only with respect to sampling noise. It is not validation against observed outcomes, and none are
  available.

## Benchmark

Run `npx tsx scripts/benchmark-optimizer.ts --sizes 100,250,500,1000,2000 --repeats 3` (results in `benchmark.md` and
`benchmark.json`). Setup:
- Sandbox: Node 20.20.2, Linux, Intel Xeon @ 2.60 GHz, 2 logical CPUs, 1,983 MB RAM.
- Planner: risk-cvar-v5 defaults, risk 0.35.
- Budget: 35% of full-capacity cost, as in the app's scale test.

| Products | Cold run | Warm (median of 2) | Peak RSS (whole process) | Relative gap |
|---|---|---|---|---|
| 100 | 1.74 s | 1.54 s | 135 MB | 0.012% |
| 250 | 1.25 s | 1.09 s | 135 MB | 0.018% |
| 500 | 2.27 s | 2.07 s | 154 MB | 0.015% |
| 1,000 | 3.00 s | 2.87 s | 191 MB | 0.044% |
| 2,000 | 7.77 s | 7.57 s | 259 MB | 0.013% |

Notes on the table:
- **Plan API at 1,000 products:** the POST handler, in-process, returned HTTP 200 in 4.07 s with a 2.2 MB response.
- **Small portfolios:** 100 products take longer than 250 because the price-polish pass runs only up to 100 products.
- **Memory:** RSS before planning was 75–84 MB (Node, tsx and the modules).
- **Precision:** each size ran once in a fresh process, on a shared sandbox. Expect variance of a few tenths of a
  second.

## States the frontend can rely on

- **Plan API:** errors are 400 with a message, oversized requests are 413, and bursts get 429 with `Retry-After`. A
  service target that cannot be met reports `service.status = "unreachable"`, never a silent "met".
- **Background planning (`useBackgroundPlan`):** exposes `pending`, `stale` and `error`.
- **Finding (not changed; frontend-owned):** after a failed background plan, changing budget, risk or options with the
  same products keeps showing the old error with `pending = false` until the new run finishes. The failure is keyed
  by the product list only. Suggested fix: key it by the full input key, as `current` is.
