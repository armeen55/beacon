/**
 * Phase A.2 (Section 3.6) — "Beacon learned" Today tile.
 *
 * The moment the brain becomes visible to the customer: instead of a
 * borrowed industry benchmark, Beacon shows the citation timing it has
 * observed in the customer's OWN shipped edits. Gated behind
 * `BEACON_BRAIN_LEARNED_TILE` (off by default — "coming soon") AND a
 * sample-size honesty gate (handled by the section that feeds this
 * component); below threshold the tile is hidden.
 *
 * Pure presentational — props in, JSX out. No data fetch, no env read.
 * Customer-safe copy only: no internal taxonomy, no Mode A/B/C, no
 * causal/revenue language. Pinned by beacon-learned-tile.test.tsx +
 * the forbidden-customer-vocabulary contract.
 *
 * v1 surfaces the PER-TENANT insight (always available once the tenant
 * crosses the customer-tile sample gate). The cross-tenant network
 * insight ("across N marketers…") activates when the producer goes
 * live with ≥2 tenants — the component accepts either via `kind`.
 */

export type BeaconLearnedState =
  | {
      kind: "per_tenant";
      /** Beacon-observed median days-to-first-citation for this site. */
      medianDays: number;
      /** Cited shipped edits the median was computed from. */
      sampleSize: number;
    }
  | {
      kind: "network";
      /** Customer-safe, pre-scrubbed pattern sentence from the producer. */
      description: string;
      /** Total shipped attempts aggregated across tracked sites. */
      sampleSize: number;
    }
  | { kind: "hidden" };

export function BeaconLearnedTile({ state }: { state: BeaconLearnedState }) {
  if (state.kind === "hidden") return null;

  return (
    <section
      data-today-beacon-learned="true"
      className="rounded-lg border border-accent-primary/30 bg-accent-primary/10 p-4"
    >
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-accent-primary">
        Beacon learned from your site
      </h2>
      {state.kind === "per_tenant" ? (
        <p className="text-sm text-foreground">
          Your shipped edits typically get their first AI citation within{" "}
          <span className="font-semibold">{state.medianDays} days</span>,
          measured from {state.sampleSize} of your own cited edits, not a
          borrowed benchmark.
        </p>
      ) : (
        <p className="text-sm text-foreground">
          {state.description}{" "}
          <span className="text-muted-foreground">
            (from {state.sampleSize} shipped edits across tracked sites)
          </span>
        </p>
      )}
    </section>
  );
}
