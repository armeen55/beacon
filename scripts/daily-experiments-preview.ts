/**
 * Native Daily-Experiments preview (Phase 11) — runs the in-app engine end-to-end. Read-only,
 * $0, NO live fetch, NO proof rows, NO Wix. Facts come from Beacon's OWN cached crawl
 * (page_snapshots: title/meta/h1/body_paragraph_sample) — the factual, no-fabrication source for
 * the safe-meta lever. Excludes the active animal batch + its 17 controls via the eligibility
 * model; selects a diversified next batch from unrelated families.
 *   set -a; . ./.env.local; set +a
 *   BEACON_TENANT_ID=tenant-iranopedia npx tsx --require ./scripts/mock-server-only.cjs scripts/daily-experiments-preview.ts
 */
import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { loadProofLedger } from "@/domains/proof-gsc/load-ledger";
import { getPageSnapshots } from "@/domains/pages/snapshot-store";
import { buildDailyCandidates, type GscPageInput, type PageFacts } from "@/domains/experiments/build-daily-candidates";
import { planDailyExperiments } from "@/domains/experiments/daily-experiment-planner";
import { deriveExperimentStates } from "@/domains/experiments/experiment-eligibility";
import { buildLinkDestinations, toLinkPath } from "@/domains/experiments/safe-internal-link";

const TENANT = process.env.BEACON_TENANT_ID ?? "tenant-iranopedia";
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const path = (u: string) => (u.replace(/^https?:\/\/[^/]+/, "") || "/").replace(/[?#].*$/, "").replace(/\/$/, "") || "/";
const labelOf = (u: string) => (path(u).split("/").filter(Boolean).at(-1) ?? "").replace(/[-_]+/g, " ");

async function main() {
  const signals = await loadGscPageSignalsForTenant(TENANT);
  const ledger = await loadProofLedger(TENANT).catch(() => []);
  const snaps = await getPageSnapshots();

  // Index Beacon's cached crawl by PATH (GSC may be non-www; snapshots www) — $0 factual source.
  const factsByPath = new Map<string, PageFacts>();
  for (const s of snaps as Array<{ url?: string; page?: string; title: string | null; meta_description: string | null; h1: string | null; body_paragraph_sample?: string[]; internal_links?: Array<{ href: string }>; fetched_at?: string }>) {
    const u = s.url ?? s.page;
    if (!u) continue;
    factsByPath.set(path(u), {
      title: s.title, meta: s.meta_description, h1: s.h1,
      openingParagraph: (s.body_paragraph_sample ?? []).find((p) => p && p.trim().length >= 80) ?? null,
      bodyParagraphs: s.body_paragraph_sample ?? [],
      internalLinkPaths: (s.internal_links ?? []).map((l) => toLinkPath(l.href)),
      snapshotFetchedAt: s.fetched_at,
    });
  }

  // Internal-link DESTINATION registry — protected pages (animal family + any active treatment/
  // control) are marked ineligible so the lever NEVER links to/from a protected page.
  const states = deriveExperimentStates(ledger, new Date());
  const activePaths = new Set<string>();
  for (const [p, st] of states) if (st.activeTreatments.length || st.activeControlAssignments.length) activePaths.add(toLinkPath(p));
  const isProtected = (p: string): string | null =>
    /\/iran-animals(\/|$)/.test(p) ? "animal_family" : activePaths.has(p) ? "active_experiment" : null;
  const linkDestinations = buildLinkDestinations(snaps as Parameters<typeof buildLinkDestinations>[0], isProtected);
  const eligibleDests = linkDestinations.filter((d) => d.eligible).length;

  // Build GSC inputs for NON-animal pages (the 27 animals are all treated/control → busy).
  const inputs: GscPageInput[] = [];
  for (const s of signals.values()) {
    if (/\/iran-animals(\/|$)/.test(s.page)) continue; // active batch family (incl. hub) — skip; eligibility model is the second-line guard
    const tq = [...s.topQueries].sort((a, b) => b.impressions - a.impressions)[0];
    if (!tq) continue;
    if (s.impressions90d < 200) continue; // need real demand (measurable source)
    if (s.position90d < 3 || s.position90d > 50) continue; // measurable band (meta scores by CTR-gap; links need only a measurable source)
    inputs.push({
      url: s.page, pageLabel: labelOf(s.page), impressions: s.impressions90d, clicks: s.clicks90d, ctr: s.ctr90d, position: s.position90d,
      topQuery: tq.query, topQueryImpressions: tq.impressions, topQueryPosition: tq.position, topQueryCtr: tq.ctr,
      ownership: s.impressions90d > 0 ? tq.impressions / s.impressions90d : 0,
    });
  }
  inputs.sort((a, b) => (b.topQueryImpressions * (1 / Math.max(1, b.topQueryPosition))) - (a.topQueryImpressions * (1 / Math.max(1, a.topQueryPosition))));

  const facts = new Map<string, PageFacts>();
  let withSnapshot = 0;
  for (const p of inputs) {
    const f = factsByPath.get(path(p.url));
    if (f) { facts.set(p.url, f); withSnapshot++; }
  }

  console.log(`\n=== Native Daily-Experiments preview (Safe Meta + Safe Internal Link) · ${TENANT} ===`);
  console.log(`non-animal candidate pages (pos 3-50, impr ≥200): ${inputs.length} | with cached snapshot facts: ${withSnapshot}`);
  console.log(`link destinations: ${linkDestinations.length} total, ${eligibleDests} eligible, ${linkDestinations.length - eligibleDests} protected (animal family + active experiments)\n`);

  const built = buildDailyCandidates({ tenantId: TENANT, pages: inputs, facts, proofLedger: ledger, linkDestinations });
  const plan = planDailyExperiments({
    tenantId: TENANT, date: new Date().toISOString().slice(0, 10),
    candidates: built, proofLedger: ledger,
    // Mixed batch: per-action-family cap 4 (so meta + internal_link each fill up to 4), per-page-
    // family 4, max 1 link per destination. One variable per page; each page independently controlled.
    config: { maxExperiments: 8, maxPerPageFamily: 4, maxPerActionFamily: 4, maxHighTraffic: 2, effortBudgetMinutes: 45, maxLinksPerDestination: 1, backups: 2 },
  });

  const famCount = new Map<string, number>();
  for (const b of built) { const fam = b.pageFamily ?? "other"; famCount.set(fam, (famCount.get(fam) ?? 0) + 1); }
  console.log(`candidates with a materially-better proposal: ${built.length} | by family: ${JSON.stringify(Object.fromEntries([...famCount.entries()].sort((a, b) => b[1] - a[1])))}`);
  console.log(`lever distribution: ${JSON.stringify(plan.leverDistribution)} | family distribution: ${JSON.stringify(plan.familyDistribution)}`);
  console.log(`estimated minutes: ${plan.estimatedMinutes} | controls available (clean pool): ${plan.controlAvailability.cleanPages}\n`);

  console.log(`--- SELECTED ${plan.selected.length} ---`);
  for (const s of plan.selected) {
    const b = built.find((x) => x.url === s.url)!;
    console.log(`\n[${b.leverField}] ${labelOf(s.url)}  ·  query "${b.targetQuery}"  ·  pos ${b.position.toFixed(1)} · ctr ${pct(b.ctr)} · impr ${b.impressions} · own ${pct(b.ownership)} · controls=${b.suggestedControls.length}${b.enoughControls ? "" : " ⚠FEW"}`);
    if (b.linkDetail) {
      const l = b.linkDetail;
      console.log(`     → links to: ${l.destinationUrl}  (anchor "${l.anchorText}", ${l.relationship})`);
      console.log(`     current : ${l.exactSourceText.slice(0, 160)}`);
      console.log(`     linked  : ${l.exactReplacementText.slice(0, 200)}`);
      console.log(`     own why : ${l.ownershipReason}`);
      console.log(`     influences: ${(b.influencedUrls ?? []).join(", ")}`);
      console.log(`     ${l.wixInstructions}`);
    } else if (b.answerDetail) {
      const a = b.answerDetail;
      console.log(`     Q: ${a.question}  (${a.operation}, ${a.supportMode})`);
      console.log(`     answer (exact, buried @p${a.paragraphIndex + 1}): "${a.answerText}"`);
      console.log(`     firewall: passed=${a.factualSafety.passed}${a.factualSafety.reasons.length ? " — " + a.factualSafety.reasons.join("; ") : ""}`);
      console.log(`     ${a.exactInstruction}`);
    } else {
      console.log(`     current : ${(b.currentText || "(none)").slice(0, 150)}`);
      console.log(`     proposed: ${b.proposedText.slice(0, 150)}`);
    }
  }
  console.log(`\n--- BACKUPS ${plan.backups.length} ---`);
  for (const s of plan.backups) { const b = built.find((x) => x.url === s.url)!; console.log(`[${b.leverField}] ${labelOf(s.url)} "${b.targetQuery}"`); }
  console.log(`\n--- EXCLUDED (by reason) ---`);
  const byReason = new Map<string, number>();
  for (const e of plan.excluded) byReason.set(e.reason, (byReason.get(e.reason) ?? 0) + 1);
  for (const [r, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${r}: ${n}`);
}
main().catch((e) => { console.error("preview failed:", e); process.exit(1); });
