/**
 * Rolling-origin (pseudo-out-of-sample) comparison of the planner's demand forecast against the existing baselines on
 * the committed public snapshot (src/data/public-portfolio.json: DGCA air traffic, Singapore room nights).
 *
 *   npx tsx scripts/forecast-rolling-origin.ts [--out file.json] [--md file.md] [--lag dgca=30,stb=30]
 *
 * `--lag` replaces the assumed publication lags (sensitivity analysis); the default is the snapshot-implied lag.
 *
 * Protocol (fixed before looking at results; deterministic, no network):
 *  - Forecast origins are calendar dates: the 1st of every month. A forecast made on date C for travel month T = month(C)
 *    + h uses only snapshot months AVAILABLE on C: a month counts once it has ended plus the source's assumed publication
 *    lag (the lag of the snapshot's latest month when it was built: DGCA 108 days, STB 47 days). Imputed months that
 *    used a not-yet-available neighbour are dropped, exactly as in the planner (`publicSeriesHistory`).
 *  - Holdout targets: T from 2024-01 to the last month of each series; horizons h = 3 and 6 months. Targets in a shock
 *    window or imputed are not scored.
 *  - Candidates:
 *      planner         learnDemand with forecastAsOf = C: the production rule, including its own gate (learned model vs
 *                      same-month-last-year, chosen on its internal rolling backtest over data available on C).
 *      learned         the learned model alone (no gate).
 *      seasonal-naive  same month in the latest usable year available on C.
 *      last-observed   latest usable month available on C.
 *      online-best     at each C, the candidate (learned, seasonal-naive, last-observed) with the lowest MAE over its
 *                      latest 24 forecasts for the same series and horizon whose target months were AVAILABLE on C
 *                      (seasonal-naive until 6 such forecasts exist). Selection never sees a holdout outcome early.
 *  - 80% intervals: the planner's own band (learnDemand lower80/upper80). Baselines get a sequential split-conformal
 *    band from their own latest 36 errors whose targets were available on C (needs 12). Coverage counts only targets
 *    where the candidate had a band.
 *  - Metrics per segment (DGCA city arrivals, DGCA routes, Singapore room nights) and horizon: n, WAPE (sum |error| /
 *    sum actual), MAE relative to seasonal-naive on the same targets, 80% coverage. Forecasts for consecutive targets
 *    overlap, so n is not a count of independent tests.
 *
 * Limits: market-level public series, not TBO bookings; the snapshot holds the latest revision of each month and no
 * release dates, so availability is assumed (not a real-time vintage study); one snapshot, one period.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import snapshot from '../src/data/public-portfolio.json';
import { learnDemand, forecastFrom, band80, type DemandHistoryPoint } from '../src/lib/learned-demand';
import type { Opportunity } from '../src/lib/procurement-core';
import { impliedLagDays, publicSeriesHistory, shockMonth, type Snapshot } from '../src/lib/public-portfolio';
import { monthEndInstant } from '../src/lib/forecast-cutoff';

const snap = snapshot as unknown as Snapshot;
const HORIZONS = [3, 6];
const FIRST_TARGET = '2024-01';
const ONLINE_WINDOW = 24, ONLINE_MIN = 6, CONFORMAL_WINDOW = 36, CONFORMAL_MIN = 12;
const BASE = ['learned', 'seasonal-naive', 'last-observed'] as const;
const CANDIDATES = ['planner', ...BASE, 'online-best'] as const;
type Candidate = typeof CANDIDATES[number];

const idx = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const ym = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const segmentOf = (key: string) => (key.startsWith('arrivals:') ? 'DGCA city arrivals' : key.startsWith('route:') ? 'DGCA routes' : 'Singapore room nights');

type Forecast = { key: string; h: number; origin: string; target: string; actual: number; scored: boolean; availableAt: number; value: Record<Candidate, number | null>; band: Partial<Record<Candidate, [number, number] | null>>; plannerGate?: string };

function seasonalNaive(history: DemandHistoryPoint[], target: number): number | null {
  const by = new Map(history.map(h => [idx(h.month), h]));
  const last = Math.max(...by.keys());
  for (let j = target - 12; j >= target - 12 * 6; j -= 12) { const p = by.get(j); if (j <= last && p && !p.exclude && p.bookings > 0) return p.bookings; }
  return null;
}
function lastObserved(history: DemandHistoryPoint[]): number | null {
  for (let i = history.length - 1; i >= 0; i--) if (!history[i].exclude && history[i].bookings > 0) return history[i].bookings;
  return null;
}
function marketItem(key: string, target: string, history: DemandHistoryPoint[], forecastAsOf: string, lagDays: number): Opportunity {
  const t = idx(target);
  return {
    id: key, name: key, destination: key, kind: key.startsWith('route:') ? 'Flight' : 'Hotel', period: `${MONTHS[t % 12]} ${Math.floor(t / 12)}`,
    buy: 100, referencePrice: 140, capacity: 1e9, bookings: history.at(-1)?.bookings ?? 0, searches: 0, conversion: 0.04, seasonal: 1, signal: 1,
    cancellations: 0, volatility: 0.1, soldOut: 0, integration: 'n/a', timing: 'n/a', history, historyScope: 'market', forecastAsOf, availabilityLagDays: lagDays,
  };
}

function run(lags: Record<string, number>) {
  const forecasts: Forecast[] = [];
  for (const key of Object.keys(snap.series)) {
    const source = snap.seriesSource[key], lag = lags[source], shocked = shockMonth(snap, key);
    const full = snap.series[key], byMonth = new Map(full.map(p => [p.month, p])), lastMonth = full.at(-1)!.month;
    for (const h of HORIZONS) {
      // Origins far enough back that the online selector and conformal bands have earlier, available forecasts.
      for (let t = idx(FIRST_TARGET) - 36; t <= idx(lastMonth); t++) {
        const target = ym(t), origin = `${ym(t - h)}-01`, point = byMonth.get(target);
        if (!point) continue;
        const { history } = publicSeriesHistory(snap, key, { forecastAsOf: origin, lagDays: lag, targetMonthIndex: t });
        if (history.length < 24) continue;
        const lastAvail = history.at(-1)!.month;
        const learned = learnDemand(marketItem(key, target, history, origin, lag));
        const alone = forecastFrom(history, lastAvail, t - idx(lastAvail), key.startsWith('route:') ? 'Flight' : 'Hotel');
        const value: Record<Candidate, number | null> = {
          planner: learned ? learned.forecast : seasonalNaive(history, t), learned: alone, 'seasonal-naive': seasonalNaive(history, t), 'last-observed': lastObserved(history), 'online-best': null,
        };
        forecasts.push({
          key, h, origin, target, actual: point.value, scored: !point.imputed && !shocked(target), availableAt: monthEndInstant(target) + lag * 86_400_000,
          value, band: { planner: learned ? [learned.forecast * learned.lower80, learned.forecast * learned.upper80] : null }, plannerGate: learned?.gate ?? 'no-history',
        });
      }
    }
  }
  // Online selection and conformal bands: only forecasts whose targets were available at the origin.
  const groups = new Map<string, Forecast[]>();
  for (const f of forecasts) { const g = `${f.key}|${f.h}`; if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(f); }
  for (const list of groups.values()) {
    list.sort((a, b) => a.target.localeCompare(b.target));
    for (const f of list) {
      const originAt = Date.parse(`${f.origin}T00:00:00Z`);
      const known = list.filter(g => g !== f && g.scored && g.availableAt <= originAt && g.actual > 0);
      const err = (c: Candidate, window: number) => known.filter(g => g.value[c] !== null).slice(-window).map(g => ({ abs: Math.abs(g.value[c]! - g.actual), rel: g.value[c]! / g.actual - 1 }));
      let pick: Candidate = 'seasonal-naive', best = Infinity;
      for (const c of BASE) {
        const e = err(c, ONLINE_WINDOW);
        if (e.length < ONLINE_MIN) continue;
        const mae = e.reduce((s, x) => s + x.abs, 0) / e.length;
        if (mae < best) { best = mae; pick = c; }
      }
      f.value['online-best'] = f.value[pick] ?? f.value['seasonal-naive'];
      for (const c of [...BASE, 'online-best'] as Candidate[]) {
        const source: Candidate = c === 'online-best' ? pick : c;
        const e = err(source, CONFORMAL_WINDOW);
        const v = f.value[c];
        f.band[c] = v !== null && e.length >= CONFORMAL_MIN ? (() => { const b = band80(e.map(x => x.rel)); return [v * b.lower80, v * b.upper80] as [number, number]; })() : null;
      }
    }
  }
  return forecasts;
}

type Row = { segment: string; h: number; candidate: Candidate; n: number; series: number; wape: number; relMae: number; bandN: number; coverage: number };
const scoredHoldout = (forecasts: Forecast[]) => forecasts.filter(f => f.scored && f.target >= FIRST_TARGET && f.actual > 0 && CANDIDATES.every(c => f.value[c] !== null));
/** The planner on the targets where its gate chose the learned model vs fell back (fallback = seasonal-naive exactly). */
function byGate(forecasts: Forecast[]) {
  const holdout = scoredHoldout(forecasts);
  return HORIZONS.flatMap(h => ['passed', 'fallback'].map(gate => {
    const set = holdout.filter(f => f.h === h && f.plannerGate === gate);
    const abs = (c: Candidate) => set.reduce((s, f) => s + Math.abs(f.value[c]! - f.actual), 0);
    return { h, gate, n: set.length, relMae: set.length ? abs('planner') / abs('seasonal-naive') : NaN, identicalToSeasonalNaive: set.filter(f => Math.abs(f.value.planner! - f.value['seasonal-naive']!) <= 1e-9 * f.actual).length };
  }));
}
function summarise(forecasts: Forecast[]): Row[] {
  const holdout = scoredHoldout(forecasts);
  const rows: Row[] = [];
  const segments = [...new Set(holdout.map(f => segmentOf(f.key)))].sort();
  for (const segment of [...segments, 'All series'])
    for (const h of HORIZONS) {
      const set = holdout.filter(f => f.h === h && (segment === 'All series' || segmentOf(f.key) === segment));
      if (!set.length) continue;
      const actual = set.reduce((s, f) => s + f.actual, 0);
      const naiveAbs = set.reduce((s, f) => s + Math.abs(f.value['seasonal-naive']! - f.actual), 0);
      for (const c of CANDIDATES) {
        const abs = set.reduce((s, f) => s + Math.abs(f.value[c]! - f.actual), 0);
        const banded = set.filter(f => f.band[c]);
        const covered = banded.filter(f => f.actual >= f.band[c]![0] && f.actual <= f.band[c]![1]).length;
        rows.push({ segment, h, candidate: c, n: set.length, series: new Set(set.map(f => f.key)).size, wape: abs / actual, relMae: abs / naiveAbs, bandN: banded.length, coverage: banded.length ? covered / banded.length : NaN });
      }
    }
  return rows;
}

function main() {
  const args = process.argv.slice(2), arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const started = Date.now();
  const lags: Record<string, number> = Object.fromEntries(snap.sources.map(s => [s.id, impliedLagDays(snap, s.id)]));
  const lagArg = arg('--lag'), lagSource = lagArg ? 'override (--lag)' : 'snapshot-implied';
  for (const part of (lagArg ?? '').split(',').filter(Boolean)) {
    const [id, days] = part.split('=');
    if (!(id in lags) || !/^\d+$/.test(days ?? '')) throw new Error(`--lag expects source=days for ${Object.keys(lags).join(', ')}`);
    lags[id] = Number(days);
  }
  const forecasts = run(lags);
  const rows = summarise(forecasts);
  const holdout = scoredHoldout(forecasts);
  const gates = holdout.reduce<Record<string, number>>((m, f) => { m[f.plannerGate!] = (m[f.plannerGate!] ?? 0) + 1; return m; }, {});
  const gateRows = byGate(forecasts);
  const sha = createHash('sha256').update(readFileSync(new URL('../src/data/public-portfolio.json', import.meta.url))).digest('hex');
  const result = {
    protocol: 'rolling-origin-v1', generatedBy: 'scripts/forecast-rolling-origin.ts', snapshot: { file: 'src/data/public-portfolio.json', sha256: sha, builtAt: snap.builtAt },
    lagDays: lags, lagSource, horizons: HORIZONS, firstTarget: FIRST_TARGET,
    selection: { onlineWindow: ONLINE_WINDOW, onlineMin: ONLINE_MIN, conformalWindow: CONFORMAL_WINDOW, conformalMin: CONFORMAL_MIN },
    plannerGateOnHoldout: gates, plannerByGate: gateRows, rows,
    caveats: [
      'Pseudo-out-of-sample: availability is assumed from the snapshot build lag, values are the latest revisions, no real-time vintages.',
      'Market-level public series (air passengers, room nights), not TBO bookings; no prospective claim.',
      'Overlapping monthly forecasts: n counts forecasts, not independent tests.',
      'The planner band is calibrated on its own internal backtest at each origin; baseline bands are sequential split-conformal.',
    ],
  };
  const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : 'n/a');
  const md = [
    '# Rolling-origin forecast comparison (public snapshot)', '',
    `Generated by \`npx tsx scripts/forecast-rolling-origin.ts\` from \`src/data/public-portfolio.json\` (sha256 \`${sha.slice(0, 12)}…\`, built ${snap.builtAt}). Deterministic; no network.`, '',
    `Origins are the 1st of each month; a forecast for travel month T made h months ahead uses only months available on that date (assumed publication lag, ${lagSource}: ${Object.entries(result.lagDays).map(([k, v]) => `${k.toUpperCase()} ${v} days`).join(', ')}). Holdout targets from ${FIRST_TARGET}; shock and imputed targets are not scored. Online selection and baseline bands use only forecasts whose targets were available at the origin.`, '',
    '| Segment | h | Candidate | n (series) | WAPE | MAE vs seasonal-naive | 80% coverage (n) |', '|---|---|---|---|---|---|---|',
    ...rows.map(r => `| ${r.segment} | ${r.h} | ${r.candidate} | ${r.n} (${r.series}) | ${pct(r.wape)} | ${r.relMae.toFixed(3)} | ${pct(r.coverage)} (${r.bandN}) |`), '',
    `Planner rule on the holdout forecasts: ${Object.entries(gates).map(([k, v]) => `${k} ${v}`).join(', ')} (passed = learned model used; fallback = same month last year).`, '',
    '| h | Planner gate | n | Planner MAE vs seasonal-naive (same targets) | Identical to seasonal-naive |', '|---|---|---|---|---|',
    ...gateRows.map(g => `| ${g.h} | ${g.gate} | ${g.n} | ${Number.isFinite(g.relMae) ? g.relMae.toFixed(3) : 'n/a'} | ${g.identicalToSeasonalNaive} |`), '',
    '**Caveats.** ' + result.caveats.join(' '), '',
  ].join('\n');
  const out = arg('--out'), mdOut = arg('--md');
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(result, null, 2) + '\n'); }
  if (mdOut) { mkdirSync(dirname(mdOut), { recursive: true }); writeFileSync(mdOut, md); }
  console.log(md);
  console.error(`forecasts: ${forecasts.length}, holdout scored: ${holdout.length}, ${((Date.now() - started) / 1000).toFixed(1)} s`);
}
main();
