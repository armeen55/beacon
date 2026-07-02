/**
 * Ground-truth probe (BEACON 500 N9, 2026-07-02): run the source-contradiction detector
 * across REAL tenant-iranopedia pages using the same signals `build-today-preview.ts`
 * threads into `reviewRecommendation` (GSC per-page traffic + the cached page-snapshot
 * HTTP status), plus GA4 page sessions where GA4 has synced. Read-only, no writes.
 *
 * Run:
 *   set -a; . ./.env.local; set +a; BEACON_TENANT_ID=tenant-iranopedia \
 *     npx tsx --require ./scripts/mock-server-only.cjs scripts/_ground-truth-source-contradiction.ts
 */
import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { loadGa4PageValuesForTenant } from "@/domains/recommendation-intelligence/ga4-page-values";
import { getPageSnapshots } from "@/domains/pages/snapshot-store";
import { detectSourceContradictions } from "@/domains/evidence/source-contradiction";

const pathOf = (u: string) => (u.replace(/^https?:\/\/[^/]+/, "") || "/").replace(/[?#].*$/, "").replace(/\/$/, "") || "/";
const labelOf = (u: string) => (pathOf(u).split("/").filter(Boolean).at(-1) ?? "home").replace(/[-_]+/g, " ");

async function main() {
  const tenantId = process.env.BEACON_TENANT_ID;
  if (!tenantId) throw new Error("set BEACON_TENANT_ID");
  const now = new Date();

  const [gscByPage, ga4ByPage, snaps] = await Promise.all([
    loadGscPageSignalsForTenant(tenantId, now),
    loadGa4PageValuesForTenant(tenantId, now),
    getPageSnapshots(),
  ]);

  console.log(`=== N9 ground-truth: ${tenantId} ===`);
  console.log(`GSC pages with signal: ${gscByPage.size}`);
  console.log(`GA4 pages with signal: ${ga4ByPage.size}`);
  console.log(`Page snapshots: ${snaps.length}`);

  const statusByPath = new Map<string, { httpStatus: number; fetchedAt: string }>();
  for (const s of snaps as Array<{ url?: string; page?: string; http_status?: number; fetched_at?: string }>) {
    const u = s.url ?? s.page;
    if (!u || typeof s.http_status !== "number" || !s.fetched_at) continue;
    statusByPath.set(pathOf(u), { httpStatus: s.http_status, fetchedAt: s.fetched_at });
  }

  // Union of every page path GSC or GA4 knows about, so a GA4-only or GSC-only page is
  // still checked (rule a fires on the SIDE that's present + meaningful).
  const allPaths = new Set<string>([...gscByPage.keys(), ...ga4ByPage.keys()].map((p) => pathOf(p)));
  // Also fold in every error/gone snapshot path, in case neither GSC nor GA4 has that
  // exact canonical form keyed (rule c only needs GSC + snapshot, not GA4).
  for (const p of statusByPath.keys()) allPaths.add(p);

  type Row = { path: string; kind: string; sources: string[]; detail: string };
  const rows: Row[] = [];
  let pagesChecked = 0;

  for (const path of allPaths) {
    pagesChecked += 1;
    const gsc = [...gscByPage.values()].find((s) => pathOf(s.page) === path) ?? null;
    const ga4 = [...ga4ByPage.values()].find((v) => pathOf(v.page) === path) ?? null;
    const status = statusByPath.get(path) ?? null;

    const contradictions = detectSourceContradictions({
      pageLabel: labelOf(path),
      now,
      gscTraffic: gsc ? { clicks: gsc.clicks90d, impressions: gsc.impressions90d, windowDays: 90 } : null,
      ga4Traffic: ga4 ? { sessions: ga4.sessions28d, windowDays: 28 } : null,
      pageStatus: status,
      gscRecentClicks: gsc ? { clicks: gsc.clicks90d, recencyDays: 90 } : null,
      // Rule (b) needs a per-query GSC position + a stored live-SERP snapshot for that
      // exact query/period. This $0 probe doesn't pull dataforseo_serp_history (that's
      // owned by serp/** — out of scope to touch), so rule (b) sees honest absence here.
      gscQueryPosition: null,
      serpSnapshot: null,
    });

    for (const c of contradictions) {
      rows.push({ path, kind: c.kind, sources: c.sources, detail: c.detail });
    }
  }

  console.log(`\nPages checked (union of GSC/GA4/snapshot-status coverage): ${pagesChecked}`);
  console.log(`Note: rule (b) (rank-visibility vs stored SERP snapshot) was not exercised in this probe —`);
  console.log(`it needs dataforseo_serp_history, which lives under src/domains/serp/** (out of N9's ownership scope).`);

  if (rows.length === 0) {
    console.log(`\n=== Contradictions found: 0 (honest zero) ===`);
    console.log(`Either every page's sources agree, or (per law 1) one side is simply absent for every page —`);
    console.log(`absence is never treated as contradiction.`);
  } else {
    console.log(`\n=== Contradictions found: ${rows.length} ===`);
    for (const r of rows) {
      console.log(`\n[${r.kind}] ${r.path}`);
      console.log(`  sources: ${r.sources.join(" vs ")}`);
      console.log(`  ${r.detail}`);
    }
  }

  // Coverage sanity: how many pages had BOTH sides present for rule (a) at all
  // (regardless of whether they agreed) — shows how much of the union rule (a)
  // could even evaluate, vs absence.
  let bothSidesPresent = 0;
  for (const path of allPaths) {
    const hasGsc = [...gscByPage.values()].some((s) => pathOf(s.page) === path);
    const hasGa4 = [...ga4ByPage.values()].some((v) => pathOf(v.page) === path);
    if (hasGsc && hasGa4) bothSidesPresent += 1;
  }
  console.log(`\nPages with BOTH GSC and GA4 present (rule a could evaluate agree/disagree): ${bothSidesPresent}`);
  let errorSnapshots = 0;
  for (const s of statusByPath.values()) if (s.httpStatus >= 400) errorSnapshots += 1;
  console.log(`Page snapshots recording an error/gone HTTP status (any age): ${errorSnapshots}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
