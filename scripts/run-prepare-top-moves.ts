/**
 * Run "Prepare my top 10" for real on Iranopedia (2026-06-25, Sprint 2B proof).
 *
 * Persists PreparedMovePacks (move_drafts kind=prepared_pack). Paid: one capped
 * gpt-5-mini draft per existing-page Move (~$0.01 each, inside the monthly cap).
 * NO publish, NO SERP, NO migration. Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/run-prepare-top-moves.ts
 */

import { prepareTodayMovesForTenant } from "@/domains/demand-graph/prepare-today-moves";
import { buildTodayMovesData } from "@/app/(shell)/today-moves-data";

const TENANT = process.env.BEACON_GROUND_TRUTH_TENANT ?? "tenant-iranopedia";

async function main() {
  console.log(`\n=== Prepare top 10 · tenant=${TENANT} ===\n`);
  const summary = await prepareTodayMovesForTenant(TENANT, { maxN: 10 });

  console.log(
    `considered=${summary.considered}  prepared=${summary.prepared}  cached=${summary.cached}  ` +
      `readyToReview=${summary.readyToReview}  draftReady=${summary.draftReady}  failed=${summary.failed}  ` +
      `LLM cost=$${summary.llmCostUsd.toFixed(4)}\n`,
  );
  console.log("# | status | action | gap | draft | refs | proof | risks | move");
  summary.outcomes.forEach((o, i) => {
    console.log(
      `${String(i + 1).padStart(2)} | ${o.preparedStatus.padEnd(15)} | ${o.action.padEnd(18)} | ${o.gap.padEnd(13)} | ` +
        `${(o.draftKind ?? "—").padEnd(13)} | ${String(o.evidenceRefsCount).padStart(2)} | ${o.proofPlanPresent ? "yes" : "no "} | ` +
        `${String(o.risksCount).padStart(2)} | "${o.label}"  [${o.note}]`,
    );
  });

  // Diagnostic: do the persisted pack keys match the packet keys the cockpit uses?
  const { getLatestMoveDrafts } = await import("@/domains/demand-graph/move-draft-store");
  const { loadChangePacksForTenant } = await import("@/domains/demand-graph/gap-compiler");
  const drafts = await getLatestMoveDrafts(TENANT);
  const packKeys = [...drafts.keys()].filter((k) => k.endsWith("::prepared_pack"));
  console.log(`\n=== diagnostic ===\nmove_drafts prepared_pack rows: ${packKeys.length}`);
  console.log("  e.g.", packKeys.slice(0, 3).map((k) => k.replace("::prepared_pack", "")));
  const { packets } = await loadChangePacksForTenant(TENANT, { limit: 40 });
  console.log(`packets from loadChangePacksForTenant: ${packets.length}; top move.key e.g.`, packets.slice(0, 3).map((p) => p.move.key));

  // Prove the COCKPIT data layer surfaces the persisted packs (the render path).
  console.log(`\n=== cockpit read-back (buildTodayMovesData) ===`);
  const hero = await buildTodayMovesData(TENANT, { limit: 10 });
  console.log(`hero stat preparedReady = ${hero.stats.preparedReady} / ${hero.moves.length} shown`);
  console.log(`hero moves w/ packet (whoCited|outline): ${hero.moves.filter((m) => m.whoCited || m.outline.length).length}`);
  for (const m of hero.moves) {
    const c = m.preparedChecklist;
    if (!c) continue;
    const chips = [c.googleChecked && "Google", c.aiChecked && "AI", c.competitorsRead && "Competitors", c.draftPrepared && "Draft", c.proofPlanReady && "Proof"]
      .filter(Boolean)
      .join("+");
    console.log(`  ${m.preparedStatus === "ready_to_review" ? "★ READY" : "  " + m.preparedStatus}  "${m.query}"  [${chips}]${m.preparedDraftText ? `  draft="${m.preparedDraftText.slice(0, 60)}…"` : ""}`);
  }
}

main().catch((e) => {
  console.error("prepare run failed:", e);
  process.exit(1);
});
