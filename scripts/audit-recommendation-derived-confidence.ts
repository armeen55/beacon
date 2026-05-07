/**
 * audit-recommendation-derived-confidence — Trust Sprint Mini-Phase
 * T4.4 (2026-05-06).
 *
 * Read-only audit of the active Ritz queue's derived-confidence
 * distribution. Uses the same row-evidence approximation as the
 * abstention + ranking audits.
 *
 *   - Counts rows by derived label (strong / moderate / needs_review).
 *   - Lists top 10 needs_review rows (so the operator sees what to
 *     manually inspect first).
 *   - Lists top 10 strong rows (so the operator sees what's
 *     ship-with-confidence).
 *
 * Hard rules:
 *   - Read-only. No mutations. No regeneration. No OpenAI.
 *   - Exits 0 unless preflight fails.
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/audit-recommendation-derived-confidence.ts
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
  | { type: "search_query"; query?: string; count?: number }
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
};

function classifyDerivedConfidence(row: RecRow): "strong_evidence" | "moderate_evidence" | "needs_review" {
  const ev = row.evidence ?? [];
  const promptCount = ev.filter((e) => e.type === "prompt").length;
  const ownedPageCount = ev.filter((e) => e.type === "owned_page").length;
  const competitorCount = ev.filter((e) => e.type === "competitor").length;
  const elementCount = ev.filter((e) => e.type === "element").length;
  const searchQueryCount = ev.filter((e) => (e as { type: string }).type === "search_query").length;
  const brandAssertionCount = ev.filter((e) => (e as { type: string }).type === "brand_assertion").length;

  let depth = 0;
  if (promptCount > 0) depth += 1;
  if (promptCount >= 2) depth += 1;
  if (ownedPageCount > 0) depth += 1;
  if (competitorCount > 0) depth += 1;
  if (elementCount > 0) depth += 1;

  const hasMultiPrompt = promptCount >= 2;
  const hasOwnedPage = ownedPageCount > 0;
  const hasCompetitor = competitorCount > 0;
  const hasSearchQuery = searchQueryCount > 0;
  const hasBrandAssertion = brandAssertionCount > 0;
  const isFaqAnswer =
    typeof row.target_element_key === "string" &&
    /^faq_answer\[/.test(row.target_element_key);

  if (hasMultiPrompt && hasOwnedPage && (hasCompetitor || hasSearchQuery || hasBrandAssertion)) {
    return "strong_evidence";
  }
  if (depth >= 4) return "strong_evidence";

  if (
    isFaqAnswer &&
    !hasMultiPrompt &&
    !hasOwnedPage &&
    !hasCompetitor &&
    !hasSearchQuery &&
    !hasBrandAssertion
  ) {
    return "needs_review";
  }
  if (
    !hasMultiPrompt &&
    !hasOwnedPage &&
    !hasCompetitor &&
    !hasSearchQuery &&
    !hasBrandAssertion
  ) {
    return "needs_review";
  }
  if (depth <= 1) return "needs_review";

  return "moderate_evidence";
}

async function main(): Promise<void> {
  console.log("audit-recommendation-derived-confidence — Trust Sprint T4.4\n");
  if (!existsSync(RECS_PATH)) {
    console.error(`FAIL: ${RECS_PATH} not found`);
    process.exit(1);
  }
  const rows = JSON.parse(readFileSync(RECS_PATH, "utf-8")) as RecRow[];
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error("FAIL: queue is empty");
    process.exit(1);
  }
  const active = rows.filter((r) => r.implementation_status !== "dismissed");
  console.log(`Active rows: ${active.length}\n`);

  const audited = active.map((r) => ({
    id: r.id,
    action_type: r.action_type,
    confidence_persisted: r.confidence,
    derived: classifyDerivedConfidence(r),
    promptCount: (r.evidence ?? []).filter((e) => e.type === "prompt").length,
    ownedPageCount: (r.evidence ?? []).filter((e) => e.type === "owned_page").length,
    competitorCount: (r.evidence ?? []).filter((e) => e.type === "competitor").length,
    isFaqAnswer:
      typeof r.target_element_key === "string" &&
      /^faq_answer\[/.test(r.target_element_key),
  }));

  // Counts
  const counts = { strong_evidence: 0, moderate_evidence: 0, needs_review: 0 };
  for (const a of audited) counts[a.derived] += 1;
  console.log("──── Distribution by derived confidence ────");
  console.log(`  Strong evidence:   ${counts.strong_evidence}`);
  console.log(`  Moderate evidence: ${counts.moderate_evidence}`);
  console.log(`  Needs review:      ${counts.needs_review}`);
  console.log("");

  // Persisted vs derived contrast
  console.log("──── Persisted 'confidence' column distribution (pre-T4.4) ────");
  const persistedCounts: Record<string, number> = {};
  for (const a of audited) {
    persistedCounts[a.confidence_persisted] =
      (persistedCounts[a.confidence_persisted] ?? 0) + 1;
  }
  for (const [k, v] of Object.entries(persistedCounts).sort()) {
    console.log(`  ${k}: ${v}`);
  }
  console.log("");

  // Top 10 needs_review
  console.log("──── Top 10 'needs review' rows (manually inspect first) ────");
  const ndr = audited.filter((a) => a.derived === "needs_review").slice(0, 10);
  if (ndr.length === 0) console.log("  (none)");
  for (const a of ndr) {
    console.log(
      `  ${a.action_type}  faq_answer=${a.isFaqAnswer}  prompts=${a.promptCount}  owned=${a.ownedPageCount}  comp=${a.competitorCount}  id=${a.id.slice(-50)}`,
    );
  }
  console.log("");

  // Top 10 strong
  console.log("──── Top 10 'strong evidence' rows (ship-with-confidence) ────");
  const strong = audited.filter((a) => a.derived === "strong_evidence").slice(0, 10);
  if (strong.length === 0) console.log("  (none)");
  for (const a of strong) {
    console.log(
      `  ${a.action_type}  prompts=${a.promptCount}  owned=${a.ownedPageCount}  comp=${a.competitorCount}  id=${a.id.slice(-50)}`,
    );
  }
  console.log("");

  console.log("──── Honesty notes ────");
  console.log(
    "  - Derived confidence is computed from the persisted row's `evidence` array (same approximation as the T4.1 + T4.2 audits).",
  );
  console.log(
    "  - Live rec engine produces packets with search_query + brand_assertion data the persisted rows currently lack. Live runs may produce more 'strong' rows than this audit reports.",
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("audit-recommendation-derived-confidence crashed:", err);
  process.exit(2);
});
