/**
 * W3 Step 3.1b (2026-05-01) — regression test for the pre-W3
 * placeholder quarantine.
 *
 * Three behaviors locked here:
 *
 * 1. The 4 quarantined recommended_edits rows exist in
 *    `.data/tenants/ritz-builders/recommended-edits.json` with
 *    `implementation_status: "dismissed"` and
 *    `not_found_reason: "invalid_placeholder_pre_w3"`. (Forward-only
 *    contract.)
 *
 * 2. The /recommendations rec card filter — the same
 *    `s !== "dismissed" && s !== "not_found_after_7d"` predicate the
 *    component uses — drops every quarantined row before rendering.
 *    The placeholder copy never reaches the operator's screen via
 *    that surface.
 *
 * 3. The /today implementation-queue source filter (which builds
 *    server-side in today-data.ts as `accepted` only) drops every
 *    quarantined row, since they are now `dismissed`.
 *
 * Pure file-read + array-filter test. No React rendering, no DB.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const FILE = path.join(
  ROOT,
  ".data",
  "tenants",
  "ritz-builders",
  "recommended-edits.json",
);

const QUARANTINED_IDS = [
  "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:d1b049c63d8a",
  "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:f2dcb7022c42",
  "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:93a207d063c1",
  "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:ff677f6f3ded",
] as const;

type Row = {
  id: string;
  rec_id: string;
  action_type: string;
  proposed_text: string | null;
  implementation_status?: string;
  not_found_reason?: string | null;
};

function loadRows(): Row[] {
  if (!fs.existsSync(FILE)) return [];
  const raw = fs.readFileSync(FILE, "utf-8").trim();
  if (raw.length === 0) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed as Row[];
}

describe("W3 Step 3.1b — pre-W3 placeholder quarantine regression", () => {
  it("the 4 quarantined rows are dismissed with the documented reason", () => {
    const rows = loadRows();
    if (rows.length === 0) {
      // Fresh checkout / CI without seeded data — skip.
      return;
    }

    for (const id of QUARANTINED_IDS) {
      const row = rows.find((r) => r.id === id);
      expect(row, `row ${id} not found`).toBeDefined();
      expect(row!.implementation_status).toBe("dismissed");
      expect(row!.not_found_reason).toBe("invalid_placeholder_pre_w3");
    }
  });

  it("the /recommendations rec card filter (dismissed + not_found_after_7d hidden) drops every quarantined row", () => {
    // Mirror the predicate used inside RecommendationsClient's
    // RecommendationRow component:
    //   const edits = allEdits.filter((e) => {
    //     const s = e.implementation_status ?? "recommended";
    //     return s !== "dismissed" && s !== "not_found_after_7d";
    //   });
    const rows = loadRows();
    if (rows.length === 0) return;
    const renderable = rows.filter((e) => {
      const s = e.implementation_status ?? "recommended";
      return s !== "dismissed" && s !== "not_found_after_7d";
    });
    for (const id of QUARANTINED_IDS) {
      expect(
        renderable.find((r) => r.id === id),
        `${id} would still render in /recommendations rec card`,
      ).toBeUndefined();
    }
  });

  it("the /today implementation-queue source predicate (accepted-only, no live_at) drops every quarantined row", () => {
    // Mirror today-data.ts's implementation-queue filter:
    //   accepted-only, live_at unset.
    const rows = loadRows();
    if (rows.length === 0) return;
    const queueable = rows.filter(
      (e) =>
        (e.implementation_status ?? "recommended") === "accepted" &&
        !(e as Row & { live_at?: string }).live_at,
    );
    for (const id of QUARANTINED_IDS) {
      expect(
        queueable.find((r) => r.id === id),
        `${id} would still render in /today implementation queue`,
      ).toBeUndefined();
    }
  });

  it("the original placeholder copy is preserved in proposed_text (history not deleted)", () => {
    // Operator constraint: "Do not delete historical data." Verify
    // the dismissed rows still carry their original text — they're
    // hidden from the queue, not erased.
    const rows = loadRows();
    if (rows.length === 0) return;
    for (const id of QUARANTINED_IDS) {
      const row = rows.find((r) => r.id === id);
      expect(row).toBeDefined();
      expect(row!.proposed_text).toBeTruthy();
      expect(row!.proposed_text!.length).toBeGreaterThan(20);
    }
  });

  it("the architecture invariant placeholder scan finds zero active rows", () => {
    // Cross-link: the active-row scanner in
    // tests/architecture/no-placeholder-recommended-edits.test.ts
    // should find zero violations after this quarantine. Re-derive
    // here so this regression file stands alone if the architecture
    // invariant ever moves.
    const rows = loadRows();
    if (rows.length === 0) return;
    const PLACEHOLDER_PHRASES = [
      /\bdraft\s+answer\b/i,
      /\boperator\s*:\s*rewrite\b/i,
      /\(\s*operator\s*:[^)\n]*\)/i,
      /\bplaceholder\b/i,
      /\[\s*insert\b[^\]]*\]/i,
      /\bTBD\b/i,
      /\brewrite\s+below\b/i,
      /\bTODO\s*:/i,
    ];
    const activeViolations: string[] = [];
    for (const row of rows) {
      const status = row.implementation_status ?? "recommended";
      if (status === "dismissed" || status === "not_found_after_7d") continue;
      const text = row.proposed_text ?? "";
      for (const re of PLACEHOLDER_PHRASES) {
        if (re.test(text)) {
          activeViolations.push(`${row.id} matches ${re.source}`);
          break;
        }
      }
    }
    expect(activeViolations).toEqual([]);
  });
});
