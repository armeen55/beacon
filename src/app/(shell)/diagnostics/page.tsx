import Link from "next/link";
import { notFound } from "next/navigation";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { PageHeader } from "@/components/data/page-header";
import { currentTenantId } from "@/lib/tenant-context";
import { getConnectorHealth } from "@/lib/connector-store";
import { rollupConnectors, type ConnectorRollupFact } from "@/lib/connectors/registry";
import { getWixUrlMap } from "@/lib/connectors/wix/url-map";
import { readBackfillProgress, isBackfillStalled } from "@/lib/connectors/gsc/deep-backfill";
import { readLastWarmReceipt } from "@/domains/ops/warm-receipt-store";

/**
 * Operator health page (2026-07-20 diagnostics amputation). The sprawling
 * /diagnostics web product (60+ operator dashboards) is gone; every deep route
 * now 404s. This one compact page is the whole operator-facing health surface:
 * connector rollup, GSC backfill, last warm pass, and a link to the real
 * connector controls under Settings. Read-only by design - the on-use warm
 * cycle already refreshes data and continues backfills, so there is nothing
 * here to trigger by hand.
 *
 * Operator-gated twice: once by the /diagnostics layout, and again inline here
 * because /settings/health re-exports this default and sits outside that layout.
 */

export const dynamic = "force-dynamic";

function fmt(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "never";
  return new Date(ms).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function loadConnectorLine(): Promise<string> {
  try {
    const [gsc, ga4, clarity, wixMap] = await Promise.all([
      getConnectorHealth("google_gsc").catch(() => null),
      getConnectorHealth("google_ga4").catch(() => null),
      getConnectorHealth("clarity").catch(() => null),
      getWixUrlMap().catch(() => [] as unknown[]),
    ]);
    const wixHealth = await getConnectorHealth("wix").catch(() => null);
    const facts: ConnectorRollupFact[] = [
      { id: "google_gsc", connected: gsc?.status === "connected", needsAttention: gsc?.health === "needs_attention" },
      { id: "google_ga4", connected: ga4?.status === "connected", needsAttention: ga4?.health === "needs_attention" },
      { id: "clarity", connected: clarity?.status === "connected", needsAttention: clarity?.health === "needs_attention" },
      { id: "wix", connected: wixHealth?.status === "connected", needsAttention: wixHealth?.status === "connected" && wixMap.length === 0 },
    ];
    return rollupConnectors(facts).headline;
  } catch {
    return "Could not read connector health right now.";
  }
}

async function loadBackfillLine(tenantId: string): Promise<string> {
  try {
    const { getSupabaseAdmin } = await import("@/lib/persistence/supabase");
    const gscRow = await getSupabaseAdmin()
      .from("gsc_daily_rows")
      .select("property")
      .eq("tenant_id", tenantId)
      .limit(1);
    const property = (gscRow.data?.[0] as { property?: string } | undefined)?.property;
    if (!property) return "No Google Search Console property synced yet.";
    const progress = await readBackfillProgress(tenantId, property);
    if (!progress) return "Backfill has not started (it kicks off on the next data pull).";
    if (progress.status === "complete") return `Backfill complete: ${progress.days_pulled} days pulled.`;
    if (isBackfillStalled(progress, new Date())) {
      return `Backfill stalled at ${progress.cursor_date ?? "?"} after ${progress.days_pulled} days. Last advanced ${progress.updated_at.slice(0, 10)}.`;
    }
    return `Backfill in progress: ${progress.days_pulled} days pulled, cursor at ${progress.cursor_date ?? "?"} (target ${progress.target_date}).`;
  } catch {
    return "Could not read backfill status right now.";
  }
}

async function loadWarmLine(tenantId: string): Promise<string> {
  try {
    const receipt = await readLastWarmReceipt(tenantId);
    if (!receipt) return "No warm pass has run yet.";
    const state = receipt.ok ? "succeeded" : "did not fully complete";
    const trigger = receipt.trigger ?? "cron";
    return `Last warm pass (${trigger}) ${state} on ${fmt(receipt.ran_at)} (day ${receipt.date}).`;
  } catch {
    return "Could not read the warm receipt right now.";
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex flex-col gap-0.5 py-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </li>
  );
}

export default async function OperatorHealthPage() {
  if (!isOperatorModeServer()) notFound();

  const tenantId = await currentTenantId();
  const [connectors, backfill, warm] = await Promise.all([
    loadConnectorLine(),
    loadBackfillLine(tenantId),
    loadWarmLine(tenantId),
  ]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Operator health"
        description="One glance at whether Beacon's data pipeline is alive. Everything refreshes itself on use, so this page only reports state. Operator-mode only."
      />

      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <ul className="divide-y divide-border/30">
          <Row label="Connectors" value={connectors} />
          <Row label="GSC backfill" value={backfill} />
          <Row label="Last warm pass" value={warm} />
        </ul>
      </section>

      <Link
        href="/settings/connectors"
        className="inline-flex items-center rounded bg-accent-primary px-3 py-1.5 text-sm font-medium text-white"
      >
        Manage connectors in Settings
      </Link>
    </div>
  );
}
