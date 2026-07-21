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
 * W3 Step 3.1b (2026-05-01) — allowlist DROPPED. The 4 Los Altos
 * placeholder rows that previously gated this invariant were
 * quarantined via `scripts/quarantine-pre-w3-placeholder-edits.ts`:
 * status flipped `accepted` → `dismissed` with
 * not_found_reason = "invalid_placeholder_pre_w3". Dismissed rows are
 * filtered by `isActive` here and don't render in the queue. Active
 * placeholder copy must be ZERO from this point forward.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const TENANTS_ROOT = path.join(ROOT, ".data", "tenants");

/**
 * The 4 originally-allowlisted placeholder ids — kept as a documented
 * regression target, not as an exemption. The "quarantined IDs are
 * dismissed" test below verifies they're still in the documented
 * post-quarantine state. There is intentionally NO active-row
 * allowlist; new placeholder rows must be impossible.
 */
const QUARANTINED_PRE_W3_IDS: ReadonlyArray<string> = [
  "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:d1b049c63d8a",
  "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:f2dcb7022c42",
  "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:93a207d063c1",
  "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:ff677f6f3ded",
];
const QUARANTINE_REASON = "invalid_placeholder_pre_w3";

type RecommendedEditRow = {
  id: string;
  rec_id: string;
  action_type: string;
  proposed_text: string | null;
  display_label: string | null;
  implementation_status?: string;
  not_found_reason?: string | null;
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
        `Found ${violations.length} active recommended_edits row(s) with placeholder phrases:\n${msg}\n\nFix: regenerate via the validator-hardened pipeline (W3 Step 3.4 LLM provider) OR run scripts/quarantine-pre-w3-placeholder-edits.ts to dismiss. There is no allowlist; placeholder copy in the active queue is never acceptable.`,
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
        `Found ${violations.length} active FAQ recommended_edits row(s) failing structural quality:\n${msg}\n\nFix: regenerate via the validator-hardened pipeline OR run scripts/quarantine-pre-w3-placeholder-edits.ts.`,
      );
    }
  });

  it("W3 Step 3.1b — quarantined placeholder rows are dismissed with the documented reason", () => {
    // Forward-only contract: once `scripts/quarantine-pre-w3-
    // placeholder-edits.ts` runs, the 4 originally-allowlisted IDs
    // must stay in `dismissed` status with not_found_reason =
    // "invalid_placeholder_pre_w3". Any drift (status reverts to
    // accepted, reason cleared, etc.) means a code path mutated the
    // rows in a way the lifecycle's forward-only contract should
    // have blocked.
    const stores = listTenantStores();
    if (stores.length === 0) return;

    // Find the rows in whichever tenant carries them.
    const found = new Map<string, RecommendedEditRow>();
    for (const { filePath } of stores) {
      for (const row of loadRows(filePath)) {
        if (QUARANTINED_PRE_W3_IDS.includes(row.id)) {
          found.set(row.id, row);
        }
      }
    }

    // Every quarantined id must (a) exist and (b) be dismissed with
    // the documented reason.
    const issues: string[] = [];
    for (const id of QUARANTINED_PRE_W3_IDS) {
      const row = found.get(id);
      if (!row) {
        issues.push(`${id} not found in any tenant store`);
        continue;
      }
      if (row.implementation_status !== "dismissed") {
        issues.push(
          `${id} status=${row.implementation_status ?? "(undef)"} (expected "dismissed")`,
        );
      }
      if (row.not_found_reason !== QUARANTINE_REASON) {
        issues.push(
          `${id} not_found_reason=${row.not_found_reason ?? "(null)"} (expected ${QUARANTINE_REASON})`,
        );
      }
    }

    if (issues.length > 0) {
      throw new Error(
        `Pre-W3 placeholder quarantine drift detected:\n${issues.map((i) => `  - ${i}`).join("\n")}\n\nThe 4 placeholder rows must remain dismissed forever. Fix: re-run scripts/quarantine-pre-w3-placeholder-edits.ts --execute.`,
      );
    }
  });

  it("W3 Step 3.1b — quarantined rows do not pass the `isActive` filter (cannot render in the queue)", () => {
    // Behavioral check on isActive: dismissed rows are filtered
    // before the placeholder + structural scans run. Future code
    // paths that surface "all" rows (e.g., admin views) must rely
    // on the same filter to avoid leaking placeholder copy.
    const stores = listTenantStores();
    if (stores.length === 0) return;

    for (const { filePath } of stores) {
      for (const row of loadRows(filePath)) {
        if (!QUARANTINED_PRE_W3_IDS.includes(row.id)) continue;
        expect(isActive(row)).toBe(false);
      }
    }
  });
});
