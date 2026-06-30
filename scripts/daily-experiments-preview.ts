/**
 * Native Daily-Experiments preview (Phase 11) — runs the in-app engine end-to-end. Read-only,
 * $0, NO proof rows, NO Wix. Excludes the active animal batch + its 17 controls via the
 * eligibility model; selects a diversified next batch from unrelated families.
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/daily-experiments-preview.ts
 */
import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { loadProofLedger } from "@/domains/proof-gsc/load-ledger";
import { buildDailyCandidates, type GscPageInput, type PageFacts } from "@/domains/experiments/build-daily-candidates";
import { planDailyExperiments } from "@/domains/experiments/daily-experiment-planner";

const TENANT = process.env.BEACON_TENANT_ID ?? "tenant-iranopedia";
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const slug = (u: string) => u.replace(/^https?:\/\/[^/]+/, "") || "/";
const labelOf = (u: string) => (slug(u).split("/").filter(Boolean).at(-1) ?? "").replace(/[-_]+/g, " ");
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

async function liveFacts(url: string): Promise<PageFacts> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "BeaconBot/1.0" }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { title: null, meta: null, h1: null };
    const html = await res.text();
    const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || null;
    const metaM = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([\s\S]*?)["']/i) || html.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]*name=["']description["']/i);
    const meta = decode(metaM?.[1] ?? "") || null;
    const h1 = decode((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "").replace(/<[^>]+>/g, " ")) || null;
    return { title, meta, h1 };
  } catch { return { title: null, meta: null, h1: null }; }
}

async function main() {
  const signals = await loadGscPageSignalsForTenant(TENANT);
  const ledger = await loadProofLedger(TENANT).catch(() => []);

  // Build GSC inputs for NON-animal pages (the 27 animals are all treated/control → busy).
  const inputs: GscPageInput[] = [];
  for (const s of signals.values()) {
    if (/\/iran-animals\//.test(s.page)) continue; // active batch family — skip the fetch
    const tq = [...s.topQueries].sort((a, b) => b.impressions - a.impressions)[0];
    if (!tq) continue;
    if (s.impressions90d < 400 || s.impressions90d > 9000) continue;
    if (s.position90d < 4 || s.position90d > 20) continue;
    inputs.push({
      url: s.page, pageLabel: labelOf(s.page), impressions: s.impressions90d, clicks: s.clicks90d, ctr: s.ctr90d, position: s.position90d,
      topQuery: tq.query, topQueryImpressions: tq.impressions, topQueryPosition: tq.position, topQueryCtr: tq.ctr,
      ownership: s.impressions90d > 0 ? tq.impressions / s.impressions90d : 0,
    });
  }
  // Pre-rank by CTR opportunity; fetch live facts only for the top 30 (bounds the fetch).
  inputs.sort((a, b) => (b.topQueryImpressions * (1 / Math.max(1, b.topQueryPosition))) - (a.topQueryImpressions * (1 / Math.max(1, a.topQueryPosition))));
  const top = inputs.slice(0, 30);
  console.log(`\n=== Native Daily-Experiments preview · ${TENANT} ===`);
  console.log(`non-animal candidate pages (pos 4-20, impr 400-9000): ${inputs.length}; fetching live facts for top ${top.length}…\n`);

  const facts = new Map<string, PageFacts>();
  for (const p of top) facts.set(p.url, await liveFacts(p.url));

  const built = buildDailyCandidates({ tenantId: TENANT, pages: top, facts, proofLedger: ledger });
  // Feed only candidates that have a materially-better proposal into the planner.
  const plan = planDailyExperiments({
    tenantId: TENANT, date: new Date().toISOString().slice(0, 10),
    candidates: built,
    proofLedger: ledger,
    config: { maxExperiments: 8, maxPerPageFamily: 3, maxPerActionFamily: 3, maxHighTraffic: 1, effortBudgetMinutes: 45, backups: 2 },
  });

  console.log(`candidates evaluated: ${plan.candidatesEvaluated} | active animal treatments+controls excluded by eligibility`);
  console.log(`lever distribution: ${JSON.stringify(plan.leverDistribution)} | family distribution: ${JSON.stringify(plan.familyDistribution)}`);
  console.log(`estimated minutes: ${plan.estimatedMinutes} | controls available (clean pool): ${plan.controlAvailability.cleanPages}\n`);
  console.log(`--- SELECTED ${plan.selected.length} ---`);
  for (const s of plan.selected as (typeof plan.selected[number] & Partial<(typeof built)[number]>)[]) {
    const b = built.find((x) => x.url === s.url)!;
    console.log(`[${b.leverField}] ${labelOf(s.url).padEnd(26)} "${b.targetQuery}" pos ${b.position.toFixed(1)} ctr ${pct(b.ctr)} own ${pct(b.ownership)} controls=${b.suggestedControls.length}${b.enoughControls ? "" : " ⚠FEW"}`);
    console.log(`     current : ${b.currentText.slice(0, 80)}`);
    console.log(`     proposed: ${b.proposedText.slice(0, 80)}`);
  }
  console.log(`\n--- BACKUPS ${plan.backups.length} ---`);
  for (const s of plan.backups) { const b = built.find((x) => x.url === s.url)!; console.log(`[${b.leverField}] ${labelOf(s.url)} "${b.targetQuery}"`); }
  console.log(`\n--- EXCLUDED (by reason) ---`);
  const byReason = new Map<string, number>();
  for (const e of plan.excluded) byReason.set(e.reason, (byReason.get(e.reason) ?? 0) + 1);
  for (const [r, n] of byReason) console.log(`  ${r}: ${n}`);
}
main().catch((e) => { console.error("preview failed:", e); process.exit(1); });
