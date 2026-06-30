/**
 * Daily-plan acceptance DRY RUN (Phase 14) — proves the full native path on real Iranopedia data
 * with ZERO writes: build candidates → plan → buildDailyPlanRecord → validatePlanAcceptance against
 * the CURRENT topology → report what WOULD be reserved. No reservations, no proof rows, no Wix, $0.
 *   set -a; . ./.env.local; set +a
 *   BEACON_TENANT_ID=tenant-iranopedia npx tsx --require ./scripts/mock-server-only.cjs scripts/daily-plan-dry-run.ts
 */
import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { loadProofLedger } from "@/domains/proof-gsc/load-ledger";
import { getPageSnapshots } from "@/domains/pages/snapshot-store";
import { buildDailyCandidates, type GscPageInput, type PageFacts, type BuiltCandidate } from "@/domains/experiments/build-daily-candidates";
import { planDailyExperiments } from "@/domains/experiments/daily-experiment-planner";
import { deriveExperimentStates } from "@/domains/experiments/experiment-eligibility";
import { buildLinkDestinations, toLinkPath } from "@/domains/experiments/safe-internal-link";
import { buildDailyPlanRecord } from "@/domains/experiments/build-daily-plan-record";
import { validatePlanAcceptance, type AcceptanceContext } from "@/domains/experiments/validate-plan-acceptance";

const TENANT = process.env.BEACON_TENANT_ID ?? "tenant-iranopedia";
const path = (u: string) => (u.replace(/^https?:\/\/[^/]+/, "") || "/").replace(/[?#].*$/, "").replace(/\/$/, "") || "/";
const labelOf = (u: string) => (path(u).split("/").filter(Boolean).at(-1) ?? "").replace(/[-_]+/g, " ");

async function main() {
  const t0 = Date.now();
  const signals = await loadGscPageSignalsForTenant(TENANT);
  const ledger = await loadProofLedger(TENANT).catch(() => []);
  const snaps = await getPageSnapshots();
  const now = new Date();

  const factsByPath = new Map<string, PageFacts>();
  for (const s of snaps as Array<{ url?: string; page?: string; title: string | null; meta_description: string | null; h1: string | null; body_paragraph_sample?: string[]; internal_links?: Array<{ href: string }>; fetched_at?: string }>) {
    const u = s.url ?? s.page; if (!u) continue;
    factsByPath.set(path(u), { title: s.title, meta: s.meta_description, h1: s.h1,
      openingParagraph: (s.body_paragraph_sample ?? []).find((p) => p && p.trim().length >= 80) ?? null,
      bodyParagraphs: s.body_paragraph_sample ?? [], internalLinkPaths: (s.internal_links ?? []).map((l) => toLinkPath(l.href)), snapshotFetchedAt: s.fetched_at });
  }

  const states = deriveExperimentStates(ledger, now);
  const activeTreatedPaths = new Set<string>(); const activeControlPaths = new Set<string>();
  for (const [p, st] of states) {
    if (st.activeTreatments.length) activeTreatedPaths.add(toLinkPath(p));
    if (st.activeControlAssignments.length) activeControlPaths.add(toLinkPath(p));
  }
  const activeProofIds = ledger.filter((r) => r.verdict === "measuring").map((r) => r.id);

  const inputs: GscPageInput[] = [];
  for (const s of signals.values()) {
    if (/\/iran-animals(\/|$)/.test(s.page)) continue;
    const tq = [...s.topQueries].sort((a, b) => b.impressions - a.impressions)[0];
    if (!tq || s.impressions90d < 200 || s.position90d < 3 || s.position90d > 50) continue;
    inputs.push({ url: s.page, pageLabel: labelOf(s.page), impressions: s.impressions90d, clicks: s.clicks90d, ctr: s.ctr90d, position: s.position90d,
      topQuery: tq.query, topQueryImpressions: tq.impressions, topQueryPosition: tq.position, topQueryCtr: tq.ctr, ownership: s.impressions90d > 0 ? tq.impressions / s.impressions90d : 0 });
  }
  inputs.sort((a, b) => (b.topQueryImpressions / Math.max(1, b.topQueryPosition)) - (a.topQueryImpressions / Math.max(1, a.topQueryPosition)));
  const facts = new Map<string, PageFacts>();
  for (const p of inputs) { const f = factsByPath.get(path(p.url)); if (f) facts.set(p.url, f); }

  const isProtected = (p: string): string | null => (/\/iran-animals(\/|$)/.test(p) ? "animal_family" : activeControlPaths.has(p) || activeTreatedPaths.has(p) ? "active_experiment" : null);
  const linkDestinations = buildLinkDestinations(snaps as Parameters<typeof buildLinkDestinations>[0], isProtected);

  const built = buildDailyCandidates({ tenantId: TENANT, pages: inputs, facts, proofLedger: ledger, linkDestinations });
  const tPlan = Date.now();
  const plan = planDailyExperiments({ tenantId: TENANT, date: now.toISOString().slice(0, 10), candidates: built, proofLedger: ledger,
    config: { maxExperiments: 8, maxPerPageFamily: 4, maxPerActionFamily: 4, maxHighTraffic: 2, effortBudgetMinutes: 45, maxLinksPerDestination: 1, backups: 2 } });
  const planMs = Date.now() - tPlan;

  const byUrl = new Map(built.map((b) => [b.url, b]));
  const selected = plan.selected.map((s) => byUrl.get(s.url)).filter(Boolean) as BuiltCandidate[];
  const backups = plan.backups.map((s) => byUrl.get(s.url)).filter(Boolean) as BuiltCandidate[];

  const record = buildDailyPlanRecord({ tenantId: TENANT, date: now.toISOString().slice(0, 10), now, selected, backups,
    activeSnapshot: { proofIds: activeProofIds, treatedUrls: [...activeTreatedPaths], controlUrls: [...activeControlPaths], influencedUrls: [] } });

  // Acceptance dry-run: validate against the CURRENT topology; no reservations exist yet.
  const ctx: AcceptanceContext = { tenantId: TENANT, now, expectedInputHash: record.inputHash,
    activeTreatedPaths, activeControlPaths, reservedControlPaths: new Map() };
  const tAccept = Date.now();
  const validation = validatePlanAcceptance(record, ctx);
  const acceptMs = Date.now() - tAccept;

  console.log(`\n=== Daily-plan ACCEPTANCE DRY RUN · ${TENANT} ===`);
  console.log(`plan id: ${record.id}`);
  console.log(`status: ${record.status} | expires: ${record.expiresAt} | inputHash: ${record.inputHash}`);
  console.log(`selected: ${record.selected.length} | backups: ${record.backups.length} | lever: ${JSON.stringify(record.distribution.byLever)} | est ${record.estimatedMinutes} min`);
  console.log(`active animal batch frozen in snapshot → treated: ${record.activeExperimentSnapshot.treatedUrls.length} | controls: ${record.activeExperimentSnapshot.controlUrls.length} | proofIds: ${record.activeExperimentSnapshot.proofIds.length}`);
  console.log(`\n--- WOULD RESERVE (per experiment) ---`);
  let totalRes = 0;
  for (const e of record.selected) {
    totalRes += e.controls.length;
    console.log(`[${e.lever}] ${e.pageLabel.padEnd(26)} controls(${e.controls.length}): ${e.controls.map((c) => path(c.controlUrl)).join(", ")}${e.influencedUrls.length ? ` | influences: ${e.influencedUrls.join(",")}` : ""}`);
  }
  console.log(`\n--- ACCEPTANCE VALIDATION (dry-run, no writes) ---`);
  if (validation.ok) {
    console.log(`✓ would accept cleanly → ${validation.reservationsToCreate} reservations across ${record.selected.length} experiments`);
  } else {
    console.log(`✗ would REJECT: ${validation.planLevelReason ?? "per-experiment failures"}`);
    for (const f of validation.failures ?? []) console.log(`   ${f.url} → ${f.reason}${f.detail ? ` (${f.detail})` : ""}`);
  }
  console.log(`\ntiming: plan ${planMs}ms · acceptance-validate ${acceptMs}ms · total ${Date.now() - t0}ms`);
  console.log(`reservations that WOULD be created: ${totalRes} | NONE persisted (dry run)`);
  console.log(`migration applied? ${process.env.BEACON_DEP_MIGRATION_APPLIED === "1" ? "yes" : "NO — atomic accept RPC awaits operator approval"}`);
}
main().catch((e) => { console.error("dry-run failed:", e); process.exit(1); });
