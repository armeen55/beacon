/**
 * One-shot: find current dedupe pairs on hosted Supabase and mark each
 * archive-candidate as `dedupe_reviewed=true`. Operator explicitly asked
 * for a manual fix because the UI Phase B path isn't clearing them.
 *
 * Dry-run by default. Pass `--confirm` to actually write.
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

import { findDuplicatePairs } from "../src/domains/changelog/dedupe";
import type { ChangelogEntry } from "../src/domains/changelog/types";

async function pageAll<T>(table: string): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from(table).select("*").range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function main() {
  const confirm = process.argv.includes("--confirm");
  console.log(`── Dedupe one-shot mark (${confirm ? "CONFIRM" : "dry run"}) ──\n`);

  const entries = await pageAll<ChangelogEntry>("changelog_entries");
  console.log(`Total changelog_entries: ${entries.length}`);
  const active = entries.filter((e) => !e.archived && !e.dedupe_reviewed);
  console.log(
    `  active (not archived, not dedupe_reviewed): ${active.length}`,
  );

  // Show source_system distribution to sanity-check pairing sources.
  const bySource = new Map<string, number>();
  for (const e of active) {
    const s = e.source_system ?? "(null)";
    bySource.set(s, (bySource.get(s) ?? 0) + 1);
  }
  console.log("\n  source_system distribution (active):");
  for (const [s, n] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${n.toString().padStart(4, " ")} · ${s}`);
  }

  const pairs = findDuplicatePairs(entries);
  console.log(`\nfindDuplicatePairs: ${pairs.length} pair(s)\n`);

  if (pairs.length === 0) {
    console.log("  Nothing to mark. Exiting.");
    return;
  }

  for (const [i, p] of pairs.entries()) {
    console.log(`  Pair ${i + 1}:`);
    console.log(`    keeper    id=${p.keeper.id}  src=${p.keeper.source_system}  url=${p.keeper.url}`);
    console.log(`              desc="${(p.keeper.change_description ?? "").slice(0, 80)}"`);
    console.log(`    archive   id=${p.archiveCandidate.id}  src=${p.archiveCandidate.source_system}  url=${p.archiveCandidate.url}`);
    console.log(`              desc="${(p.archiveCandidate.change_description ?? "").slice(0, 80)}"`);
    console.log(`    daysApart=${p.daysApart.toFixed(1)}  shared=[${p.sharedTokens.join(",")}]`);
    console.log();
  }

  const archiveIds = pairs.map((p) => p.archiveCandidate.id);
  console.log(
    `Will mark ${archiveIds.length} archive-candidate id(s) as dedupe_reviewed=true:`,
  );
  for (const id of archiveIds) console.log(`  ${id}`);

  if (!confirm) {
    console.log("\n(dry run — use --confirm to write)");
    return;
  }

  const nowISO = new Date().toISOString();
  const { data: updated, error } = await sb
    .from("changelog_entries")
    .update({
      dedupe_reviewed: true,
      dedupe_reviewed_at: nowISO,
      updated_at: nowISO,
    })
    .in("id", archiveIds)
    .select("id, dedupe_reviewed, dedupe_reviewed_at");

  if (error) {
    console.error(`\nUPDATE failed: ${error.message}`);
    process.exit(1);
  }

  console.log(`\nUpdated ${updated?.length ?? 0} row(s):`);
  for (const row of updated ?? []) {
    console.log(`  ${row.id}  dedupe_reviewed=${row.dedupe_reviewed}  at=${row.dedupe_reviewed_at}`);
  }

  // Verify by re-reading
  const afterEntries = await pageAll<ChangelogEntry>("changelog_entries");
  const afterPairs = findDuplicatePairs(afterEntries);
  console.log(`\nVerification: findDuplicatePairs after update = ${afterPairs.length} pair(s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
