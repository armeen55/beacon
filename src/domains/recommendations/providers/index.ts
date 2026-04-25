/**
 * Sprint 6A.1 Phase 8 (2026-04-24) — Provider registry.
 *
 * Single import point for callers (Sprint 6A.2's evidence-cache +
 * budget gate) so they can dispatch on provider name without knowing
 * which file each implementation lives in. Adding a new provider =
 * one new file under this folder + one entry in `PROVIDERS`.
 */

import type {
  SpecificEditProvider,
  SpecificEditProviderName,
} from "../specific-edit-provider";
import { deterministicProvider } from "./deterministic";
import { openaiProvider } from "./openai";
import { anthropicProvider } from "./anthropic";

export { deterministicProvider, openaiProvider, anthropicProvider };

/**
 * Total registry. Every key in `SpecificEditProviderName` MUST appear
 * — TypeScript enforces this via `Record`. Lookup by name returns the
 * implementation; missing-name lookup is a compile error.
 */
export const PROVIDERS: Record<
  SpecificEditProviderName,
  SpecificEditProvider
> = {
  deterministic: deterministicProvider,
  openai: openaiProvider,
  anthropic: anthropicProvider,
};

/**
 * Convenience: fetch a provider by name. Throws if the name is not in
 * the registry — protects callers from silent fall-through when a
 * configuration string is wrong.
 */
export function getProvider(
  name: SpecificEditProviderName,
): SpecificEditProvider {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown SpecificEditProvider: ${name}`);
  }
  return provider;
}
