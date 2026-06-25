import "server-only";
import { cache } from "react";
import { currentTenantId } from "@/lib/tenant-context";
import { getRepository } from "@/lib/persistence/repositories";
import { loadChangePacksForTenant } from "@/domains/demand-graph/gap-compiler";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { titleCandidates, scoreTitle } from "@/domains/demand-graph/ctr-title-scorer";
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
  /** Other engine actions queued on the SAME page (so a page is one card, not many). */
  also: string[];
  outline: string[];
  answerBrief: string | null;
  /** Deterministic, grounded draft skeleton (NO LLM) — what the operator pastes. */
  draftTitle: string | null;
  draftMeta: string | null;
  faqs: string[];
  schema: string[];
  /** CTR Title Lab: scored, deterministic title variants for "capture clicks" Moves. */
  titleVariants: { title: string; score: number; signals: string[] }[];
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

// Hero shows ONLY the engine's Rank-&-Revenue Moves (not every queue row like
// schema fixes), collapsed to one card per page. Priority picks the primary
// action when a page has several.
const ACTION_PRIORITY: Record<string, number> = {
  add_answer_block: 3,
  edit_title: 2,
  fix_page_experience: 1,
  create_page: 0,
};
const CONF_RANK = { high: 3, medium: 2, low: 1 } as const;

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

/** Brand name from the owned domain's first label (e.g. iranopedia.com → Iranopedia). */
function brandFromUrl(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    const label = h.split(".")[0] ?? h;
    return label.replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return "";
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

/** Fail-fast guard: the cockpit must NEVER hang on the heavy demand-graph compute
 *  (the /today statement-timeout class). On timeout the enrichment degrades to
 *  empty and the light queue read still renders the hero. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export const loadTodayMovesHeroData = cache(
  async (): Promise<TodayMovesHeroData> => {
    const tenantId = await currentTenantId();
    const repo = getRepository().forTenant(tenantId);

    const [edits, packets, responses] = await Promise.all([
      repo.getRecommendedEdits().catch(() => []),
      // Enrichment (teardown/outline/proof) rides the heavy graph compute — guard
      // it so a slow graph degrades the hero to the light queue read, never hangs.
      withTimeout(
        loadChangePacksForTenant(tenantId, { limit: 40 }).then((r) => r.packets ?? []),
        8000,
        [] as EvidencePacket[],
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
    for (const p of packets) {
      const u = canon(p.yourPage?.url);
      if (u && !packetByUrl.has(u)) packetByUrl.set(u, p);
    }

    // Collect engine-action, live, not-actioned edits grouped by PAGE — so a page
    // is ONE premium card (primary action + "also on this page"), never several
    // near-duplicate cards. Non-engine queue rows (schema fixes etc.) are excluded;
    // they live in the full queue, not the §7 ritual hero.
    type Edit = (typeof edits)[number];
    const byPage = new Map<string, Edit[]>();
    for (const e of edits) {
      const status = (e as { implementation_status?: string }).implementation_status;
      if (status && status !== "recommended") continue;
      if (!e.target_url) continue;
      if (!(e.action_type in ACTION_META)) continue;
      const moveId = (e as { rec_id?: string; id?: string }).rec_id ?? (e as { id?: string }).id ?? "";
      if (moveId && actioned.has(moveId)) continue;
      const pk = canon(e.target_url);
      const arr = byPage.get(pk) ?? [];
      arr.push(e);
      byPage.set(pk, arr);
    }

    const moves: TodayMove[] = [];
    for (const [pk, pageEdits] of byPage) {
      pageEdits.sort(
        (a, b) =>
          (ACTION_PRIORITY[b.action_type] ?? 0) - (ACTION_PRIORITY[a.action_type] ?? 0) ||
          CONF_RANK[(b.confidence as "high" | "medium" | "low") ?? "low"] -
            CONF_RANK[(a.confidence as "high" | "medium" | "low") ?? "low"],
      );
      const e = pageEdits[0]!;
      const targetUrl = e.target_url!;
      const packet = packetByUrl.get(pk);
      const meta = ACTION_META[e.action_type] ?? { label: "Make this move", tone: "page" as const };
      const also = [
        ...new Set(
          pageEdits
            .slice(1)
            .map((x) => ACTION_META[x.action_type]?.label)
            .filter((l): l is string => Boolean(l) && l !== meta.label),
        ),
      ];
      const { why, proof } = splitWhyProof(e.why ?? "");
      const looselyMatched = packet?.competitor?.looselyMatched ?? false;
      const wwRaw = packet?.competitor?.whatWins?.trim() ?? "";
      const whatWins = wwRaw && wwRaw !== "—" && !looselyMatched ? wwRaw : null;
      const whoCited =
        packet?.competitor?.domain && packet.competitor.fetchStatus === "ok" && !looselyMatched
          ? packet.competitor.domain
          : null;

      const query =
        packet?.move?.label ??
        (e as { topic_cluster_label?: string }).topic_cluster_label ??
        prettyPage(targetUrl);

      // CTR Title Lab — deterministic scored title variants for "capture clicks" Moves.
      let titleVariants: TodayMove["titleVariants"] = [];
      if (e.action_type === "edit_title") {
        const brand = brandFromUrl(targetUrl);
        const year = new Date().getFullYear();
        titleVariants = titleCandidates(query, brand, year)
          .map((t) => scoreTitle(t, query, brand))
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);
      }

      moves.push({
        id: (e as { rec_id?: string; id?: string }).rec_id ?? (e as { id?: string }).id ?? pk,
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
        also,
        outline: (packet?.draft?.outline ?? []).filter(Boolean).slice(0, 5),
        answerBrief: packet?.draft?.answerBlockBrief?.trim() || null,
        draftTitle: packet?.draft?.titleSuggestion?.trim() || null,
        draftMeta: packet?.draft?.metaBrief?.trim() || null,
        faqs: (packet?.draft?.faqQuestions ?? []).filter(Boolean).slice(0, 6),
        schema: (packet?.draft?.schemaRecommendations ?? []).filter(Boolean).slice(0, 6),
        titleVariants,
        score: packet?.move?.score ?? 0,
      });
    }

    // Rank: engine score desc, then confidence, then demand.
    moves.sort(
      (a, b) =>
        b.score - a.score ||
        CONF_RANK[b.confidence] - CONF_RANK[a.confidence] ||
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
