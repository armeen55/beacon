/**
 * Sprint 6A.1 Phase 9 (2026-04-24) — Deterministic SpecificEditProvider.
 *
 * Phase 8 shipped the empty shell; Phase 9 wires the three generators
 * for the v1 active action types:
 *
 *   - `edit_title`       (./generators/edit-title.ts)
 *   - `add_h2_section`   (./generators/add-h2-section.ts)
 *   - `add_faq`          (./generators/add-faq.ts)
 *
 * Each generator is a pure function from
 * `SpecificEditEvidencePacket` → `SpecificEdit[]`. The provider
 * runs all three and concatenates the results, in a stable order so
 * the bundle's `recommendations` array hashes identically across
 * runs with the same input.
 *
 * **No validation in this phase.** Output validation that rejects
 * hallucinated URLs / element keys / action types is Phase 6A.1.10.
 * The deterministic generators here are written to never produce
 * those (they only emit URLs from `allowedTargetUrls` and
 * actionTypes from `allowedActionTypes`), so deterministic output is
 * implicitly valid — but the validation layer will still run on top
 * of it for symmetry with the LLM providers.
 *
 * Pure function. No I/O. No DB writes. No LLM. No mutation of input.
 */

import {
  emptyBundleFor,
  type SpecificEdit,
  type SpecificEditBundle,
  type SpecificEditProvider,
} from "../specific-edit-provider";
import type { SpecificEditEvidencePacket } from "../specific-edit-evidence";
import { generateEditTitle } from "./generators/edit-title";
import { generateAddH2Section } from "./generators/add-h2-section";
import { generateAddFaq } from "./generators/add-faq";

/**
 * Stable order. Sequence matters — when downstream sorting changes,
 * keep this list and the `runDeterministicGenerators` order aligned.
 */
const GENERATORS: Array<
  (packet: SpecificEditEvidencePacket) => SpecificEdit[]
> = [generateEditTitle, generateAddH2Section, generateAddFaq];

/** Pure: run every Phase-9 generator and concatenate. Exported for
 *  unit tests + Phase 10 validation chain. */
export function runDeterministicGenerators(
  packet: SpecificEditEvidencePacket,
): SpecificEdit[] {
  const out: SpecificEdit[] = [];
  for (const fn of GENERATORS) {
    for (const edit of fn(packet)) out.push(edit);
  }
  return out;
}

export const deterministicProvider: SpecificEditProvider = {
  name: "deterministic",

  async generate(
    packet: SpecificEditEvidencePacket,
  ): Promise<SpecificEditBundle> {
    const bundle = emptyBundleFor(packet, "deterministic");
    bundle.recommendations = runDeterministicGenerators(packet);
    // Deterministic generators never spend tokens — totalCostUsd
    // stays 0. Per-edit costUsd is null (set in the generators).
    return bundle;
  },
};
