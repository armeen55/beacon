/**
 * Ground-truth the D2 native-teardown lane on the REAL 24 native observation
 * rows (D1's 8-prompt poll) for tenant-iranopedia (2026-07-02).
 *
 * Not a product surface - a one-off proof that:
 *   1. planNativeCitedTargets finds real cited pages per prompt from the poll,
 *   2. auditNativeCitedTargets politely tears them down (14d cache-aware),
 *   3. buildCommonalityBrief finds a real consensus (or honestly returns null
 *      when fewer than 2 pages were fetchable for a prompt),
 *   4. routeGapVerdict routes each prompt to atomic_edit / new_page / no_verdict.
 *
 * Run (env sourced first so Supabase reads actually work):
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-native-teardown.ts
 */

import { runNativeTeardownForTenant } from "@/domains/demand-graph/native-teardown-runner";

const TENANT_ID = "tenant-iranopedia";

async function main() {
  console.log(`\n=== D2 ground-truth: native-cited teardown + commonality for ${TENANT_ID} ===\n`);

  const summary = await runNativeTeardownForTenant(TENANT_ID, { maxPrompts: 10 });

  console.log(`Prompts analyzed: ${summary.promptsAnalyzed}`);
  console.log(`Pages torn down (fetchStatus ok): ${summary.torndownPages}`);
  console.log(`From cache: ${summary.fromCache}`);
  console.log("");

  if (summary.promptsAnalyzed === 0) {
    console.log("No native-poll prompts with usable cited pages were found - nothing to tear down.");
    return;
  }

  console.log("=== Verdict table ===");
  console.log("promptId | outcome | pages torn down (ok/total) | brief? ");
  for (const r of summary.results) {
    const ok = r.audits.filter((a) => a.fetchStatus === "ok").length;
    console.log(
      `${r.promptId} | ${r.verdict.outcome} | ${ok}/${r.audits.length} | ${r.brief ? "yes (" + r.brief.sourceCount + " sources)" : "no"}`,
    );
  }
  console.log("");

  const withBrief = summary.results.find((r) => r.brief);
  if (withBrief) {
    console.log(`=== ONE real CommonalityBrief (prompt: "${withBrief.promptText}") ===`);
    console.log(JSON.stringify(withBrief.brief, null, 2));
    console.log("");
    console.log("Rendered sentence (operator-journey quote):");
    console.log(`"${withBrief.verdict.renderedSentence}"`);
    console.log("");
    if (withBrief.verdict.atomicEdit) {
      console.log("Atomic edit brief rationale (as it would render on the edit move detail):");
      console.log(`"${withBrief.verdict.atomicEdit.rationale}"`);
    }
    if (withBrief.verdict.newPage) {
      console.log("New-page commonality rationale (as it would render on the new-pages card):");
      console.log(`"${withBrief.verdict.newPage.rationale}"`);
    }
  } else {
    console.log("No prompt had 2+ fetchable competitor pages this run (honest null brief for all) -");
    console.log("printing the raw per-prompt targets + audit statuses for diagnosis instead:");
    for (const r of summary.results) {
      console.log(`\n${r.promptId} ("${r.promptText}")`);
      console.log(`  targets: ${JSON.stringify(r.targets)}`);
      for (const a of r.audits) {
        console.log(`  - ${a.url} -> ${a.fetchStatus}${a.httpStatus ? ` (http ${a.httpStatus})` : ""}${a.error ? ` [${a.error}]` : ""}`);
      }
      console.log(`  verdict: ${r.verdict.outcome}${r.verdict.reason ? ` (${r.verdict.reason})` : ""}`);
    }
  }

  console.log("\n=== Full verdicts summary ===");
  console.log(JSON.stringify(summary.verdicts, null, 2));
}

main().catch((e) => {
  console.error("Ground-truth run failed:", e);
  process.exit(1);
});
