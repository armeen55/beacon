/**
 * measurement/outcome-windows: the day-range arithmetic behind reading many shipments' AI answers in
 * ONE bounded walk. Overlapping windows are merged into disjoint stretches so no day is read twice, the
 * stretches are read in pieces sized by the densest day actually seen, and a piece that will not read
 * fails ONLY the days it covers: the failure belongs to the shipments whose windows touch it and to
 * nothing else, never to the whole ledger. PURE except for the read function the caller injects.
 */

type DayRange = { from: string; to: string }; // INTERNAL: `mergeRanges` and `readPartitioned` hand this shape back, so a caller names it by what it gets rather than by a second public name (export ceiling, 2026-09-05)

export const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export const overlaps = (a: DayRange, b: DayRange): boolean => a.from <= b.to && b.from <= a.to;

/** Overlapping or touching stretches joined into disjoint ones, oldest first, so no day is ever read twice. */
export function mergeRanges(ranges: readonly DayRange[]): DayRange[] {
  const out: DayRange[] = [];
  for (const r of [...ranges].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))) {
    const last = out[out.length - 1];
    if (last && r.from <= addDays(last.to, 1)) last.to = r.to > last.to ? r.to : last.to;
    else out.push({ ...r });
  }
  return out;
}

/** How many rows one read may ask for. Half the store's own 40,000 ceiling, so a day that turns out denser
 *  than the estimate below still lands inside one read rather than being refused. */
const READ_ROW_BUDGET = 20_000;
/** The opening guess at a day's size, ahead of any evidence: 35 questions on 4 engines is 140 first readings
 *  a day, and the guess is raised the moment a read comes back denser than it. */
const ASSUMED_ROWS_PER_DAY = 200;

/**
 * READ THE MERGED STRETCHES IN PIECES, one after another, through the caller's own read function. The
 * piece size follows the densest day seen so far, so an account with many more questions than the opening
 * guess narrows its own reads as it goes. A piece that throws is recorded as unread and the walk continues.
 */
export async function readPartitioned<T>(
  ranges: readonly DayRange[],
  read: (from: string, to: string) => Promise<T[]>,
): Promise<{ rows: T[]; failed: DayRange[] }> {
  const rows: T[] = [];
  const failed: DayRange[] = [];
  let perDay = ASSUMED_ROWS_PER_DAY;
  for (const range of ranges) {
    let from = range.from;
    while (from <= range.to) {
      const span = Math.max(1, Math.floor(READ_ROW_BUDGET / perDay));
      const to = addDays(from, span - 1) < range.to ? addDays(from, span - 1) : range.to;
      try {
        const got = await read(from, to);
        rows.push(...got);
        perDay = Math.max(perDay, Math.ceil(got.length / (daysBetween(from, to) + 1)));
      } catch {
        failed.push({ from, to });
      }
      from = addDays(to, 1);
    }
  }
  return { rows, failed };
}
