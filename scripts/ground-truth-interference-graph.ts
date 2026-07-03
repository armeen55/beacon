/**
 * Ground-truth the N14 interference graph against the REAL tenant-iranopedia
 * proof ledger (2026-07-03) - the operator-journey rule requires a real edge
 * table, not a synthetic one, before N14 counts as done.
 *
 * Reads (no writes):
 *   - shipped_change_proof (the full ledger, via loadShippedChanges)
 *   - page_snapshots (internal_links, for the linked_page_treated edge)
 *
 * Run (env sourced first so Supabase reads actually work):
 *   set -a; . ./.env.local; set +a
 *   BEACON_TENANT_ID=tenant-iranopedia npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-interference-graph.ts
 */

import { loadShippedChanges } from "@/domains/proof-gsc/shipped-change-store";
import { measurementWindowOf } from "@/domains/proof-gsc/measurement-maturity";
import { outcomeStateOf } from "@/domains/proof-gsc/measure-lifecycle";
import { buildShockWindows } from "@/domains/proof-gsc/algorithm-weather";
import {
  computeInterferenceGraphForLedger,
  toPlannerHoldEntry,
  interferenceByKind,
  pathOf,
  type InterferenceLedgerShip,
  type PageLinkRow,
} from "@/domains/proof-gsc/interference-graph";
import { gradeVerdictReliability } from "@/domains/proof-gsc/verdict-reliability";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";

const TENANT_ID = process.env.BEACON_TENANT_ID || "tenant-iranopedia";

async function loadLinkRows(tenantId: string): Promise<PageLinkRow[]> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("page_snapshots")
      .select("url, internal_links")
      .eq("tenant_id", tenantId)
      .not("internal_links", "is", null)
      .limit(2000);
    if (error) {
      console.log(`  (page_snapshots link read failed: ${error.message})`);
      return [];
    }
    const rows = (data ?? []) as Array<{ url: string; internal_links: { href: string; anchor_text: string }[] | null }>;
    return rows
      .filter((r) => Array.isArray(r.internal_links) && r.internal_links.length > 0)
      .map((r) => ({ sourcePath: pathOf(r.url), targetHrefs: r.internal_links!.map((l) => l.href) }));
  } catch (e) {
    console.log(`  (page_snapshots link read threw: ${e instanceof Error ? e.message : String(e)})`);
    return [];
  }
}

async function main() {
  console.log(`\n=== N14 ground-truth: interference graph for ${TENANT_ID} ===\n`);

  const now = new Date();
  const records = await loadShippedChanges();
  console.log(`Ledger rows: ${records.length}`);
  if (records.length === 0) {
    console.log("No shipped changes found for this tenant - nothing to graph.");
    return;
  }

  const ships: InterferenceLedgerShip[] = records.map((r) => ({
    id: r.id,
    path: r.path,
    shippedAt: r.shippedAt,
    measuring: outcomeStateOf(r, now) === "measuring",
    window: measurementWindowOf(r.shippedAt, r.windows ?? []),
    targetQueries: r.targetQueries ?? [],
    controlPages: r.controlPages ?? [],
  }));
  const measuringCount = ships.filter((s) => s.measuring).length;
  console.log(`Currently measuring: ${measuringCount} / ${ships.length}`);

  const linkRows = await loadLinkRows(TENANT_ID);
  console.log(`page_snapshots rows with internal_links: ${linkRows.length}`);

  // Shock windows: reuse algorithm-weather's own composer with an empty daily
  // series (no live daily read wired for this probe) - confirmed updates
  // still fire; suspected shocks require the caller's own changepoint sweep,
  // out of scope for this read-only ground-truth pass.
  const shockWindows = buildShockWindows({ dailySeries: [] });
  console.log(`Confirmed Google update shock windows known: ${shockWindows.length}`);
  console.log("");

  const graphs = computeInterferenceGraphForLedger({ ships, linkRows, shockWindows });

  console.log("=== Real interference edge table (every ship with >=1 significant edge) ===");
  console.log("path | kind | otherPath | strength | windowOverlapDays | reason");
  let totalEdges = 0;
  let shipsWithEdges = 0;
  const kindCounts: Record<string, number> = {};
  for (const ship of ships) {
    const g = graphs.get(pathOf(ship.path));
    if (!g || g.edges.length === 0) continue;
    shipsWithEdges += 1;
    for (const e of g.edges) {
      totalEdges += 1;
      kindCounts[e.kind] = (kindCounts[e.kind] ?? 0) + 1;
      console.log(`${g.targetPath} | ${e.kind} | ${e.otherPath} | ${e.strength} | ${e.windowOverlapDays} | ${e.reason}`);
    }
  }
  console.log("");
  console.log(`Ships with >=1 significant edge: ${shipsWithEdges} / ${ships.length}`);
  console.log(`Total edges: ${totalEdges}`);
  console.log(`By kind: ${JSON.stringify(kindCounts)}`);
  console.log("");

  console.log("=== N13 cross-check: does the known /persian-male-names contamination cluster show up as edges? ===");
  let controlDepHits = 0;
  for (const ship of ships) {
    const g = graphs.get(pathOf(ship.path));
    if (!g) continue;
    for (const e of g.edges) {
      if (e.kind === "linked_page_treated" && e.otherPath === "/persian-male-names" && e.reason.includes("comparison page")) {
        controlDepHits += 1;
        console.log(`  ${g.targetPath} -> control dependency on /persian-male-names: "${e.reason}"`);
      }
    }
  }
  console.log(`Control-dependency edges onto /persian-male-names: ${controlDepHits}`);
  console.log("");

  // Quote one real rendered hold reason (selection-time consumer) - the
  // exact sentence a planner exclusion would carry on plainReason.
  const heldExample = [...graphs.entries()].find(([, g]) => g.hasSignificantInterference);
  if (heldExample) {
    const [path, g] = heldExample;
    const entry = toPlannerHoldEntry(g);
    console.log(`=== Rendered selection-time hold reason (real ship: ${path}) ===`);
    console.log(`"${entry.reason}"`);
    console.log("");
    console.log("=== See-the-math breakdown for the same ship ===");
    for (const group of interferenceByKind(g)) {
      console.log(`  ${group.label}: ${group.edges.length} edge(s)`);
    }
    console.log("");
  } else {
    console.log("No ship crossed the significant-interference floor today - nothing to quote for the hold reason.");
    console.log("");
  }

  // Quote one real N10 grade effect (read-time consumer) - before/after
  // interferenceFlagged on the SAME ship, using otherwise-clean flags so the
  // effect of the new input alone is visible (a ship's OTHER real caveats
  // would already push it to shaky on their own, masking the new input).
  if (heldExample) {
    const [, g] = heldExample;
    const clean = {
      maturity: "mature_result" as const,
      basisDay: 28 as const,
      recrawlPending: false,
      controlContaminationFlagged: false,
      weakComparisonFlagged: false,
      weatherQuarantined: false,
      seasonalInflectionFlagged: false,
      attributionShared: false,
      controlsUsed: 3,
      baselineImpressions: 3000,
    };
    const without = gradeVerdictReliability({ ...clean, interferenceFlagged: false });
    const withFlag = gradeVerdictReliability({ ...clean, interferenceFlagged: g.hasSignificantInterference });
    console.log("=== N10 grade effect (same otherwise-clean inputs, interferenceFlagged toggled) ===");
    console.log(`Without N14 input: grade="${without.grade}" sentence="${without.sentence}"`);
    console.log(`With N14 input:    grade="${withFlag.grade}" sentence="${withFlag.sentence}"`);
  }

  console.log("\n=== Done ===\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
