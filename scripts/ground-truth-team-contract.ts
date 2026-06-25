/**
 * Ground-truth the Beacon Team Contract (P1–P3) on REAL Iranopedia Moves (2026-06-25).
 *
 * Not a product surface — a read-only proof that the specialist opinions + the
 * MoveRouter + the PreparedMovePack run end-to-end on live demand-graph data.
 * NO paid calls (reads Supabase + computes purely), NO writes, NO publish. Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-team-contract.ts
 */

import { loadChangePacksForTenant } from "@/domains/demand-graph/gap-compiler";
import { attachOpinions, type Specialist } from "@/domains/demand-graph/specialist-opinions";
import { routeMove } from "@/domains/demand-graph/move-router";
import { buildPreparedMovePack } from "@/domains/demand-graph/prepared-move-pack";

const ALL: Specialist[] = ["gsc", "ga4", "clarity", "profound", "dataforseo", "wix", "llm", "commerce_asset"];
const NOW = new Date().toISOString();
const TENANT = process.env.BEACON_GROUND_TRUTH_TENANT ?? "tenant-iranopedia";

async function main() {
  console.log(`\n=== Beacon Team Contract ground-truth · tenant=${TENANT} ===\n`);
  const { packets, coverage } = await loadChangePacksForTenant(TENANT, { limit: 25 });
  console.log(
    `coverage: ${coverage.moves} actionable moves · ${coverage.withCompetitorTeardown} with teardown · ` +
      `${coverage.withOwnedSnapshot} with owned snapshot · ${coverage.ownedSnapshots} snapshots · ${coverage.competitorAudits} audits\n`,
  );
  if (packets.length === 0) {
    console.log("No packets — engine may be off for this tenant, or env not loaded (set -a; . ./.env.local; set +a).");
    return;
  }

  const rows = packets
    .map((packet) => {
      const opinions = attachOpinions(packet, { nowIso: NOW });
      const decision = routeMove({ packet, opinions });
      const pack = buildPreparedMovePack({ tenantId: TENANT, packet, opinions, decision, nowIso: NOW });
      const present = new Set(opinions.map((o) => o.specialist));
      const missing = ALL.filter((s) => !present.has(s));
      return { packet, opinions, decision, pack, present: [...present], missing };
    })
    .sort((a, b) => b.decision.adjustedScore - a.decision.adjustedScore)
    .slice(0, 10);

  let i = 0;
  for (const r of rows) {
    i += 1;
    console.log(`#${i}  [${r.pack.moveId}]  "${r.packet.move.label}"`);
    console.log(`    gap=${r.packet.move.gapType}  →  router=${r.decision.action} (${r.decision.parentType})  conf=${r.decision.confidenceLevel}`);
    console.log(`    score: base=${r.decision.baseScore} → adjusted=${r.decision.adjustedScore}   prepared=${r.pack.preparedStatus}`);
    console.log(`    rationale: ${r.decision.rationale}`);
    console.log(`    specialists weighing in: ${r.present.length ? r.present.join(", ") : "(none)"}`);
    for (const o of r.opinions) {
      const objs = o.objections.map((ob) => `${ob.kind}(${ob.severity})`).join(", ");
      console.log(`      - ${o.specialist} [conf ${o.confidence.toFixed(2)}]: ${o.claim}${objs ? `  ⚠ ${objs}` : ""}`);
    }
    if (r.decision.appliedObjections.length) {
      console.log(`    applied objections: ${r.decision.appliedObjections.map((o) => o.kind).join(", ")}`);
    }
    console.log(`    missing evidence (abstained): ${r.missing.join(", ")}`);
    console.log("");
  }

  // Aggregate honesty check: which specialists actually had evidence across the set.
  const tally = new Map<Specialist, number>();
  for (const r of rows) for (const s of r.present as Specialist[]) tally.set(s, (tally.get(s) ?? 0) + 1);
  console.log("=== specialist participation across top 10 ===");
  for (const s of ALL) console.log(`  ${s}: ${tally.get(s) ?? 0}/10`);
}

main().catch((e) => {
  console.error("ground-truth failed:", e);
  process.exit(1);
});
