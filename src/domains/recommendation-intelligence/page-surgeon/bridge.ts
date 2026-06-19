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
import { buildAtomicChangePack, type PageSurgeonForUrl } from "./change-pack";

export type { PageSurgeonForUrl } from "./change-pack";

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

  const [decisions, history] = await Promise.all([
    getLatestReviewDecisions(tenantId),
    opts.history ? getBriefHistory(tenantId, packet.current.pageUrl) : Promise.resolve([]),
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
  });

  return { status: "pack", pack };
}
