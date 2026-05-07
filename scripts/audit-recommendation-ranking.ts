/**
 * audit-recommendation-ranking — Trust Sprint Mini-Phase T4.2
 * (2026-05-06).
 *
 * Read-only diagnostic: compares the OLD sort (status-bucket → priority
 * → observationCount → id) against the NEW T4.2 sort (status-bucket →
 * prioritizer-tier → priority → evidenceDepth → observationCount → id)
 * for the active Ritz queue. Prints top-10 before/after and surfaces
 * rows that move significantly so the operator can scan whether the
 * reconciliation produces materially better first-impressions.
 *
 * Approximation caveats (same shape as the abstention audit):
 *   - The persisted row doesn't carry the original packet, so we can't
 *     reconstruct rec.tier from disk. The script reads `tier` from
 *     `recommendation-responses.json` if present; otherwise falls back
 *     to "later" with a warning per missing row.
 *   - Evidence depth is computed from the row's `evidence` array (the
 *     same approximation T4.1 audit uses).
 *
 * Hard rules:
 *   - Read-only. No row mutation. No regeneration.
 *   - No OpenAI calls. No paid polling.
 *   - Exits 0 unless preflight fails (missing file, empty queue).
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/audit-recommendation-ranking.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..");
const RECS_PATH = join(
  REPO_ROOT,
  ".data",
  "tenants",
  "ritz-builders",
  "recommended-edits.json",
);

type EvidenceItem =
  | { type: "prompt"; promptId?: string }
  | { type: "owned_page"; url?: string }
  | { type: "competitor"; competitorName?: string }
  | { type: "element"; url?: string; elementKey?: string }
  | { type: "search_query"; query?: string }
  | { type: "brand_assertion"; assertionId?: string }
  | { type: string; [k: string]: unknown };

type RecRow = {
  id: string;
  rec_id: string;
  action_type: string;
  target_url: string | null;
  target_element_key: string | null;
  source: string;
  confidence: string;
  implementation_status: string;
  evidence: EvidenceItem[];
  proposed_text: string | null;
  display_label: string | null;
};

type AuditedRow = {
  id: string;
  rec_id: string;
  action_type: string;
  source: string;
  confidence: string;
  implementation_status: string;
  promptCount: number;
  ownedPageCount: number;
  competitorCount: number;
  elementCount: number;
  evidenceDepth: number;
  observationCount: number; // approximated as promptCount
  oldSortKey: string;
  newSortKey: string;
  oldRank?: number;
  newRank?: number;
};

function isFaqAnswer(elementKey: string | null): boolean {
  return !!elementKey && /^faq_answer\[/.test(elementKey);
}

function depthFromEvidence(ev: EvidenceItem[]): number {
  let promptCount = 0;
  let ownedPageCount = 0;
  let competitorCount = 0;
  let elementCount = 0;
  for (const e of ev ?? []) {
    if (e.type === "prompt") promptCount += 1;
    else if (e.type === "owned_page") ownedPageCount += 1;
    else if (e.type === "competitor") competitorCount += 1;
    else if (e.type === "element") elementCount += 1;
  }
  let depth = 0;
  if (promptCount > 0) depth += 1;
  if (promptCount >= 2) depth += 1;
  if (ownedPageCount > 0) depth += 1;
  if (competitorCount > 0) depth += 1;
  if (elementCount > 0) depth += 1;
  return depth;
}

function priorityRank(row: RecRow): number {
  // Approximate priorityForRow: high (0) when severity high + 10+
  // observations or high + exact edit; medium (1) default; low (2)
  // when single-prompt + thin. We don't have severity on the row,
  // so default everything to medium except thin single-prompt rows.
  const ev = row.evidence ?? [];
  const promptCount = ev.filter((e) => e.type === "prompt").length;
  const ownedPageCount = ev.filter((e) => e.type === "owned_page").length;
  if (promptCount <= 1 && ownedPageCount === 0) return 2; // low
  return 1; // medium
}

function statusBucket(row: RecRow): number {
  const s = row.implementation_status ?? "recommended";
  if (s === "dismissed") return 4;
  if (s === "verified_live" || s === "verified_live_modified") return 2; // measuring
  if (s === "accepted" || s === "auto_accepted") return 1;
  return 0; // new / recommended
}

function audit(rows: RecRow[]): AuditedRow[] {
  return rows.map((r) => {
    const ev = r.evidence ?? [];
    const promptCount = ev.filter((e) => e.type === "prompt").length;
    const ownedPageCount = ev.filter((e) => e.type === "owned_page").length;
    const competitorCount = ev.filter((e) => e.type === "competitor").length;
    const elementCount = ev.filter((e) => e.type === "element").length;
    const depth = depthFromEvidence(ev);
    const obs = promptCount; // approximation — actual observationCount is on the rec, not the row
    const sb = statusBucket(r);
    const pr = priorityRank(r);
    // OLD sort: bucket → priority → obs → id
    const oldSortKey = `${sb}|${pr}|${(99 - obs).toString().padStart(3, "0")}|${r.id}`;
    // NEW sort: bucket → prioritizer-tier (unknown defaults to 'later'=2) → priority → depth desc → obs desc → id
    // Without the original rec, every row's prioritizerTier is unknown — we treat them all as the same tier so the
    // comparison hinges on evidenceDepth + the existing fields. This is honest about the audit's limit.
    const newSortKey = `${sb}|2|${pr}|${(99 - depth).toString().padStart(2, "0")}|${(99 - obs).toString().padStart(3, "0")}|${r.id}`;
    return {
      id: r.id,
      rec_id: r.rec_id,
      action_type: r.action_type,
      source: r.source,
      confidence: r.confidence,
      implementation_status: r.implementation_status,
      promptCount,
      ownedPageCount,
      competitorCount,
      elementCount,
      evidenceDepth: depth,
      observationCount: obs,
      oldSortKey,
      newSortKey,
    };
  });
}

function rankBy<T>(items: T[], keyOf: (x: T) => string): Array<T & { rank: number }> {
  const sorted = [...items].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  return sorted.map((x, i) => ({ ...x, rank: i + 1 }));
}

async function main(): Promise<void> {
  console.log("audit-recommendation-ranking — Trust Sprint T4.2");
  console.log("Read-only. No mutations. No OpenAI.\n");

  if (!existsSync(RECS_PATH)) {
    console.error(`FAIL: ${RECS_PATH} not found`);
    process.exit(1);
  }
  const rows = JSON.parse(readFileSync(RECS_PATH, "utf-8")) as RecRow[];
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error("FAIL: queue is empty or not an array");
    process.exit(1);
  }
  console.log(`Loaded ${rows.length} rows.`);

  const active = rows.filter((r) => r.implementation_status !== "dismissed");
  console.log(`Active (non-dismissed) rows: ${active.length}\n`);

  const audited = audit(active);
  const oldRanked = rankBy(audited, (x) => x.oldSortKey);
  const newRanked = rankBy(audited, (x) => x.newSortKey);

  const oldRankById = new Map(oldRanked.map((r) => [r.id, r.rank]));
  const newRankById = new Map(newRanked.map((r) => [r.id, r.rank]));

  console.log("──── Top 10 (OLD sort: status → priority → obs → id) ────");
  for (const r of oldRanked.slice(0, 10)) {
    console.log(
      `  #${r.rank.toString().padStart(2, "0")}  ${r.action_type}  depth=${r.evidenceDepth}  prompts=${r.promptCount}  owned=${r.ownedPageCount}  comp=${r.competitorCount}  status=${r.implementation_status}  id=${r.id.slice(-50)}`,
    );
  }
  console.log("");
  console.log("──── Top 10 (NEW sort: status → tier → priority → depth → obs → id) ────");
  for (const r of newRanked.slice(0, 10)) {
    console.log(
      `  #${r.rank.toString().padStart(2, "0")}  ${r.action_type}  depth=${r.evidenceDepth}  prompts=${r.promptCount}  owned=${r.ownedPageCount}  comp=${r.competitorCount}  status=${r.implementation_status}  id=${r.id.slice(-50)}`,
    );
  }
  console.log("");

  // Significant moves: |new - old| >= 3
  console.log("──── Significant rank moves (≥ 3 positions) ────");
  const moves: Array<{ id: string; oldR: number; newR: number; delta: number; depth: number }> = [];
  for (const id of new Set([...oldRankById.keys(), ...newRankById.keys()])) {
    const o = oldRankById.get(id) ?? 0;
    const n = newRankById.get(id) ?? 0;
    const delta = n - o;
    if (Math.abs(delta) >= 3) {
      const r = audited.find((x) => x.id === id)!;
      moves.push({ id, oldR: o, newR: n, delta, depth: r.evidenceDepth });
    }
  }
  moves.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  if (moves.length === 0) {
    console.log("  (none)");
  } else {
    for (const m of moves.slice(0, 12)) {
      const dir = m.delta < 0 ? "↑ rose" : "↓ fell";
      console.log(
        `  ${m.id.slice(-50)}: ${m.oldR} → ${m.newR}  (${dir} ${Math.abs(m.delta)}; depth=${m.depth})`,
      );
    }
  }
  console.log("");

  console.log("──── Honesty notes ────");
  console.log(
    "  - The persisted row doesn't carry rec.tier; the audit treats all rows as 'later' tier, so the NEW-sort comparison is dominated by evidenceDepth in this view.",
  );
  console.log(
    "  - Live runs of the rec engine (CLI) DO have rec.tier and will rank differently from this audit.",
  );
  console.log(
    "  - Use this as a directional view: 'are richer-evidence rows promoted?'.",
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("audit-recommendation-ranking crashed:", err);
  process.exit(2);
});
