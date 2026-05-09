/**
 * Phase 3.5B (2026-04-22) — one-shot backfill of the two operator-loop tables
 * that dual-write started tracking in Phase 1a but which never had their
 * historical local JSON state pushed up to Supabase.
 *
 *   recommendation_responses ← .data/recommendation-responses.json
 *   url_change_outcomes      ← .data/url-change-outcomes.json
 *
 * Safe to re-run: upserts on natural primary keys. Cleans nothing; only
 * inserts/updates.
 *
 * Usage: npx tsx scripts/backfill-operator-loop-stores.ts
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
      const [k, v] = [trimmed.slice(0, eq), trimmed.slice(eq + 1)];
      process.env[k] ??= v;
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

// Mirrors mapRecommendationResponseToRow in src/lib/persistence/dual-write.ts
function mapRecResponseToRow(r: {
  recId: string;
  status: string;
  respondedAt: string;
  deferUntil: string | null;
  targetPageUrl?: string | null;
  patternId?: string | null;
  tenant_id?: string | null;
}) {
  return {
    rec_id: r.recId,
    status: r.status,
    responded_at: r.respondedAt,
    defer_until: r.deferUntil,
    target_page_url: r.targetPageUrl ?? null,
    pattern_id: r.patternId ?? null,
    tenant_id: r.tenant_id ?? FALLBACK_TENANT_ID,
    updated_at: new Date().toISOString(),
  };
}

async function backfill<T>(args: {
  label: string;
  jsonPath: string;
  table: string;
  pk: string;
  mapper: (x: T) => Record<string, unknown>;
}) {
  const path = join(process.cwd(), args.jsonPath);
  if (!existsSync(path)) {
    console.log(`[${args.label}] SKIP — local file not found at ${path}`);
    return;
  }
  const rows = JSON.parse(readFileSync(path, "utf-8")) as T[];
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log(`[${args.label}] SKIP — empty or malformed JSON`);
    return;
  }
  console.log(`[${args.label}] upserting ${rows.length} rows into ${args.table} (PK=${args.pk})`);
  const mapped = rows.map(args.mapper);
  const CHUNK = 500;
  for (let i = 0; i < mapped.length; i += CHUNK) {
    const chunk = mapped.slice(i, i + CHUNK);
    const { error } = await sb.from(args.table).upsert(chunk, { onConflict: args.pk });
    if (error) {
      console.error(`[${args.label}] upsert ${i}..${i + chunk.length} failed:`, error.message);
      process.exit(1);
    }
    console.log(`[${args.label}] upserted ${i + chunk.length}/${mapped.length}`);
  }
  const { count } = await sb.from(args.table).select("*", { count: "exact", head: true });
  console.log(`[${args.label}] final row count in ${args.table}: ${count}`);
}

// Stage D3 (2026-05-09): require explicit BEACON_TENANT_ID so the
// backfill never silently defaults a row's tenant_id to empty string.
// Both mappers below fall back to this value when the JSON row carries
// no tenant_id (legacy pre-stamping rows).
const FALLBACK_TENANT_ID = process.env.BEACON_TENANT_ID;
if (!FALLBACK_TENANT_ID) {
  console.error(
    "[backfill-operator-loop-stores] BEACON_TENANT_ID env var is required " +
      "(e.g. BEACON_TENANT_ID=tenant-ritz-founder)",
  );
  process.exit(1);
}

async function main() {
  await backfill<{
    recId: string;
    status: string;
    respondedAt: string;
    deferUntil: string | null;
    targetPageUrl?: string | null;
    patternId?: string | null;
    tenant_id?: string | null;
  }>({
    label: "rec_responses",
    jsonPath: ".data/recommendation-responses.json",
    table: "recommendation_responses",
    pk: "rec_id",
    mapper: mapRecResponseToRow,
  });

  // url_change_outcomes: local JSON is already snake_case matching DB columns.
  // Pass through with a narrow whitelist so any extra client-side fields get
  // dropped (avoids unknown-column errors if the file drifted).
  await backfill<Record<string, unknown>>({
    label: "url_outcomes",
    jsonPath: ".data/url-change-outcomes.json",
    table: "url_change_outcomes",
    pk: "change_id,url",
    mapper: (o) => ({
      change_id: o.change_id,
      url: o.url,
      edit_type_tokens: Array.isArray(o.edit_type_tokens) ? o.edit_type_tokens : [],
      asset_type: o.asset_type,
      verdict: o.verdict,
      landing_day_n: o.landing_day_n ?? null,
      landing_z: o.landing_z ?? null,
      delta_pct: o.delta_pct ?? null,
      delta_abs: o.delta_abs ?? null,
      baseline_days_used: o.baseline_days_used ?? 0,
      post_days_used: o.post_days_used ?? 0,
      sustain_up: o.sustain_up ?? 0,
      sustain_down: o.sustain_down ?? 0,
      confidence: o.confidence,
      recorded_at: o.recorded_at,
      updated_at: o.updated_at ?? o.recorded_at,
      transitions: o.transitions ?? 0,
      tenant_id: o.tenant_id ?? FALLBACK_TENANT_ID,
    }),
  });

  console.log("Backfill complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
