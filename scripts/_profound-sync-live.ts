/**
 * LIVE verification of the durable Profound sync (tenant-iranopedia). Calls the
 * REAL syncProfoundPromptIntelligenceForTenant (topic-scoped; no bots/referrals;
 * ownership = iranopedia.com) and prints the row counts it persisted. Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx scripts/_profound-sync-live.ts
 */
import { syncProfoundPromptIntelligenceForTenant } from "@/lib/connectors/profound/sync-prompt-intelligence";

async function main() {
  const t0 = Date.now();
  const res = await syncProfoundPromptIntelligenceForTenant({ tenantId: "tenant-iranopedia" });
  console.log("=== DURABLE PROFOUND SYNC (live, tenant-iranopedia) ===");
  console.log(JSON.stringify(res, null, 2));
  console.log(`sync wall-clock: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
main().catch((e) => { console.error("fatal", e); process.exit(1); });

export {};
