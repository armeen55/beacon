import "server-only";

import { callStructuredLLM, type CompleteFn } from "./structured-drafter";
import type { BatchAdjudication } from "./schemas";

/**
 * llm/batch-adjudicator (2026-07-02, BEACON 500 item 12) - the nightly FINAL
 * REVIEW, the standing reasoning-gap fix. After the deterministic picks are
 * final, ONE bounded LLM call reads the whole batch and sanity-checks each pick
 * against its own evidence: does the proposed text actually match what the top
 * search asks for? (The motivating failure: the deterministic batch once
 * surfaced a definition answer when the demand was a date, "chaharshanbe suri
 * 2026" - an LLM read would have caught it.)
 *
 * TRUST CONTRACT (pinned by batch-adjudicator.test.ts +
 * tests/architecture/batch-adjudicator-final-review.test.ts):
 *  - The review can FLAG a pick with a one-line plain-language caution. It can
 *    NEVER drop, reorder, edit, or block a pick. Attach-only.
 *  - One call for the WHOLE batch (<= 8 picks/night, ~a cent).
 *  - NO NEW EGRESS POINT: everything routes through callStructuredLLM (the
 *    single gated/budgeted OpenAI entry: BEACON_LLM_PROVIDER=openai gate,
 *    checkBudget/recordSpend fail-closed cap, gpt-5-mini reasoning_effort
 *    "low", Zod validate, retry-once, numeric-fidelity/placeholder/superlative
 *    firewalls). This file never opens its own OpenAI connection, so the
 *    llm-safety-invariants egress allowlist needs no new entry.
 *  - 90s timeout: gpt-5-mini reasoning at default effort once blew a 40s judge
 *    timeout and fell back SILENTLY; never again.
 *  - FAIL OPEN, LOUDLY: any LLM failure (budget, validation, transport) ships
 *    the batch with ZERO flags and one unmissable console.warn. The batch is
 *    never held hostage by the reviewer. "off" (provider not openai) is
 *    expected configuration, not a failure - it stays silent.
 */

/** The persisted result of the final review for one pick. Attach-only. */
export type TeamCheck = { verdict: "looks_right" | "concern"; concern?: string };

/** What the reviewer reads per pick - already-frozen plan-record fields. */
export type AdjudicationPick = {
  /** The plan-record pick id, echoed back by the model to address its verdict. */
  id: string;
  url: string;
  targetQuery: string;
  proposedText: string;
  /** The pick's evidence sentence (the plan record's whyNow line). */
  whyNow?: string;
};

export type AdjudicateOptions = { complete?: CompleteFn; now?: Date };

const pathOf = (u: string): string =>
  (u.replace(/^https?:\/\/[^/]+/i, "") || "/").replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";

const truncate = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 3)}...`);

const SYSTEM = [
  "You are the final reviewer on an SEO team, sanity-checking today's planned page changes before the site owner sees them.",
  "For EACH pick decide one thing: does the proposed text actually match what the top search is asking for?",
  "The classic miss you exist to catch: the search asks for a date or a number and the proposed text gives a definition instead.",
  'Return ONLY JSON: {"picks":[{"pickId": string, "verdict": "looks_right" or "concern", "concern": string}]}.',
  "Echo each pickId EXACTLY as given, include every pick exactly once, in any order.",
  'Set "concern" ONLY when verdict is "concern": one plain-English sentence UNDER 140 characters saying what mismatches, readable by a non-technical business owner.',
  "Flag a concern only for a REAL intent mismatch; when in doubt, answer looks_right.",
  "Plain business language: never say adjudicator, LLM, model, SERP, or intent-classification. No em dashes. Never invent a number, date, or statistic that is not in the pick's own lines.",
].join(" ");

/**
 * One bounded LLM read over the whole batch. Returns a map of pickId ->
 * TeamCheck for every pick the reviewer addressed with a trustworthy row
 * (known id; a "concern" without a reason is noise and is dropped). Empty map
 * when the review is off, blocked, or failed - never throws, never blocks.
 */
export async function adjudicateBatch(
  picks: AdjudicationPick[],
  opts: AdjudicateOptions = {},
): Promise<Map<string, TeamCheck>> {
  if (picks.length === 0) return new Map();

  const lines = picks.map((p, i) =>
    [
      `Pick ${i + 1}`,
      `pickId: ${p.id}`,
      `Page: ${pathOf(p.url)}`,
      `Top search: "${p.targetQuery}"`,
      `Proposed text: ${truncate(p.proposedText, 280)}`,
      p.whyNow ? `Evidence: ${truncate(p.whyNow, 220)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  const user = [`Today's batch (${picks.length} picks):`, "", lines.join("\n\n"), "", "Return the JSON now."].join("\n");
  // Grounding for the numeric-fidelity firewall: every number the model may
  // legitimately echo (ids, queries, proposed text, evidence) is in here, so a
  // concern that invents a figure is rejected by the shared firewall.
  const grounded = lines.join("\n");

  const r = await callStructuredLLM({
    kind: "batch_adjudication",
    system: SYSTEM,
    user,
    grounded,
    projectedCostUsd: 0.02,
    maxTokens: 4000,
    // gpt-5-mini reasoning gotcha: default effort once took ~44s and blew a 40s
    // timeout silently. reasoning_effort "low" is set inside the shared caller;
    // the timeout stays >= 90s here.
    timeoutMs: 90_000,
    complete: opts.complete,
    now: opts.now,
  });

  // Provider not configured: expected state, zero flags, quiet.
  if (r.status === "off") return new Map();

  if (r.status !== "drafted") {
    const detail =
      r.status === "blocked_budget" ? `budget: ${r.reason}` : `validation: ${r.reason} (retried: ${String(r.retried)})`;
    // FAIL OPEN, LOUDLY: the batch ships with zero flags rather than being blocked.
    console.warn(
      `[batch-adjudicator] FINAL REVIEW FAILED OPEN (${r.status} - ${detail}). ` +
        `All ${picks.length} picks continue WITHOUT a final-review check today. The plan itself is unaffected.`,
    );
    return new Map();
  }

  const knownIds = new Set(picks.map((p) => p.id));
  const out = new Map<string, TeamCheck>();
  for (const row of (r.value as BatchAdjudication).picks) {
    if (!knownIds.has(row.pickId)) continue; // never trust an id we did not send
    const concern = row.verdict === "concern" ? row.concern?.trim() : undefined;
    if (row.verdict === "concern" && !concern) continue; // a flag with no reason is noise
    out.set(row.pickId, concern ? { verdict: "concern", concern } : { verdict: "looks_right" });
  }
  return out;
}

/** Structural shape of a reviewable plan pick - PlannedExperimentRecord
 *  satisfies it without this domain importing the experiments domain. */
type ReviewablePick = {
  id: string;
  url: string;
  targetQuery: string;
  proposedText: string;
  whyNow?: string;
  teamCheck?: TeamCheck;
};

/**
 * The one-call-site wiring helper for the nightly preview builder: run the
 * final review over the FINAL picks and attach each verdict additively as
 * `teamCheck`. Mutates in place; NEVER filters, reorders, or replaces the
 * array. Returns the number of picks flagged with a concern. Never throws.
 */
export async function applyFinalReviewToPicks<T extends ReviewablePick>(
  picks: T[],
  opts: AdjudicateOptions = {},
): Promise<number> {
  const results = await adjudicateBatch(
    picks.map((p) => ({ id: p.id, url: p.url, targetQuery: p.targetQuery, proposedText: p.proposedText, whyNow: p.whyNow })),
    opts,
  );
  let flagged = 0;
  for (const p of picks) {
    const check = results.get(p.id);
    if (!check) continue;
    p.teamCheck = check; // attach-only
    if (check.verdict === "concern") flagged += 1;
  }
  return flagged;
}
