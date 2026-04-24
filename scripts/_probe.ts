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

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data: sample } = await sb.from("scan_findings").select("*").limit(1);
  if (sample?.[0])
    console.log("Columns:", Object.keys(sample[0]).sort().join(", "));
  const { data: pending } = await sb
    .from("scan_findings")
    .select("*")
    .eq("status", "pending")
    .in("type", ["faq_changed", "schema_changed", "schema_entity_names_changed"])
    .limit(20);
  console.log("\npending faq/schema findings:", pending?.length ?? 0);
  for (const f of pending ?? []) {
    console.log(
      "  [" +
        (f as Record<string, unknown>).status +
        "] " +
        (f as Record<string, unknown>).type +
        "  url=" +
        (f as Record<string, unknown>).url,
    );
    console.log("    summary:", (f as Record<string, unknown>).summary);
    for (const k of ["previous_state", "current_state", "detected_at", "previousState", "currentState", "detectedAt"]) {
      const v = (f as Record<string, unknown>)[k];
      if (v) console.log(`    ${k}:`, v);
    }
  }
  const { data: all } = await sb
    .from("scan_findings")
    .select("type,url,status")
    .eq("status", "pending")
    .limit(100);
  const byType = new Map<string, number>();
  for (const f of all ?? [])
    byType.set(
      f.type as string,
      (byType.get(f.type as string) ?? 0) + 1,
    );
  console.log(
    "\nAll pending by type (top 100):",
    [...byType.entries()].map(([t, n]) => `${t}:${n}`).join(", "),
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
