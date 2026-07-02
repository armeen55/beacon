/** Ground-truth probe (item 26): mine REAL prompt_answer_observations +
 *  answer_texts for a tenant, print the real citation-pattern profile, then
 *  join the item-7 crawl-citation funnel + the citability rubric over cached
 *  page_snapshots text to show which pages the "make it quotable" lever
 *  would target tonight. Read-only unless --persist is passed (writes the
 *  mined profile to the citability-pattern-profile store).
 *  Run: set -a; . ./.env.local; set +a; BEACON_TENANT_ID=tenant-iranopedia \
 *       npx tsx --require ./scripts/mock-server-only.cjs scripts/_citability-probe.ts */
import { mineAnswerPatterns } from "@/domains/citability/mine-answer-patterns";
import { writePatternProfile } from "@/domains/citability/citability-store";
import { scorePageCitability } from "@/domains/citability/citability-score";
import { buildCitabilityHintNotes } from "@/domains/citability/citability-hints";
import { loadCrawlCitationFunnel } from "@/domains/ai-visibility/load-crawl-citation-funnel";
import { getPageSnapshots } from "@/domains/pages/snapshot-store";
import { getTenant } from "@/domains/tenants/store";

const pathOf = (u: string) => (u.replace(/^https?:\/\/[^/]+/, "") || "/").replace(/[?#].*$/, "").replace(/\/$/, "") || "/";

async function main() {
  const tenantId = process.env.BEACON_TENANT_ID;
  if (!tenantId) throw new Error("set BEACON_TENANT_ID");

  const t0 = Date.now();
  const profile = await mineAnswerPatterns(tenantId);
  const mineMs = Date.now() - t0;
  console.log("=== Mined citation-pattern profile ===");
  console.log(JSON.stringify({ tenantId, mineMs, ...profile }, null, 2));

  if (process.argv.includes("--persist")) {
    await writePatternProfile(profile);
    console.log("persisted pattern profile for", tenantId);
  }

  // Join the item-7 funnel + rubric over cached page text to find real lever targets.
  const tenant = await getTenant(tenantId).catch(() => null);
  const slug = tenant?.slug ?? "";
  if (!slug) {
    console.log("\n=== Lever targets ===\nno tenant slug resolvable, skipping funnel join");
    return;
  }
  const [funnel, snaps] = await Promise.all([
    loadCrawlCitationFunnel(tenantId, slug),
    getPageSnapshots(),
  ]);
  const textByPath = new Map<string, string>();
  for (const s of snaps as Array<{ url?: string; page?: string; title: string | null; h1: string | null; body_paragraph_sample?: string[] }>) {
    const u = s.url ?? s.page;
    if (!u) continue;
    const text = [s.title, s.h1, ...(s.body_paragraph_sample ?? [])].filter(Boolean).join(". ");
    if (text.trim()) textByPath.set(pathOf(u), text);
  }
  console.log("\n=== Funnel ===");
  console.log(JSON.stringify({ hasData: funnel.hasData, feeds: funnel.feeds, stageCounts: funnel.stageCounts, stalledCount: funnel.stalled.length }, null, 2));

  console.log("\n=== Top 10 stalled pages (funnel) with citability score ===");
  for (const p of funnel.stalled.slice(0, 10)) {
    const text = textByPath.get(p.pagePath);
    const score = text ? scorePageCitability(text) : null;
    console.log(
      JSON.stringify({
        path: p.pagePath,
        stage: p.stage,
        demand: p.demand,
        citedCount: p.cited.count,
        hasText: !!text,
        score: score?.score ?? null,
        missingPatterns: score?.missingPatterns ?? null,
      }),
    );
  }

  const hints = buildCitabilityHintNotes(funnel, textByPath);
  console.log("\n=== Citability lever hints (bounded, max 2/night) ===");
  console.log(JSON.stringify([...hints.entries()], null, 2));
}

main().catch((e) => {
  console.error("probe failed:", e);
  process.exit(1);
});
