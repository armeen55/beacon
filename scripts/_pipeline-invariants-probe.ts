/** Ground-truth probe (item 10): gather real pipeline readings for a tenant and
 *  run the invariant checker. Read-only except for one store write we SKIP here.
 *  Run: set -a; . ./.env.local; set +a; BEACON_TENANT_ID=tenant-iranopedia \
 *       npx tsx --require ./scripts/mock-server-only.cjs scripts/_pipeline-invariants-probe.ts */
import { gatherPipelineReadings } from "@/domains/ops/pipeline-readings";
import { checkPipelineInvariants } from "@/domains/ops/pipeline-invariants";
import { buildPipelineHealthRow, writePipelineHealth } from "@/domains/ops/pipeline-health-store";

async function main() {
  const tenantId = process.env.BEACON_TENANT_ID;
  if (!tenantId) throw new Error("set BEACON_TENANT_ID");
  const t0 = Date.now();
  const readings = await gatherPipelineReadings(tenantId);
  const ms = Date.now() - t0;
  const violations = checkPipelineInvariants(readings);
  const row = buildPipelineHealthRow(readings, violations);
  if (process.argv.includes("--persist")) {
    await writePipelineHealth(row);
    console.log("persisted pipeline health row for", tenantId);
  }
  console.log(JSON.stringify({ ms, readings, violations, summary: row.summary }, null, 2));
}

main().catch((e) => {
  console.error("probe failed:", e);
  process.exit(1);
});
