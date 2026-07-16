/**
 * Tiny debug-log helper for intentional diagnostic events in the rec engine
 * path (phrase-shape rejects, page-placement routing decisions, section-
 * presence classifications, etc.).
 *
 * Why this exists:
 *   Next.js dev / Turbopack surfaces every `console.error(...)` call as a
 *   red Console Error overlay during dogfooding. Intentional reject /
 *   classify / suppress logs are NOT errors — they are expected operational
 *   decisions. Demoting them from `console.error` to a gated `console.log`
 *   keeps the overlays clean while preserving visibility when needed.
 *
 * Usage:
 *   import { debugRecEngine } from "@/lib/debug-log";
 *   debugRecEngine(`[phrase-shape] "${concept}" on ${path} → reject: ${reason}`);
 *
 * Behavior:
 *   - Default: silent. Nothing printed. Zero overhead beyond the env check.
 *   - When `BEACON_DEBUG_RECS=1` (or `=true`) is set in the environment,
 *     the message is written with `console.log(...)` so it shows up in the
 *     server terminal but does NOT trigger the Next.js dev error overlay.
 *
 * This helper is ONLY for intentional diagnostic events. Real thrown
 * errors and unexpected exceptions should continue to use `console.error`
 * (or throw) — we are not removing observability, we are separating
 * expected operational logs from true error signals.
 */

function debugRecEngineEnabled(): boolean {
  // Read per-call so tests / runtime flips take effect without a restart.
  // `process` is always defined in Node / Next.js server contexts.
  const raw = typeof process !== "undefined" ? process.env?.BEACON_DEBUG_RECS : undefined;
  if (!raw) return false;
  const v = String(raw).toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function debugRecEngine(message: string): void {
  if (!debugRecEngineEnabled()) return;
  // Use console.log (not console.error) so Next.js dev overlay is NOT
  // triggered for expected diagnostic events.
  console.log(message);
}
