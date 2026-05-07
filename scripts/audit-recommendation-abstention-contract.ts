/**
 * audit-recommendation-abstention-contract — Trust Sprint Mini-Phase
 * T4.1 (2026-05-06).
 *
 * Read-only audit of the active Ritz recommendation queue against the
 * new T4.1 abstention-contract rules. Reports rows that WOULD be
 * rejected by `validateAbstentionContract` if regenerated today.
 *
 * The persisted `recommended_edits` rows do NOT carry the original
 * `SpecificEditEvidencePacket`. We approximate the packet from the
 * row's `evidence` array (which carries `{type, …}` items: prompt /
 * owned_page / competitor / element / search_query / brand_assertion).
 * Approximation caveats:
 *
 *   - `aiSearchSignal.topSearchQueries` is approximated by counting
 *     `evidence[].type === "search_query"` items. Per Trust Sprint
 *     Phase 2.B audit, NO production rows currently ship a
 *     search_query evidence row even when the engine claims to use
 *     one. The audit therefore systematically reports thinner
 *     grounding than the original packet may have had.
 *   - `resolution.confidence` is NOT persisted on the row; we cannot
 *     re-check Rule A. We skip A and explicitly report that.
 *   - `brandAssertions` is NOT persisted on the row; we approximate
 *     by checking whether the `evidence` array contains a
 *     `brand_assertion` entry — production rows produced via the
 *     W3 §3.7 brand-claim grounder DO carry this evidence type.
 *
 * Honesty contract: when a row's evidence is insufficient for a rule,
 * the audit reports `unknown` for that rule rather than guessing. The
 * script is a flagging tool, not a re-validation oracle.
 *
 * Hard rules:
 *   - Read-only. No row mutation. No regeneration.
 *   - No OpenAI calls. No paid polling.
 *   - Exits 0 unless an invariant fails (currently: at least one
 *     invariant — JSON file readable + non-empty).
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/audit-recommendation-abstention-contract.ts
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
  | { type: "prompt"; promptId?: string; promptText?: string }
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

type RuleVerdict = {
  rule: "A" | "B" | "C" | "D";
  reason: string;
  status: "would_reject" | "would_pass" | "unknown_insufficient_data";
  evidenceFingerprint: string;
};

type RowAudit = {
  id: string;
  rec_id: string;
  action_type: string;
  source: string;
  confidence: string;
  implementation_status: string;
  promptCount: number;
  ownedPageCount: number;
  competitorCount: number;
  searchQueryCount: number;
  brandAssertionCount: number;
  isFaqAnswer: boolean;
  rules: RuleVerdict[];
  /** Whether ANY rule fired (B/C/D) — A is always unknown without resolution.confidence. */
  flagged: boolean;
};

function isFaqAnswerKey(elementKey: string | null): boolean {
  if (!elementKey) return false;
  // shape: faq_answer[<idx>]:<hash> or faq_answer[new]:<hash>
  return /^faq_answer\[/.test(elementKey);
}

function approximatePacket(row: RecRow) {
  const ev = Array.isArray(row.evidence) ? row.evidence : [];
  const promptCount = ev.filter((e) => e.type === "prompt").length;
  const ownedPageCount = ev.filter((e) => e.type === "owned_page").length;
  const competitorCount = ev.filter((e) => e.type === "competitor").length;
  const searchQueryCount = ev.filter((e) => e.type === "search_query").length;
  const brandAssertionCount = ev.filter((e) => e.type === "brand_assertion").length;
  return {
    promptCount,
    ownedPageCount,
    competitorCount,
    searchQueryCount,
    brandAssertionCount,
  };
}

function auditRow(row: RecRow): RowAudit {
  const a = approximatePacket(row);
  const isFaqAnswer = isFaqAnswerKey(row.target_element_key);
  const fingerprint = `prompts=${a.promptCount}, owned_pages=${a.ownedPageCount}, competitors=${a.competitorCount}, search_queries=${a.searchQueryCount}, brand_assertions=${a.brandAssertionCount}`;

  const rules: RuleVerdict[] = [];

  // ── Rule A: needs resolution.confidence which is not persisted ──
  rules.push({
    rule: "A",
    reason: "abstention_contract_low_confidence_no_brand_assertions",
    status: "unknown_insufficient_data",
    evidenceFingerprint: `resolution.confidence not persisted on row; brandAssertions=${a.brandAssertionCount}`,
  });

  // ── Rule B: no grounding signals ──
  // (competitorPageBlueprints empty AND topSearchQueries empty AND brandAssertions empty)
  // We approximate competitorPageBlueprints with competitorCount + searchQueryCount with searchQueryCount.
  // CAVEAT: the row's `evidence` array does NOT carry the full packet's
  //   competitorPageBlueprints — it carries `competitor` summary entries.
  //   When competitorCount > 0 we're overcounting grounding (the packet
  //   may have had blueprints; the row records only the angle). When
  //   competitorCount === 0 AND searchQueryCount === 0 AND
  //   brandAssertionCount === 0, we definitively know all 3 are empty.
  if (
    a.competitorCount === 0 &&
    a.searchQueryCount === 0 &&
    a.brandAssertionCount === 0
  ) {
    rules.push({
      rule: "B",
      reason: "abstention_contract_no_grounding_signals",
      status: "would_reject",
      evidenceFingerprint: fingerprint,
    });
  } else {
    rules.push({
      rule: "B",
      reason: "abstention_contract_no_grounding_signals",
      status: "would_pass",
      evidenceFingerprint: fingerprint,
    });
  }

  // ── Rule C: single-prompt thin evidence ──
  if (
    a.promptCount === 1 &&
    a.ownedPageCount === 0 &&
    a.competitorCount === 0 &&
    a.brandAssertionCount === 0 &&
    a.searchQueryCount === 0
  ) {
    rules.push({
      rule: "C",
      reason: "abstention_contract_single_prompt_thin_evidence",
      status: "would_reject",
      evidenceFingerprint: fingerprint,
    });
  } else {
    rules.push({
      rule: "C",
      reason: "abstention_contract_single_prompt_thin_evidence",
      status: "would_pass",
      evidenceFingerprint: fingerprint,
    });
  }

  // ── Rule D: thin FAQ answer ──
  if (isFaqAnswer) {
    const hasOwnedPage = a.ownedPageCount > 0;
    const hasBrandAssertion = a.brandAssertionCount > 0;
    const hasSearchQuery = a.searchQueryCount > 0;
    const hasMultiPrompt = a.promptCount >= 2;
    const hasAnyStrongerGrounding =
      hasOwnedPage || hasBrandAssertion || hasSearchQuery || hasMultiPrompt;
    rules.push({
      rule: "D",
      reason: "abstention_contract_thin_faq_answer",
      status: hasAnyStrongerGrounding ? "would_pass" : "would_reject",
      evidenceFingerprint: fingerprint,
    });
  } else {
    rules.push({
      rule: "D",
      reason: "abstention_contract_thin_faq_answer",
      status: "would_pass",
      evidenceFingerprint: "row is not a faq_answer",
    });
  }

  const flagged = rules.some((r) => r.status === "would_reject");

  return {
    id: row.id,
    rec_id: row.rec_id,
    action_type: row.action_type,
    source: row.source,
    confidence: row.confidence,
    implementation_status: row.implementation_status,
    promptCount: a.promptCount,
    ownedPageCount: a.ownedPageCount,
    competitorCount: a.competitorCount,
    searchQueryCount: a.searchQueryCount,
    brandAssertionCount: a.brandAssertionCount,
    isFaqAnswer,
    rules,
    flagged,
  };
}

async function main(): Promise<void> {
  console.log("audit-recommendation-abstention-contract — Trust Sprint T4.1\n");

  if (!existsSync(RECS_PATH)) {
    console.error(`FAIL: recommended-edits.json not found at ${RECS_PATH}`);
    process.exit(1);
  }

  const raw = readFileSync(RECS_PATH, "utf-8");
  const rows = JSON.parse(raw) as RecRow[];
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error("FAIL: recommended-edits.json is empty or not an array");
    process.exit(1);
  }

  console.log(`Loaded ${rows.length} rows from ${RECS_PATH}`);
  console.log("Mode: read-only. No mutations. No regeneration. No OpenAI.\n");

  // Audit only "active" rows: the ones an operator could still ship.
  const active = rows.filter(
    (r) => r.implementation_status !== "dismissed",
  );
  console.log(`Active (non-dismissed) rows: ${active.length}\n`);

  const audits = active.map(auditRow);
  const flagged = audits.filter((a) => a.flagged);

  // Summary by rule
  const byRule: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const a of audits) {
    for (const r of a.rules) {
      if (r.status === "would_reject") byRule[r.rule] = (byRule[r.rule] ?? 0) + 1;
    }
  }

  console.log("──── Summary ────");
  console.log(
    `  Rule A (low confidence + no brand assertions): unknown — resolution.confidence is not persisted on the row (caveat above)`,
  );
  console.log(`  Rule B (no grounding signals): ${byRule.B} would reject`);
  console.log(`  Rule C (single-prompt thin evidence): ${byRule.C} would reject`);
  console.log(`  Rule D (thin FAQ answer): ${byRule.D} would reject`);
  console.log(
    `  At least one rule fires: ${flagged.length} of ${active.length} active rows`,
  );
  console.log("");

  if (flagged.length > 0) {
    console.log("──── Flagged rows ────");
    for (const a of flagged) {
      const fired = a.rules
        .filter((r) => r.status === "would_reject")
        .map((r) => `${r.rule} (${r.reason})`)
        .join(", ");
      console.log(
        `  ${a.id}: action=${a.action_type} source=${a.source} conf=${a.confidence} status=${a.implementation_status}`,
      );
      console.log(`    fingerprint: prompts=${a.promptCount}, owned=${a.ownedPageCount}, comp=${a.competitorCount}, sq=${a.searchQueryCount}, ba=${a.brandAssertionCount}, isFaqAnswer=${a.isFaqAnswer}`);
      console.log(`    rules fired: ${fired}`);
    }
    console.log("");
  } else {
    console.log("PASS — no active rows hit any abstention rule (B/C/D).\n");
  }

  console.log("──── Honesty notes ────");
  console.log(
    "  - Rule A cannot be checked from a persisted row (resolution.confidence is not stored).",
  );
  console.log(
    "  - Rule B's competitorPageBlueprints check is approximated by the `competitor` evidence count; the audit may UNDER-flag rows whose packet had non-zero blueprints but whose row evidence array dropped them.",
  );
  console.log(
    "  - All 31 production rows show confidence='medium' (per Trust Sprint Phase 2.B); A's risk surface is therefore observed-zero today.",
  );
  console.log(
    "  - This script is a flagging tool, not a re-validation oracle; treat its counts as a directional baseline.",
  );

  // Always exit 0 unless preflight failed (handled above).
  process.exit(0);
}

main().catch((err) => {
  console.error("audit-recommendation-abstention-contract crashed:", err);
  process.exit(2);
});
