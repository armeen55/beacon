/**
 * Ground-truth the N6 query-intent veto on REAL Iranopedia Moves (2026-07-02).
 *
 * Not a product surface - a read-only proof that intent-veto.ts actually fires
 * (or honestly doesn't) against the current live Move set. NO paid calls, NO
 * writes, NO publish. Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-intent-veto.ts
 */

import { loadChangePacksForTenant } from "@/domains/demand-graph/gap-compiler";
import { attachOpinions } from "@/domains/demand-graph/specialist-opinions";
import { routeMove } from "@/domains/demand-graph/move-router";
import { checkIntentVeto } from "@/domains/demand-graph/intent-veto";
import { classifyQueryIntent } from "@/domains/experiments/answer-intent";

const NOW = new Date().toISOString();
const TENANT = process.env.BEACON_GROUND_TRUTH_TENANT ?? "tenant-iranopedia";

async function main() {
  console.log(`\n=== N6 intent-veto ground-truth - tenant=${TENANT} ===\n`);
  const { packets, coverage } = await loadChangePacksForTenant(TENANT, { limit: 500 });
  console.log(`coverage: ${coverage.moves} actionable moves in the graph, ${packets.length} packets loaded\n`);
  if (packets.length === 0) {
    console.log("No packets - engine may be off for this tenant, or env not loaded (set -a; . ./.env.local; set +a).");
    return;
  }

  let vetoed = 0;
  let downgraded = 0;
  let silent = 0;
  let noSignal = 0;
  const examples: string[] = [];
  const nearMisses: Array<{ label: string; action: string; dominant: string; share: number }> = [];

  for (const packet of packets) {
    const opinions = attachOpinions(packet, { nowIso: NOW });
    const withoutVeto = routeMove({ packet, opinions, intentVeto: { enabled: false } });
    const withVeto = routeMove({ packet, opinions });
    const applied = withVeto.appliedObjections.find((o) => o.kind === "wrong_lever_for_intent");

    // Also directly probe the classifier (independent of routing) for the "nearest miss" report.
    const signal = [
      { query: packet.move.label, impressions: 2 },
      ...(packet.demand.fanoutSeeds ?? []).map((q) => ({ query: q, impressions: 1 })),
    ].filter((s) => s.query && s.query.trim());
    const cls = classifyQueryIntent(signal);
    if (!cls) {
      noSignal += 1;
    } else if (!applied) {
      nearMisses.push({ label: packet.move.label, action: withoutVeto.action, dominant: cls.dominant, share: cls.dominantShare });
    }

    if (applied) {
      if (applied.severity === "veto") vetoed += 1;
      else downgraded += 1;
      examples.push(
        `[${applied.severity.toUpperCase()}] "${packet.move.label}" (${withoutVeto.action} -> ${withVeto.action})\n` +
          `    ${applied.detail}`,
      );
    } else {
      silent += 1;
    }
  }

  console.log(`=== results across ${packets.length} moves ===`);
  console.log(`  vetoed:     ${vetoed}`);
  console.log(`  downgraded: ${downgraded}`);
  console.log(`  silent (no mismatch found): ${silent}`);
  console.log(`  no classifiable signal at all: ${noSignal}\n`);

  if (examples.length === 0) {
    console.log("ZERO vetoes/downgrades fired on the current real Move set. Honest nearest misses (dominant intent + share, no rule triggered):\n");
    const sorted = nearMisses
      .filter((m) => m.dominant === "when" || m.dominant === "cost")
      .sort((a, b) => b.share - a.share)
      .slice(0, 10);
    const toShow = sorted.length > 0 ? sorted : nearMisses.slice(0, 10);
    for (const m of toShow) {
      console.log(`  - "${m.label}" -> action=${m.action}, dominant=${m.dominant} (${Math.round(m.share * 100)}% share)`);
    }
  } else {
    console.log(`=== clearest examples (up to 3) ===\n`);
    for (const ex of examples.slice(0, 3)) console.log(ex + "\n");
  }
}

main().catch((e) => {
  console.error("ground-truth failed:", e);
  process.exit(1);
});
