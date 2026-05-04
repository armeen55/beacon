/**
 * W3 Step 3.10 (2026-05-03) — static-bundle provider.
 *
 * A `SpecificEditProvider` that returns a previously-captured
 * `SpecificEditBundle` instead of calling a real LLM. Used by the
 * `--from-bundle=<path>` CLI flag to persist exactly the copy the
 * operator approved during a dry-run.
 *
 * Operator scope (W3 §3.10):
 *   The Step 3.9 reports listed exact dry-run output, but `--write`
 *   re-calls OpenAI on every invocation, so persisted copy could
 *   drift from the reviewed copy. The static-bundle provider lets
 *   the operator save the dry-run bundle to disk, review it, and
 *   persist the SAME bytes — no second model call, no copy drift.
 *
 * Validation + persistence layers still run on the loaded bundle,
 * so brand-claim grounding, em dashes, FAQ pairing, and competitor-
 * leak checks all apply. The bundle's `providerName` and per-edit
 * `source`, `model`, `costUsd` are preserved verbatim — telemetry
 * (LLM history, cost ledger) reflects the ORIGINAL run, not the
 * replay.
 *
 * Consistency rules (enforced when the provider is invoked):
 *   - `bundle.tenantId` MUST match `packet.tenantId`.
 *   - `bundle.recId` MUST match `packet.recId`.
 *   - `bundle.evidenceHash` MUST match `packet.evidenceHash`.
 *   When any rule fails, the provider throws — the persistence
 *   layer's tenant-mismatch / hash-mismatch guards catch upstream
 *   drift; this layer catches operator-level mistakes (loaded the
 *   wrong bundle for this rec).
 *
 * Pure / deterministic. The provider is idempotent: calling
 * `generate` twice with the same packet returns the same bundle
 * reference (no clones; downstream MUST treat as readonly).
 */

import type {
  SpecificEditBundle,
  SpecificEditProvider,
  SpecificEditProviderName,
} from "../specific-edit-provider";
import type { SpecificEditEvidencePacket } from "../specific-edit-evidence";

/**
 * W3 Step 3.12 (2026-05-03) — operator-opt-in option to relax the
 * evidence-hash equality check while keeping tenantId + recId match
 * enforced. Set by the CLI when `--rec-id-override` is in use: the
 * saved bundle was generated against a different rec scope, so its
 * evidenceHash legitimately differs from the live packet's hash. The
 * tenantId / recId guards still fire (they catch the operator-loaded-
 * the-wrong-bundle mistake the W3 §3.10 design existed for).
 *
 * Default `false` — preserves the §3.10 contract for callers without
 * an explicit override.
 */
export type StaticBundleProviderOptions = {
  allowEvidenceHashDrift?: boolean;
};

/**
 * Build a `SpecificEditProvider` whose `generate` returns the given
 * pre-captured bundle. The provider's `name` mirrors the bundle's
 * `providerName` so logs / cost ledger / LLM history show the
 * original source ("openai" / "deterministic") instead of a synthetic
 * marker.
 */
export function staticBundleProvider(
  bundle: SpecificEditBundle,
  options: StaticBundleProviderOptions = {},
): SpecificEditProvider {
  const allowEvidenceHashDrift = options.allowEvidenceHashDrift === true;
  return {
    name: bundle.providerName,
    async generate(
      packet: SpecificEditEvidencePacket,
    ): Promise<SpecificEditBundle> {
      assertBundleMatchesPacket(bundle, packet, { allowEvidenceHashDrift });
      // When evidence-hash drift is allowed (via --rec-id-override),
      // graft the live packet's evidenceHash onto the returned bundle
      // so downstream cache + telemetry use the CURRENT packet's hash.
      // The bundle's saved totalCostUsd still reflects the original
      // generation run.
      if (allowEvidenceHashDrift && bundle.evidenceHash !== packet.evidenceHash) {
        return { ...bundle, evidenceHash: packet.evidenceHash };
      }
      return bundle;
    },
  };
}

/**
 * Throw a clear error when the loaded bundle doesn't match the
 * packet the caller is about to feed it. Catches the most common
 * operator mistake: passing the wrong bundle path for the
 * `--rec-id` they're persisting.
 *
 * `allowEvidenceHashDrift` (W3 §3.12): when true, skips the
 * evidence-hash equality check while still enforcing tenantId +
 * recId match. Set by the CLI under `--rec-id-override` because the
 * saved bundle was generated for a different rec scope — its
 * evidence hash legitimately differs from the live packet's hash.
 */
function assertBundleMatchesPacket(
  bundle: SpecificEditBundle,
  packet: SpecificEditEvidencePacket,
  options: { allowEvidenceHashDrift: boolean } = { allowEvidenceHashDrift: false },
): void {
  const fails: string[] = [];
  if (bundle.tenantId !== packet.tenantId) {
    fails.push(
      `tenantId mismatch (bundle=${JSON.stringify(bundle.tenantId)} packet=${JSON.stringify(packet.tenantId)})`,
    );
  }
  if (bundle.recId !== packet.recId) {
    fails.push(
      `recId mismatch (bundle=${JSON.stringify(bundle.recId)} packet=${JSON.stringify(packet.recId)})`,
    );
  }
  if (
    !options.allowEvidenceHashDrift &&
    bundle.evidenceHash !== packet.evidenceHash
  ) {
    fails.push(
      `evidenceHash mismatch (bundle=${JSON.stringify(bundle.evidenceHash)} packet=${JSON.stringify(packet.evidenceHash)}); the live evidence has shifted since the dry-run, so persisting this bundle could mismatch the live page state. If you intentionally re-scoped the rec (single→cluster), pass --rec-id-override to opt into the drift.`,
    );
  }
  if (fails.length > 0) {
    throw new Error(
      `[static-bundle] saved bundle does not match the current packet:\n  - ${fails.join(
        "\n  - ",
      )}\nLoad the correct bundle, or re-run a fresh dry-run + save before persisting.`,
    );
  }
}

/**
 * Schema-tagged provider name for the wrapped static path. The
 * runtime provider's `name` mirrors the bundle's original
 * providerName (e.g. "openai"); this constant is exported so tests
 * + telemetry can refer to the static-replay path explicitly.
 */
export const STATIC_BUNDLE_PROVIDER_TAG: SpecificEditProviderName | "static" =
  "static";

/**
 * Type guard: is the given object a SpecificEditBundle? Best-effort
 * structural check — we don't run the full schema validator here
 * because the persistence layer's `validateSpecificEditBundle` does
 * that work.
 */
export function looksLikeSpecificEditBundle(
  v: unknown,
): v is SpecificEditBundle {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Partial<SpecificEditBundle>;
  if (b.schemaVersion !== "specific-edit-bundle/v1") return false;
  if (typeof b.tenantId !== "string") return false;
  if (typeof b.recId !== "string") return false;
  if (typeof b.evidenceHash !== "string") return false;
  if (typeof b.providerName !== "string") return false;
  if (!Array.isArray(b.recommendations)) return false;
  if (typeof b.totalCostUsd !== "number") return false;
  return true;
}
