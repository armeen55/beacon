/**
 * Phase Auto-Link Audit — read-only probe.
 * Check which recs are currently accepted on hosted + whether any URL
 * overlaps the 5 active FAQ findings (determines whether those findings
 * are already stamped with source_rec_id via Path 2).
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

const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;

function pathOf(url: string | null | undefined): string {
  if (!url) return "";
  return url
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

async function main() {
  console.log("── Accepted recommendations (last 14 days) ──\n");

  const { data: accepted, error: ae } = await sb
    .from("recommendation_responses")
    .select("rec_id, status, responded_at, target_page_url, pattern_id")
    .eq("status", "accepted")
    .order("responded_at", { ascending: false });
  if (ae) {
    console.log(`  ERR: ${ae.message}`);
    return;
  }

  const nowMs = Date.now();
  const active = (accepted ?? []).filter((r) => {
    if (!r.responded_at) return false;
    const t = Date.parse(r.responded_at);
    return Number.isFinite(t) && nowMs - t <= FOURTEEN_DAYS;
  });
  console.log(`  ${active.length} accepted recs within 14d window\n`);
  for (const r of active) {
    console.log(
      `  ${r.responded_at?.slice(0, 19)}Z  rec=${r.rec_id}  target=${r.target_page_url ?? "(null)"}`,
    );
  }

  const targetPaths = new Set(
    active.map((r) => pathOf(r.target_page_url)).filter(Boolean),
  );

  console.log("\n── Current 5 FAQ/schema findings (pending) ──\n");
  const { data: findings } = await sb
    .from("scan_findings")
    .select("id,type,url,status,summary,detected_at,source_rec_id,source_pattern_id")
    .in("type", ["faq_changed", "schema_changed"])
    .eq("status", "pending")
    .order("detected_at", { ascending: false });

  for (const f of findings ?? []) {
    const p = pathOf(f.url);
    const wouldLink = targetPaths.has(p);
    console.log(
      `  ${f.type.padEnd(14)} ${f.url}\n` +
        `    summary: ${f.summary}\n` +
        `    detected_at: ${f.detected_at}\n` +
        `    source_rec_id: ${f.source_rec_id ?? "(null)"}\n` +
        `    URL in accepted-rec set: ${wouldLink}\n`,
    );
  }

  console.log("\n── recommendation_responses column shape ──");
  const { data: sample } = await sb
    .from("recommendation_responses")
    .select("*")
    .limit(1);
  if (sample?.[0]) {
    console.log(
      "  cols:",
      Object.keys(sample[0]).sort().join(", "),
    );
  }

  // Also dump scan_findings row schema so we know what's carried.
  console.log("\n── scan_findings sample keys ──");
  const { data: sf } = await sb
    .from("scan_findings")
    .select("*")
    .limit(1);
  if (sf?.[0]) {
    console.log("  cols:", Object.keys(sf[0]).sort().join(", "));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
