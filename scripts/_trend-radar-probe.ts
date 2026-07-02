/** Ground-truth probe (item 14): run the bounded spike loader + pure spike pass
 *  on REAL gsc_daily_rows for a tenant and print what the radar would say.
 *  Read-only unless --persist is passed (then it writes the spike store row,
 *  exactly what the nightly cron step does).
 *  Run: set -a; . ./.env.local; set +a; BEACON_TENANT_ID=tenant-iranopedia \
 *       npx tsx --require ./scripts/mock-server-only.cjs scripts/_trend-radar-probe.ts */
import { loadQuerySpikeRows } from "@/domains/trend-radar/load-query-spikes";
import { computeQuerySpikes, anchorDateOf } from "@/domains/trend-radar/query-spikes";
import { writeQuerySpikeSummary } from "@/domains/trend-radar/spike-store";

async function main() {
  const tenantId = process.env.BEACON_TENANT_ID;
  if (!tenantId) throw new Error("set BEACON_TENANT_ID");
  const t0 = Date.now();
  const rows = await loadQuerySpikeRows(tenantId);
  const loadMs = Date.now() - t0;
  const spikes = computeQuerySpikes(rows);
  const anchor = anchorDateOf(rows);
  console.log(JSON.stringify({ tenantId, loadMs, rows: rows.length, anchor, spikes }, null, 2));
  if (process.argv.includes("--persist")) {
    await writeQuerySpikeSummary({ tenant_id: tenantId, computed_at: new Date().toISOString(), anchor_date: anchor, spikes });
    console.log("persisted spike summary for", tenantId);
  }
}

main().catch((e) => {
  console.error("probe failed:", e);
  process.exit(1);
});
