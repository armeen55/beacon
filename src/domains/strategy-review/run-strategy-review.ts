import "server-only";

/**
 * strategy-review/run-strategy-review (2026-07-02, BEACON 500 item 51) - the weekly
 * strategy review: ONE budget-gated LLM pass reads the dossier (build-dossier.ts) and
 * proposes a lever mix + up to 3 focus families + a signed memo for the COMING week.
 *
 * Routes through the EXISTING structured-drafter gauntlet (callStructuredLLM): budget
 * fail-closed, gpt-5-mini reasoning_effort "low", json_schema-shaped Zod validation,
 * retry-once, numeric-fidelity/placeholder/superlative/em-dash firewalls. NO new OpenAI
 * egress point is opened here - same posture as batch-adjudicator.ts.
 *
 * TRUST CONTRACT (pinned by run-strategy-review.test.ts):
 *  - The LLM PROPOSES; clampStrategyMix/clampFocusFamilies (apply-mix.ts) DISPOSE. Every
 *    weight is clamped to [0.5, 2.0]; any family the model invents is dropped.
 *  - FAIL OPEN, LOUDLY, to NO CHANGE: any failure (off, budget, validation, transport)
 *    carries the PREVIOUS week's mix forward unchanged (or a neutral empty mix if there
 *    is no previous week) and writes that as an explicit "fail_open" history record with
 *    an unmissable console.warn - never a silent gap, never an uncontrolled mix.
 *  - Idempotent per (tenant, weekOf): the caller (the cron route) checks
 *    hasStrategyMixForWeek before calling this; this function itself does not re-check,
 *    it always evaluates once when called (the guard lives at the call site so a manual
 *    or test invocation is not silently blocked).
 */

import { log } from "@/lib/logger";
import { callStructuredLLM, type CompleteFn } from "@/domains/llm/structured-drafter";
import type { StrategyReview } from "@/domains/llm/schemas";
import { loadStrategyDossier, renderDossierForPrompt, type StrategyDossier } from "./build-dossier";
import { clampStrategyMix, type ClampedStrategyMix } from "./apply-mix";
import {
  appendStrategyMixRecord,
  loadLatestStrategyMix,
  type StrategyMixRecord,
  type StrategyLeverWeight,
  type StrategyFocusFamily,
} from "./strategy-mix-store";

/** The action families the daily plan actually scores by (experiment-eligibility.ts's
 *  ExperimentFamily, mirrored here as a runtime value set so the LLM's proposal can be
 *  validated against a real, known vocabulary without this domain importing planner
 *  internals - ownership stays clean per the item 51 contract). */
export const KNOWN_ACTION_FAMILIES = [
  "title",
  "meta",
  "title_meta",
  "h1",
  "answer",
  "link",
  "schema",
  "content",
  "new_page",
  "other",
] as const;
const KNOWN_ACTION_FAMILIES_SET = new Set<string>(KNOWN_ACTION_FAMILIES);

export type RunStrategyReviewResult = {
  ran: boolean;
  weekOf: string;
  record: StrategyMixRecord | null;
  reason?: string;
};

const SYSTEM = [
  "You are the strategist on an SEO/AEO team, planning the COMING week's posture from the last week's real results.",
  "You read: which lever families (title, meta, answer blocks, links, schema, new pages, content edits) won or lost this",
  "week, this week's demand spikes, active seasonal windows, and Farsi/Finglish language gaps.",
  'Return ONLY JSON: {"leverMix": [{"family": string, "weight": number, "reason": string}], "focusFamilies": [{"family": string, "reason": string}], "memo": string, "confidence": "high"|"medium"|"low"}.',
  "leverMix: one entry per lever family you have an opinion on (use ONLY the family names given in the data - never invent a new family name).",
  "weight is a RELATIVE emphasis for next week: 1.0 is neutral, above 1.0 leans in, below 1.0 eases off. Base every weight ONLY on the won/lost record given - never invent a result.",
  "focusFamilies: at most 3 page families worth extra attention next week, each with a one-sentence reason grounded in the data given.",
  "memo: 2-4 sentences, first person, plain business English, plainly naming what changed and why. Do NOT add your own signature or sign-off line (the app adds that separately) and do NOT start a sentence with the word Signed. No jargon (experiment, control, treatment, SERP, baseline). No em dashes, no en dashes, hyphens only.",
  "With a thin week (few or no settled results), say so plainly and propose a conservative, mostly-neutral mix rather than a bold reallocation.",
  "Never invent a number, date, or statistic that is not in the data given.",
].join(" ");

function buildUserPrompt(dossier: StrategyDossier): string {
  return [renderDossierForPrompt(dossier), "", "Propose next week's lever mix, focus families, and memo now. Return the JSON now."].join("\n");
}

/** Carry the previous week's mix forward unchanged - the fail-open path. Returns null
 *  (no record to write) when there is no previous week at all (first-ever run + a
 *  failure means simply no record this week, not a fabricated neutral one). */
function failOpenRecord(tenantId: string, weekOf: string, previous: StrategyMixRecord | null, now: Date): StrategyMixRecord | null {
  if (!previous) return null;
  return {
    tenant_id: tenantId,
    weekOf,
    leverMix: previous.leverMix,
    focusFamilies: previous.focusFamilies,
    memo: previous.memo,
    appliedAt: now.toISOString(),
    source: "fail_open",
  };
}

/**
 * Run the full weekly strategy review for one tenant: build the dossier, call the LLM
 * through the structured-drafter gauntlet, deterministically clamp the result, and
 * append the record. Fail-soft/fail-open throughout - never throws into the cron loop.
 */
export async function runStrategyReview(
  tenantId: string,
  weekOf: string,
  opts: { complete?: CompleteFn; now?: Date } = {},
): Promise<RunStrategyReviewResult> {
  const now = opts.now ?? new Date();
  const previous = await loadLatestStrategyMix(tenantId).catch(() => null);

  let dossier: StrategyDossier;
  try {
    dossier = await loadStrategyDossier(tenantId, weekOf);
  } catch (e) {
    log.warn("[strategy-review] FAIL OPEN - dossier build failed, carrying previous mix forward", {
      tenantId,
      weekOf,
      error: e instanceof Error ? e.message : String(e),
    });
    const record = failOpenRecord(tenantId, weekOf, previous, now);
    if (record) await appendStrategyMixRecord(record).catch(() => false);
    return { ran: false, weekOf, record, reason: "dossier_failed" };
  }

  const result = await callStructuredLLM({
    kind: "strategy_review",
    system: SYSTEM,
    user: buildUserPrompt(dossier),
    grounded: renderDossierForPrompt(dossier),
    projectedCostUsd: 0.01,
    maxTokens: 1500,
    timeoutMs: 90_000,
    now,
    complete: opts.complete,
  });

  if (result.status === "off") {
    // Expected configuration (no LLM provider armed) - quiet, no record written. This is
    // NOT a failure: no review is scheduled to run at all, so there is nothing to carry
    // forward. The last real mix (if any) simply stays the latest one on file.
    return { ran: false, weekOf, record: null, reason: "off" };
  }

  if (result.status !== "drafted") {
    const detail = result.status === "blocked_budget" ? `budget: ${result.reason}` : `validation: ${result.reason} (retried: ${String(result.retried)})`;
    log.warn(
      `[strategy-review] FAIL OPEN, LOUDLY (${result.status} - ${detail}). Carrying the previous week's mix forward unchanged for ${tenantId}, week ${weekOf}.`,
    );
    const record = failOpenRecord(tenantId, weekOf, previous, now);
    if (record) await appendStrategyMixRecord(record).catch(() => false);
    return { ran: false, weekOf, record, reason: result.status };
  }

  const review = result.value as StrategyReview;
  const clampedMix: ClampedStrategyMix = clampStrategyMix(review.leverMix, KNOWN_ACTION_FAMILIES_SET);
  // focusFamilies names PAGE families (e.g. "iran-flags"), not action families - those are
  // tenant-specific and unbounded, so there is no fixed known-set to validate membership
  // against. The disposal rule that still applies is the dash-strip + 3-item cap + dedupe,
  // via the local helper below (apply-mix.ts's clampFocusFamilies is for the bounded
  // action-family vocabulary and is not the right fit here).
  const focusFamilies: StrategyFocusFamily[] = clampFocusFamiliesPageFamilies(review.focusFamilies);

  const leverMix: StrategyLeverWeight[] = [...clampedMix.entries()].map(([family, v]) => ({ family, weight: v.weight, reason: v.reason }));

  const record: StrategyMixRecord = {
    tenant_id: tenantId,
    weekOf,
    leverMix,
    focusFamilies,
    memo: stripDashesTop(review.memo),
    appliedAt: now.toISOString(),
    source: "llm",
  };
  const wrote = await appendStrategyMixRecord(record).catch(() => false);
  if (!wrote) {
    // Idempotency guard tripped (a record for this week already exists) - report the
    // EXISTING record rather than the one we just (redundantly) computed, so the caller
    // never thinks a second write happened.
    const existing = await loadLatestStrategyMix(tenantId).catch(() => null);
    return { ran: false, weekOf, record: existing, reason: "already_ran" };
  }
  return { ran: true, weekOf, record };
}

// clampFocusFamilies (apply-mix.ts) is written generically against a known-family set for
// the ACTION-family case (leverMix); page-family focus targets have no fixed vocabulary,
// so this local helper reuses the SAME dash-strip + cap-at-3 + dedupe logic without a
// membership check (every proposed family "passes").
function clampFocusFamiliesPageFamilies(proposed: ReadonlyArray<{ family: string; reason: string }>): StrategyFocusFamily[] {
  const seen = new Set<string>();
  const out: StrategyFocusFamily[] = [];
  for (const p of proposed) {
    const family = (p.family ?? "").trim();
    const key = family.toLowerCase();
    if (!family || seen.has(key)) continue;
    seen.add(key);
    out.push({ family, reason: stripDashesTop(p.reason ?? "") });
    if (out.length >= 3) break;
  }
  return out;
}

function stripDashesTop(s: string): string {
  return s.replace(/\s*[—–]\s*/g, " - ").trim();
}
