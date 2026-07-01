/** TEMP - hydrate config THEN rescan Iranopedia pages. Delete after. */
import { hydrateBusinessConfigFromSupabase } from "@/lib/business-config";
import { runWebsiteScan } from "@/domains/scanning/orchestrate-scan";
async function main() {
  await hydrateBusinessConfigFromSupabase("tenant-iranopedia");
  const r = await runWebsiteScan({ trigger: "manual" as never });
  console.log(JSON.stringify({ ok: r.ok, phase: r.phase, findingsAdded: r.findingsAdded, error: r.error ?? null }));
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
