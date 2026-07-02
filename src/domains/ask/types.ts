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
};

export type AskDossier = {
  questionClass: AskQuestionClass;
  pagePath: string | null;
  facts: AskFact[];
  /** True when at least one real fact was found (vs. an honest "no data yet" dossier). */
  hasData: boolean;
};

/** One cited fact underneath an answer bubble. */
export type AskCitedFact = {
  fact: string;
  href: string;
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
};

export type AskHistoryEntry = {
  id: string;
  tenant_id: string;
  question: string;
  answer: AskAnswer;
  questionClass: AskQuestionClass;
  askedAt: string;
};
