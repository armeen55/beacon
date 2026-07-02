/** Ground-truth probe (items 84/85): read-only. Reports real connector state
 *  for a tenant (last_synced_at per provider, connected_at, derived Google
 *  token age), and proves the cron-runs-store PGRST205 file-fallback path
 *  works against the REAL (pre-migration) Supabase project.
 *  Run: set -a; . ./.env.local; set +a; BEACON_TENANT_ID=tenant-iranopedia \
 *       npx tsx --require ./scripts/mock-server-only.cjs scripts/_cron-health-probe.ts */
import { getConnectorInfo } from "@/lib/connector-store";
import { listRecentCronRuns, recordCronRun } from "@/domains/ops/cron-runs-store";
import { daysUntilExpiry } from "@/domains/ops/token-expiry-forecast";
import { deriveProviderStreaks, streaksAtOrAboveThreshold } from "@/domains/ops/cron-streak";
import { checkTokenExpiryForTenants } from "@/domains/ops/token-expiry-notify";

const PROVIDERS = ["google_gsc", "google_ga4", "google_gbp", "clarity", "profound"] as const;

async function main() {
  const tenantId = process.env.BEACON_TENANT_ID;
  if (!tenantId) throw new Error("set BEACON_TENANT_ID");

  console.log("=== Connector states for", tenantId, "===");
  for (const provider of PROVIDERS) {
    const info = await getConnectorInfo(provider, tenantId);
    const grantAgeDays =
      info.connected_at != null
        ? ((Date.now() - Date.parse(info.connected_at)) / (24 * 60 * 60 * 1000)).toFixed(2)
        : null;
    const refreshDaysLeft = info.connected_at != null ? daysUntilExpiry(info.connected_at) : null;
    console.log(
      JSON.stringify({
        provider,
        status: info.status,
        connected_at: info.connected_at,
        last_synced_at: info.last_synced_at,
        auth_failed_at: info.auth_failed_at ?? null,
        grantAgeDays,
        testingModeRefreshDaysLeft: refreshDaysLeft,
      }),
    );
  }

  console.log("\n=== cron_runs ledger read (before the migration is applied, expect empty + file-fallback) ===");
  const runs = await listRecentCronRuns("sync-connectors", 14);
  console.log("rows found:", runs.length);

  console.log("\n=== Proving the PGRST205 file-fallback write path works ===");
  const t0 = Date.now();
  await recordCronRun({
    job: "sync-connectors",
    startedAt: new Date(t0 - 1000).toISOString(),
    finishedAt: new Date(t0).toISOString(),
    ok: true,
    perSource: [{ tenantId, provider: "google_gsc", ok: true, detail: "probe write" }],
    notes: { probe: true },
  });
  const afterWrite = await listRecentCronRuns("sync-connectors", 14);
  console.log("rows found after probe write:", afterWrite.length, "(should be 1 if this ran against a table-less/dev Supabase or no-env)");

  const streaks = streaksAtOrAboveThreshold(deriveProviderStreaks(afterWrite));
  console.log("\n=== Derived failure streaks (>=3, from the just-written data - expect none yet) ===");
  console.log(JSON.stringify(streaks));

  console.log("\n=== Token-expiry check (dry, will actually send if BEACON_DIGEST_TO is set and a connection is at T-2) ===");
  const checks = await checkTokenExpiryForTenants([tenantId]);
  console.log(JSON.stringify(checks, null, 2));
}

main().catch((e) => {
  console.error("probe failed:", e);
  process.exit(1);
});
