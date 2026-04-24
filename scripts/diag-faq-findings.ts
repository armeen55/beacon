/**
 * Phase C — read-only probe of pending faq_changed / schema_changed
 * findings on the blocker pages. Show what the Today UI is actually
 * surfacing.
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
  // Enumerate tables to find where findings live.
  const tables = [
    "findings",
    "scan_findings",
    "guardrail_alerts",
  ];
  console.log("── Finding-table probes ──");
  for (const t of tables) {
    const { count, error } = await sb
      .from(t)
      .select("*", { count: "exact", head: true });
    console.log(`  ${t}: ${error ? `err(${error.message.slice(0, 50)})` : `count=${count}`}`);
  }
  console.log();

  // Pull pending faq/schema findings.
  console.log("── pending faq_changed / schema_changed / schema_entity_names_changed findings ──");
  const { data, error } = await sb
    .from("findings")
    .select("id,type,status,severity,url,summary,previousState,currentState,detectedAt")
    .in("type", ["faq_changed", "schema_changed", "schema_entity_names_changed"])
    .eq("status", "pending")
    .order("detectedAt", { ascending: false })
    .limit(20);
  if (error) {
    console.log(`  ERROR: ${error.message}`);
    // Retry with snake_case (maybe column names differ).
    const { data: d2 } = await sb
      .from("findings")
      .select("*")
      .in("type", ["faq_changed", "schema_changed", "schema_entity_names_changed"])
      .eq("status", "pending")
      .limit(5);
    if (d2 && d2.length > 0) {
      console.log("  sample row keys:", Object.keys(d2[0]).sort().join(", "));
    }
  } else {
    for (const f of data ?? []) {
      console.log(
        `  [${(f.status as string).padEnd(8)}] ${f.type.padEnd(14)} ${(f.severity ?? "").padEnd(7)} ${f.url}`,
      );
      console.log(`    summary: ${f.summary}`);
      console.log(`    prev: ${f.previousState}`);
      console.log(`    curr: ${f.currentState}`);
      console.log(`    detectedAt: ${f.detectedAt}`);
      console.log();
    }
  }

  // All pending findings (any type) to see full set.
  console.log("── ALL pending findings (any type) ──");
  const { data: allPending, error: e2 } = await sb
    .from("findings")
    .select("id,type,status,url,summary")
    .eq("status", "pending")
    .limit(30);
  if (e2) console.log(`  ERROR: ${e2.message}`);
  else {
    const byType = new Map<string, number>();
    for (const f of allPending ?? []) {
      byType.set(f.type, (byType.get(f.type) ?? 0) + 1);
    }
    console.log(`  total: ${allPending?.length ?? 0}`);
    for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${n} × ${t}`);
    }
    console.log();
    console.log("  All pending rows:");
    for (const f of allPending ?? []) {
      console.log(`    ${f.type.padEnd(14)}  ${f.url}  — ${f.summary}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
