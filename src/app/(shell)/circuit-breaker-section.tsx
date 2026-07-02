/**
 * CircuitBreakerSection (2026-07-02, BEACON 500 item 80) - server wrapper for
 * the "I paused myself" card. Loads the tenant's persisted breaker state,
 * self-hides when not tripped, fail-soft to null on any read error (a
 * substrate hiccup here must never crash Today).
 *
 * Sibling pattern to OpsPipelineSection / InvestigationSection: $0 persisted
 * read, Suspense-wrapped by the caller, dark-mode + 375px safe.
 */
import { loadCircuitBreakerCardView } from "./circuit-breaker-actions";
import { CircuitBreakerCard } from "./circuit-breaker-card";

export async function CircuitBreakerSection() {
  try {
    const view = await loadCircuitBreakerCardView();
    if (!view.tripped) return null;
    return <CircuitBreakerCard view={view} />;
  } catch {
    return null;
  }
}
