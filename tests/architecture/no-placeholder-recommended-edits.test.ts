import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  detectPlaceholder,
  evaluateFaqAnswer,
  parseFaqProposedText,
} from "@/domains/recommendations/placeholder-detection";

/**
 * W3 Step 3.1 (2026-05-01) — placeholder + structural-quality
 * regression guard for the recommended_edits store.
 *
 * Scans `.data/tenants/* /recommended-edits.json` for rows whose
 * proposed_text reads like a generator placeholder OR whose FAQ Q+A
 * body is structurally useless. Active (non-dismissed) rows must be
 * clean.
 *
 * Why two passes:
 *   - PHRASE: catches "Draft answer", "TBD", "[insert ...]", etc.
 *   - STRUCTURAL: catches generic-restate FAQ bodies (under 25 words,
 *     mostly repeats the question, no specific content).
 *
 * Founder direction (2026-05-01): "Beacon should prefer no
 * recommendation over a recommendation that makes the operator trust
 * the product less." The validator rejects these on regenerate; this
 * invariant keeps the data store honest as a regression guard.
 *
 * Pre-W3 placeholder rows DO exist in the canonical .data store
 * (operator-accepted before the validator was hardened). Those rows
 * are allowlisted by id below and remain `accepted` until the next
 * regeneration cycle (W3 Step 3.4 LLM activation) replaces them with
 * grounded copy. This test FAILS the moment any NEW placeholder row
 * sneaks past the validator.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const TENANTS_ROOT = path.join(ROOT, ".data", "tenants");

/**
 * Pre-W3 placeholder rows that predate the validator hardening. These
 * rows are operator-accepted and will be replaced when the W3 Step 3.4
 * LLM provider regenerates the queue. They are allowlisted here so
 * the invariant blocks NEW placeholder regressions without forcing a
 * mid-step data mutation.
 *
 * If you find yourself adding to this list, STOP — your validator or
 * generator change is likely missing a placeholder gate. The whole
 * point of W3 Step 3.1 is that this list shrinks, never grows.
 */
const KNOWN_PRE_W3_PLACEHOLDER_IDS: ReadonlyArray<string> = [
  "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:d1b049c63d8a",
  "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:f2dcb7022c42",
  "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:93a207d063c1",
  "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:ff677f6f3ded",
];

type RecommendedEditRow = {
  id: string;
  rec_id: string;
  action_type: string;
  proposed_text: string | null;
  display_label: string | null;
  implementation_status?: string;
};

function listTenantStores(): Array<{ tenantSlug: string; filePath: string }> {
  if (!fs.existsSync(TENANTS_ROOT)) return [];
  const out: Array<{ tenantSlug: string; filePath: string }> = [];
  for (const entry of fs.readdirSync(TENANTS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(
      TENANTS_ROOT,
      entry.name,
      "recommended-edits.json",
    );
    if (fs.existsSync(filePath)) {
      out.push({ tenantSlug: entry.name, filePath });
    }
  }
  return out;
}

function loadRows(filePath: string): RecommendedEditRow[] {
  const raw = fs.readFileSync(filePath, "utf-8").trim();
  if (raw.length === 0) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed as RecommendedEditRow[];
}

function isActive(row: RecommendedEditRow): boolean {
  // dismissed rows aren't surfaced anywhere; they don't carry the
  // trust risk an active placeholder row does. Same for legacy rows
  // without a status — the file-store predates the column, but the
  // read-side normalizer treats undefined as `recommended` which IS
  // active.
  return row.implementation_status !== "dismissed";
}

describe("Architecture: recommended_edits — placeholder + structural quality", () => {
  it("active rows do not contain placeholder phrases", () => {
    const stores = listTenantStores();
    if (stores.length === 0) {
      // Fresh checkout / CI without seeded data — nothing to scan.
      expect(stores.length).toBeGreaterThanOrEqual(0);
      return;
    }

    const violations: Array<{
      tenantSlug: string;
      id: string;
      field: string;
      patternId: string;
      sample: string;
    }> = [];

    for (const { tenantSlug, filePath } of stores) {
      const rows = loadRows(filePath);
      for (const row of rows) {
        if (!isActive(row)) continue;
        if (KNOWN_PRE_W3_PLACEHOLDER_IDS.includes(row.id)) continue;

        for (const [field, value] of [
          ["proposed_text", row.proposed_text],
          ["display_label", row.display_label],
        ] as const) {
          const hit = detectPlaceholder(value);
          if (hit.matched) {
            violations.push({
              tenantSlug,
              id: row.id,
              field,
              patternId: hit.patternId,
              sample: (value ?? "").slice(0, 120),
            });
          }
        }
      }
    }

    if (violations.length > 0) {
      const msg = violations
        .map(
          (v) =>
            `  - tenant=${v.tenantSlug} id=${v.id} field=${v.field} pattern=${v.patternId} sample=${JSON.stringify(v.sample)}`,
        )
        .join("\n");
      throw new Error(
        `Found ${violations.length} active recommended_edits row(s) with placeholder phrases:\n${msg}\n\nFix: regenerate via the validator-hardened pipeline (W3 Step 3.4 LLM provider) OR mark the row dismissed. Adding to KNOWN_PRE_W3_PLACEHOLDER_IDS is NOT allowed — that list only documents rows that predate the hardening.`,
      );
    }
  });

  it("active FAQ rows pass the structural-quality gate", () => {
    const stores = listTenantStores();
    if (stores.length === 0) {
      expect(stores.length).toBeGreaterThanOrEqual(0);
      return;
    }

    const violations: Array<{
      tenantSlug: string;
      id: string;
      reason: string;
      detail: string;
    }> = [];

    for (const { tenantSlug, filePath } of stores) {
      const rows = loadRows(filePath);
      for (const row of rows) {
        if (!isActive(row)) continue;
        if (KNOWN_PRE_W3_PLACEHOLDER_IDS.includes(row.id)) continue;
        if (row.action_type !== "add_faq" && row.action_type !== "rewrite_faq") {
          continue;
        }
        const parsed = parseFaqProposedText(row.proposed_text);
        if (!parsed) continue;
        const verdict = evaluateFaqAnswer(parsed);
        if (!verdict.ok) {
          violations.push({
            tenantSlug,
            id: row.id,
            reason: verdict.reason,
            detail: verdict.detail,
          });
        }
      }
    }

    if (violations.length > 0) {
      const msg = violations
        .map(
          (v) =>
            `  - tenant=${v.tenantSlug} id=${v.id} reason=${v.reason} detail=${v.detail}`,
        )
        .join("\n");
      throw new Error(
        `Found ${violations.length} active FAQ recommended_edits row(s) failing structural quality:\n${msg}\n\nFix: regenerate via the validator-hardened pipeline OR dismiss.`,
      );
    }
  });

  it("KNOWN_PRE_W3_PLACEHOLDER_IDS only references rows that actually exist (no stale allowlist entries)", () => {
    const stores = listTenantStores();
    if (stores.length === 0) return;

    const allIdsInData = new Set<string>();
    for (const { filePath } of stores) {
      for (const row of loadRows(filePath)) {
        allIdsInData.add(row.id);
      }
    }

    const stale = KNOWN_PRE_W3_PLACEHOLDER_IDS.filter(
      (id) => !allIdsInData.has(id),
    );
    if (stale.length > 0) {
      throw new Error(
        `KNOWN_PRE_W3_PLACEHOLDER_IDS references ${stale.length} row(s) that no longer exist in the canonical store:\n${stale.map((s) => `  - ${s}`).join("\n")}\n\nRemove these from the allowlist — they were already cleaned up.`,
      );
    }
  });
});
