/**
 * ConnectorCapability — the in-product "what does this connection actually
 * DO?" clarity block (2026-06-15, operator ask: "make sure anyone can
 * understand at every step").
 *
 * Rendered on each connector card (and reusable elsewhere) so a non-technical
 * owner sees, in plain English, exactly:
 *   • What Beacon does AUTOMATICALLY once this is connected, and
 *   • What THEY need to do (connect / approve / a limit to know about).
 *
 * Copy is centralized in CONNECTOR_CAPABILITY (connector-capability-copy.ts)
 * so it stays consistent across the connectors page, the Today data-sources
 * strip, and onboarding. Pure presentation — no data, no jargon, no vendor
 * names beyond the connector's own customer-facing label.
 */

// The copy shape is defined once on the canonical connector registry; re-exported
// here so existing importers of ConnectorCapabilityCopy from this component keep
// working.
export type { ConnectorCapabilityCopy } from "@/lib/connectors/registry";
import type { ConnectorCapabilityCopy } from "@/lib/connectors/registry";

export function ConnectorCapability({
  automated,
  youDo,
}: ConnectorCapabilityCopy) {
  return (
    <dl
      className="mt-3 grid gap-2 rounded-md border border-border/40 bg-surface-raised/30 px-3 py-2.5 text-[12px] sm:grid-cols-2"
      data-connector-capability="true"
    >
      <div className="flex gap-2">
        <span aria-hidden="true" className="text-status-success">✓</span>
        <div>
          <dt className="font-medium text-foreground">Beacon does this automatically</dt>
          <dd className="mt-0.5 leading-relaxed text-muted-foreground">{automated}</dd>
        </div>
      </div>
      <div className="flex gap-2">
        <span aria-hidden="true" className="text-accent-primary">→</span>
        <div>
          <dt className="font-medium text-foreground">What you do</dt>
          <dd className="mt-0.5 leading-relaxed text-muted-foreground">{youDo}</dd>
        </div>
      </div>
    </dl>
  );
}
