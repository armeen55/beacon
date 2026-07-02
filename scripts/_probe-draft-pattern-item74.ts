/** Ground-truth probe (BEACON_500 item 74): read the REAL shipped_change_proof ledger
 *  for a tenant, classify every shipped artifact's after-text into its structural
 *  pattern, print the real distribution, then print the real (pattern, pageFamily)
 *  aggregate table and say plainly whether any cell clears the >=3 decided-sample
 *  floor. Read-only: no writes, no LLM calls, no mutation of the ledger.
 *  Run: set -a; . ./.env.local; set +a; BEACON_TENANT_ID=tenant-iranopedia \
 *       npx tsx scripts/_probe-draft-pattern-item74.ts */
import { loadShippedChanges } from "@/domains/proof-gsc/shipped-change-store";
import { deriveMeasurementMaturity } from "@/domains/proof-gsc/measurement-maturity";
import { classifyDraftPattern, aggregateWinsByPattern, bestConfidentPattern, patternInsightSentence, MIN_DECIDED_FOR_CONFIDENCE } from "@/domains/llm/draft-pattern";
import { loadWinners, loadPatternAggregate } from "@/domains/llm/winner-memory";

function pageFamilyOfUrl(urlOrPath: string): string {
  const path = (urlOrPath ?? "").replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "");
  const segs = path.split("/").filter(Boolean);
  return segs.length >= 2 ? segs[0]! : (segs[0] ?? "root");
}

async function main() {
  const tenantId = process.env.BEACON_TENANT_ID;
  if (!tenantId) throw new Error("set BEACON_TENANT_ID");

  const now = new Date();
  const records = await loadShippedChanges();
  console.log(`=== Ledger for ${tenantId} ===`);
  console.log(`total shipped_change_proof rows: ${records.length}`);

  const withText = records.filter((r) => (r.after ?? "").trim() !== "");
  console.log(`rows with non-empty after-text: ${withText.length}`);

  const distribution = new Map<string, number>();
  const byVerdict = new Map<string, number>();
  let decided = 0;
  let pending = 0;
  for (const r of withText) {
    const pattern = classifyDraftPattern((r.after ?? "").trim());
    distribution.set(pattern, (distribution.get(pattern) ?? 0) + 1);
    byVerdict.set(r.verdict, (byVerdict.get(r.verdict) ?? 0) + 1);
    const maturity = deriveMeasurementMaturity({
      shippedAt: r.shippedAt,
      now,
      latestGscDate: r.measuredAt,
      windows: r.windows.map((w) => ({ day: w.day, ran: w.ran })),
      verdict: r.verdict,
      controlsUsed: r.controlPages.length,
      baselineImpressions: r.baseline?.impressions ?? 0,
      live: r.verifiedLive,
    });
    if (maturity === "mature_result" || maturity === "inconclusive") decided += 1;
    else pending += 1;
  }

  console.log("\n=== Real pattern distribution (ALL shipped artifacts with text) ===");
  console.log(JSON.stringify(Object.fromEntries(distribution), null, 2));

  console.log("\n=== Real verdict distribution ===");
  console.log(JSON.stringify(Object.fromEntries(byVerdict), null, 2));
  console.log(`decided (mature_result or inconclusive): ${decided}, pending/other: ${pending}`);

  console.log("\n=== Real (pattern, pageFamily) aggregate table (winner-memory.loadPatternAggregate) ===");
  const cells = await loadPatternAggregate(tenantId, { now });
  if (cells.length === 0) {
    console.log("no decided, classifiable rows yet - honest empty table");
  } else {
    for (const c of cells) {
      console.log(
        `${c.pattern} x ${c.pageFamily}: wins=${c.wins} losses=${c.losses} pending=${c.pending} decided=${c.decided} winRate=${(c.winRate * 100).toFixed(0)}% confident=${c.confident}`,
      );
    }
  }

  console.log(`\n=== Confidence floor check (MIN_DECIDED_FOR_CONFIDENCE=${MIN_DECIDED_FOR_CONFIDENCE}) ===`);
  const confidentCells = cells.filter((c) => c.confident);
  if (confidentCells.length === 0) {
    console.log("HONEST: no (pattern, pageFamily) cell has cleared the floor yet. No pattern claim would be surfaced tonight.");
  } else {
    console.log(`${confidentCells.length} cell(s) cleared the floor:`);
    for (const c of confidentCells) console.log(`  - ${patternInsightSentence(c)}`);
  }

  // Per-page-family best pattern (what the few-shot injector would actually pick tonight).
  const families = [...new Set(withText.map((r) => pageFamilyOfUrl(r.page || r.path)))];
  console.log("\n=== Per-page-family best confident pattern (what tonight's drafter would use) ===");
  for (const fam of families) {
    const best = bestConfidentPattern(cells, fam);
    console.log(`  ${fam}: ${best ? patternInsightSentence(best) : "no confident cell yet - prompt stays unchanged"}`);
  }

  console.log("\n=== winner-memory harvested winners (already-tagged pattern field) ===");
  const winners = await loadWinners(tenantId);
  console.log(`harvested winner rows: ${winners.length}`);
  const winnerPatterns = new Map<string, number>();
  for (const w of winners) winnerPatterns.set(w.pattern, (winnerPatterns.get(w.pattern) ?? 0) + 1);
  console.log(JSON.stringify(Object.fromEntries(winnerPatterns), null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
