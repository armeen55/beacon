/**
 * Sprint 6A.1 Phase 8 (2026-04-24) — Deterministic SpecificEditProvider shell.
 *
 * Phase 8 ships the SHELL only. The shell:
 *
 *   - implements the `SpecificEditProvider` interface
 *   - threads `tenantId` / `recId` / `evidenceHash` through to the
 *     bundle from the input packet
 *   - returns an empty `recommendations: []` and `totalCostUsd: 0`
 *
 * Phase 6A.1.9 fills in the per-action-type generators (edit_title,
 * add_h2_section, add_faq) and they return populated arrays. The shell
 * lives here so callers in Phase 6A.2's evidence-cache + budget gate
 * can wire the provider TODAY without waiting on Phase 9 — a Phase 9
 * landing changes ONE function (the inner generator dispatch) and
 * every consumer keeps working.
 *
 * Pure function. No I/O. No DB writes. No LLM. Returns the same
 * bundle shape any other provider returns.
 */

import {
  emptyBundleFor,
  type SpecificEditBundle,
  type SpecificEditProvider,
} from "../specific-edit-provider";
import type { SpecificEditEvidencePacket } from "../specific-edit-evidence";

export const deterministicProvider: SpecificEditProvider = {
  name: "deterministic",

  async generate(
    packet: SpecificEditEvidencePacket,
  ): Promise<SpecificEditBundle> {
    // Phase 6A.1.9 will replace the empty `recommendations` array with
    // the output of `runDeterministicGenerators(packet)`. Until then
    // the shell is a no-op generator: callers exercise the pipeline,
    // the cache populates, and 0 LLM tokens get spent.
    return emptyBundleFor(packet, "deterministic");
  },
};
