/**
 * Post-flip verification: BEACON_AUTO_LINK_FINDINGS=1 on production.
 * Read-only. Runs every SQL check from the verification checklist.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) process.env[t.slice(0, eq)] ??= t.slice(eq + 1);
  }
}
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function section(title: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n══════ ${title} ══════`);
  await fn();
}

async function main() {
  // ── 1. No pending finding has source_rec_id (retroactive-link check) ──
  await section(
    "Check #1: Any pending finding with source_rec_id? (Expected: 0)",
    async () => {
      const { data, error } = await sb
        .from("scan_findings")
        .select("id, type, url, source_rec_id, linked_change_id, status, detected_at")
        .eq("status", "pending")
        .not("source_rec_id", "is", null);
      if (error) {
        console.log(`  ERR: ${error.message}`);
        return;
      }
      console.log(`  rows: ${data?.length ?? 0}`);
      for (const r of data ?? []) {
        console.log(`    ${r.type.padEnd(14)} ${r.url}  rec=${r.source_rec_id}`);
      }
    },
  );

  // ── 2. The original 5 pre-Phase-C findings ──
  await section(
    "Check #2: The original 5 findings detected 2026-04-22T18:21:08",
    async () => {
      const { data, error } = await sb
        .from("scan_findings")
        .select(
          "id, type, url, detected_at, source_rec_id, linked_change_id, status, summary",
        )
        .eq("detected_at", "2026-04-22T18:21:08.931+00:00")
        .order("url");
      if (error) {
        console.log(`  ERR: ${error.message}`);
        return;
      }
      console.log(`  rows: ${data?.length ?? 0}`);
      for (const r of data ?? []) {
        console.log(
          `    [${r.status.padEnd(8)}] ${r.type.padEnd(14)} ${r.url}`,
        );
        console.log(`      summary: ${r.summary}`);
        console.log(
          `      source_rec_id=${r.source_rec_id ?? "null"}  linked_change_id=${r.linked_change_id ?? "null"}`,
        );
      }
    },
  );

  // ── 3. Recent Accept-sourced changelog entries ──
  await section(
    "Check #3: Most recent recommendation-sourced changelog entries (any Accept happened yet?)",
    async () => {
      const { data, error } = await sb
        .from("changelog_entries")
        .select(
          "id, timestamp, url, hypothesis_source, source_rec_id, signal_type, asset_name, change_description, created_at",
        )
        .eq("hypothesis_source", "recommendation")
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) {
        console.log(`  ERR: ${error.message}`);
        return;
      }
      console.log(`  rows: ${data?.length ?? 0}`);
      for (const r of data ?? []) {
        console.log(
          `    created=${r.created_at?.slice(0, 19)}Z  signal=${r.signal_type}  url=${r.url}`,
        );
        console.log(
          `      rec=${r.source_rec_id}  asset=${r.asset_name}`,
        );
        console.log(`      desc: ${(r.change_description ?? "").slice(0, 80)}`);
      }
    },
  );

  // ── 4. Most recent findings across all statuses ──
  await section(
    "Check #4: Most recent 10 scan_findings (any auto-accepted with status=accepted + source_rec_id?)",
    async () => {
      const { data, error } = await sb
        .from("scan_findings")
        .select(
          "id, type, url, status, detected_at, source_rec_id, linked_change_id, resolution_note",
        )
        .order("detected_at", { ascending: false })
        .limit(10);
      if (error) {
        console.log(`  ERR: ${error.message}`);
        return;
      }
      for (const r of data ?? []) {
        const auto =
          r.source_rec_id || r.linked_change_id ? "  [auto-link metadata]" : "";
        console.log(
          `    ${r.detected_at.slice(0, 19)}Z [${r.status.padEnd(8)}] ${r.type.padEnd(14)} ${r.url ?? ""}${auto}`,
        );
        if (r.resolution_note) {
          console.log(`      resolution_note: ${r.resolution_note}`);
        }
      }
    },
  );

  // ── 5. Auto-accepted findings — old Path 1 contamination check ──
  await section(
    "Check #5: Any finding auto-accepted via resolution_note starting with 'Auto-linked'? (Expected: 0 — Path 1 retired)",
    async () => {
      const { data, error } = await sb
        .from("scan_findings")
        .select("id, type, url, status, resolution_note, detected_at")
        .ilike("resolution_note", "Auto-linked%");
      if (error) {
        console.log(`  ERR: ${error.message}`);
        return;
      }
      console.log(`  rows: ${data?.length ?? 0}`);
      for (const r of data ?? []) {
        console.log(`    ${r.detected_at.slice(0, 19)}Z  ${r.type}  ${r.url}`);
        console.log(`      note: ${r.resolution_note}`);
      }
      if (!data || data.length === 0) {
        console.log("  (clean — no legacy Path 1 auto-accepts in the table)");
      }
    },
  );

  // ── 6. Recent scan_runs to see if any scan ran after the flip ──
  await section(
    "Check #6: Recent observation_runs to see if any scan happened post-flip",
    async () => {
      const { data, error } = await sb
        .from("observation_runs")
        .select("run_id, source, started_at, completed_at, status, scope_label")
        .gte("started_at", "2026-04-24T17:00:00Z")
        .order("started_at", { ascending: false })
        .limit(10);
      if (error) {
        console.log(`  ERR: ${error.message}`);
        return;
      }
      console.log(`  rows: ${data?.length ?? 0}`);
      for (const r of data ?? []) {
        console.log(
          `    ${r.started_at.slice(0, 19)}Z  ${r.source.padEnd(25)} ${r.status.padEnd(10)} ${r.scope_label}`,
        );
      }
      if (!data || data.length === 0) {
        console.log(
          "  (no polls/scans started after 17:00 UTC — flip is post-cron)",
        );
      }
    },
  );

  console.log("\n── Summary: read only, no writes made. ──");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
