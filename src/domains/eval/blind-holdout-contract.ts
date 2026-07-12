/**
 * The release contract for a genuinely blind product-judgment benchmark.
 *
 * Known fixtures cannot satisfy this contract. A case counts only when its input
 * was preregistered, Beacon's prediction was frozen before the expert answer was
 * revealed, and no code was changed in response to that case. Any case that
 * causes a code change is useful training evidence, but is permanently spent and
 * must be replaced by another unseen case.
 */

export const REQUIRED_HOLDOUT_ARCHETYPES = [
  "edit",
  "new_page",
  "zero_click_trap",
  "declining_page",
  "do_nothing",
] as const;

export type HoldoutArchetype = (typeof REQUIRED_HOLDOUT_ARCHETYPES)[number];

export type BlindHoldoutCaseReceipt = {
  id: string;
  archetype: HoldoutArchetype;
  preregisteredAt: string;
  predictionRecordedAt: string;
  expertLabelRevealedAt: string;
  passed: boolean;
  /** True means this case influenced implementation and can never certify it. */
  codeChangedInResponse: boolean;
};

export type BlindHoldoutReceipt = {
  candidateSha: string;
  cases: readonly BlindHoldoutCaseReceipt[];
};

export type BlindHoldoutValidation = {
  releaseEligible: boolean;
  countedCases: number;
  spentCases: number;
  reasons: string[];
};

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Pure, fail-closed acceptance gate. Empty, malformed, leaked, tuned, incomplete,
 * or failed runs can only remove eligibility, never grant it. */
export function validateBlindHoldout(receipt: BlindHoldoutReceipt): BlindHoldoutValidation {
  const reasons: string[] = [];
  if (!/^[0-9a-f]{40}$/i.test(receipt.candidateSha)) reasons.push("The candidate commit is missing or invalid.");

  const ids = new Set<string>();
  const covered = new Set<HoldoutArchetype>();
  let countedCases = 0;
  let spentCases = 0;

  for (const c of receipt.cases) {
    if (!c.id.trim() || ids.has(c.id)) {
      reasons.push(`Case IDs must be nonempty and unique: ${c.id || "missing"}.`);
      continue;
    }
    ids.add(c.id);

    if (!(REQUIRED_HOLDOUT_ARCHETYPES as readonly string[]).includes(c.archetype)) {
      reasons.push(`${c.id} has an unknown holdout archetype.`);
      continue;
    }

    const preregistered = timestamp(c.preregisteredAt);
    const predicted = timestamp(c.predictionRecordedAt);
    const revealed = timestamp(c.expertLabelRevealedAt);
    if (preregistered == null || predicted == null || revealed == null || !(preregistered < predicted && predicted < revealed)) {
      reasons.push(`${c.id} does not prove preregistration, frozen prediction, then label reveal in that order.`);
      continue;
    }
    if (c.codeChangedInResponse) {
      spentCases += 1;
      reasons.push(`${c.id} influenced the code, so it is spent and cannot certify this release.`);
      continue;
    }

    countedCases += 1;
    covered.add(c.archetype);
    if (!c.passed) reasons.push(`${c.id} failed its expert judgment.`);
  }

  if (countedCases < 5) reasons.push(`A release needs 5 countable unseen cases; this receipt has ${countedCases}.`);
  for (const archetype of REQUIRED_HOLDOUT_ARCHETYPES) {
    if (!covered.has(archetype)) reasons.push(`The holdout is missing the ${archetype} archetype.`);
  }

  return { releaseEligible: reasons.length === 0, countedCases, spentCases, reasons };
}

export const NO_BLIND_HOLDOUT_LINE =
  "No fresh blind result is registered for this release. My known cases only catch regressions.";
