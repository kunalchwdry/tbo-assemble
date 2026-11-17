import type { Opportunity } from './procurement-core';
import { targetMonthIndex, type DemandHistoryPoint } from './learned-demand';
import { monthEndInstant, parseInstant, selectAvailableHistory, type CutoffReport } from './forecast-cutoff';
import snapshot from '../data/public-portfolio.json';

/**
 * Public-data portfolio: the planner on real monthly demand histories.
 *
 * Demand histories are real public series (src/data/public-portfolio.json, built by
 * docs/data/build_public_portfolio.py): DGCA domestic city-pair passengers (routes, and air arrivals into leisure
 * cities as a proxy for hotel demand there) and Singapore Tourism Board occupied hotel room nights.
 *
 * Each market series is scaled to a product-sized level (the learned model is log-linear, so scaling changes
 * nothing about the learned seasonality, growth, error spread or backtest gate). Costs, selling prices, capacity
 * and contract terms are illustrative assumptions, not TBO data. Market series are smoother than a single product,
 * so the planner uses the larger of the learned error spread and the product's typed volatility
 * (`historyScope: 'market'`).
 *
 * As-of use (`forecastAsOf`): the snapshot has no per-month release dates and holds the latest revision of each month.
 * A month is treated as available `lagDays` after it ends, where the default lag per source is the lag of the latest
 * month in the snapshot when it was built (`impliedLagDays`) — an upper bound for that month, applied to every month as
 * an assumption. Rows not available by the cutoff are dropped BEFORE scaling, so no later data shapes the history.
 * Results are therefore pseudo-out-of-sample: availability is assumed, and earlier vintages are not reconstructed.
 * Imputed months (gaps in the source) were filled using the FOLLOWING month too, so at a cutoff where that following
 * month is not yet available an imputed month is dropped (the gap was simply unknown then). COVID shock windows are
 * defined with hindsight (their end dates); they only decide which months are left out of fitting, never values.
 */
export type PublicSeriesPoint = { month: string; value: number; imputed?: boolean };
export type Snapshot = {
  schema: string; builtAt: string;
  sources: { id: string; name: string; url: string; sha256: string; note: string; licenseUrl?: string }[];
  anomalies: { source: string; from: string; to: string; reason: string }[];
  seriesSource: Record<string, string>;
  series: Record<string, PublicSeriesPoint[]>;
};
const data = snapshot as Snapshot;

/** Latest months of each history passed to the planner (also the API's per-item history limit). */
export const PUBLIC_HISTORY_MONTHS = 120;

type ProductSpec = Omit<Opportunity, 'bookings' | 'searches' | 'conversion' | 'seasonal' | 'signal' | 'soldOut' | 'history' | 'previousBookings' | 'previousSearches'> & {
  /** Series key in the snapshot. */
  series: string;
  /** Product-sized average monthly demand over the latest 12 months (units). */
  level: number;
  /** Human-readable description of the series. */
  seriesLabel: string;
};

const PRODUCTS: ProductSpec[] = [
  { id: 'pub-goa', name: 'Goa beach hotels', destination: 'Goa', kind: 'Hotel', period: 'Dec 2026', series: 'arrivals:GOA', seriesLabel: 'DGCA air arrivals into Goa', level: 140, buy: 6400, referencePrice: 9200, capacity: 160, allotmentBuy: 6850, allotmentDepositPct: 0.25, allotmentCapacity: 60, cancellations: 0.12, volatility: 0.28, recoveryPct: 0.15, quoteExpiry: '2026-12-05', integration: 'Direct contract', timing: 'Buy now', existingStock: 0 },
  { id: 'pub-jaipur', name: 'Jaipur heritage hotels', destination: 'Jaipur', kind: 'Hotel', period: 'Jan 2027', series: 'arrivals:JAIPUR', seriesLabel: 'DGCA air arrivals into Jaipur', level: 90, buy: 5100, referencePrice: 7600, capacity: 150, cancellations: 0.1, volatility: 0.26, recoveryPct: 0.1, quoteExpiry: '2026-12-20', integration: 'Bedbank', timing: 'Negotiate', existingStock: 0 },
  { id: 'pub-kerala', name: 'Kerala backwater resorts', destination: 'Kerala', kind: 'Hotel', period: 'Dec 2026', series: 'arrivals:KOCHI', seriesLabel: 'DGCA air arrivals into Kochi', level: 80, buy: 5800, referencePrice: 8400, capacity: 130, allotmentBuy: 6200, allotmentDepositPct: 0.25, allotmentCapacity: 50, cancellations: 0.11, volatility: 0.3, recoveryPct: 0.2, quoteExpiry: '2026-12-10', integration: 'Direct contract', timing: 'Buy now', existingStock: 0 },
  { id: 'pub-srinagar', name: 'Srinagar hotels and houseboats', destination: 'Srinagar', kind: 'Hotel', period: 'May 2027', series: 'arrivals:SRINAGAR', seriesLabel: 'DGCA air arrivals into Srinagar', level: 70, buy: 5600, referencePrice: 8100, capacity: 120, cancellations: 0.14, volatility: 0.34, recoveryPct: 0.1, quoteExpiry: '2027-01-31', integration: 'Bedbank', timing: 'Monitor quote', existingStock: 0 },
  { id: 'pub-singapore', name: 'Singapore city hotels', destination: 'Singapore', kind: 'Hotel', period: 'Dec 2026', series: 'stb:SINGAPORE', seriesLabel: 'Singapore Tourism Board occupied room nights', level: 110, buy: 10600, referencePrice: 14800, capacity: 130, allotmentBuy: 11300, allotmentDepositPct: 0.25, allotmentCapacity: 40, cancellations: 0.09, volatility: 0.22, recoveryPct: 0.2, quoteExpiry: '2026-12-01', integration: 'Direct contract', timing: 'Buy now', existingStock: 0 },
  { id: 'pub-del-bom', name: 'Delhi → Mumbai', destination: 'Mumbai', kind: 'Flight', period: 'Dec 2026', series: 'route:DELHI>MUMBAI', seriesLabel: 'DGCA passengers Delhi → Mumbai', level: 120, buy: 4600, referencePrice: 6100, capacity: 150, allotmentBuy: 4850, allotmentDepositPct: 0.2, allotmentCapacity: 60, cancellations: 0.07, volatility: 0.18, recoveryPct: 0.05, quoteExpiry: '2026-12-01', integration: 'Airline allotment', timing: 'Buy now', existingStock: 0 },
  { id: 'pub-blr-del', name: 'Bengaluru → Delhi', destination: 'Delhi', kind: 'Flight', period: 'Jan 2027', series: 'route:BENGALURU>DELHI', seriesLabel: 'DGCA passengers Bengaluru → Delhi', level: 100, buy: 5200, referencePrice: 6900, capacity: 120, cancellations: 0.07, volatility: 0.18, recoveryPct: 0.05, quoteExpiry: '2026-12-15', integration: 'GDS fare', timing: 'Negotiate', existingStock: 0 },
  { id: 'pub-del-goa', name: 'Delhi → Goa', destination: 'Goa', kind: 'Flight', period: 'Dec 2026', series: 'route:DELHI>GOA', seriesLabel: 'DGCA passengers Delhi → Goa', level: 90, buy: 4900, referencePrice: 6600, capacity: 110, allotmentBuy: 5150, allotmentDepositPct: 0.2, allotmentCapacity: 40, cancellations: 0.08, volatility: 0.22, recoveryPct: 0.05, quoteExpiry: '2026-12-01', integration: 'Airline allotment', timing: 'Buy now', existingStock: 0 },
];

const CONVERSION = 0.04;
const nextMonth = (ym: string) => { const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };

/**
 * Days between the end of the latest month of a source's series and the snapshot's build time: that month was
 * available within this lag. Used (rounded up) as the assumed publication lag for every month of the source.
 */
export function impliedLagDays(snap: Snapshot, source: string): number {
  const built = parseInstant(snap.builtAt);
  let latest = '';
  for (const [key, src] of Object.entries(snap.seriesSource)) if (src === source) for (const p of snap.series[key] ?? []) if (p.month > latest) latest = p.month;
  if (!built.ok || !latest) return 0;
  return Math.max(0, Math.ceil((built.instant - monthEndInstant(latest)) / 86_400_000));
}

export type PublicPortfolioOptions = {
  /** Data cutoff (YYYY-MM-DD or timestamp with offset). Rows not available by then are dropped before scaling. */
  forecastAsOf?: string;
  /** Assumed publication lag in days after month end, per source id (default: `impliedLagDays`). */
  lagDays?: Partial<Record<string, number>>;
};

/** Per-product availability report of the last `publicPortfolioFrom` call with a cutoff (for docs and the API). */
export type PublicCutoff = { id: string; source: string; lagDays: number; report: CutoffReport; imputedDroppedLookAhead: number };

/**
 * The public-data portfolio as planner inputs (histories scaled to product size; economics are assumptions).
 * Without `forecastAsOf` every snapshot month is used (unchanged behaviour).
 */
export function publicPortfolio(options: PublicPortfolioOptions = {}): Opportunity[] {
  return publicPortfolioFrom(data, options);
}

export function publicPortfolioFrom(snap: Snapshot, options: PublicPortfolioOptions = {}): Opportunity[] {
  return publicPortfolioWithCutoff(snap, options).items;
}

type AvailableSeries = { series: PublicSeriesPoint[]; lagDays?: number; report: CutoffReport | null; imputedDroppedLookAhead: number };

/** The snapshot months of one series available at the cutoff (all months without one). Shared by every public-data path. */
function availableSeries(snap: Snapshot, key: string, forecastAsOf: string | undefined, lagDays: number | undefined, target: number | undefined): AvailableSeries {
  const source = snap.seriesSource[key];
  const series = snap.series[key] ?? [];
  if (forecastAsOf === undefined) return { series, report: null, imputedDroppedLookAhead: 0 };
  const lag = lagDays ?? impliedLagDays(snap, source);
  const picked = selectAvailableHistory(series.map(p => ({ month: p.month, bookings: p.value })), forecastAsOf, { lagDays: lag, targetMonthIndex: target !== undefined && Number.isFinite(target) ? target : undefined });
  if (!picked.ok) throw new Error(picked.error);
  const keep = new Set(picked.history.map(h => h.month));
  // An imputed month used its next month's value: drop it unless that month is also available at the cutoff.
  const lookAhead = series.filter(p => p.imputed && keep.has(p.month) && !keep.has(nextMonth(p.month)));
  for (const p of lookAhead) keep.delete(p.month);
  return { series: series.filter(p => keep.has(p.month)), lagDays: lag, report: picked.report, imputedDroppedLookAhead: lookAhead.length };
}

/** True for months inside a documented shock window of the series' source (left out of fitting and scoring). */
export function shockMonth(snap: Snapshot, key: string): (month: string) => boolean {
  const windows = snap.anomalies.filter(a => a.source === snap.seriesSource[key]);
  return (month: string) => windows.some(a => month >= a.from && month <= a.to);
}

/**
 * One public series as an UNSCALED planner history at a data cutoff, with the same availability, look-ahead and
 * exclusion rules as `publicPortfolio` (used by the rolling-origin research script).
 */
export function publicSeriesHistory(snap: Snapshot, key: string, options: { forecastAsOf?: string; lagDays?: number; targetMonthIndex?: number } = {}) {
  const available = availableSeries(snap, key, options.forecastAsOf, options.lagDays, options.targetMonthIndex);
  const shocked = shockMonth(snap, key);
  const history: DemandHistoryPoint[] = available.series.slice(-PUBLIC_HISTORY_MONTHS).map(p => ({ month: p.month, bookings: p.value, ...(p.imputed || shocked(p.month) ? { exclude: true } : {}) }));
  return { history, report: available.report, lagDays: available.lagDays, imputedDroppedLookAhead: available.imputedDroppedLookAhead };
}

export function publicPortfolioWithCutoff(snap: Snapshot, options: PublicPortfolioOptions = {}): { items: Opportunity[]; cutoffs: PublicCutoff[] } {
  const cutoffs: PublicCutoff[] = [];
  const items = PRODUCTS.map(spec => {
    const { series: key, level, seriesLabel, ...rest } = spec;
    const source = snap.seriesSource[key];
    const available = availableSeries(snap, key, options.forecastAsOf, options.lagDays?.[source], targetMonthIndex(spec.period));
    const series = available.series, lag = available.lagDays;
    let asOfNote = '';
    if (available.report) {
      cutoffs.push({ id: spec.id, source, lagDays: lag!, report: available.report, imputedDroppedLookAhead: available.imputedDroppedLookAhead });
      asOfNote = ` As of ${options.forecastAsOf}: ${series.length} of ${available.report.supplied} months available (assumed ${lag} days after month end; latest revision values).`;
    }
    const raw = series.slice(-PUBLIC_HISTORY_MONTHS);
    const recent = raw.slice(-12), mean = recent.reduce((s, p) => s + p.value, 0) / Math.max(1, recent.length);
    const scale = mean > 0 ? level / mean : 0;
    const shocked = shockMonth(snap, key);
    // Shock months and months imputed for gaps in the source stay in the series but are left out of fitting and validation.
    const history: DemandHistoryPoint[] = raw.map(p => ({ month: p.month, bookings: Math.round(p.value * scale * 10) / 10, ...(p.imputed || shocked(p.month) ? { exclude: true } : {}) }));
    const excluded = history.filter(h => h.exclude).length;
    const latest = history[history.length - 1]?.bookings ?? level, yearAgo = history[history.length - 13]?.bookings ?? latest;
    return {
      ...rest,
      bookings: Math.round(latest), searches: Math.round(latest / CONVERSION), conversion: CONVERSION,
      previousBookings: Math.round(yearAgo), previousSearches: Math.round(yearAgo / CONVERSION),
      seasonal: 1, signal: 1, soldOut: 0,
      history, historyScope: 'market' as const,
      dataSource: `${seriesLabel}, ${raw[0]?.month ?? '?'} to ${raw[raw.length - 1]?.month ?? '?'} (${raw.length} months; ${excluded} COVID or imputed months left out of fitting); scaled ×${scale.toPrecision(3)} to product size.${asOfNote}`,
      ...(options.forecastAsOf !== undefined ? { forecastAsOf: options.forecastAsOf, availabilityLagDays: lag } : {}),
    };
  });
  return { items, cutoffs };
}

/** Sources of the public series and the shock windows left out of fitting, for citations in the UI and docs. */
export function publicPortfolioSources() {
  return { builtAt: data.builtAt, sources: data.sources, anomalies: data.anomalies, impliedLagDays: Object.fromEntries(data.sources.map(s => [s.id, impliedLagDays(data, s.id)])) };
}
