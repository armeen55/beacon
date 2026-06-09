/**
 * 2026-06-09 — CallRail call classification + per-URL/day rollup (§9.B).
 *
 * PURE (no I/O). Decides which calls are "qualified" and groups them by
 * canonical landing URL + UTC date so the persist layer can upsert one
 * row per (tenant, url, date) — matching the GA4 ga4_url_traffic grain
 * and the Mode A canonical-URL join.
 */

import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import {
  DEFAULT_QUALIFIED_RULE,
  type CallRailCall,
  type CallRailQualifiedRule,
  type CallRailUrlDayCount,
} from "./types";

/**
 * A call is "qualified" when CallRail scored it a good lead, OR it was
 * answered and lasted at least the rule's minimum. Drive-by hangups and
 * unanswered rings don't count.
 */
export function isQualifiedCall(
  call: CallRailCall,
  rule: CallRailQualifiedRule = DEFAULT_QUALIFIED_RULE,
): boolean {
  if (call.leadStatus === "good_lead") return true;
  return call.answered && call.durationSec >= rule.minAnsweredDurationSec;
}

function utcDate(iso: string | null): string | null {
  if (iso == null || iso === "") return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Group calls into per-(canonical URL, UTC date) qualified + total
 * counts. Calls without a parseable landing URL or start time are
 * dropped (can't be attributed to a page/day). Deterministic.
 */
export function groupCallsByUrlDay(
  calls: ReadonlyArray<CallRailCall>,
  rule: CallRailQualifiedRule = DEFAULT_QUALIFIED_RULE,
): CallRailUrlDayCount[] {
  const byKey = new Map<string, CallRailUrlDayCount>();
  for (const call of calls) {
    const canonical = call.landingPageUrl
      ? canonicalizeCitationUrl(call.landingPageUrl)
      : null;
    const date = utcDate(call.startTimeIso);
    if (canonical == null || canonical === "" || date == null) continue;
    // `|` is a safe key delimiter: `date` is a fixed-format YYYY-MM-DD and
    // a canonicalized URL never contains a raw pipe, so (url, date) pairs
    // can't collide. The key is only used for grouping, never parsed back.
    const key = `${canonical}|${date}`;
    const row =
      byKey.get(key) ?? { url: canonical, date, qualifiedCalls: 0, totalCalls: 0 };
    row.totalCalls += 1;
    if (isQualifiedCall(call, rule)) row.qualifiedCalls += 1;
    byKey.set(key, row);
  }
  // Stable order for deterministic upserts/tests.
  return [...byKey.values()].sort((a, b) =>
    a.url === b.url ? (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) : a.url < b.url ? -1 : 1,
  );
}

/**
 * Sum qualified calls for a single canonical URL across a set of
 * per-day rows (the read-side helper the Mode A feed uses).
 */
export function sumQualifiedForUrl(
  rows: ReadonlyArray<CallRailUrlDayCount>,
  canonicalUrl: string,
): number {
  let n = 0;
  for (const r of rows) if (r.url === canonicalUrl) n += r.qualifiedCalls;
  return n;
}
