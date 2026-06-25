import "server-only";
import { cache } from "react";
import { currentTenantId } from "@/lib/tenant-context";
import { getRepository } from "@/lib/persistence/repositories";
import { loadChangePacksForTenant } from "@/domains/demand-graph/gap-compiler";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import type { EvidencePacket } from "@/domains/demand-graph/evidence-packet";

/**
 * today-moves-data (2026-06-24) — the loader behind the premium "Today's Moves"
 * ritual hero. Fuses the LIVE recommendation queue (persisted `recommended_edits`,
 * the demand-graph engine's promoted Moves) with the engine's EvidencePackets
 * (competitor teardown + grounded outline + demand + proof plan), joined by URL.
 *
 * Tenant-agnostic + read-only: when the engine is off for a tenant there are no
 * packets, so the hero is silent (empty → the section renders nothing). No
 * generation, no LLM, no writes — just the same persisted data the queue shows,
 * made beautiful.
 */

export type TodayMoveAction =
  | "add_answer_block"
  | "edit_title"
  | "fix_page_experience"
  | "create_page"
  | string;

export type TodayMove = {
  id: string;
  action: TodayMoveAction;
  actionLabel: string;
  actionTone: "citation" | "clicks" | "experience" | "page";
  query: string;
  targetUrl: string;
  pageLabel: string;
  why: string;
  proof: string;
  confidence: "high" | "medium" | "low";
  demand: number | null;
  demandBasis: "gsc" | "ai_attention" | "mixed" | null;
  whoCited: string | null;
  whatWins: string | null;
  looselyMatched: boolean;
  outline: string[];
  answerBrief: string | null;
  score: number;
};

export type TodayMovesHeroData = {
  moves: TodayMove[];
  stats: {
    movesReady: number;
    demandAtStake: number;
    citationsContested: number;
    pagesCovered: number;
  };
};

const ACTION_META: Record<
  string,
  { label: string; tone: TodayMove["actionTone"] }
> = {
  add_answer_block: { label: "Win the AI citation", tone: "citation" },
  edit_title: { label: "Capture more clicks", tone: "clicks" },
  fix_page_experience: { label: "Fix the experience", tone: "experience" },
  create_page: { label: "Build a new page", tone: "page" },
};

const PROOF_MARKERS = ["You'll know it worked", "Once it's live"];

/** Pretty page name from a URL's last path segment. */
function prettyPage(url: string): string {
  try {
    const u = new URL(url);
    const slug = u.pathname.split("/").filter(Boolean).pop() ?? u.hostname;
    return slug.replace(/[-_]+/g, " ").trim() || u.hostname;
  } catch {
    return url;
  }
}

/** Split the persisted `why` into the action rationale + the proof sentence
 *  (the candidate builder appends a "You'll know it worked…" proof line). */
function splitWhyProof(whyRaw: string): { why: string; proof: string } {
  const why = (whyRaw ?? "").trim();
  for (const m of PROOF_MARKERS) {
    const i = why.indexOf(m);
    if (i > 0) return { why: why.slice(0, i).trim(), proof: why.slice(i).trim() };
  }
  return { why, proof: "" };
}

function canon(url: string | null | undefined): string {
  if (!url) return "";
  return (canonicalizeCitationUrl(url) ?? url).toLowerCase();
}

export const loadTodayMovesHeroData = cache(
  async (): Promise<TodayMovesHeroData> => {
    const tenantId = await currentTenantId();
    const repo = getRepository().forTenant(tenantId);

    const [edits, packsResult, responses] = await Promise.all([
      repo.getRecommendedEdits().catch(() => []),
      loadChangePacksForTenant(tenantId, { limit: 40 }).catch(
        () => ({ packets: [] as EvidencePacket[] }),
      ),
      repo.getRecommendationResponses().catch(() => []),
    ]);

    // Skip Moves the operator already shipped/dismissed — so a one-tap "Ship it"
    // removes the card on the next render (the action revalidates "/").
    const actioned = new Set<string>();
    const nowMs = Date.now();
    for (const r of responses as ReadonlyArray<{ recId: string; status: string; deferUntil?: string | null }>) {
      if (r.status === "accepted" || r.status === "dismissed") actioned.add(r.recId);
      else if (r.status === "deferred" && r.deferUntil && new Date(r.deferUntil).getTime() > nowMs) actioned.add(r.recId);
    }

    // Index packets by the owned page URL (the join key to a queued edit).
    const packetByUrl = new Map<string, EvidencePacket>();
    for (const p of packsResult.packets ?? []) {
      const u = canon(p.yourPage?.url);
      if (u && !packetByUrl.has(u)) packetByUrl.set(u, p);
    }

    const moves: TodayMove[] = [];
    const seen = new Set<string>();
    for (const e of edits) {
      // Only live, not-yet-actioned queue items.
      const status = (e as { implementation_status?: string }).implementation_status;
      if (status && status !== "recommended") continue;
      const targetUrl = e.target_url;
      if (!targetUrl) continue;
      const key = canon(targetUrl) + "::" + e.action_type;
      if (seen.has(key)) continue;
      const moveId =
        (e as { rec_id?: string; id?: string }).rec_id ??
        (e as { id?: string }).id ??
        key;
      if (actioned.has(moveId)) continue; // already shipped / dismissed / deferred

      const packet = packetByUrl.get(canon(targetUrl));
      // Hero = the engine's Rank-&-Revenue Moves: either action types the engine
      // emits OR any queued edit we can enrich with a packet. Skip the rest so
      // the hero stays the premium "moves" surface, not the full queue.
      const isEngineAction = e.action_type in ACTION_META;
      if (!packet && !isEngineAction) continue;
      seen.add(key);

      const meta = ACTION_META[e.action_type] ?? { label: "Make this move", tone: "page" as const };
      const { why, proof } = splitWhyProof(e.why ?? "");
      const looselyMatched = packet?.competitor?.looselyMatched ?? false;
      const wwRaw = packet?.competitor?.whatWins?.trim() ?? "";
      const whatWins = wwRaw && wwRaw !== "—" && !looselyMatched ? wwRaw : null;
      const whoCited =
        packet?.competitor?.domain &&
        packet.competitor.fetchStatus === "ok" &&
        !looselyMatched
          ? packet.competitor.domain
          : null;

      moves.push({
        id: (e as { rec_id?: string; id?: string }).rec_id ?? (e as { id?: string }).id ?? key,
        action: e.action_type,
        actionLabel: meta.label,
        actionTone: meta.tone,
        query: packet?.move?.label ?? (e as { topic_cluster_label?: string }).topic_cluster_label ?? prettyPage(targetUrl),
        targetUrl,
        pageLabel: prettyPage(targetUrl),
        why: why || "Queued in your recommendations and ready to act on.",
        proof,
        confidence: (e.confidence as "high" | "medium" | "low") ?? "medium",
        demand: packet?.demand?.demandWeight ?? null,
        demandBasis: packet?.demand?.basis ?? null,
        whoCited,
        whatWins,
        looselyMatched,
        outline: (packet?.draft?.outline ?? []).filter(Boolean).slice(0, 5),
        answerBrief: packet?.draft?.answerBlockBrief?.trim() || null,
        score: packet?.move?.score ?? 0,
      });
    }

    // Rank: engine score desc, then confidence, then demand.
    const confRank = { high: 3, medium: 2, low: 1 } as const;
    moves.sort(
      (a, b) =>
        b.score - a.score ||
        confRank[b.confidence] - confRank[a.confidence] ||
        (b.demand ?? 0) - (a.demand ?? 0),
    );
    const top = moves.slice(0, 6);

    const demandAtStake = top.reduce((s, m) => s + (m.demand ?? 0), 0);
    const citationsContested = top.filter((m) => m.action === "add_answer_block").length;
    const pagesCovered = new Set(top.map((m) => canon(m.targetUrl))).size;

    return {
      moves: top,
      stats: {
        movesReady: top.length,
        demandAtStake: Math.round(demandAtStake),
        citationsContested,
        pagesCovered,
      },
    };
  },
);
