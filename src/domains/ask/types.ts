/**
 * ask/types (BEACON_500 item 59) - shared shapes for the ask-your-team chat. Pure types,
 * no I/O. Every fact the composer can cite carries a value, its source surface, and a
 * clickable href so an operator-facing number NEVER floats free of where it came from.
 */

import type { TeammateKey } from "@/domains/team/identity";
import type { AskQuestionClass } from "./router";

/** One grounded fact the LLM (or the deterministic fallback) is allowed to cite. `value`
 *  is the exact string that must appear verbatim in the answer for the number inside it
 *  to pass the numeric-fidelity firewall - keep numbers formatted plainly (no currency
 *  symbols the model might reformat away from what's grounded). */
export type AskFact = {
  /** Short plain-English fact, e.g. "Clicks on /cheetah: 412 over the last 28 days". */
  value: string;
  /** Which teammate/surface this fact came from. */
  source: TeammateKey;
  /** Where the operator can go to verify this fact themselves. */
  href: string;
  /** W9 slice 1 (fact-provider registry) - ISO date for the freshest underlying row
   *  behind this fact, e.g. "2026-07-08". Lets a rendered answer say "data through
   *  <date>" instead of leaving freshness implicit. Additive: only facts gathered
   *  through src/domains/ask/providers/registry.ts set it today; every other caller
   *  of fact-assembly.ts is unaffected. */
  freshnessIso?: string;
  /** W9 slice 1 - which registry provider produced this fact (see providers/registry.ts),
   *  e.g. "gsc-daily-totals". Additive, optional. */
  providerId?: string;
  /** W9 slice 1 - true when the provider's underlying source is real hosted (Supabase)
   *  data in production, as opposed to a file-only local store. Additive, optional;
   *  absent means "not yet classified by the registry", never a false claim of liveness. */
  prodLive?: boolean;
};

export type AskDossier = {
  questionClass: AskQuestionClass;
  pagePath: string | null;
  facts: AskFact[];
  /** True when at least one real fact was found (vs. an honest "no data yet" dossier). */
  hasData: boolean;
  /** W9 slice 2 (2026-07-10) - the planner's whole-plan verdict on whether this question
   *  is answerable with ZERO LLM (a count/rank/list, or a plan made only of page_ranking/
   *  site_trend classes). When set, the composer trusts it over the per-class shape check;
   *  when absent (Slice-1 callers, buildAskDossier's 2-arg form), the composer falls back
   *  to isDeterministicQuestionShape so old behavior is byte-identical. Additive. */
  deterministic?: boolean;
  /** W9 slice 2 - the ids of every provider the planner SELECTED for this question, even
   *  ones that returned zero facts. Lets the composer name honestly which specialists it
   *  asked but heard nothing back from (providersUnavailable). Additive, optional. */
  plannedProviderIds?: string[];
  /** W9 slice 2 - every question class the planner selected a provider for (primary +
   *  secondary cues), primary first. Length > 1 means a multi-specialist answer. Additive. */
  selectedClasses?: AskQuestionClass[];
  /** W9 slice 2 review (2026-07-10, P2) - true when the planner's whole-plan verdict
   *  (AskPlan.bestEffortOnly) says the ONLY thing to go on was the catch-all sitewide
   *  traffic provider, with no explicit trend cue and no secondary specialist. Lets the
   *  composer say plainly it only had overall traffic to go on, instead of implying a
   *  narrower question was understood. Additive; unset for Slice-1 callers. */
  bestEffortOnly?: boolean;
};

/** One cited fact underneath an answer bubble. */
export type AskCitedFact = {
  fact: string;
  href: string;
};

/** W9 slice 2 - one specialist credit under a multi-source answer. `label` is ALWAYS a
 *  human teammate name (via team/identity.ts teammateOf), NEVER a provider slug id, so the
 *  operator reads "Search demand" not "gsc-daily-totals". */
export type AskProviderCredit = {
  label: string;
  /** ISO date of the freshest row behind this specialist's facts, when it exposes one. */
  freshnessIso?: string;
};

export type AskAnswer = {
  /** The teammate whose voice this is (drives the identity chip). */
  speaker: TeammateKey;
  /** First-person answer, <= 1200 chars, dash-free. */
  answer: string;
  citedFacts: AskCitedFact[];
  /** "llm" when a real structured composition ran; "fallback" when the LLM was off, over
   *  budget, or failed validation and a deterministic template answered instead. */
  source: "llm" | "fallback";
  /** W9 slice 2 - specialists whose real facts back this answer, each with its freshest
   *  date when known. DERIVED DETERMINISTICALLY from the facts (distinct teammateOf of each
   *  fact's source), never model-generated. Set only for multi-specialist answers. */
  providersUsed?: AskProviderCredit[];
  /** W9 slice 2 - specialists the planner asked that returned zero facts, so the answer can
   *  own the gap honestly. Set only for multi-specialist answers. */
  providersUnavailable?: AskProviderCredit[];
};

export type AskHistoryEntry = {
  id: string;
  tenant_id: string;
  question: string;
  answer: AskAnswer;
  questionClass: AskQuestionClass;
  askedAt: string;
};
