/**
 * UX0 ground-truth probe (2026-07-02) - lists every create_page candidate the NEW
 * coherence gate, ownership gate, and dedup pass suppress/reclassify/collapse for the
 * real Iranopedia tenant, so the operator gets an honest before/after count instead of
 * a code-only claim. Read-only: loads the live demand graph (no writes).
 *
 * Run: set -a; . ./.env.local; set +a; npx tsx --require ./scripts/mock-server-only.cjs scripts/_ux0-newpages-gate-probe.ts
 */
import { loadDemandGraphForTenant } from "@/domains/demand-graph/load-graph";
import { writeGraphSnapshot } from "@/domains/demand-graph/graph-snapshot-store";
import { buildNewPagesData } from "../src/app/(shell)/today-newpages-data";

const T = "tenant-iranopedia";

async function main() {
  const fresh = await loadDemandGraphForTenant(T);
  const { graph, coverage } = fresh;
  // The New Pages board reads the cross-request SWR snapshot (stale-serve + background
  // refresh) - force-write a FRESH snapshot here so the board section below reflects
  // this run's gate output instead of a snapshot computed before these fixes landed.
  await writeGraphSnapshot(fresh, new Date().toISOString());

  console.log("=== load-graph coverage.coherence (topic-coherence gate) ===");
  console.log(`suppressed candidates: ${coverage.coherence.suppressedCandidates.length}`);
  for (const s of coverage.coherence.suppressedCandidates) {
    console.log(`  SUPPRESSED "${s.label}" - ${s.reason}`);
  }
  console.log(`trimmed candidates (members dropped, card kept): ${coverage.coherence.trimmedCandidates.length}`);
  for (const t of coverage.coherence.trimmedCandidates) {
    console.log(`  TRIMMED "${t.label}" - dropped ${t.droppedCount} member(s) - ${t.reason}`);
  }

  console.log("\n=== load-graph coverage.ownershipReclassified (ownership gate) ===");
  console.log(`total: ${coverage.ownershipReclassified.length}`);
  for (const o of coverage.ownershipReclassified) {
    console.log(`  ${o.action.toUpperCase()} "${o.label}" -> ${o.ownedUrl ?? "(no url)"} - ${o.reason}`);
  }

  console.log(`\n=== final create_page moves on the graph: ${graph.moves.filter((m) => m.gap === "create_page").length} ===`);
  for (const m of graph.moves.filter((m) => m.gap === "create_page").slice(0, 30)) {
    console.log(`  "${m.label}" score=${Math.round(m.score)} competitors=${m.competitorUrls.length}${m.canonicalGroup ? ` alsoCovers=[${m.canonicalGroup.alsoCovers.join(", ")}]` : ""}`);
  }

  console.log("\n=== New Pages board (buildNewPagesData) - final rendered cards ===");
  const board = await buildNewPagesData(T);
  console.log(`totalCandidates (pre-board-filter): ${board.totalCandidates}`);
  console.log(`rendered opportunities: ${board.opportunities.length}`);
  for (const o of board.opportunities) {
    console.log(`  "${o.topic}" signal=${o.signal.label} score=${o.score} searchVolume=${o.searchVolume ?? "null"} clusterVolume=${o.clusterVolume ?? "null"} keywordMatch=${o.keywordMatch ? `${o.keywordMatch.keyword} (${o.keywordMatch.confidence})` : "none"} alsoCovers=[${(o.alsoCovers ?? []).join(", ")}]`);
  }

  // Sanity flags: none of the operator-found corrupted labels should survive verbatim.
  const badLabels = ["Travel Iran Beautiful Natural Wonders", "Deadly Misconceptions About Iran Hear Cross"];
  console.log("\n=== regression check: operator-found corrupted labels ===");
  for (const bad of badLabels) {
    const stillThere = board.opportunities.some((o) => o.topic === bad);
    console.log(`  "${bad}": ${stillThere ? "STILL PRESENT (BUG)" : "gone/reclassified (fixed)"}`);
  }
  const persianLit = board.opportunities.find((o) => o.topic.toLowerCase().includes("persian literature"));
  console.log(`  "Persian Literature" as a create_page card: ${persianLit ? "STILL PRESENT (BUG, check aeoReceipt.ownAbsent)" : "not present as a create_page card (fixed or no longer a candidate)"}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
export {};
