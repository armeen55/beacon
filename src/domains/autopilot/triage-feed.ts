import "server-only";

/**
 * Triage feed bridge (2026-07-02, BEACON 500 item 52).
 *
 * PURE bridge from the dormant triage-rules learning loop
 * (src/domains/learning/triage-rules.ts) to autopilot per-lever policy
 * SUGGESTIONS. Triage rules are computed after every scan pass but were
 * never read back by anything - this module is the first consumer.
 *
 * Shape gap this module exists to close: triage rules are keyed by
 * `finding_type` (a scanning Finding.type, e.g. "meta_changed") and
 * `citation_bucket`. Autopilot per-lever policies are keyed by `actionType`
 * (a recommended-edit action_type, e.g. "edit_meta"). Only finding types
 * that correspond to a real, pushable lever are ever surfaced here - the
 * rest (deploy_mismatch, page_added, robots_txt_blocked, ...) are not
 * something autopilot can ship, so they never become a suggestion.
 *
 * SAFETY: this module only ever produces SUGGESTIONS. Nothing here writes
 * to the autopilot config. An operator must read the evidence line and
 * click "enable" (a settings action) before any lever's mode becomes "auto".
 * A suggestion is never surfaced for a lever the operator already has an
 * explicit policy row for (already decided, one way or the other).
 *
 * Pinned by tests/domains/autopilot/triage-feed.test.ts.
 */

import { readStore } from "@/lib/persistence/json-store";
import type { TriageRule } from "@/domains/learning/triage-rules";
import { leverLabel, type AutopilotConfig, type PerLeverPolicy } from "./autopilot-policy";

/**
 * Only finding types that map to a lever autopilot can actually ship. A
 * finding type absent from this map (deploy_mismatch, page_added, ...) can
 * never produce a suggestion - there is no pushable action behind it.
 */
export const FINDING_TYPE_TO_LEVER: Partial<Record<TriageRule["finding_type"], string>> = {
  title_changed: "edit_title",
  meta_changed: "edit_meta",
  h1_changed: "change_h1",
  faq_changed: "add_faq",
  faq_without_schema: "add_schema",
  schema_changed: "fix_schema",
  schema_invalid: "fix_schema",
  schema_missing_for_page_type: "add_schema",
};

/** The default daily cap suggested when the operator enables a suggestion. */
export const SUGGESTED_DAILY_CAP = 1;

export type TriagePolicySuggestion = {
  /** The lever this suggestion would enable (autopilot actionType). */
  actionType: string;
  /** Operator-readable lever name, e.g. "Search description updates". */
  label: string;
  /** The triage rule id(s) behind this suggestion (for traceability). */
  ruleIds: string[];
  /** Total resolved decisions behind the suggestion (summed across buckets). */
  totalResolved: number;
  /** Total accepted decisions behind the suggestion. */
  totalAccepted: number;
  /** Rounded acceptance rate as a whole percent (e.g. 93). */
  acceptancePct: number;
  /**
   * The operator-facing evidence line, e.g. "You have accepted 14 of 15 meta
   * description suggestions. Want me to just do these?"
   */
  evidenceLine: string;
  /** The daily cap this suggestion proposes if the operator enables it. */
  suggestedDailyCap: number;
};

const AUTO_ACCEPT_THRESHOLD_PCT = 90;

/**
 * Fold triage rules (per finding_type x citation_bucket) into one suggestion
 * per lever. A lever qualifies when its combined "auto_accept"-recommended,
 * high-confidence rules cross the 90 percent acceptance threshold across all
 * their resolved decisions together. Pure - no I/O.
 */
export function computeTriageSuggestions(rules: TriageRule[]): TriagePolicySuggestion[] {
  const byLever = new Map<
    string,
    { ruleIds: string[]; totalResolved: number; totalAccepted: number }
  >();

  for (const rule of rules) {
    if (rule.confidence !== "high") continue;
    if (rule.recommendation !== "auto_accept") continue;
    const actionType = FINDING_TYPE_TO_LEVER[rule.finding_type];
    if (actionType == null) continue;

    const entry = byLever.get(actionType) ?? { ruleIds: [], totalResolved: 0, totalAccepted: 0 };
    entry.ruleIds.push(rule.id);
    entry.totalResolved += rule.total_resolved;
    entry.totalAccepted += rule.accepted_count;
    byLever.set(actionType, entry);
  }

  const suggestions: TriagePolicySuggestion[] = [];
  for (const [actionType, entry] of byLever) {
    if (entry.totalResolved <= 0) continue;
    const acceptancePct = Math.round((entry.totalAccepted / entry.totalResolved) * 100);
    if (acceptancePct < AUTO_ACCEPT_THRESHOLD_PCT) continue;

    const label = leverLabel(actionType);
    suggestions.push({
      actionType,
      label,
      ruleIds: entry.ruleIds,
      totalResolved: entry.totalResolved,
      totalAccepted: entry.totalAccepted,
      acceptancePct,
      evidenceLine: `You have accepted ${entry.totalAccepted} of ${entry.totalResolved} ${label.toLowerCase()} suggestions (${acceptancePct} percent). Want me to just do these?`,
      suggestedDailyCap: SUGGESTED_DAILY_CAP,
    });
  }

  return suggestions.sort((a, b) => b.totalResolved - a.totalResolved);
}

/**
 * Suggestions never surface for a lever the operator already has an explicit
 * policy row for - "auto" is already on (nothing to suggest) and "review" is
 * an explicit past decision to hold this lever (re-suggesting it would be
 * nagging, not helping). Pure.
 */
export function filterSuggestionsForOperatorDecision(
  suggestions: TriagePolicySuggestion[],
  existingPolicies: PerLeverPolicy[] | null | undefined,
): TriagePolicySuggestion[] {
  const decided = new Set((existingPolicies ?? []).map((p) => p.actionType));
  return suggestions.filter((s) => !decided.has(s.actionType));
}

/**
 * The full read: load triage rules, compute suggestions, and drop anything
 * the operator has already decided on. This is the ONLY function that talks
 * to the store - computeTriageSuggestions and the filter above stay pure and
 * are what the tests pin.
 */
export async function loadTriageSuggestions(
  config: Pick<AutopilotConfig, "perLeverPolicies">,
): Promise<TriagePolicySuggestion[]> {
  let rules: TriageRule[] = [];
  try {
    rules = await readStore<TriageRule>("triage-rules");
  } catch {
    return [];
  }
  const all = computeTriageSuggestions(rules);
  return filterSuggestionsForOperatorDecision(all, config.perLeverPolicies);
}
