import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath))
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) process.env[t.slice(0, eq)] ??= t.slice(eq + 1);
  }
async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data: recent } = await sb
    .from("scan_findings")
    .select(
      "id,type,url,status,resolution_note,resolved_at,updated_at,detected_at,promotion_status,linked_change_id",
    )
    .gte("updated_at", "2026-04-24T18:00:00Z")
    .order("updated_at", { ascending: false })
    .limit(20);
  console.log(
    `scan_findings updated after 18:00 UTC: ${recent?.length ?? 0}`,
  );
  for (const r of recent ?? []) {
    console.log(
      `  ${(r.updated_at as string).slice(0, 19)}Z [${r.status}] ${r.type.padEnd(14)} ${r.url}`,
    );
    console.log(
      `    promotion=${r.promotion_status}  linked=${r.linked_change_id || "null"}  note=${(r.resolution_note || "").slice(0, 80)}`,
    );
  }
  const { data: recentCL } = await sb
    .from("changelog_entries")
    .select(
      "id,timestamp,url,signal_type,source_system,hypothesis_source,source_rec_id,created_at",
    )
    .gte("created_at", "2026-04-24T18:00:00Z")
    .order("created_at", { ascending: false })
    .limit(10);
  console.log(
    `\nchangelog_entries created after 18:00 UTC: ${recentCL?.length ?? 0}`,
  );
  for (const r of recentCL ?? [])
    console.log(
      `  ${(r.created_at as string).slice(0, 19)}Z  signal=${r.signal_type}  source_sys=${r.source_system || "null"}  hyp=${r.hypothesis_source || "null"}  url=${r.url}`,
    );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
