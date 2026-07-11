/**
 * Step 0: immutable validation snapshot (protocol L12).
 *
 * Copies the tenant's FINALIZED daily rows (gsc_daily_page_totals and
 * gsc_daily_totals) plus the full shipped_change_proof ledger into
 * PROOFVAL_DIR/snapshot-<runId>/ as json, records min/max date, row counts
 * and SHA-256 hashes in manifest.json. READ ONLY against production; every
 * later step reads the snapshot, never the database.
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PROOFVAL_DIR.
 */

import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { normalizePathKey } from "@/domains/proof-gsc/validation/series";
import type { SnapshotDailyRow } from "@/domains/proof-gsc/validation/types";
import {
  RUN_ID,
  TENANT_ID,
  appendFreezeLog,
  sha256OfFile,
  snapshotDir,
  writeJson,
  type RawLedgerRow,
  type SnapshotManifest,
  type TotalsRow,
} from "./lib";

const PAGE_SIZE = 1000;

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing (load .env.local first)");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const dir = snapshotDir();

  // Page-day rows, finalized only, paged deterministically.
  const pageRows: SnapshotDailyRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await sb
      .from("gsc_daily_page_totals")
      .select("date,page,clicks,impressions,position,is_final")
      .eq("tenant_id", TENANT_ID)
      .eq("is_final", true)
      .order("date", { ascending: true })
      .order("page", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`page totals read failed at ${from}: ${error.message}`);
    for (const r of data ?? []) {
      pageRows.push({
        path: normalizePathKey(String(r.page)),
        date: String(r.date).slice(0, 10),
        clicks: Number(r.clicks) || 0,
        impressions: Number(r.impressions) || 0,
        position: Number(r.position) || 0,
      });
    }
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  pageRows.sort((a, b) => a.date.localeCompare(b.date) || a.path.localeCompare(b.path));

  const { data: totalsData, error: totalsError } = await sb
    .from("gsc_daily_totals")
    .select("date,clicks,impressions,is_final")
    .eq("tenant_id", TENANT_ID)
    .eq("is_final", true)
    .order("date", { ascending: true });
  if (totalsError) throw new Error(`daily totals read failed: ${totalsError.message}`);
  const totals: TotalsRow[] = (totalsData ?? []).map((r) => ({
    date: String(r.date).slice(0, 10),
    clicks: Number(r.clicks) || 0,
    impressions: Number(r.impressions) || 0,
  }));

  const { data: ledgerData, error: ledgerError } = await sb
    .from("shipped_change_proof")
    .select(
      "id,page,path,action_type,shipped_at,verdict,confidence,baseline,control_pages,windows,verified_live,live_source_url,operator_verdict_override,control_donor_pool,verify_state,measured_at,calibration_version",
    )
    .eq("tenant_id", TENANT_ID)
    .order("id", { ascending: true });
  if (ledgerError) throw new Error(`ledger read failed: ${ledgerError.message}`);
  const ledger = (ledgerData ?? []) as RawLedgerRow[];

  const dates = pageRows.map((r) => r.date);
  const minDate = dates[0]!;
  const maxDate = dates[dates.length - 1]!;

  const files = {
    "pages-daily.json": pageRows,
    "totals-daily.json": totals,
    "ledger.json": ledger,
  } as const;
  const hashes: SnapshotManifest["files"] = {};
  for (const [name, value] of Object.entries(files)) {
    const p = join(dir, name);
    writeJson(p, value);
    hashes[name] = { sha256: sha256OfFile(p) };
  }

  const manifest: SnapshotManifest = {
    runId: RUN_ID,
    tenantId: TENANT_ID,
    createdAt: new Date().toISOString(),
    minDate,
    maxDate,
    pageDailyRowCount: pageRows.length,
    totalsRowCount: totals.length,
    ledgerRowCount: ledger.length,
    files: hashes,
  };
  const manifestPath = join(dir, "manifest.json");
  writeJson(manifestPath, manifest);
  appendFreezeLog({
    step: "step0",
    at: manifest.createdAt,
    file: manifestPath,
    sha256: sha256OfFile(manifestPath),
    note: `snapshot ${minDate}..${maxDate}, ${pageRows.length} page-day rows, ${totals.length} totals rows, ${ledger.length} ledger rows`,
  });

  console.log(`[step0] snapshot ${RUN_ID}`);
  console.log(`  range      ${minDate} .. ${maxDate}`);
  console.log(`  page rows  ${pageRows.length}`);
  console.log(`  totals     ${totals.length}`);
  console.log(`  ledger     ${ledger.length}`);
  for (const [name, h] of Object.entries(hashes)) console.log(`  ${name} sha256 ${h.sha256}`);
}

main().catch((e) => {
  console.error("[step0] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
