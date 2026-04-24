/**
 * Phase 5.5 — daily_metric_snapshots truth probe.
 * Read-only. No writes.
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

async function main() {
  console.log("── daily_metric_snapshots table state ──\n");

  // Total count
  const { count: total } = await sb
    .from("daily_metric_snapshots")
    .select("*", { count: "exact", head: true });
  console.log(`Total rows: ${total}`);

  // Column names (sample row)
  const { data: sample, error: sampleErr } = await sb
    .from("daily_metric_snapshots")
    .select("*")
    .limit(1);
  if (sampleErr) {
    console.log(`  sample error: ${sampleErr.message}`);
  } else if (sample?.[0]) {
    console.log(`Columns: ${Object.keys(sample[0]).sort().join(", ")}`);
  }

  // Rows by date for the last 10 days (try both 'date' and 'metric_date')
  console.log("\n── Rows by date (last 10 days) — using 'date' column ──");
  const { data: byDate } = await sb
    .from("daily_metric_snapshots")
    .select("date, source_type, scope_type, platform")
    .gte("date", "2026-04-15")
    .order("date", { ascending: false });
  const counts = new Map<string, number>();
  for (const r of byDate ?? []) {
    const key = `${(r.date as string)?.slice(0, 10)}|${r.source_type}|${r.scope_type}|${r.platform}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [k, n] of [...counts.entries()].sort().reverse().slice(0, 30)) {
    console.log(`  ${n.toString().padStart(4, " ")} · ${k}`);
  }

  // Specifically check for derived rows (source_type='derived') on Apr 22-24
  console.log("\n── source_type='derived' rows on 2026-04-22..2026-04-24 ──");
  const { data: derivedRecent } = await sb
    .from("daily_metric_snapshots")
    .select("id, date, source_type, scope_type, platform")
    .eq("source_type", "derived")
    .gte("date", "2026-04-22")
    .order("date", { ascending: false });
  console.log(`  count: ${derivedRecent?.length ?? 0}`);
  for (const r of (derivedRecent ?? []).slice(0, 10)) {
    console.log(`  ${r.date} ${r.scope_type.padEnd(10)} ${r.platform.padEnd(12)} ${r.id}`);
  }

  // Last successful derivation date
  console.log("\n── Most recent derived date ──");
  const { data: lastDerived } = await sb
    .from("daily_metric_snapshots")
    .select("date")
    .eq("source_type", "derived")
    .order("date", { ascending: false })
    .limit(1);
  console.log(`  ${lastDerived?.[0]?.date ?? "NONE"}`);

  // Source type distribution
  console.log("\n── source_type distribution ──");
  const { data: srcs } = await sb
    .from("daily_metric_snapshots")
    .select("source_type");
  const srcCounts = new Map<string, number>();
  for (const s of srcs ?? []) {
    srcCounts.set(s.source_type, (srcCounts.get(s.source_type) ?? 0) + 1);
  }
  for (const [k, n] of srcCounts) console.log(`  ${k}: ${n}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
