import "server-only";

/**
 * contamination - THE ONE COMPARISON POLICY. Which pages may stand behind a change, and why.
 *
 * THREE RULES USED TO EXIST. The ledger rebuild excluded the pages under active treatment, the
 * scheduled pass excluded nothing at all, and the operator recheck omitted the argument entirely,
 * so the same change read against three different comparison sets depending on which door asked.
 * Selection time added a fourth: every page ever touched was dropped forever, which shrinks the
 * pool of a working account to nothing. This file is the only place that decides, every entry
 * point passes through it, and the parameter it feeds is REQUIRED so the compiler says so.
 *
 * EXCLUSION IS WINDOW SCOPED, NEVER FOREVER. A page is unusable while its own change is being
 * measured and for the days that overlap the window being read. Past that span it is comparable
 * again. Its history stays visible on the receipt and excludes nothing.
 *
 * NOTHING HERE IS A SIMILARITY SCORE. A control qualifies on facts anybody can check: the job on
 * file for both pages says the same shape, its search traffic sits beside the changed page's, and
 * Search Console holds rows for it across the baseline window.
 */

import { reportingDay } from "@/lib/reporting-day";
import { addDays } from "./kernel";
import { outcomeStateOf } from "./measure-lifecycle";
import type { ShippedChangeRecord } from "./shipped-change-store";

/** Why one page cannot stand behind a change right now. Every reason expires. */
type ContaminationReason =
  | "treated-now"
  | "measuring-window-overlap"
  | "open-proposal"
  | "recently-settled-within-window";

/** The span a changed page owns: every checkpoint including the conditional fourth, plus the days
 *  Google reports behind. Past it the page is comparable again and the pool recovers. */
const CONTAMINATED_DAYS = 59;

/** The path of a URL or a path, without the query, the fragment or a trailing slash. */
export const pathOf = (u: string): string =>
  (u ?? "").replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";

/** What the window math needs from a change: where it landed and the stamp it counts from. */
type AnchoredChange = { path: string; shippedAt: string; implementedAt?: string | null };

function spanOf(c: AnchoredChange): { start: string; end: string } {
  const stamp = c.implementedAt ?? c.shippedAt;
  const start = stamp.length > 10 ? stamp.slice(0, 10) : stamp;
  return { start, end: addDays(start, CONTAMINATED_DAYS) };
}

/**
 * THE POLICY. Every page that cannot stand behind a change right now, with the reason. PURE.
 *
 * `measuring` is the change being read: pass it and exclusion is scoped to ITS window, so a page
 * whose own change closed before that window opened is eligible again. Omit it (selection time)
 * and the scope is today: a page settled inside its own span is still recovering.
 */
export function contaminationFor(
  records: ReadonlyArray<ShippedChangeRecord>,
  openProposalPaths: Iterable<string>,
  now: Date,
  measuring?: AnchoredChange | null,
): Map<string, ContaminationReason> {
  const out = new Map<string, ContaminationReason>();
  const read = measuring ? spanOf(measuring) : null;
  const treatedPath = measuring ? pathOf(measuring.path) : null;
  const today = reportingDay(now);
  for (const r of records) {
    const p = pathOf(r.path);
    if (p === treatedPath) continue; // the changed page is never one of its own comparisons
    const span = spanOf(r);
    const reason: ContaminationReason | null =
      outcomeStateOf(r, now) === "measuring" ? "treated-now"
        : read ? (span.start <= read.end && read.start <= span.end ? "measuring-window-overlap" : null)
          : today <= span.end ? "recently-settled-within-window" : null;
    // A page still under its own treatment says so, whatever a second, older row on it says.
    if (reason != null && (!out.has(p) || reason === "treated-now")) out.set(p, reason);
  }
  for (const raw of openProposalPaths) {
    const p = pathOf(raw);
    if (p !== treatedPath && !out.has(p)) out.set(p, "open-proposal");
  }
  return out;
}

/** The paths this policy excludes, which is what the measure pass consumes. PURE. */
export const contaminatedPaths = (m: ReadonlyMap<string, ContaminationReason>): ReadonlySet<string> =>
  new Set(m.keys());

// ── Matched comparison pages, and the receipt that says why ──────────────────

/** WHY THIS PAGE QUALIFIED, in checkable facts and nothing else. Stored on the record. */
export type ControlReceipt = { path: string; reasons: string[] };

/** One page offered as a comparison. Every field is read off data already bought. */
type ControlCandidate = {
  url: string;
  path: string;
  /** The shape on the job already on file for this page, or null. Null degrades to the next
   *  criterion and never blocks a page from being chosen. */
  pageType: string | null;
  /** Impressions over the same pre-change window the diff in diff reads. */
  baselineImpressions: number;
  /** Whether Search Console holds rows for this page across that window at all. */
  hasBaseline: boolean;
};

/** How far apart two traffic levels are, as a multiple. Either side at zero is no comparison. */
const spread = (a: number, b: number): number => (a > 0 && b > 0 ? Math.max(a / b, b / a) : Infinity);
/** Traffic this close counts as the same size of page. */
const SAME_SIZE_MULTIPLE = 2;
const count = (n: number): string => Math.round(n).toLocaleString("en-US");

/**
 * The comparison pages for one change, best match first, with the receipt for each. PURE.
 *
 * Ranked on the job both pages carry, then on how close the traffic is (the same size of page
 * beats the biggest page on the site), then on whether the baseline window holds data at all.
 * A page with no job on file is still eligible; it simply wins nothing on the first criterion.
 */
export function selectMatchedControls(args: {
  treated: { path: string; pageType: string | null; baselineImpressions: number };
  candidates: ReadonlyArray<ControlCandidate>;
  excluded: ReadonlyMap<string, ContaminationReason>;
  max?: number;
}): { controls: string[]; receipts: ControlReceipt[] } {
  const { treated, excluded } = args;
  const treatedPath = pathOf(treated.path);
  const matched = (c: ControlCandidate): boolean =>
    treated.pageType != null && c.pageType != null && treated.pageType === c.pageType;
  const ranked = args.candidates
    .filter((c) => pathOf(c.path) !== treatedPath && !excluded.has(pathOf(c.path)))
    .map((c) => ({ c, apart: spread(c.baselineImpressions, treated.baselineImpressions) }))
    .sort((x, y) =>
      Number(matched(y.c)) - Number(matched(x.c))
      || x.apart - y.apart
      || Number(y.c.hasBaseline) - Number(x.c.hasBaseline)
      || y.c.baselineImpressions - x.c.baselineImpressions)
    .slice(0, args.max ?? 3);
  return {
    controls: ranked.map((r) => r.c.url),
    receipts: ranked.map(({ c, apart }) => {
      const reasons: string[] = [];
      if (matched(c)) reasons.push(`same page type: ${c.pageType}`);
      reasons.push(apart <= SAME_SIZE_MULTIPLE ? `traffic within ${SAME_SIZE_MULTIPLE}x`
        : `${count(c.baselineImpressions)} impressions against ${count(treated.baselineImpressions)} on the changed page`);
      if (c.hasBaseline) reasons.push("search data across the whole baseline window");
      reasons.push("no open or measuring changes");
      return { path: pathOf(c.path), reasons };
    }),
  };
}
