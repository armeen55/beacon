import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { writeFileSync } from "node:fs";
const OUT = process.env.SCRATCH + "/drafts.json";
const T = "tenant-iranopedia";
async function main() {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("move_drafts")
    .select("rec_id,kind,content,created_at")
    .eq("tenant_id", T)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) { console.error("ERR", error.message); process.exit(1); }
  const rows = (data ?? []) as Array<{ rec_id: string; kind: string; content: string; created_at: string }>;
  // keep latest per (rec_id,kind)
  const seen = new Set<string>();
  const latest: typeof rows = [];
  for (const r of rows) { const k = `${r.rec_id}::${r.kind}`; if (seen.has(k)) continue; seen.add(k); latest.push(r); }
  const byKind: Record<string, number> = {};
  for (const r of latest) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  console.log("TOTAL_ROWS", rows.length, "LATEST_UNIQUE", latest.length);
  console.log("BY_KIND", JSON.stringify(byKind));
  writeFileSync(OUT, JSON.stringify(latest, null, 2));
  console.log("WROTE", OUT);
}
main().then(() => process.exit(0)).catch((e) => { console.error("ERR", String(e).slice(0, 300)); process.exit(1); });
export {};
