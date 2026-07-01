/** TEMP - refresh 20-day-stale page_snapshots for Iranopedia (own-site crawl, $0). Delete after. */
import { runWebsiteScan } from "@/domains/scanning/orchestrate-scan";
async function main() {
  const r = await runWebsiteScan({ trigger: "manual" as never });
  console.log(JSON.stringify({ ok: r.ok, phase: r.phase, findingsAdded: r.findingsAdded, error: r.error ?? null }));
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
