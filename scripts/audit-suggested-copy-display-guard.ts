/**
 * Read-only audit: which `recommended_edits` rows would have their
 * user-visible `proposed_text` / `faq_answer_text` / `current_text` /
 * `display_label` hidden by the Suggested Copy display-safety guard?
 *
 * Reads via the existing repository pattern (Supabase service role,
 * tenant-scoped). Never mutates. Never persists. Never calls the LLM.
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs \
 *     scripts/audit-suggested-copy-display-guard.ts
 *
 * Required env (read from .env.local OR shell):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   BEACON_TENANT_ID            (e.g., tenant-ritz-founder)
 *   BEACON_TENANT_SLUG          (e.g., ritz-founder)
 *
 * Output: a per-tenant summary printed to stdout. Exit code 0 always
 * (this is observability, not a CI gate).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ── Load .env.local — same pattern as scripts/bootstrap-from-supabase.ts ──
{
  const envPath = join(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        const key = trimmed.slice(0, eq);
        const val = trimmed.slice(eq + 1);
        process.env[key] ??= val;
      }
    }
  }
}

import { checkCopyDisplaySafe } from "../src/domains/recommendations/suggested-copy-display-guard";

// We hit Supabase directly here rather than through `getRepository()`,
// because this script runs outside the Next.js server context and
// `getRepository()` expects tenant-context middleware to have run.
import { createClient } from "@supabase/supabase-js";

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const tenantId = process.env.BEACON_TENANT_ID;

  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
        "Set them in .env.local or in the shell.",
    );
    process.exit(1);
  }
  if (!tenantId) {
    console.error(
      "Missing BEACON_TENANT_ID (e.g., tenant-ritz-founder). Set it in " +
        ".env.local or in the shell.",
    );
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Pull only the user-visible string columns. No write columns, no
  // joins, no large payloads. Tenant-scoped via `tenant_id`.
  const { data, error } = await supabase
    .from("recommended_edits")
    .select(
      [
        "id",
        "rec_id",
        "action_type",
        "target_url",
        "display_label",
        "current_text",
        "proposed_text",
        "implementation_status",
      ].join(","),
    )
    .eq("tenant_id", tenantId)
    .limit(10_000);

  if (error) {
    console.error("Supabase read failed:", error.message);
    process.exit(1);
  }
  const rows = ((data ?? []) as unknown) as Array<{
    id: string;
    rec_id: string | null;
    action_type: string;
    target_url: string | null;
    display_label: string | null;
    current_text: string | null;
    proposed_text: string | null;
    implementation_status: string | null;
  }>;

  // ── Aggregate ──
  let rowsWithAnyProposedText = 0;
  let rowsHidden = 0;
  let fieldHits = 0;
  const reasons: Record<string, number> = {};
  const byActionType: Record<string, { total: number; hidden: number }> = {};
  const samplesByReason: Record<
    string,
    Array<{ id: string; field: string; match: string }>
  > = {};

  for (const row of rows) {
    const hasProposed =
      typeof row.proposed_text === "string" &&
      row.proposed_text.trim().length > 0;
    if (hasProposed) rowsWithAnyProposedText += 1;

    const bucket = byActionType[row.action_type] ?? { total: 0, hidden: 0 };
    bucket.total += 1;

    let rowHidden = false;
    for (const field of [
      "proposed_text",
      "current_text",
      "display_label",
    ] as const) {
      const t = row[field];
      if (typeof t !== "string" || !t.trim()) continue;
      const r = checkCopyDisplaySafe(t);
      if (!r.safe) {
        fieldHits += 1;
        rowHidden = true;
        reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
        const list = samplesByReason[r.reason] ?? [];
        if (list.length < 5) {
          list.push({ id: row.id, field, match: r.match });
        }
        samplesByReason[r.reason] = list;
      }
    }
    if (rowHidden) {
      rowsHidden += 1;
      bucket.hidden += 1;
    }
    byActionType[row.action_type] = bucket;
  }

  // ── Print ──
  console.log("");
  console.log(`Tenant: ${tenantId}`);
  console.log(`Rows scanned: ${rows.length}`);
  console.log(`Rows with non-empty proposed_text: ${rowsWithAnyProposedText}`);
  console.log(
    `Rows that fail the display guard on any user-visible field: ${rowsHidden} (${
      rows.length > 0
        ? Math.round((rowsHidden / rows.length) * 1000) / 10
        : 0
    }%)`,
  );
  console.log(`Field-level guard hits: ${fieldHits}`);
  console.log("");
  console.log("Hits grouped by reason:");
  if (Object.keys(reasons).length === 0) {
    console.log("  (none — every row is safe to render verbatim)");
  } else {
    for (const [reason, count] of Object.entries(reasons).sort(
      ([, a], [, b]) => b - a,
    )) {
      console.log(`  ${reason.padEnd(28)} ${count}`);
    }
  }
  console.log("");
  console.log("Action-type rollup (hidden / total):");
  for (const [type, { total, hidden }] of Object.entries(
    byActionType,
  ).sort(([, a], [, b]) => b.hidden - a.hidden)) {
    console.log(
      `  ${type.padEnd(28)} ${String(hidden).padStart(4)} / ${String(
        total,
      ).padStart(4)}`,
    );
  }
  console.log("");
  console.log("Up to 5 sample matches per reason (id · field · match):");
  for (const [reason, samples] of Object.entries(samplesByReason)) {
    console.log(`  [${reason}]`);
    for (const s of samples) {
      console.log(
        `    ${s.id.slice(0, 60)}${s.id.length > 60 ? "…" : ""}`,
      );
      console.log(`      ${s.field} match=${JSON.stringify(s.match)}`);
    }
  }
  console.log("");
  console.log("This script is READ-ONLY. No rows were modified.");
}

main().catch((err) => {
  console.error("audit failed:", err);
  process.exit(1);
});
