/**
 * Forecast-as-of (data-availability) cutoff for monthly demand histories.
 *
 * The planner has two different dates and never substitutes one for the other:
 *  - `asOf` — the supplier QUOTE REVIEW date: which quotes have expired and how many days remain before travel.
 *  - `forecastAsOf` — the DATA CUTOFF: the moment the forecast is made. Only observations that were AVAILABLE by
 *    then may be used for fitting, model selection, scaling or the forecast itself.
 *
 * Availability rules for one monthly row (month m):
 *  1. A month is never usable before it has ended (the first instant of month m+1, UTC): a partial month is not the
 *     month's figure. A recorded `availableAt` earlier than that is moved to the month end and counted.
 *  2. Recorded availability: `availableAt` — a date `YYYY-MM-DD` (treated as available at the END of that UTC day,
 *     which is conservative for intraday cutoffs) or a timestamp with an explicit offset (`…Z` or `…+05:30`).
 *     Timestamps without an offset are ambiguous and rejected.
 *  3. Unknown availability: assumed available `lagDays` after the month ends (default 0: the month's own bookings are
 *     complete when it ends). Rows using this assumption are counted, and the result is then NOT a strict as-of
 *     (real-time vintage) forecast — the report says so.
 *  4. When a target period is given, months at or after the target month are dropped: a forecast of month T never
 *     uses T's own outcome.
 * A cutoff given as a date `YYYY-MM-DD` means the END of that UTC day; a timestamp needs an explicit offset.
 *
 * Revisions (vintages): several rows may be supplied for one month with different `availableAt` times. With a cutoff,
 * the latest vintage available by then is used (ties: the row supplied last). When only one value per month is supplied
 * — the usual case — it is the latest revision the caller has, and earlier vintages cannot be reconstructed; the
 * report's `revisionNote` states this.
 */
import type { DemandHistoryPoint } from './learned-demand';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;
const DAY_MS = 86_400_000;

function validDate(y: number, m: number, d: number) {
  const t = Date.UTC(y, m - 1, d);
  const x = new Date(t);
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? t : null;
}

export type ParsedInstant = { ok: true; instant: number; dateOnly: boolean } | { ok: false; error: string };

/**
 * Parses an ISO date or an ISO timestamp with an explicit offset into epoch milliseconds.
 * `dateOnly` values resolve to the END of that UTC day (23:59:59.999Z).
 */
export function parseInstant(value: unknown): ParsedInstant {
  if (typeof value !== 'string') return { ok: false, error: 'must be a string' };
  const s = value.trim();
  const d = DATE.exec(s);
  if (d) {
    const t = validDate(Number(d[1]), Number(d[2]), Number(d[3]));
    return t === null ? { ok: false, error: 'is not a valid calendar date' } : { ok: true, instant: t + DAY_MS - 1, dateOnly: true };
  }
  const m = STAMP.exec(s);
  if (!m) {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return { ok: false, error: 'needs an explicit time-zone offset (Z or ±HH:MM)' };
    return { ok: false, error: 'must be YYYY-MM-DD or an ISO timestamp with an offset' };
  }
  const day = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  const hh = Number(m[4]), mi = Number(m[5]), ss = Number(m[6] ?? 0), ms = Number((m[7] ?? '0').padEnd(3, '0'));
  if (day === null || hh > 23 || mi > 59 || ss > 59) return { ok: false, error: 'is not a valid timestamp' };
  let offset = 0;
  if (m[8] !== 'Z') {
    const sign = m[8][0] === '-' ? -1 : 1, oh = Number(m[8].slice(1, 3)), om = Number(m[8].slice(4, 6));
    if (oh > 14 || om > 59) return { ok: false, error: 'has an invalid offset' };
    offset = sign * (oh * 60 + om) * 60_000;
  }
  return { ok: true, instant: day + ((hh * 60 + mi) * 60 + ss) * 1000 + ms - offset, dateOnly: false };
}

const monthIndex = (ym: string) => { const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym); return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : NaN; };
/** First instant (UTC) after month `ym` ends, i.e. 00:00Z on the first day of the next month. */
export function monthEndInstant(ym: string): number {
  const i = monthIndex(ym);
  return Number.isFinite(i) ? Date.UTC(Math.floor((i + 1) / 12), (i + 1) % 12, 1) : NaN;
}

export type CutoffOptions = {
  /** Assumed days after month end before a row without `availableAt` is available (default 0). */
  lagDays?: number;
  /** Target travel month index (year × 12 + month0): rows at or after it are dropped. */
  targetMonthIndex?: number;
};

export type CutoffReport = {
  forecastAsOf: string;
  /** The cutoff instant, ISO (UTC). */
  cutoff: string;
  rule: string;
  supplied: number;
  eligible: number;
  /** Rows whose month had not ended, or whose availability was later than the cutoff. */
  droppedAfterCutoff: number;
  /** Rows at or after the target month (never used to forecast that month). */
  droppedAtOrAfterTarget: number;
  /** Rows with an unparseable month or `availableAt` (excluded; fail closed). */
  invalid: number;
  /** Eligible rows with a recorded `availableAt`. */
  recordedAvailability: number;
  /** Eligible rows whose availability was assumed by the lag rule. */
  assumedAvailability: number;
  /** Recorded `availableAt` earlier than the month end (moved to the month end). */
  availableBeforeMonthEnd: number;
  /** Available rows replaced by a later vintage of the same month that was also available by the cutoff. */
  supersededVintages: number;
  firstEligibleMonth: string | null;
  lastEligibleMonth: string | null;
  /** True only when every eligible row has a recorded availability time. */
  strictAsOf: boolean;
  note: string;
  revisionNote: string;
};

export type CutoffSelection = { ok: true; history: DemandHistoryPoint[]; report: CutoffReport } | { ok: false; error: string };

export const REVISION_NOTE = 'Where one value per month is supplied it is the latest revision the caller had; earlier vintages, if they differed, are not reconstructed. Where several dated vintages are supplied, the latest one available by the cutoff is used.';

/**
 * Keeps only the history rows available by `forecastAsOf` (see the module rules). Pure: the input is not modified and
 * the returned rows are the original objects.
 */
export function selectAvailableHistory(history: readonly DemandHistoryPoint[], forecastAsOf: string, options: CutoffOptions = {}): CutoffSelection {
  const cut = parseInstant(forecastAsOf);
  if (!cut.ok) return { ok: false, error: `forecastAsOf ${cut.error}.` };
  const lagDays = Number.isFinite(options.lagDays) && (options.lagDays as number) >= 0 ? Math.min(3650, options.lagDays as number) : 0;
  const target = options.targetMonthIndex;
  // month index -> chosen row (latest availability among the rows available by the cutoff)
  const chosen = new Map<number, { row: DemandHistoryPoint; at: number; order: number; recorded: boolean }>();
  let afterCutoff = 0, atOrAfterTarget = 0, invalid = 0, early = 0, superseded = 0, order = 0;
  for (const row of history) {
    const mi = row && typeof row.month === 'string' ? monthIndex(row.month) : NaN;
    if (!Number.isFinite(mi)) { invalid++; continue; }
    if (target !== undefined && Number.isFinite(target) && mi >= target) { atOrAfterTarget++; continue; }
    const monthEnd = monthEndInstant(row.month);
    let available: number;
    let isRecorded = false;
    if (row.availableAt !== undefined && row.availableAt !== null) {
      const a = parseInstant(row.availableAt);
      if (!a.ok) { invalid++; continue; }
      isRecorded = true;
      if (a.instant < monthEnd) early++;
      available = Math.max(a.instant, monthEnd);
    } else {
      available = monthEnd + lagDays * DAY_MS;
    }
    if (available > cut.instant) { afterCutoff++; continue; }
    const previous = chosen.get(mi);
    if (previous) superseded++;
    if (!previous || available >= previous.at) chosen.set(mi, { row, at: available, order: order++, recorded: isRecorded });
  }
  const picks = [...chosen.values()].sort((a, b) => a.order - b.order);
  const kept = picks.map(p => p.row);
  const recorded = picks.filter(p => p.recorded).length, assumed = picks.length - recorded;
  const months = kept.map(r => r.month).sort();
  const strict = kept.length > 0 && assumed === 0;
  const rule = `month ended and available by the cutoff; rows without availableAt assumed available ${lagDays} day(s) after month end`;
  return {
    ok: true,
    history: kept,
    report: {
      forecastAsOf, cutoff: new Date(cut.instant).toISOString(), rule,
      supplied: history.length, eligible: kept.length, droppedAfterCutoff: afterCutoff, droppedAtOrAfterTarget: atOrAfterTarget,
      invalid, recordedAvailability: recorded, assumedAvailability: assumed, availableBeforeMonthEnd: early, supersededVintages: superseded,
      firstEligibleMonth: months[0] ?? null, lastEligibleMonth: months[months.length - 1] ?? null,
      strictAsOf: strict,
      note: !kept.length
        ? 'No history row was available by the cutoff.'
        : strict
          ? 'Strict as-of: every row used has a recorded availability time at or before the cutoff.'
          : `Not a strict as-of backtest: ${assumed} of ${kept.length} rows have no recorded availability time and were assumed available ${lagDays} day(s) after month end.`,
      revisionNote: REVISION_NOTE,
    },
  };
}

/**
 * Applies a plan-level `forecastAsOf` to every product (shallow copies; histories are shared, not copied). Undefined
 * leaves the products unchanged. Idempotent.
 */
export function withForecastCutoff<T extends { forecastAsOf?: string }>(items: T[], forecastAsOf: string | undefined): T[] {
  if (forecastAsOf === undefined) return items;
  return items.map(item => (item.forecastAsOf === forecastAsOf ? item : { ...item, forecastAsOf }));
}
