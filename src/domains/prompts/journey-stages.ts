import type { JourneyStage } from "./types";

/**
 * Auto-classify a prompt's journey stage from its text.
 * Uses keyword/pattern heuristics — not ML.
 */

const AWARENESS_PATTERNS = [
  /^what (?:is|are) /i,
  /^how (?:does|do) /i,
  /^why (?:do|does|should|is) /i,
  /^explain /i,
  /^tell me about /i,
  /^understanding /i,
];

const CONSIDERATION_PATTERNS = [
  /^best /i,
  /^top /i,
  /^recommended /i,
  /^what are the best /i,
  /^who are the best /i,
  /^find (?:me )?(?:a |the )?/i,
  /^looking for /i,
];

const COMPARISON_PATTERNS = [
  / vs\.? /i,
  / versus /i,
  / compared to /i,
  / or /i,
  /^compare /i,
  /^difference between /i,
  / better /i,
];

const DECISION_PATTERNS = [
  /^(?:reviews?|rating) (?:of|for) /i,
  /^hire /i,
  /^should I (?:hire|use|choose|go with) /i,
  /^is .+ (?:good|worth|reliable|trustworthy)/i,
  / cost /i,
  / price /i,
  / quote /i,
];

const SUPPORT_PATTERNS = [
  /^how (?:to|do I) /i,
  /^can I /i,
  /^what (?:should|do) I do /i,
  /^help (?:me |with )/i,
  /^troubleshoot/i,
  /^fix /i,
];

const ADVERSARIAL_PATTERNS = [
  /complaint/i,
  /scam/i,
  /worst /i,
  /problem(?:s)? with /i,
  /bad (?:reviews?|experience)/i,
  /avoid /i,
  /ripoff/i,
  /lawsuit/i,
];

export function classifyJourneyStage(promptText: string): JourneyStage {
  const text = promptText.trim();

  if (ADVERSARIAL_PATTERNS.some((p) => p.test(text))) return "adversarial";
  if (DECISION_PATTERNS.some((p) => p.test(text))) return "decision";
  if (COMPARISON_PATTERNS.some((p) => p.test(text))) return "comparison";
  if (SUPPORT_PATTERNS.some((p) => p.test(text))) return "support";
  if (CONSIDERATION_PATTERNS.some((p) => p.test(text))) return "consideration";
  if (AWARENESS_PATTERNS.some((p) => p.test(text))) return "awareness";

  return "consideration";
}

export const JOURNEY_STAGE_LABELS: Record<JourneyStage, string> = {
  awareness: "Awareness",
  consideration: "Consideration",
  comparison: "Comparison",
  decision: "Decision",
  support: "Support",
  adversarial: "Adversarial",
};

export const JOURNEY_STAGE_ORDER: JourneyStage[] = [
  "awareness",
  "consideration",
  "comparison",
  "decision",
  "support",
  "adversarial",
];
