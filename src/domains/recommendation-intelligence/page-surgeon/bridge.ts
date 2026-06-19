/**
 * Page Surgeon — BRIDGE into the product (server-only).
 *
 * Given a recommendation's target URL, resolve the cached Page Surgeon brief for
 * that page and assemble a read-only AtomicChangePack (evidence + finished
 * artifacts + QA + review decision + pushability + optional history). This is how
 * the strong diagnostics engine reaches the live recommendation review surface
 * WITHOUT re-deciding anything, publishing, or regenerating the queue.
 *
 * Read-only: never calls OpenAI, never writes. Fail-soft — any miss returns a
 * typed "not available" rather than throwing into a customer surface.
 */

import "server-only";

import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";

import {
  assemblePacketForUrl,
  evidenceHash,
  loadPageSurgeonContext,
  topPagesByDemand,
  type PageSurgeonContext,
} from "./assemble-packet";
import { composeArtifactBundle } from "./artifact-bundle";
import { qaArtifactBundle } from "./artifact-qa";
import { buildSourceCoverage, type SourceCoverage } from "./page-decision";
import { getCachedBriefs, getBriefHistory } from "./brief-store";
import { getLatestReviewDecisions } from "./review-store";
import { buildAtomicChangePack, type PageSurgeonForUrl, type PageSurgeonSummary } from "./change-pack";
import { buildProofPlanRow, type ProofPlanRow } from "./proof-plan";

export type { PageSurgeonForUrl, PageSurgeonSummary } from "./change-pack";
export type { ProofPlanRow } from "./proof-plan";

const toPath = (u: string): string => u.replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, "") || "/";

/** Resolve a recommendation target URL to the context's canonical key. */
function resolveCanon(ctx: PageSurgeonContext, targetUrl: string): string | null {
  const direct = canonicalizeCitationUrl(targetUrl) ?? targetUrl;
  if (ctx.snapshotByCanon.has(direct) || ctx.gscByUrl.has(direct)) return direct;
  const path = toPath(targetUrl);
  for (const k of ctx.snapshotByCanon.keys()) if (toPath(k) === path) return k;
  for (const k of ctx.gscByUrl.keys()) if (toPath(k) === path) return k;
  return null;
}

function controlPaths(ctx: PageSurgeonContext, canon: string): string[] {
  return topPagesByDemand(ctx, 8).filter((u) => u !== canon).map(toPath).slice(0, 3);
}

/** Does this exact page have a Wix url-map entry? Drives PS8 pushability.
 *  Returns undefined (not false) when the map is empty/unreadable — we can't
 *  tell "unsynced" from "no Wix", so we defer to the publish-channel inference
 *  rather than over-claim "blocked". Best-effort; never throws. */
async function resolveMappingExists(pageUrl: string, canon: string): Promise<boolean | undefined> {
  try {
    const { getWixUrlMap } = await import("@/lib/connectors/wix/mappings-store");
    const map = await getWixUrlMap();
    if (map.length === 0) return undefined;
    const paths = new Set(map.map((m) => toPath(m.url)));
    return paths.has(toPath(pageUrl)) || paths.has(toPath(canon));
  } catch {
    return undefined;
  }
}

/**
 * Load the read-only Page Surgeon pack for a recommendation's target URL.
 * Pass `{ history: true }` to include the append-only change history.
 */
export async function loadPageSurgeonForUrl(
  tenantId: string,
  targetUrl: string,
  opts: { history?: boolean } = {},
): Promise<PageSurgeonForUrl> {
  const ctx = await loadPageSurgeonContext(tenantId);
  const canon = resolveCanon(ctx, targetUrl);
  if (!canon) return { status: "no_page" };

  const packet = assemblePacketForUrl(ctx, canon);
  const briefs = await getCachedBriefs(tenantId);
  const brief = briefs.get(packet.current.pageUrl);

  if (!brief) {
    return {
      status: "evidence_only",
      canonUrl: canon,
      pageUrl: packet.current.pageUrl,
      hasGsc: packet.gsc != null,
      sourceCoverage: buildSourceCoverage(packet),
    };
  }

  const siteUrls = [...ctx.snapshotByCanon.values()].map((s) => ({ url: s.url, title: s.title ?? null }));
  const bundle = composeArtifactBundle(brief.decision, packet, siteUrls, controlPaths(ctx, canon));
  const qa = qaArtifactBundle(bundle, packet, Date.now());

  const [decisions, history, mappingExists] = await Promise.all([
    getLatestReviewDecisions(tenantId),
    opts.history ? getBriefHistory(tenantId, packet.current.pageUrl) : Promise.resolve([]),
    resolveMappingExists(packet.current.pageUrl, canon),
  ]);

  const pack = buildAtomicChangePack({
    tenantId,
    canonUrl: canon,
    decision: brief.decision,
    packet,
    bundle,
    qa,
    evidenceHash: evidenceHash(packet),
    generatedAt: brief.created_at,
    reviewDecision: decisions.get(packet.current.pageUrl) ?? null,
    history,
    mappingExists,
  });

  return { status: "pack", pack };
}

/**
 * PSQ1 — compact Page Surgeon status for the QUEUE, keyed by page PATH so the
 * client can match a rec's target URL directly. Only pages that HAVE a brief get
 * a summary (absence ⇒ no pack ⇒ legacy). Bounded by the (small) number of
 * briefs, and the context load is cached (WL7). Read-only, fail-soft.
 */
export async function loadPageSurgeonSummaries(
  tenantId: string,
): Promise<Record<string, PageSurgeonSummary>> {
  const out: Record<string, PageSurgeonSummary> = {};
  try {
    const [ctx, briefs, decisions] = await Promise.all([
      loadPageSurgeonContext(tenantId),
      getCachedBriefs(tenantId),
      getLatestReviewDecisions(tenantId),
    ]);
    const siteUrls = [...ctx.snapshotByCanon.values()].map((s) => ({ url: s.url, title: s.title ?? null }));
    for (const [pageUrl, brief] of briefs) {
      const canon = resolveCanon(ctx, pageUrl);
      if (!canon) continue;
      const packet = assemblePacketForUrl(ctx, canon);
      const bundle = composeArtifactBundle(brief.decision, packet, siteUrls, controlPaths(ctx, canon));
      const qa = qaArtifactBundle(bundle, packet, Date.now());
      const review = decisions.get(packet.current.pageUrl) ?? decisions.get(pageUrl) ?? null;
      out[toPath(pageUrl)] = {
        hasPack: true,
        pageUrl,
        path: toPath(pageUrl),
        qaPass: qa.pass,
        factCheckRequired: qa.factCheckRequired ?? false,
        headlineAction: brief.decision.recommended_atomic_action,
        reviewVerdict: review?.verdict ?? null,
        reviewNote: review?.note ?? null,
      };
    }
  } catch {
    /* fail-soft → whatever we gathered (often empty) */
  }
  return out;
}

/**
 * PS6 — the proof plan: every REVIEWED change (approve / needs_edit) with its
 * measurement window (7/14/28-day check-ins), the GSC metrics that will be
 * re-checked (today's baseline), and the control pages for a diff-in-diff.
 * Read-only, no cron — prepares the proof loop the operator/runner executes.
 */
export async function loadProofPlan(tenantId: string): Promise<ProofPlanRow[]> {
  const [decisions, ctx, briefs] = await Promise.all([
    getLatestReviewDecisions(tenantId),
    loadPageSurgeonContext(tenantId),
    getCachedBriefs(tenantId),
  ]);

  const rows: ProofPlanRow[] = [];
  for (const [pageUrl, decision] of decisions) {
    if (decision.verdict === "reject") continue; // proof loop tracks accepted/edited only
    const canon = resolveCanon(ctx, pageUrl);
    if (!canon) continue;
    const packet = assemblePacketForUrl(ctx, canon);
    const brief = briefs.get(packet.current.pageUrl);
    const g = packet.gsc;
    rows.push(
      buildProofPlanRow({
        pageUrl,
        verdict: decision.verdict,
        headlineAction: brief?.decision.recommended_atomic_action ?? "—",
        decidedAt: decision.created_at,
        measurementPlan: brief?.decision.primary_atomic_change?.measurement ?? null,
        note: decision.note,
        gsc: g
          ? { clicks: g.clicks, impressions: g.impressions, ctr: g.ctr, avgPosition: g.avgPosition, topQuery: g.topQueries[0]?.query ?? "" }
          : null,
        controlPaths: controlPaths(ctx, canon),
      }),
    );
  }
  // Newest decision first.
  rows.sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1));
  return rows;
}
