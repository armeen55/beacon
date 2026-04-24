/**
 * Sprint 2.1 (2026-04-24) — FAQ finding copy migration (DRY-RUN ONLY).
 *
 * Pre-Phase-C `faq_changed` findings emitted a single flat summary —
 * "Q&A blocks disappeared from /services (was 10)" or "Q&A count changed:
 * 16 → 8" — that conflated visible-FAQ-removal, schema-removal-only, and
 * duplicate-schema-cleanup. Phase C shipped classifyFaqChange() which
 * produces five honest cases: visible_removed, schema_removed_visible_present,
 * duplicate_schema_cleanup, expanded, structure_changed.
 *
 * This script re-classifies pending faq_changed findings against the new
 * classifier and reports what the summary/suggestedAction would become.
 * It makes ZERO writes. A future pass with explicit operator go-ahead can
 * persist the changes via the existing dual-write path.
 *
 * Scope per operator directive:
 *   - Only status='pending' findings (resolved findings stay as they are
 *     to preserve the historical record unless a strong reason arises).
 *   - Zero writes. Dry-run only.
 *
 * Usage: npx tsx scripts/migrate-faq-finding-copy.ts
 */

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PageSnapshot } from "@/domains/pages/types";
import { classifyFaqChange } from "@/domains/scanning/faq-change-classifier";

// ── Load .env.local ──
const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) process.env[t.slice(0, eq)] ??= t.slice(eq + 1);
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

type FindingRow = {
  id: string;
  type: string;
  status: string;
  url: string;
  detected_at: string;
  scan_run_id: string;
  summary: string | null;
  suggested_action: string | null;
  severity: string;
  previous_state: string | null;
  current_state: string | null;
};

type SnapshotRow = PageSnapshot & {
  fetched_at: string;
  observation_run_id?: string;
};

function fmtLabel(s: string | null | undefined): string {
  if (!s) return "(empty)";
  return s.length > 140 ? s.slice(0, 137) + "..." : s;
}

async function fetchPendingFaqFindings(): Promise<FindingRow[]> {
  const { data, error } = await sb
    .from("scan_findings")
    .select(
      "id,type,status,url,detected_at,scan_run_id,summary,suggested_action,severity,previous_state,current_state",
    )
    .eq("type", "faq_changed")
    .eq("status", "pending")
    .order("detected_at", { ascending: false });
  if (error) {
    throw new Error(`scan_findings query failed: ${error.message}`);
  }
  return (data as FindingRow[]) ?? [];
}

async function fetchSnapshotsForUrl(url: string): Promise<SnapshotRow[]> {
  const { data, error } = await sb
    .from("page_snapshots")
    .select("*")
    .eq("url", url)
    .order("fetched_at", { ascending: false })
    .limit(50);
  if (error) {
    throw new Error(
      `page_snapshots query failed for ${url}: ${error.message}`,
    );
  }
  return (data as SnapshotRow[]) ?? [];
}

function pickCurrAndPrev(
  finding: FindingRow,
  snapshots: SnapshotRow[],
): { curr: SnapshotRow | null; prev: SnapshotRow | null; reason: string } {
  if (snapshots.length === 0) {
    return { curr: null, prev: null, reason: "no snapshots on URL" };
  }

  // Try: curr by matching scan_run_id (exact run that produced the finding).
  let curr =
    snapshots.find((s) => s.observation_run_id === finding.scan_run_id) ??
    null;

  // Fallback: newest snapshot at or before detected_at.
  if (!curr) {
    const detectedMs = new Date(finding.detected_at).getTime();
    const atOrBefore = snapshots
      .filter((s) => new Date(s.fetched_at).getTime() <= detectedMs + 60_000)
      .sort(
        (a, b) =>
          new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime(),
      );
    curr = atOrBefore[0] ?? null;
  }

  if (!curr) {
    return {
      curr: null,
      prev: null,
      reason: `no snapshot matches scan_run_id=${finding.scan_run_id} nor is at-or-before detected_at=${finding.detected_at}`,
    };
  }

  const currFetchedMs = new Date(curr.fetched_at).getTime();
  const prev =
    snapshots
      .filter((s) => new Date(s.fetched_at).getTime() < currFetchedMs)
      .sort(
        (a, b) =>
          new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime(),
      )[0] ?? null;

  if (!prev) {
    return {
      curr,
      prev: null,
      reason: "no prior snapshot before curr — can't re-classify",
    };
  }

  return { curr, prev, reason: "" };
}

async function main() {
  console.log("── Sprint 2.1 migrate-faq-finding-copy — DRY-RUN ONLY ──");
  console.log();

  const findings = await fetchPendingFaqFindings();
  console.log(`Pending faq_changed findings in Supabase: ${findings.length}`);
  console.log();

  if (findings.length === 0) {
    console.log(
      "Nothing to migrate. All existing faq_changed findings are already\n" +
        "resolved (accepted/rejected/ignored). Per operator directive for\n" +
        "Sprint 2, resolved findings are left alone.",
    );
    console.log();

    // Report broader context for situational awareness — not actionable
    // within Sprint 2 scope.
    const { data: byStatus } = await sb
      .from("scan_findings")
      .select("status")
      .eq("type", "faq_changed");
    const counts: Record<string, number> = {};
    for (const row of (byStatus as { status: string }[]) ?? []) {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
    }
    console.log("── Context: all faq_changed findings by status ──");
    for (const [s, n] of Object.entries(counts).sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`  ${s}: ${n}`);
    }
    console.log();
    console.log("Done.");
    return;
  }

  const stats = {
    reclassified: 0,
    skippedNoSnapshots: 0,
    skippedNoPrev: 0,
    unchanged: 0,
  };

  for (const f of findings) {
    console.log(`┌── ${f.id}`);
    console.log(`│   url: ${f.url}`);
    console.log(`│   detected_at: ${f.detected_at}`);
    console.log(`│   OLD summary: ${fmtLabel(f.summary)}`);
    console.log(`│   OLD suggested_action: ${fmtLabel(f.suggested_action)}`);
    console.log(`│   OLD severity: ${f.severity}`);

    const snapshots = await fetchSnapshotsForUrl(f.url);
    const { curr, prev, reason } = pickCurrAndPrev(f, snapshots);

    if (!curr && !prev) {
      console.log(`│   SKIP: ${reason}`);
      stats.skippedNoSnapshots += 1;
      console.log(`└──`);
      console.log();
      continue;
    }
    if (!prev) {
      console.log(`│   SKIP: ${reason}`);
      stats.skippedNoPrev += 1;
      console.log(`└──`);
      console.log();
      continue;
    }

    const c = classifyFaqChange(prev, curr!);
    const changed =
      c.summary !== (f.summary ?? "") ||
      c.suggestedAction !== (f.suggested_action ?? "");

    console.log(`│   NEW kind: ${c.kind}`);
    console.log(`│   NEW summary: ${fmtLabel(c.summary)}`);
    console.log(`│   NEW suggested_action: ${fmtLabel(c.suggestedAction)}`);
    console.log(`│   NEW severity: ${c.severity}`);
    console.log(
      `│   evidence: prevTotal=${c.evidence.prevTotal} currTotal=${c.evidence.currTotal} prevBlocks=${c.evidence.prevBlocks} currBlocks=${c.evidence.currBlocks}`,
    );
    console.log(`│   would_change_copy: ${changed ? "YES" : "no"}`);
    if (changed) stats.reclassified += 1;
    else stats.unchanged += 1;
    console.log(`└──`);
    console.log();
  }

  console.log("── Summary ──");
  console.log(`  Pending faq_changed findings: ${findings.length}`);
  console.log(`  Would reclassify (copy changes): ${stats.reclassified}`);
  console.log(`  Unchanged (already Phase-C copy): ${stats.unchanged}`);
  console.log(
    `  Skipped — no snapshots on URL: ${stats.skippedNoSnapshots}`,
  );
  console.log(
    `  Skipped — no prior snapshot to diff against: ${stats.skippedNoPrev}`,
  );
  console.log();
  console.log("No writes performed. Dry-run only.");
}

main().catch((e) => {
  console.error("migration failed:", e);
  process.exit(1);
});
