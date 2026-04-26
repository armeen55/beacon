/**
 * Sprint 6A.2a (2026-04-26) — LLM provider config + safety gate.
 *
 * Single source of truth for which provider `runProviderAndPersist`
 * dispatches to. Phase 6A.2a is **CONFIG ONLY** — no network calls, no
 * SDK dependencies, no real LLM activation. The OpenAI provider body
 * lights up in 6A.2b; this file just makes the toggle explicit and
 * fail-loud.
 *
 * Resolution order:
 *   1. `BEACON_LLM_PROVIDER` env var, when set:
 *      - "deterministic" → use the in-repo deterministic generators (no
 *        cost, no network, default)
 *      - "openai"        → use the OpenAI provider (requires
 *        OPENAI_API_KEY; throws if missing)
 *      - any other value → throw (no silent fallback)
 *   2. unset / empty → default to "deterministic"
 *
 * Anthropic is NOT a valid value in 6A.2. The provider stub at
 * `src/domains/recommendations/providers/anthropic.ts` still throws
 * `not_implemented`; this helper refuses to resolve to it. A future
 * Phase 6A.2-bis (or 6A.3) will broaden the union.
 *
 * Why a separate file (not src/lib/flags.ts):
 *   flags.ts is for boolean feature flags. This is a discriminated
 *   provider config that will grow more knobs in 6A.2b–f (model id,
 *   temperature, max-tokens, dry-run override, build-time guard).
 *   Co-locating LLM-specific helpers under src/lib/llm/ keeps the
 *   surface scannable.
 *
 * Hard rules (locked by tests):
 *   - default is "deterministic"
 *   - "openai" requires `OPENAI_API_KEY` (throws otherwise)
 *   - "deterministic" never touches `OPENAI_API_KEY`
 *   - unknown values throw with the list of allowed values
 *   - "anthropic" is rejected even though `SpecificEditProviderName`
 *     includes it — Sprint 6A.2 is openai-only
 */

import "server-only";

/**
 * The provider names this phase accepts. Subset of
 * `SpecificEditProviderName` from
 * `src/domains/recommendations/specific-edit-provider.ts` —
 * intentionally narrower so 6A.2 can't accidentally route to the
 * Anthropic stub.
 */
export const ALLOWED_LLM_PROVIDERS = ["deterministic", "openai"] as const;

export type AllowedLLMProvider = (typeof ALLOWED_LLM_PROVIDERS)[number];

const DEFAULT_PROVIDER: AllowedLLMProvider = "deterministic";

/**
 * Resolve the active LLM provider name from `BEACON_LLM_PROVIDER`.
 *
 * Throws when:
 *   - the env value isn't in `ALLOWED_LLM_PROVIDERS`
 *   - the value is "openai" but `OPENAI_API_KEY` is missing
 *
 * Returns "deterministic" by default. Reading `process.env` here on
 * every call is intentional — vitest can mutate env between tests
 * without `vi.resetModules()` and still see the new value.
 */
export function resolveLLMProvider(): AllowedLLMProvider {
  const raw = process.env.BEACON_LLM_PROVIDER?.trim();

  // Empty / unset → safe default.
  if (!raw) return DEFAULT_PROVIDER;

  if (!isAllowedProvider(raw)) {
    throw new Error(
      `[llm/config] invalid BEACON_LLM_PROVIDER=${JSON.stringify(raw)}. ` +
        `Allowed values: ${ALLOWED_LLM_PROVIDERS.map((p) => JSON.stringify(p)).join(", ")}. ` +
        `Anthropic is not yet supported in Sprint 6A.2 — leave the env var unset to fall back to "deterministic".`,
    );
  }

  if (raw === "openai") {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        `[llm/config] BEACON_LLM_PROVIDER="openai" requires OPENAI_API_KEY to be set. ` +
          `Either provide the API key or unset BEACON_LLM_PROVIDER to fall back to "deterministic".`,
      );
    }
  }

  return raw;
}

/**
 * Type guard for the allowed-providers union. Pure / no env reads.
 */
export function isAllowedProvider(name: string): name is AllowedLLMProvider {
  return (ALLOWED_LLM_PROVIDERS as readonly string[]).includes(name);
}
