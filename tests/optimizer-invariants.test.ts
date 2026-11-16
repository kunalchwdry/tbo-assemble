/**
 * Invariants of the risk-cvar-v5 planner that complement tests/risk-optimizer.test.ts, risk-large.test.ts and
 * risk-v5-extensions.test.ts: an independent recomputation of every row's spend, edge budgets on both budget bases,
 * the quote-expiry boundary, extreme and degenerate inputs, seeds, service targets that cannot be met, plan API vs
 * library consistency, an exhaustive 3-product check of the default solver, and what the objective / bound / gap
 * refer to. All inputs are synthetic.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { opportunities, type Opportunity, type PlanRow } from '../src/lib/procurement-core';
import { optimizePortfolio } from '../src/lib/portfolio-optimizer';
import { evaluateDecisions, riskModelInternals, RISK_ENGINE_DEFAULTS, DEFAULT_ALLOTMENT_DEPOSIT } from '../src/lib/risk-optimizer';
import { buildScenarioSet } from '../src/lib/risk-scenarios';
import { syntheticPortfolio } from '../src/lib/synthetic-portfolio';
import { POST } from '../src/app/api/procurement/plan/route';

const asOf = '2026-11-16', engine = 'risk-cvar-v5' as const;
const fast = { asOf, engine, scenarioCount: 150, evaluationCount: 400 };
const total = (rows: PlanRow[], key: 'spend' | 'qty') => rows.reduce((s, r) => s + r[key], 0);

/** Spend recomputed from the row's own terms, independent of the engine's `capital`. */
function expectedSpend(r: PlanRow, basis: 'cash' | 'capital-at-risk') {
  const q = r.prepaidQty ?? 0, a = r.allotQty ?? 0;
  if (q + a === 0) return 0;
  const deposit = Math.min(1, Math.max(0, r.allotmentDepositPct ?? DEFAULT_ALLOTMENT_DEPOSIT));
  const perAllot = basis === 'cash' ? (r.allotmentBuy ?? 0) : deposit * (r.allotmentBuy ?? 0);
  return q * r.buy + a * perAllot + Math.max(0, r.fixedOrderFee ?? 0);
}
function assertFeasible(rows: PlanRow[], budget: number, basis: 'cash' | 'capital-at-risk', label: string) {
  assert.ok(total(rows, 'spend') <= budget + 1e-6, `${label}: spend ${total(rows, 'spend')} > budget ${budget}`);
  for (const r of rows) {
    const q = r.prepaidQty ?? 0, a = r.allotQty ?? 0;
    assert.ok(Number.isInteger(q) && Number.isInteger(a) && q >= 0 && a >= 0, `${label} ${r.id}: integer, non-negative`);
    assert.equal(r.qty, q + a, `${label} ${r.id}: qty = prepaid + allotment`);
    assert.ok(r.qty <= Math.max(0, Math.floor(r.capacity)), `${label} ${r.id}: capacity`);
    assert.ok(a <= Math.max(0, Math.floor(r.allotmentCapacity ?? 0)), `${label} ${r.id}: allotment capacity`);
    if (!((r.allotmentBuy ?? 0) > 0)) assert.equal(a, 0, `${label} ${r.id}: no allotment terms, no allotment units`);
    assert.ok(q === 0 || q >= Math.max(1, Math.floor(r.minOrderUnits ?? 1)), `${label} ${r.id}: minimum order`);
    assert.ok(Math.abs(r.spend - expectedSpend(r, basis)) <= 1e-6 * Math.max(1, r.spend), `${label} ${r.id}: spend ${r.spend} vs ${expectedSpend(r, basis)}`);
    assert.ok(Math.abs(r.spend - ((r.prepaidSpend ?? 0) + (r.allotSpend ?? 0))) <= 1e-6 * Math.max(1, r.spend), `${label} ${r.id}: spend split`);
    for (const k of ['price', 'spend', 'expectedProfit', 'downsideProfit', 'expectedSold', 'forecast'] as const) assert.ok(Number.isFinite(r[k]), `${label} ${r.id}: finite ${k}`);
  }
}

test('every row: spend recomputed from its own terms (fixed fee, allotment basis) and all hard limits, on both bases', () => {
  const items = syntheticPortfolio(60, 7);
  for (const basis of ['cash', 'capital-at-risk'] as const)
    for (const budget of [1, 25_000, 400_000, 3_000_000, 50_000_000]) {
      const plan = optimizePortfolio(items, budget, 0.35, { ...fast, budgetBasis: basis });
      assertFeasible(plan.rows, budget, basis, `${basis} ₹${budget}`);
      assert.equal(plan.risk!.budgetBasis, basis);
    }
});

test('a budget equal to one minimum order buys exactly what fits; one rupee less buys nothing of it', () => {
  const only: Opportunity = { ...opportunities[0], id: 'one', minOrderUnits: 10, fixedOrderFee: 5000, allotmentBuy: undefined, allotmentCapacity: undefined, quoteExpiry: '2026-12-31' };
  const exact = 10 * only.buy + 5000;
  const fits = optimizePortfolio([only], exact, 0, fast).rows[0];
  assertFeasible([fits], exact, 'cash', 'exact');
  assert.equal(fits.qty, 10, 'the minimum order including its fee fits exactly');
  const short = optimizePortfolio([only], exact - 1, 0, fast).rows[0];
  assert.equal(short.qty, 0);
  assert.equal(short.spend, 0);
});

test('quote expiry boundary: valid through its expiry date, excluded the day after (UTC dates)', () => {
  const item: Opportunity = { ...opportunities[0], id: 'q', quoteExpiry: '2026-11-16' };
  const onDay = optimizePortfolio([item], 5_000_000, 0.2, fast).rows[0];
  assert.notEqual(onDay.purchaseTiming, 'Quote expired');
  assert.ok(onDay.qty > 0, 'still orderable on the expiry date');
  const dayAfter = optimizePortfolio([item], 5_000_000, 0.2, { ...fast, asOf: '2026-11-17' }).rows[0];
  assert.equal(dayAfter.purchaseTiming, 'Quote expired');
  assert.equal(dayAfter.qty, 0);
  assert.equal(dayAfter.spend, 0);
  const allExpired = optimizePortfolio(opportunities.map(o => ({ ...o, quoteExpiry: '2026-01-01' })), 5_000_000, 0.2, fast);
  assert.equal(total(allExpired.rows, 'qty'), 0, 'nothing is bought when every quote has expired');
  assert.ok(allExpired.rows.every(r => r.purchaseTiming === 'Quote expired'));
});

test('degenerate and extreme inputs stay finite and feasible; products that cannot sell are not bought', () => {
  const base = opportunities[1];
  const items: Opportunity[] = [
    { ...base, id: 'no-demand', bookings: 0, searches: 0, previousBookings: undefined, previousSearches: undefined, recoveryPct: 0, existingStock: 0 },
    { ...base, id: 'zero-capacity', capacity: 0 },
    { ...base, id: 'fractional-capacity', capacity: 3.7 },
    { ...base, id: 'calm', volatility: 0 },
    { ...base, id: 'wild', volatility: 3 },
    { ...base, id: 'loss-maker', buy: base.referencePrice * 4 },
    { ...base, id: 'huge', capacity: 1_000_000, bookings: 900_000, searches: 20_000_000 },
  ];
  for (const risk of [0, 0.5, 1, Number.NaN]) for (const budget of [0, 1e3, 1e9, Number.NaN, -5, Number.POSITIVE_INFINITY]) {
    const plan = optimizePortfolio(items, budget, risk, fast);
    const cap = Number.isFinite(budget) && budget > 0 ? budget : 0;
    assertFeasible(plan.rows, cap, 'cash', `risk ${risk} budget ${budget}`);
    const by = Object.fromEntries(plan.rows.map(r => [r.id, r]));
    assert.equal(by['no-demand'].qty, 0, 'no demand, no recovery: never bought');
    assert.equal(by['zero-capacity'].qty, 0);
    assert.ok(by['fractional-capacity'].qty <= 3);
    assert.ok(Number.isFinite(plan.objective) && Number.isFinite(plan.upperBound));
  }
});

test('seeds: same seed and inputs give identical plans for both solvers; other seeds stay feasible', () => {
  const items = syntheticPortfolio(25, 3);
  for (const solver of ['decomposition', 'local-search'] as const) {
    const run = (seed: number) => optimizePortfolio(items, 900_000, 0.35, { ...fast, seed, solver } as never);
    const a = run(42), b = run(42);
    assert.deepEqual(b.rows.map(r => [r.id, r.prepaidQty, r.allotQty, r.price]), a.rows.map(r => [r.id, r.prepaidQty, r.allotQty, r.price]));
    assert.equal(b.objective, a.objective);
    assert.equal(b.upperBound, a.upperBound);
    for (const seed of [1, 7, 20261116]) assertFeasible(run(seed).rows, 900_000, 'cash', `${solver} seed ${seed}`);
  }
  // Without asOf the library falls back to today's UTC date (quote expiry), so callers that need reproducibility pass it.
  const noDate = optimizePortfolio(items, 900_000, 0.35, { engine, scenarioCount: 150, evaluationCount: 400 });
  assertFeasible(noDate.rows, 900_000, 'cash', 'no asOf');
});

test('service targets: unreachable and zero-budget cases are explicit, never silently "met"', () => {
  const items = syntheticPortfolio(12, 5);
  const tiny = optimizePortfolio(items, 50_000, 0.3, { ...fast, serviceTarget: 0.95 });
  assert.equal(tiny.service!.status, 'unreachable');
  assert.ok(tiny.service!.servedShare < 0.95);
  assertFeasible(tiny.rows, 50_000, 'cash', 'unreachable target');
  const none = optimizePortfolio(items, 0, 0.3, { ...fast, serviceTarget: 0.5 });
  assert.equal(none.service!.status, 'unreachable');
  assert.equal(total(none.rows, 'spend'), 0);
  const expired = optimizePortfolio(items.map(o => ({ ...o, quoteExpiry: '2026-01-01' })), 5_000_000, 0.3, { ...fast, serviceTarget: 0.5 });
  assert.equal(expired.service!.status, 'unreachable', 'expired quotes cannot serve a target');
  const off = optimizePortfolio(items, 900_000, 0.3, fast);
  assert.equal(off.service!.status, 'off');
});

test('plan API and library agree on the same inputs (rows, totals, bound)', async () => {
  const items = syntheticPortfolio(30, 11).map(({ id, name, destination, kind, period, buy, referencePrice, capacity, bookings, searches, conversion, seasonal, signal, cancellations, volatility, soldOut, integration, timing, quoteExpiry, minOrderUnits, fixedOrderFee, allotmentBuy, allotmentDepositPct, allotmentCapacity, existingStock }) =>
    ({ id, name, destination, kind, period, buy, referencePrice, capacity, bookings, searches, conversion, seasonal, signal, cancellations, volatility, soldOut, integration, timing, quoteExpiry, minOrderUnits, fixedOrderFee, allotmentBuy, allotmentDepositPct, allotmentCapacity, existingStock }));
  const res = await POST(new Request('http://localhost/api/procurement/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, budget: 1_500_000, risk: 0.35, asOf, engine, budgetBasis: 'capital-at-risk' }) }));
  assert.equal(res.status, 200);
  const body = await res.json();
  const rows: PlanRow[] = body.recommendations;
  assertFeasible(rows, 1_500_000, 'capital-at-risk', 'api');
  assert.ok(Math.abs(body.summary.spend - total(rows, 'spend')) < 1e-6);
  assert.equal(body.summary.units, total(rows, 'qty'));
  assert.ok(body.optimization.upperBound + 1e-6 >= body.optimization.objective);
  // Same inputs through the library (the API parses the same fields): identical decisions.
  const { readInventoryCSV, columns, optionalColumns } = await import('../src/lib/inventory-csv');
  const keys = [...columns, ...optionalColumns];
  const csv = [keys.join(','), ...items.map(it => keys.map(k => `"${String((it as Record<string, unknown>)[k] ?? '').replaceAll('"', '""')}"`).join(','))].join('\n');
  const lib = optimizePortfolio(readInventoryCSV(csv), 1_500_000, 0.35, { asOf, engine, budgetBasis: 'capital-at-risk' });
  assert.deepEqual(rows.map(r => [r.id, r.prepaidQty, r.allotQty, r.price]), lib.rows.map(r => [r.id, r.prepaidQty, r.allotQty, r.price]));
  assert.equal(body.optimization.objective, lib.objective);
});

/** Three small products with allotments, minimum orders and fees; the budget binds in most cases. */
function trio(k: number) {
  let s = 77 + k * 104729;
  const r = () => { s = (s * 48271) % 2147483647; return s / 2147483647; };
  const items: Opportunity[] = [0, 1, 2].map(i => ({
    ...opportunities[i], id: `t${k}-${i}`, destination: ['Goa', 'Dubai', 'Bali'][i], buy: 40 + Math.floor(r() * 50), referencePrice: 95 + Math.floor(r() * 70),
    capacity: 1 + Math.floor(r() * 4), bookings: 1 + Math.floor(r() * 5), searches: Math.floor(r() * 50), conversion: 0.05, existingStock: k % 4 === 0 && i === 0 ? 1 : 0,
    volatility: 0.1 + r() * 0.6, quoteExpiry: '2026-12-31', minOrderUnits: (k + i) % 4 === 0 ? 2 : undefined, fixedOrderFee: (k + i) % 3 === 0 ? 25 : undefined,
    allotmentBuy: (k + i) % 2 ? 55 + Math.floor(r() * 40) : undefined, allotmentDepositPct: 0.3, allotmentCapacity: (k + i) % 2 ? 2 : undefined,
  }));
  return { items, budget: 80 + Math.floor(r() * 350), risk: [0, 0.35, 0.8][k % 3], basis: (k % 5 === 0 ? 'capital-at-risk' : 'cash') as 'cash' | 'capital-at-risk' };
}

test('independent check: exhaustive enumeration on 3-product instances (default solver, both bases)', () => {
  const { buildModel, profit, capital, objectiveOf } = riskModelInternals;
  const S = 60, kk = Math.ceil(RISK_ENGINE_DEFAULTS.alpha * S), work = new Float64Array(S), P = new Float64Array(S);
  let worstGap = 0;
  for (let k = 0; k < 40; k++) {
    const { items, budget, risk, basis } = trio(k);
    const plan = optimizePortfolio(items, budget, risk, { asOf, engine, scenarioCount: S, evaluationCount: 200, seed: 5 + k, budgetBasis: basis });
    assertFeasible(plan.rows, budget, basis, `trio ${k}`);
    const set = buildScenarioSet(items, S, 5 + k);
    const models = items.map((item, i) => buildModel(item, i, set, plan.rows[i].price, asOf, 0, basis));
    const options = models.map(m => {
      const out: [number, number][] = [];
      for (let q = 0; q <= m.cap; q++) for (let a = 0; a <= m.capAllot && q + a <= m.cap; a++) if (!(q > 0 && q < m.minimum)) out.push([q, a]);
      return out;
    });
    let best = -Infinity;
    for (const [q0, a0] of options[0]) for (const [q1, a1] of options[1]) for (const [q2, a2] of options[2]) {
      if (capital(models[0], q0, a0) + capital(models[1], q1, a1) + capital(models[2], q2, a2) > budget + 1e-9) continue;
      for (let s = 0; s < S; s++) P[s] = profit(models[0], q0, a0, s) + profit(models[1], q1, a1, s) + profit(models[2], q2, a2, s) + models[0].stockTerm[s] + models[1].stockTerm[s] + models[2].stockTerm[s];
      best = Math.max(best, objectiveOf(P, risk, kk, work));
    }
    // The plan's objective is the optimisation-scenario objective of its own decisions at its chosen prices.
    for (let s = 0; s < S; s++) P[s] = models.reduce((sum, m, i) => sum + profit(m, plan.rows[i].prepaidQty ?? 0, plan.rows[i].allotQty ?? 0, s) + m.stockTerm[s], 0);
    const own = objectiveOf(P, risk, kk, work);
    assert.ok(Math.abs(own - plan.objective) <= 1e-6 * Math.max(1, Math.abs(own)), `trio ${k}: objective ${plan.objective} is not the optimisation-set value ${own}`);
    assert.ok(plan.objective <= best + 1e-6, `trio ${k}: objective above the enumerated optimum`);
    assert.ok(plan.upperBound + 1e-6 >= best, `trio ${k}: bound ${plan.upperBound} below the enumerated optimum ${best}`);
    worstGap = Math.max(worstGap, (best - plan.objective) / Math.max(1, Math.abs(best)));
  }
  assert.ok(worstGap <= 0.03, `worst shortfall vs exhaustive optimum ${worstGap}`);
});

test('scope of objective, bound and gap: optimisation scenarios only; reported risk metrics are a separate evaluation draw', () => {
  const items = syntheticPortfolio(15, 9);
  const opts = { asOf, engine, scenarioCount: 200, evaluationCount: 1000, seed: 99 };
  const plan = optimizePortfolio(items, 700_000, 0.35, opts);
  const decisions = plan.rows.map(r => ({ prepaid: r.prepaidQty ?? 0, allotment: r.allotQty ?? 0, price: r.price }));
  const evaluation = evaluateDecisions(items, decisions, 0.35, opts);
  assert.ok(Math.abs(evaluation.metrics.expectedProfit - plan.risk!.expectedProfit) <= 1e-6 * Math.abs(plan.risk!.expectedProfit), 'reported expected profit = evaluation set');
  const evalObjective = 0.65 * plan.risk!.expectedProfit + 0.35 * plan.risk!.cvar;
  assert.notEqual(evalObjective, plan.objective, 'the objective (and its bound and gap) are on the optimisation set, not the reported metrics');
  assert.equal(plan.gap, Math.max(0, plan.upperBound - plan.objective), 'gap is absolute (₹ of objective), bound minus objective');
});
