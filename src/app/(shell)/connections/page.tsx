import Link from "next/link";
import { notFound } from "next/navigation";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import {
  loadConnectionHealth,
  type ConnectionSeverity,
} from "@/domains/insight/connection-health";

/**
 * Connections / Data Health — operator-OS rebuild, surfaces (4)+(7).
 * Shows how the sources interlock + each one's freshness + what's blocked while
 * it's missing. Read-only; connect/sync actions live on /settings/connectors.
 */
export const dynamic = "force-dynamic";

const SEV_STYLE: Record<ConnectionSeverity, string> = {
  healthy: "border-emerald-300 bg-emerald-50 text-emerald-700",
  stale: "border-amber-300 bg-amber-50 text-amber-700",
  needs_setup: "border-amber-300 bg-amber-50 text-amber-700",
  disconnected: "border-border bg-muted/40 text-muted-foreground",
};
const SEV_LABEL: Record<ConnectionSeverity, string> = {
  healthy: "Healthy",
  stale: "Stale",
  needs_setup: "Needs setup",
  disconnected: "Not connected",
};

export default async function ConnectionsPage() {
  if (!isOperatorModeServer()) notFound();
  const tenantId = await currentTenantId();
  const sources = await loadConnectionHealth(tenantId);

  const connected = sources.filter((s) => s.connected).length;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Data Health</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          {connected} of {sources.length} sources connected. Beacon fuses these
          into every insight — coverage gaps narrow what it can see.
        </p>
      </div>

      {/* How the sources interlock — the connection graph, in one line. */}
      <div className="mb-6 rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">How it connects:</span>{" "}
        Search demand (GSC) + market (SEMrush) → <b>Opportunity Map</b> →
        Page Surgeon drafts → publish (Wix) → prove the lift (GSC + Analytics).
        Clarity flags on-page friction; AI answers track citations.
      </div>

      <div className="space-y-2.5">
        {sources.map((s) => (
          <div
            key={s.key}
            className="rounded-lg border border-border/60 bg-background p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-foreground">
                    {s.label}
                  </span>
                  <span
                    className={
                      "rounded border px-1.5 py-0.5 text-[10px] font-medium " +
                      SEV_STYLE[s.severity]
                    }
                  >
                    {SEV_LABEL[s.severity]}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{s.note}</span>
                </div>
                <p className="mt-1.5 text-[12px] text-muted-foreground">
                  <span className="text-foreground/80">Tells us:</span> {s.role}.{" "}
                  <span className="text-foreground/80">Unlocks:</span> {s.unlocks}.
                </p>
                {!s.connected ? (
                  <p className="mt-1 text-[12px] text-amber-700">
                    Blocked until connected: {s.blockedWhenMissing}.
                  </p>
                ) : null}
              </div>
              {!s.connected ? (
                <Link
                  href="/settings/connectors"
                  prefetch={false}
                  className="shrink-0 rounded-md border border-foreground bg-foreground px-3 py-1.5 text-[12px] font-medium text-background hover:opacity-90"
                >
                  Connect →
                </Link>
              ) : (
                <Link
                  href="/settings/connectors"
                  prefetch={false}
                  className="shrink-0 rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground"
                >
                  Manage →
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
