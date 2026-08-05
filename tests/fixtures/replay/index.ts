/**
 * DETERMINISTIC REPLAY - the WORLD around the envelopes: first-party Search Console shapes, owned-page
 * bodies at two ages, competitor winners readable and not, a confirmed business profile, and an in-memory
 * basis-scoped funnel store. Everything is invented and every builder takes overridable fields, so the
 * replay harness composes cases instead of carrying blobs. Re-exports the envelope builders as the ONE
 * import for a replay test.
 */
import type { BusinessProfile, ProfileSection } from "@/domains/account";
import { emptyBusinessProfile } from "@/domains/account";
import type { GscDecaySignal } from "@/domains/evidence/readers/gsc-page-signals";
import type { SerpAgendaPageQuery } from "@/domains/evidence/funnel/normalize";
import { emptyFunnelState, type FunnelState, type FunnelWinningPage } from "@/domains/evidence/funnel/state";
import type { FunnelDeps } from "@/domains/evidence/funnel/shared";
import { emptyResearchEvidence, type FunnelResearchEvidence, type ResearchPageExtract } from "@/domains/evidence/funnel/research-evidence";
import { buildEvidenceSnapshot, type EvidenceSnapshot, type EvidenceSnapshotInput, type LoadedSource, type OwnedQuerySignal } from "@/domains/evidence/snapshot";
import { GAP_QUERY, GAP_URL, OBSERVED_AT, SITE, WINNER_QUERY } from "./envelopes";

export * from "./envelopes";
export const TENANT = "replay-tenant";
export const BASIS = "basis_replay";
export const WINNER_URL = `${SITE}/paper-lantern-guide`;
export const TWIN_URL = `${SITE}/kite-festival-food`;
export const STALE_URL = `${SITE}/kite-festival-history`;

// ── first-party Search Console ───────────────────────────────────────────────
type GscRow = EvidenceSnapshotInput["gsc"]["payload"][number];
const q = (query: string, impressions: number, clicks: number, position: number): OwnedQuerySignal => ({ query, impressions, clicks, position });
export function gscPage(url: string, totals: { impressions: number; clicks: number; position?: number }, topQueries: OwnedQuerySignal[]): GscRow {
  return { url, clicks90d: totals.clicks, impressions90d: totals.impressions, ctr90d: totals.clicks / totals.impressions, position90d: totals.position ?? 4, topQueries };
}
/** A REAL click-through gap: 3.0 percent where this position usually earns about 8.0 percent. */
export const gscCtrGap = (): GscRow => gscPage(GAP_URL, { impressions: 6400, clicks: 190, position: 4.1 }, [q(GAP_QUERY, 6000, 180, 4.1)]);
/** A page already beating the clicks its positions earn: nothing here is recoverable. */
export const gscStableWinner = (): GscRow => gscPage(WINNER_URL, { impressions: 75646, clicks: 3246, position: 3.9 }, [
  q(WINNER_QUERY, 25000, 2365, 3.96), q("paper lantern how to", 12000, 1012, 3.74), q("lantern festival guide", 2110, 209, 2.66)]);
/** TWO of my own pages served for one and the same search. */
export const gscCannibalPair = (): GscRow[] => [
  gscPage(TWIN_URL, { impressions: 3000, clicks: 60, position: 4.1 }, [q("kite festival food", 2800, 55, 4.1), q(GAP_QUERY, 900, 20, 8.2)]),
  gscPage(GAP_URL, { impressions: 6400, clicks: 190, position: 4.1 }, [q(GAP_QUERY, 6000, 180, 4.1)])];
/** The trailing 28 days against the 28 before: one page climbing, one slipping. */
export function gscDecay(page: string, clicksNow: number, clicksPrior: number): GscDecaySignal {
  return { page, clicksNow, positionNow: 4.1, impressionsNow: 2000, clicksPrior, positionPrior: 4.4, impressionsPrior: 2000, windowNowEnd: "2026-07-19" };
}
export const gscGain = (): GscDecaySignal => gscDecay(WINNER_URL, 320, 210);
export const gscDecline = (): GscDecaySignal => gscDecay(GAP_URL, 140, 260);
/** The SERP agenda's first-party portfolio, exactly as the funnel's own reader hands it over
 *  (a page whose last 28 days fell against the 28 before marks its queries declining). */
export function agendaFromDecay(rows: { decay: GscDecaySignal; queries: OwnedQuerySignal[] }[]): SerpAgendaPageQuery[] {
  return rows.flatMap((r) => r.queries.map((k) => ({ query: k.query, impressions: k.impressions, declining: r.decay.clicksNow < r.decay.clicksPrior })));
}

// ── owned page bodies, current and stale ────────────────────────────────────
type WixRow = EvidenceSnapshotInput["wix"]["payload"][number];
export function ownedBody(url: string, title: string, over: Partial<WixRow> = {}): WixRow {
  return { url, title, metaDescription: null, h1: title, h2: [], outline: ["What happens on the day", "What families bring"], schemaTypes: [],
    hasFaq: false, faqCount: 0, wordCount: 780, internalLinks: [], fetchedAt: OBSERVED_AT, ...over };
}
/** Read weeks ago: still a body, and honestly dated as an old one. */
export const staleOwnedBody = (): WixRow => ownedBody(STALE_URL, "Kite Festival History", { fetchedAt: "2026-05-01T00:00:00.000Z", wordCount: 410 });

// ── competitor winners ──────────────────────────────────────────────────────
export function winningPage(url: string, query: string, extract: ResearchPageExtract | null, over: Partial<FunnelWinningPage> = {}): FunnelWinningPage {
  return { url, domain: new URL(url).hostname, engines: [], examplePrompts: [],
    appearances: [{ kind: "serp_organic", query, promptId: null, promptText: null, engine: null, rank: 1, citedUrl: url, observedAt: OBSERVED_AT, modelServed: null }],
    extract, ...over };
}
/** The publisher said no, so the body is not in hand and this URL is not tried again yet. */
export const blockedWinner = (url: string, query: string): FunnelWinningPage =>
  winningPage(url, query, null, { readOutcome: { state: "robots_blocked", attemptedAt: OBSERVED_AT, retryAfter: "2026-08-20T09:00:00.000Z" } });

// ── the account ─────────────────────────────────────────────────────────────
const confirmed = <V>(value: V): ProfileSection<V> => ({ value, origin: "operator_confirmed", confidence: null, sourceUrls: [] });
export function replayProfile(over: { offerings?: string[]; topics?: string[] } = {}): BusinessProfile {
  const p = emptyBusinessProfile(TENANT);
  p.offerings = confirmed(over.offerings ?? ["festival guides"]);
  p.topicsToOwn = confirmed(over.topics ?? ["kite festival", "paper lantern"]);
  return p;
}

// ── the funnel's basis-scoped store, in memory ──────────────────────────────
export function memFunnelStore(seed?: FunnelState) {
  const rows = new Map<string, { state: FunnelState; rowVersion: number }>();
  if (seed) rows.set(`${seed.tenantId}|${seed.basisTag}`, { state: seed, rowVersion: 1 });
  const clone = (s: FunnelState): FunnelState => structuredClone(s); // the real repo decodes a fresh object per load
  const deps = {
    loadState: async (t: string, b: string) => { const row = rows.get(`${t}|${b}`); return row ? { state: clone(row.state), rowVersion: row.rowVersion } : { state: emptyFunnelState(t, b), rowVersion: 0 }; },
    saveState: async (t: string, b: string, s: FunnelState, expected: number) => { const k = `${t}|${b}`; if ((rows.get(k)?.rowVersion ?? 0) !== expected) return null; rows.set(k, { state: clone(s), rowVersion: expected + 1 }); return expected + 1; },
  } satisfies Pick<FunnelDeps, "loadState" | "saveState">;
  return { deps, peek: (t = TENANT, b = BASIS) => rows.get(`${t}|${b}`)?.state, put: (s: FunnelState) => rows.set(`${s.tenantId}|${s.basisTag}`, { state: clone(s), rowVersion: (rows.get(`${s.tenantId}|${s.basisTag}`)?.rowVersion ?? 0) + 1 }) };
}

// ── the snapshot the decision kernel reads ──────────────────────────────────
const src = <T>(payload: T): LoadedSource<T> => ({ status: "fresh", lastSyncedAt: OBSERVED_AT, payload });
export type WorldOver = { gsc?: GscRow[]; wix?: WixRow[]; research?: FunnelResearchEvidence; keywordDemand?: EvidenceSnapshotInput["dataforseo"]["payload"] };
/** The SAME pure assembler the production loader calls, over already-loaded fixture sources. */
export function replaySnapshot(over: WorldOver = {}): EvidenceSnapshot {
  return buildEvidenceSnapshot({
    scope: { tenantId: TENANT, site: SITE, builtAt: "2026-07-21T00:00:00.000Z" },
    gsc: src(over.gsc ?? [gscCtrGap()]), ga4: src([]), wix: src(over.wix ?? [ownedBody(GAP_URL, "Kite Festival")]),
    clarity: src([]), dataforseo: src(over.keywordDemand ?? []), research: src(over.research ?? emptyResearchEvidence()), aiAnswersUnread: false,
  });
}
