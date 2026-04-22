/**
 * One-shot backfill of `.data/scan-findings.json` → Supabase `scan_findings`.
 *
 * Reason (Phase 1a, 2026-04-21): DB has 63 rows vs JSON has 130. The drift
 * happened before `scan_findings` was added to dual-write and the delta never
 * got pushed. This script reconciles by upserting ALL local findings with the
 * current mapper shape (now carrying source_rec_id / source_pattern_id /
 * tenant_id).
 *
 * Safe to re-run: upsert on `id` primary key; no data loss.
 *
 * Usage: npx tsx scripts/backfill-scan-findings.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, serviceKey);

type Finding = Record<string, unknown> & {
  id: string;
  pagePath?: string | null;
  detectedAt?: string | null;
  scanRunId?: string | null;
  previousState?: string | null;
  currentState?: string | null;
  priorityScore?: number | null;
  suggestedAction?: string | null;
  resolvedAt?: string | null;
  linkedChangeId?: string | null;
  promotionStatus?: string | null;
  resolutionNote?: string | null;
  suppressUntil?: string | null;
  citationCount?: number | null;
  isHomepage?: boolean | null;
  contradictsChangelog?: boolean | null;
  metricMovementDetected?: boolean | null;
  signalStrength?: number | null;
  source_rec_id?: string | null;
  source_pattern_id?: string | null;
  tenant_id?: string | null;
};

function mapFindingToRow(f: Finding): Record<string, unknown> {
  return {
    id: f.id,
    type: f.type,
    url: f.url,
    page_path: f.pagePath ?? null,
    detected_at: f.detectedAt ?? null,
    scan_run_id: f.scanRunId ?? null,
    previous_state: f.previousState ?? null,
    current_state: f.currentState ?? null,
    severity: f.severity ?? null,
    priority: f.priority ?? null,
    priority_score: f.priorityScore ?? null,
    summary: f.summary ?? null,
    suggested_action: f.suggestedAction ?? null,
    status: f.status,
    resolved_at: f.resolvedAt ?? null,
    linked_change_id: f.linkedChangeId ?? null,
    promotion_status: f.promotionStatus ?? null,
    resolution_note: f.resolutionNote ?? null,
    suppress_until: f.suppressUntil ?? null,
    citation_count: f.citationCount ?? 0,
    is_homepage: f.isHomepage ?? false,
    contradicts_changelog: f.contradictsChangelog ?? false,
    metric_movement_detected: f.metricMovementDetected ?? null,
    signal_strength: f.signalStrength ?? null,
    source_rec_id: f.source_rec_id ?? null,
    source_pattern_id: f.source_pattern_id ?? null,
    tenant_id: f.tenant_id ?? "",
  };
}

async function main() {
  const path = join(process.cwd(), ".data", "scan-findings.json");
  const findings = JSON.parse(readFileSync(path, "utf-8")) as Finding[];
  console.log(`Reading ${findings.length} findings from ${path}`);

  const rows = findings.map(mapFindingToRow);
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await sb.from("scan_findings").upsert(chunk, { onConflict: "id" });
    if (error) {
      console.error(`Upsert ${i}-${i + chunk.length} failed:`, error.message);
      process.exit(1);
    }
    console.log(`Upserted ${i + chunk.length}/${rows.length}`);
  }

  const { count } = await sb
    .from("scan_findings")
    .select("*", { count: "exact", head: true });
  console.log(`Supabase scan_findings row count after backfill: ${count}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
