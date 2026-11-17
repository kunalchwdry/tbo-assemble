/**
 * Forecast chronology: the forecast data cutoff (`forecastAsOf`) is separate from the quote review date (`asOf`), and a
 * forecast made at a cutoff can only depend on observations available by then. All data here is synthetic or the
 * committed public snapshot; nothing calls a network service.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import snapshot from '../src/data/public-portfolio.json';
import { opportunities, type Opportunity } from '../src/lib/procurement-core';
import { learnDemand, demandSourceOf, forecastCutoffReport, type DemandHistoryPoint } from '../src/lib/learned-demand';
import { forecastUnconstrained } from '../src/lib/demand-unconstraining';
import { parseInstant, selectAvailableHistory, monthEndInstant, withForecastCutoff } from '../src/lib/forecast-cutoff';
import { optimizePortfolio } from '../src/lib/portfolio-optimizer';
import { checkModelRisk } from '../src/lib/model-risk';
import { impliedLagDays, publicPortfolio, publicPortfolioFrom, publicPortfolioWithCutoff, type Snapshot } from '../src/lib/public-portfolio';
import { POST } from '../src/app/api/procurement/plan/route';

const engine = 'risk-cvar-v5' as const;
const SEASON = [0.8, 0.75, 0.85, 0.9, 0.95, 1.0, 1.1, 1.05, 0.9, 1.0, 1.25, 1.45];
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const ym = (index: number) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
/** `months` monthly rows ending at `last` (YYYY-MM): seasonal, 8% growth, 6% noise, with prices and signals. */
function history(seed: number, months = 60, last = '2026-10'): DemandHistoryPoint[] {
  const r = rng(seed), end = Number(last.slice(0, 4)) * 12 + Number(last.slice(5, 7)) - 1, out: DemandHistoryPoint[] = [];
  for (let t = 0; t < months; t++) {
    const i = end - months + 1 + t, price = 9200 * (1 + 0.08 * (r() * 2 - 1)), signal = 100 * (1 + 0.2 * (r() * 2 - 1));
    const mean = 150 * Math.pow(1.08, (t - months) / 12) * SEASON[i % 12] * Math.pow(price / 9200, -2) * Math.pow(signal / 100, 0.5);
    out.push({ month: ym(i), bookings: Math.round(mean * Math.exp(0.06 * (r() * 2 - 1) * 1.7)), price: Math.round(price), signal: Math.round(signal) });
  }
  return out;
}
const product = (patch: Partial<Opportunity> = {}): Opportunity => ({ ...opportunities[0], period: 'Jan 2027', signal: 1, ...patch });
/** A copy of `rows` with `bookings` multiplied by `factor` for months matching `pick`. */
const scaled = (rows: DemandHistoryPoint[], pick: (month: string) => boolean, factor: number) => rows.map(r => (pick(r.month) ? { ...r, bookings: Math.round(r.bookings * factor) } : { ...r }));
/** Every learned output except the availability report (which counts supplied rows). */
const fitted = (item: Opportunity) => { const l = learnDemand(item); if (!l) return null; const { cutoff, ...rest } = l; void cutoff; return rest; };

test('parseInstant: dates mean the end of that UTC day; timestamps need an explicit offset', () => {
  const d = parseInstant('2026-09-30');
  assert.ok(d.ok && d.dateOnly && new Date(d.instant).toISOString() === '2026-09-30T23:59:59.999Z');
  const z = parseInstant('2026-10-01T00:00:00Z');
  assert.ok(z.ok && z.instant === Date.UTC(2026, 9, 1));
  const ist = parseInstant('2026-10-01T05:30:00+05:30');
  assert.ok(ist.ok && ist.instant === Date.UTC(2026, 9, 1), 'IST 05:30 is UTC midnight');
  const ms = parseInstant('2026-09-30T23:59:59.5Z');
  assert.ok(ms.ok && ms.instant === Date.UTC(2026, 8, 30, 23, 59, 59, 500));
  for (const bad of ['2026-02-30', '2026-13-01', '2026-09-30T10:00', '2026-09-30T10:00:00', '30/09/2026', '2026-09-30T24:00Z', '2026-09-30T10:00+15:00', '', 20260930, null]) {
    assert.equal(parseInstant(bad).ok, false, `rejects ${JSON.stringify(bad)}`);
  }
  assert.match((parseInstant('2026-09-30T10:00') as { error: string }).error, /offset/);
  assert.equal(monthEndInstant('2026-12'), Date.UTC(2027, 0, 1));
});

test('availability boundaries: a month counts only once it has ended (UTC), at or before the cutoff', () => {
  const rows: DemandHistoryPoint[] = [{ month: '2026-08', bookings: 10 }, { month: '2026-09', bookings: 11 }];
  const months = (cutoff: string, lagDays = 0) => { const s = selectAvailableHistory(rows, cutoff, { lagDays }); assert.ok(s.ok); return s.history.map(r => r.month); };
  assert.deepEqual(months('2026-09-30'), ['2026-08'], 'September is not over on 30 Sep (end of UTC day)');
  assert.deepEqual(months('2026-09-30T23:59:59.999Z'), ['2026-08']);
  assert.deepEqual(months('2026-10-01T00:00:00Z'), ['2026-08', '2026-09'], 'available exactly at the boundary');
  assert.deepEqual(months('2026-10-01T05:29:59+05:30'), ['2026-08'], 'IST time one second before UTC month end');
  assert.deepEqual(months('2026-10-01T05:30:00+05:30'), ['2026-08', '2026-09']);
  assert.deepEqual(months('2026-10-01T00:00:00-01:00'), ['2026-08', '2026-09'], 'negative offsets');
  assert.deepEqual(months('2026-10-15', 15), ['2026-08'], 'assumed publication lag: available 16 Oct');
  assert.deepEqual(months('2026-10-16T00:00:00Z', 15), ['2026-08', '2026-09']);
  assert.deepEqual(months('2026-08-31'), [], 'nothing available yet');
});

test('recorded availableAt: date or timestamp, never earlier than the month end; strict only when all are recorded', () => {
  const rows: DemandHistoryPoint[] = [
    { month: '2026-07', bookings: 9, availableAt: '2026-08-20' },
    { month: '2026-08', bookings: 10, availableAt: '2026-08-25' }, // before its month ended: moved to 1 Sep
    { month: '2026-09', bookings: 11, availableAt: '2026-10-10T12:00:00+05:30' },
  ];
  const at = (cutoff: string) => { const s = selectAvailableHistory(rows, cutoff); assert.ok(s.ok); return s; };
  assert.deepEqual(at('2026-08-31').history.map(r => r.month), ['2026-07']);
  const sep = at('2026-09-01T00:00:00Z');
  assert.deepEqual(sep.history.map(r => r.month), ['2026-07', '2026-08']);
  assert.equal(sep.report.availableBeforeMonthEnd, 1);
  assert.deepEqual(at('2026-10-10T06:29:59Z').history.map(r => r.month), ['2026-07', '2026-08']);
  const oct = at('2026-10-10T06:30:00Z');
  assert.deepEqual(oct.history.map(r => r.month), ['2026-07', '2026-08', '2026-09']);
  assert.equal(oct.report.strictAsOf, true);
  assert.match(oct.report.note, /^Strict as-of/);
  const mixed = selectAvailableHistory([...rows, { month: '2026-06', bookings: 8 }], '2026-12-01');
  assert.ok(mixed.ok && !mixed.report.strictAsOf && mixed.report.assumedAvailability === 1 && mixed.report.recordedAvailability === 3);
  assert.match(mixed.report.note, /Not a strict as-of backtest: 1 of 4 rows/);
});

test('invalid rows fail closed, target month and later are never used, report counts add up', () => {
  const rows = [
    { month: '2026-05', bookings: 5 }, { month: '2026-5', bookings: 5 }, { month: '2026-06', bookings: 6, availableAt: '2026-07-01T00:00' },
    { month: '2026-07', bookings: 7 }, { month: '2026-08', bookings: 8 }, { month: '2026-09', bookings: 9 },
  ] as DemandHistoryPoint[];
  const s = selectAvailableHistory(rows, '2026-12-31', { targetMonthIndex: 2026 * 12 + 7 }); // target August 2026
  assert.ok(s.ok);
  assert.deepEqual(s.history.map(r => r.month), ['2026-05', '2026-07']);
  const r = s.report;
  assert.equal(r.invalid, 2);
  assert.equal(r.droppedAtOrAfterTarget, 2);
  assert.equal(r.supplied, r.eligible + r.droppedAfterCutoff + r.droppedAtOrAfterTarget + r.invalid + r.supersededVintages);
  assert.deepEqual(selectAvailableHistory(rows, 'yesterday'), { ok: false, error: 'forecastAsOf must be YYYY-MM-DD or an ISO timestamp with an offset.' });
});

test('vintages: the latest revision available by the cutoff is used; later revisions cannot leak back', () => {
  const rows: DemandHistoryPoint[] = [
    { month: '2026-08', bookings: 100, availableAt: '2026-09-05' }, // first release
    { month: '2026-08', bookings: 130, availableAt: '2026-11-05' }, // revised later
  ];
  const before = selectAvailableHistory(rows, '2026-10-01');
  const after = selectAvailableHistory(rows, '2026-11-30');
  assert.ok(before.ok && after.ok);
  assert.deepEqual(before.history.map(r => r.bookings), [100]);
  assert.deepEqual(after.history.map(r => r.bookings), [130]);
  assert.equal(after.report.supersededVintages, 1);
  const reversed = selectAvailableHistory([rows[1], rows[0]], '2026-11-30');
  assert.ok(reversed.ok && reversed.history[0].bookings === 130, 'latest availability wins regardless of order');
});

test('learnDemand: post-cutoff changes cannot move the forecast; eligible changes can; the full-history default still does', () => {
  const rows = history(7);
  const cutoff = '2026-06-30'; // months to 2026-05 are available (June ends 1 Jul)
  const base = product({ history: rows, forecastAsOf: cutoff });
  const learned = learnDemand(base);
  assert.ok(learned, 'enough history before the cutoff');
  assert.equal(learned.cutoff?.lastEligibleMonth, '2026-05');
  assert.equal(learned.cutoff?.droppedAfterCutoff, 5);
  assert.equal(learned.cutoff?.strictAsOf, false, 'no recorded availability: not a strict as-of forecast');

  const future = scaled(rows, m => m >= '2026-06', 3);
  assert.deepEqual(fitted(product({ history: future, forecastAsOf: cutoff })), fitted(base), 'tripling post-cutoff months changes nothing');
  const extended = [...rows, { month: '2026-11', bookings: 9999 }, { month: '2026-12', bookings: 1 }];
  assert.deepEqual(fitted(product({ history: extended, forecastAsOf: cutoff })), fitted(base), 'appending later months changes nothing');
  const firstRelease = rows.map(r => (r.month === '2026-05' ? { ...r, availableAt: '2026-06-10' } : r));
  const revisedLater = [...firstRelease, { month: '2026-05', bookings: 5000, availableAt: '2026-07-15' }];
  assert.deepEqual(fitted(product({ history: revisedLater, forecastAsOf: cutoff })), fitted(base), 'a revision published after the cutoff is ignored (first release used)');
  assert.notDeepEqual(fitted(product({ history: revisedLater, forecastAsOf: '2026-07-31' })), fitted(product({ history: firstRelease, forecastAsOf: '2026-07-31' })), 'and used once it is available');

  const eligible = scaled(rows, m => m <= '2026-05' && m >= '2025-06', 1.5);
  assert.notEqual(learnDemand(product({ history: eligible, forecastAsOf: cutoff }))!.forecast, learned.forecast, 'eligible data moves the forecast');
  assert.notEqual(forecastUnconstrained(product({ history: eligible, forecastAsOf: cutoff })), forecastUnconstrained(base));

  const all = learnDemand(product({ history: rows }))!, allFuture = learnDemand(product({ history: future }))!;
  assert.equal(all.cutoff, null);
  assert.notEqual(allFuture.forecast, all.forecast, 'without forecastAsOf every row is used (unchanged default)');
});

test('learnDemand cache: the cutoff is part of the key (same history array, different cutoffs)', () => {
  const rows = history(11);
  const full = learnDemand(product({ history: rows }))!;
  const early = learnDemand(product({ history: rows, forecastAsOf: '2025-12-31' }))!;
  const later = learnDemand(product({ history: rows, forecastAsOf: '2026-06-30' }))!;
  assert.equal(early.cutoff?.lastEligibleMonth, '2025-11');
  assert.equal(later.cutoff?.lastEligibleMonth, '2026-05');
  assert.notEqual(early.months, full.months);
  assert.notEqual(early.forecast, later.forecast);
  assert.equal(learnDemand(product({ history: rows }))!.forecast, full.forecast, 'the full-history entry is still served');
  const lag = learnDemand(product({ history: rows, forecastAsOf: '2026-06-30', availabilityLagDays: 45 }))!;
  assert.equal(lag.cutoff?.lastEligibleMonth, '2026-04', 'lag is part of the key too');
});

test('learnDemand: the target month is never its own input; short or invalid availability falls back honestly', () => {
  const rows = history(5, 60, '2027-03'); // includes the target month (Jan 2027) and later
  const late = learnDemand(product({ history: rows, forecastAsOf: '2027-12-31' }))!;
  assert.equal(late.cutoff?.lastEligibleMonth, '2026-12', 'the target month and later are dropped even when available');
  assert.equal(late.cutoff?.droppedAtOrAfterTarget, 3);

  const shortRun = product({ history: history(5), forecastAsOf: '2023-06-30' }); // ~8 months available
  assert.equal(learnDemand(shortRun), null);
  assert.equal(forecastUnconstrained(shortRun), forecastUnconstrained(product()), 'typed formula, same as no history');
  assert.match(demandSourceOf(shortRun).detail, /History not used at the data cutoff 2023-06-30: \d+ of 60 months/);

  const invalid = product({ history: history(5), forecastAsOf: '2026-06-30T12:00' });
  assert.equal(learnDemand(invalid), null, 'an ambiguous cutoff never falls back to using every row');
  assert.match(demandSourceOf(invalid).detail, /offset/);
  assert.deepEqual(forecastCutoffReport(invalid), { error: 'forecastAsOf needs an explicit time-zone offset (Z or ±HH:MM).' });
});

test('missing months and values: a gap before the cutoff limits the run to the months after it', () => {
  const rows = history(9, 72); // 2020-11 .. 2026-10
  const gap = rows.filter(r => r.month !== '2023-12'); // one missing month
  const noPrices = gap.map(r => ({ month: r.month, bookings: r.bookings })); // optional values missing
  const withNaN = gap.map(r => (r.month === '2024-03' ? { ...r, bookings: Number.NaN } : r));
  const at = (h: DemandHistoryPoint[], cutoff: string) => learnDemand(product({ history: h, forecastAsOf: cutoff }));
  assert.equal(at(gap, '2026-11-30')?.months, 34, 'the latest consecutive run (2024-01 .. 2026-10) is used');
  assert.equal(at(gap, '2026-10-31')?.months, 33, 'October is not over on 31 Oct');
  assert.equal(at(gap, '2025-06-30'), null, 'at mid-2025 only 17 consecutive months follow the gap');
  assert.equal(at(noPrices, '2026-11-30')?.priceElasticity, null, 'prices and signals are optional');
  const nan = at(withNaN, '2026-11-30'), after = at(gap.filter(r => r.month > '2024-03'), '2026-11-30');
  assert.equal(nan?.months, 31, 'a missing value breaks the run like a missing month');
  assert.equal(nan?.forecast, after?.forecast);
});

test('quote review date is not the data cutoff: changing asOf never filters history', () => {
  const rows = history(13);
  const items = [product({ id: 'h1', history: rows }), product({ id: 'h2', name: 'Second', history: history(14) })];
  const at = (asOf: string, forecastAsOf?: string) => optimizePortfolio(items, 6_000_000, 0.3, { engine, asOf, forecastAsOf, scenarioCount: 120, evaluationCount: 200 }).rows;
  const early = at('2024-01-01'), late = at('2026-11-16');
  assert.equal(early[0].forecast, late[0].forecast, 'forecast identical for any quote review date');
  const cut = at('2026-11-16', '2025-12-31');
  assert.notEqual(cut[0].forecast, late[0].forecast, 'only forecastAsOf changes the data used');
});

test('planner and model-risk check: post-cutoff changes leave the plan identical; eligible changes move it', () => {
  const cutoff = '2026-03-31';
  const mk = (transform: (rows: DemandHistoryPoint[]) => DemandHistoryPoint[]) => [
    product({ id: 'a', history: transform(history(21)) }),
    product({ id: 'b', name: 'B', history: transform(history(22)), referencePrice: 11000, buy: 7000 }),
    product({ id: 'c', name: 'C', history: transform(history(23)), referencePrice: 8000, buy: 5200 }),
  ];
  const opts = { engine, asOf: '2026-11-16', forecastAsOf: cutoff, scenarioCount: 120, evaluationCount: 200 };
  const base = optimizePortfolio(mk(r => r), 3_000_000, 0.35, opts);
  const future = optimizePortfolio(mk(r => scaled(r, m => m >= '2026-03', 4)), 3_000_000, 0.35, opts);
  assert.deepEqual(future.rows.map(r => [r.qty, r.price, r.forecast, r.expectedProfit]), base.rows.map(r => [r.qty, r.price, r.forecast, r.expectedProfit]));
  assert.deepEqual(future.risk, base.risk);
  const eligible = optimizePortfolio(mk(r => scaled(r, m => m < '2026-03', 2)), 3_000_000, 0.35, opts);
  assert.notDeepEqual(eligible.rows.map(r => r.forecast), base.rows.map(r => r.forecast));

  const mr = (items: Opportunity[]) => checkModelRisk(items, 3_000_000, 0.35, { ...opts, oracle: false });
  const a = mr(mk(r => r)), b = mr(mk(r => scaled(r, m => m >= '2026-03', 4)));
  assert.deepEqual(b.worlds.map(w => w.plan), a.worlds.map(w => w.plan), 'model-risk worlds use the same cutoff');
  assert.deepEqual(withForecastCutoff(mk(r => r), undefined).map(i => i.forecastAsOf), [undefined, undefined, undefined]);
});

test('public portfolio: rows after the cutoff (with the assumed publication lag) cannot change histories or scaling', () => {
  const snap = snapshot as unknown as Snapshot;
  assert.equal(impliedLagDays(snap, 'dgca'), 108, 'latest DGCA month (2026-07) was in the 16 Nov 2026 snapshot: 108 days');
  assert.equal(impliedLagDays(snap, 'stb'), 47);
  const cutoff = '2025-06-30';
  // First month NOT available on 30 Jun 2025: DGCA Mar 2025 (1 Apr + 108 days), STB May 2025 (1 Jun + 47 days).
  const firstUnavailable: Record<string, string> = { dgca: '2025-03', stb: '2025-05' };
  const bumped: Snapshot = { ...snap, series: Object.fromEntries(Object.entries(snap.series).map(([k, v]) => [k, v.map(p => (p.month >= firstUnavailable[snap.seriesSource[k]] ? { ...p, value: p.value * 10 } : p))])) };
  const a = publicPortfolioFrom(snap, { forecastAsOf: cutoff }), b = publicPortfolioFrom(bumped, { forecastAsOf: cutoff });
  assert.deepEqual(b, a, 'histories, scale factors, bookings and source notes are identical');
  assert.notDeepEqual(publicPortfolioFrom(bumped), publicPortfolioFrom(snap), 'without a cutoff the later months do matter');
  const lastMonths = publicPortfolioWithCutoff(snap, { forecastAsOf: cutoff }).cutoffs.map(c => [c.source, c.report.lastEligibleMonth]);
  assert.ok(lastMonths.every(([source, last]) => last === (source === 'dgca' ? '2025-02' : '2025-04')), JSON.stringify(lastMonths));
  for (const item of a) {
    assert.ok(item.history!.at(-1)!.month <= '2025-04');
    assert.equal(item.forecastAsOf, cutoff);
    assert.match(item.dataSource!, /As of 2025-06-30: \d+ of \d+ months available/);
  }
  const explicit = publicPortfolioWithCutoff(snap, { forecastAsOf: cutoff, lagDays: { dgca: 20, stb: 20 } });
  assert.ok(explicit.cutoffs.every(c => c.lagDays === 20 && c.report.lastEligibleMonth === '2025-05'));
  assert.deepEqual(publicPortfolio(), publicPortfolioFrom(snap), 'default call unchanged');
});

test('public portfolio: an imputed month that used a later month is dropped until that month is available', () => {
  const snap = snapshot as unknown as Snapshot;
  // DGCA 2024-05 is imputed from neighbours including 2024-06. With the 108-day lag, 2024-05 is available from
  // 17 Sep 2024 and 2024-06 from 17 Oct 2024.
  const sep = publicPortfolioWithCutoff(snap, { forecastAsOf: '2024-09-20' });
  const goa = sep.cutoffs.find(c => c.id === 'pub-goa')!;
  assert.equal(goa.imputedDroppedLookAhead, 1);
  assert.equal(sep.items.find(i => i.id === 'pub-goa')!.history!.at(-1)!.month, '2024-04');
  const oct = publicPortfolioWithCutoff(snap, { forecastAsOf: '2024-10-20' });
  assert.equal(oct.cutoffs.find(c => c.id === 'pub-goa')!.imputedDroppedLookAhead, 0);
  const last = oct.items.find(i => i.id === 'pub-goa')!.history!.slice(-2);
  assert.deepEqual(last.map(p => [p.month, p.exclude === true]), [['2024-05', true], ['2024-06', false]], 'kept, and still left out of fitting');
});

test('integration: POST /api/procurement/plan applies forecastAsOf, reports it, and rejects ambiguous inputs', async () => {
  const post = async (body: unknown) => { const res = await POST(new Request('http://localhost/api/procurement/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return { status: res.status, body: await res.json() }; };
  const asItem = (id: string, rows: DemandHistoryPoint[], extra: Record<string, unknown> = {}) => {
    const o = product({ id, name: id });
    return { id: o.id, name: o.name, destination: o.destination, kind: o.kind, period: o.period, buy: o.buy, referencePrice: o.referencePrice, capacity: o.capacity, bookings: o.bookings, searches: o.searches, conversion: o.conversion, seasonal: o.seasonal, signal: o.signal, cancellations: o.cancellations, volatility: o.volatility, soldOut: o.soldOut, integration: o.integration, timing: o.timing, history: rows, ...extra };
  };
  const cutoff = '2026-04-30T23:59:59+05:30'; // 18:29:59Z on 30 Apr: April is not over
  const itemsWith = (t: (r: DemandHistoryPoint[]) => DemandHistoryPoint[]) => [asItem('p1', t(history(31))), asItem('p2', t(history(32)), { availabilityLagDays: 35 })];
  const request = (items: unknown[], extra: Record<string, unknown> = {}) => ({ items, budget: 2_500_000, risk: 0.3, asOf: '2026-11-16', engine, ...extra });

  const a = await post(request(itemsWith(r => r), { forecastAsOf: cutoff }));
  assert.equal(a.status, 200, JSON.stringify(a.body).slice(0, 300));
  const fd = a.body.forecastData;
  assert.equal(fd.forecastAsOf, cutoff);
  assert.equal(fd.quoteReviewDateIsCutoff, false);
  assert.equal(fd.itemsWithHistory, 2);
  assert.equal(fd.strictAsOfItems, 0);
  assert.equal(fd.rowsSupplied, 120);
  assert.equal(fd.rowsUsed + fd.rowsAfterCutoff + fd.rowsAtOrAfterTarget + fd.invalidRows + fd.supersededVintages, fd.rowsSupplied);
  assert.equal(fd.rowsUsed, 53 + 52, 'p1 to Mar 2026; p2 (35-day lag) to Feb 2026');
  assert.match(fd.note, /Not a strict as-of forecast for 2 of 2 items/);

  const b = await post(request(itemsWith(r => scaled(r, m => m >= '2026-04', 5)), { forecastAsOf: cutoff }));
  assert.equal(b.status, 200);
  const decisions = (rows: Record<string, unknown>[]) => rows.map(({ history: _h, ...rest }) => { void _h; return rest; }); // rows echo the submitted history
  assert.deepEqual(decisions(b.body.recommendations), decisions(a.body.recommendations), 'post-cutoff months do not change the plan');
  assert.deepEqual(b.body.summary, a.body.summary);
  const c = await post(request(itemsWith(r => scaled(r, m => m < '2026-03', 2)), { forecastAsOf: cutoff }));
  assert.notDeepEqual(c.body.recommendations.map((r: { forecast: number }) => r.forecast), a.body.recommendations.map((r: { forecast: number }) => r.forecast));

  const none = await post(request(itemsWith(r => r)));
  assert.equal(none.status, 200);
  assert.equal(none.body.forecastData.forecastAsOf, null);
  assert.match(none.body.forecastData.note, /not an as-of forecast/);
  assert.notDeepEqual(none.body.recommendations.map((r: { forecast: number }) => r.forecast), a.body.recommendations.map((r: { forecast: number }) => r.forecast));

  const strictRows = history(31).map(r => ({ ...r, availableAt: `${ym(Number(r.month.slice(0, 4)) * 12 + Number(r.month.slice(5, 7)))}-05` }));
  const strict = await post(request([asItem('s1', strictRows)], { forecastAsOf: '2026-08-04' }));
  assert.equal(strict.status, 200);
  assert.equal(strict.body.forecastData.strictAsOfItems, 1);
  assert.equal(strict.body.forecastData.rowsUsed, 56, 'each month published on the 5th of the next: to Jun 2026');
  assert.match(strict.body.forecastData.note, /^Strict as-of/);

  for (const [body, pattern] of [
    [request(itemsWith(r => r), { forecastAsOf: '2026-04-30T12:00' }), /forecastAsOf needs an explicit time-zone offset/],
    [request(itemsWith(r => r), { forecastAsOf: '2026-02-30' }), /forecastAsOf is not a valid calendar date/],
    [request(itemsWith(r => r), { forecastAsOf: 20260430 }), /forecastAsOf must be a string/],
    [request([asItem('x', history(31).map((r, i) => (i === 3 ? { ...r, availableAt: 'soon' } : r)))], { forecastAsOf: cutoff }), /history row 4: availableAt must be YYYY-MM-DD/],
    [request([asItem('x', history(31), { availabilityLagDays: -1 })], { forecastAsOf: cutoff }), /availabilityLagDays must be a whole number/],
  ] as const) {
    const res = await post(body);
    assert.equal(res.status, 400);
    assert.match(res.body.error, pattern);
  }
});
