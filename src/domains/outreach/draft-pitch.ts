import "server-only";

import { callStructuredLLM, type CompleteFn } from "@/domains/llm/structured-drafter";
import type { StructuredDraftResult } from "@/domains/llm/structured-drafter";
import type { OutreachPitch } from "@/domains/llm/schemas";
import type { OutreachLead } from "./types";

/**
 * outreach/draft-pitch (BEACON_500 item 57, 2026-07-02) - operator-triggered
 * pitch drafter for ONE lead, through the existing budget-gated
 * callStructuredLLM (gate -> budget -> call -> validate -> firewalls ->
 * retry-once -> fail-closed). Never returns loose text - only a schema-valid
 * OutreachPitch or a non-"drafted" status the caller must handle honestly.
 *
 * Grounding is the lead's OWN evidence line plus the tenant's name/domain - the
 * numeric-fidelity firewall rejects any invented number, so the drafter cannot
 * claim a made-up stat about the target site.
 */

export type DraftPitchInput = {
  lead: OutreachLead;
  /** The tenant's own name/brand - never hardcoded, always from tenant config. */
  ownName: string;
  ownDomain: string;
  /** A short description of what the tenant's relevant page/content covers. */
  ownContext: string;
};

const OUTREACH_PITCH_SYSTEM =
  "You write ONE short, honest cold-outreach email pitching a link or citation update for a content site. " +
  'Return ONLY a JSON object: "subject" (<=80 chars, specific, no clickbait, no ALL CAPS), ' +
  '"body" (<=900 chars, plain first-person business English, references the REAL evidence provided, ' +
  "makes ONE clear ask, ends with a simple next step - no signature block, no placeholders like [Name]), " +
  '"evidenceRefs" (array of {"source","detail"}, at least one, from the grounding; source one of gsc|ga4|clarity|profound|dataforseo|semrush|competitor_teardown|owned_snapshot|fanout), ' +
  '"confidence" ("high"|"medium"|"low"), "risks" (array of short strings). ' +
  "Ground the personalization ONLY in the evidence line provided - do NOT invent facts about the recipient's site, their traffic, their audience, or any statistic. No marketing language, no superlatives, no guarantees, no em-dashes. Be brief and respectful of their time.";

/** Draft a schema-valid OutreachPitch for one lead. Capped + budgeted + firewalled. */
export async function draftOutreachPitch(
  input: DraftPitchInput,
  opts: { complete?: CompleteFn; now?: Date } = {},
): Promise<StructuredDraftResult<OutreachPitch>> {
  const grounded = [input.lead.evidence, input.ownName, input.ownDomain, input.ownContext].join(" ");
  const user = [
    `Your organization: ${input.ownName} (${input.ownDomain})`,
    `What your relevant page covers: ${input.ownContext}`,
    `Outreach target: ${input.lead.targetDomain} (${input.lead.targetUrl})`,
    `Lead source: ${input.lead.leadSource}`,
    `Evidence for this pitch: ${input.lead.evidence}`,
    "",
    "Return the JSON now.",
  ].join("\n");

  return callStructuredLLM({
    kind: "outreach_pitch",
    system: OUTREACH_PITCH_SYSTEM,
    user,
    grounded,
    projectedCostUsd: 0.01,
    maxTokens: 900,
    timeoutMs: 45_000,
    complete: opts.complete,
    now: opts.now,
  }) as Promise<StructuredDraftResult<OutreachPitch>>;
}

/**
 * Draft a follow-up pitch for a row that has gone silent (BEACON_500 item 57 -
 * follow-ups are QUEUED drafts, never auto-sent). References the original pitch
 * so the follow-up reads as a natural nudge, not a duplicate cold email.
 */
export async function draftOutreachFollowup(
  input: DraftPitchInput & { originalSubject: string; daysSinceSent: number },
  opts: { complete?: CompleteFn; now?: Date } = {},
): Promise<StructuredDraftResult<OutreachPitch>> {
  const grounded = [input.lead.evidence, input.ownName, input.ownDomain, input.ownContext, input.originalSubject].join(" ");
  const user = [
    `Your organization: ${input.ownName} (${input.ownDomain})`,
    `What your relevant page covers: ${input.ownContext}`,
    `Outreach target: ${input.lead.targetDomain} (${input.lead.targetUrl})`,
    `Evidence for this pitch: ${input.lead.evidence}`,
    `You already sent one pitch with subject "${input.originalSubject}" ${input.daysSinceSent} days ago and have not heard back.`,
    "Write a brief, polite follow-up - do not repeat the whole original pitch, just a short nudge referencing it.",
    "",
    "Return the JSON now.",
  ].join("\n");

  return callStructuredLLM({
    kind: "outreach_pitch",
    system: OUTREACH_PITCH_SYSTEM + " This is a FOLLOW-UP to a pitch that already went unanswered - keep it shorter than a first pitch and reference that you wrote before, without being pushy.",
    user,
    grounded,
    projectedCostUsd: 0.01,
    maxTokens: 700,
    timeoutMs: 45_000,
    complete: opts.complete,
    now: opts.now,
  }) as Promise<StructuredDraftResult<OutreachPitch>>;
}
