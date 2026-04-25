/**
 * Sprint 6A.1 Phase 8 (2026-04-24) — OpenAI SpecificEditProvider stub.
 *
 * Phase 8 ships an EXPLICIT-FAILURE stub. `generate()` throws
 * `not_implemented` so any premature caller hits a loud failure rather
 * than silently consuming an empty bundle and assuming "no edits to
 * make."
 *
 * Sprint 6A.2 replaces this body with the real implementation:
 *   - `openai` SDK client
 *   - structured-output JSON schema derived from the packet's
 *     `allowedTargetUrls` + `allowedActionTypes`
 *   - per-call cost accounting fed back to `recommended_edits.cost_usd`
 *   - validation pass via Phase 6A.1.10's output validator before
 *     returning
 *
 * **No `openai` SDK import in Phase 8.** Adding the dependency before
 * the implementation lands creates a ghost import that ships with
 * every Beacon build for nothing. The Phase 6A.1.8 wiring tests
 * assert the absence of the import.
 */

import type {
  SpecificEditBundle,
  SpecificEditProvider,
} from "../specific-edit-provider";
import type { SpecificEditEvidencePacket } from "../specific-edit-evidence";

export const NOT_IMPLEMENTED_MESSAGE =
  "openai SpecificEditProvider not implemented (Sprint 6A.2)";

export const openaiProvider: SpecificEditProvider = {
  name: "openai",

  async generate(
    _packet: SpecificEditEvidencePacket,
  ): Promise<SpecificEditBundle> {
    throw new Error(NOT_IMPLEMENTED_MESSAGE);
  },
};
