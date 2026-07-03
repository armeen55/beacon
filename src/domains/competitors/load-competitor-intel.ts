import "server-only";
import { cache } from "react";

import { currentTenantId } from "@/lib/tenant-context";
import { loadActionPackWorklistForTenant } from "@/domains/action-pack/load";
import {
  getCompetitorAuditsForTenant,
  planTeardownTargetsForTenant,
  whatWins,
} from "@/domains/demand-graph/competitor-page-audit";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { competitorRelevance } from "@/domains/evidence/relevance-gate";
import type { ActionPack } from "@/domains/action-pack/types";

/** Evidence relevance gate: a competitor "page to beat" must actually be on-topic for the
 *  ActionPack's subject — never map a Persian-food page to a "Persian Insults" move. */
const pagesToBeatFor = (p: ActionPack): string[] =>
  p.competitorPagesToBeat.filter((url) => competitorRelevance(p.label, { url }).relevant);

/**
 * load-competitor-intel (2026-06-28 — ActionPack execution loop, Phase 6) — the
 * real Competitors map for the tenant, built ONLY from cached/durable sources:
 * the canonical ActionPack worklist (profound receipts: who AI cites + the prompts;
 * competitorPagesToBeat) + the competitor-page-audit teardown cache. NO live Profound
 * / DataForSEO calls, no seed/demo data, no new model. ActionPack is the spine: every
 * competitor maps to the moves that beat them.
 */

export type CompetitorDomain = {
  domain: string;
  citationCount: number;
  promptCount: number;
  actionPackCount: number;
  topPrompts: string[];
  topPages: string[];
};

export type CompetitorPage = {
  url: string;
  domain: string;
  prompts: string[];
  actionPackIds: string[];
  actionPackLabel: string | null;
  teardownStatus: "read" | "blocked" | "not_read";
  whatWins: string | null;
};

export type CompetitorActionPack = {
  actionPackId: string;
  title: string;
  targetUrl: string | null;
  action: string;
  competitorPagesToBeat: string[];
  evidenceSources: string[];
};

/** A prioritized "read this competitor page next" item — turns the raw unread count
 *  into an action queue (read the pages that back your strongest moves first). */
export type CompetitorReadItem = {
  url: string;
  domain: string;
  prompt: string | null;
  moveLabel: string | null;
  why: string;
  teardownStatus: "read" | "blocked" | "not_read";
  /** Distilled "what wins" from the teardown — present once the page is read. */
  whatWins: string | null;
  priority: number;
};

export type CompetitorIntel = {
  summary: {
    competitorDomains: number;
    competitorPages: number;
    aiCitedDomains: number;
    pagesTornDown: number;
    actionPacksToBeatCompetitors: number;
  };
  domains: CompetitorDomain[];
  pages: CompetitorPage[];
  /** Top-20 prioritized "read first" queue (unread pages that back the best moves). */
  readQueue: CompetitorReadItem[];
  actionPacks: CompetitorActionPack[];
  gaps: {
    notTornDown: number;
    needsSerpValidation: number;
  };
};

const EMPTY: CompetitorIntel = {
  summary: { competitorDomains: 0, competitorPages: 0, aiCitedDomains: 0, pagesTornDown: 0, actionPacksToBeatCompetitors: 0 },
  domains: [],
  pages: [],
  readQueue: [],
  actionPacks: [],
  gaps: { notTornDown: 0, needsSerpValidation: 0 },
};

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.replace(/^www\./, "").toLowerCase();
  }
}
const canon = (u: string): string => (canonicalizeCitationUrl(u) ?? u).toLowerCase().replace(/\/+$/, "");
const ACTION_LABEL_FALLBACK = (a: string) => a.replace(/_/g, " ");

type DomainAgg = { citations: number; prompts: Set<string>; packs: Set<string>; pages: Set<string> };

/** Domains (who AI cites instead of us) from profound receipts + pages-to-beat.
 *  PURE over the packs - no audit cache, no teardown planner, no extra reads.
 *  Shared by the full intel loader and the lean rivals loader (FP10b). */
function buildDomains(packs: ActionPack[]): { domains: CompetitorDomain[]; domMap: Map<string, DomainAgg> } {
  const domMap = new Map<string, DomainAgg>();
  const bump = (d: string) => {
    const e = domMap.get(d) ?? { citations: 0, prompts: new Set<string>(), packs: new Set<string>(), pages: new Set<string>() };
    domMap.set(d, e);
    return e;
  };
  for (const p of packs) {
    const r = p.profoundReceipt;
    if (r && r.citedDomains.length) {
      for (const d of r.citedDomains) {
        const dom = domainOf(d);
        const e = bump(dom);
        e.citations += 1;
        if (r.topPrompt.trim()) e.prompts.add(r.topPrompt.trim());
        e.packs.add(p.id);
      }
    }
    for (const url of pagesToBeatFor(p)) {
      const dom = domainOf(url);
      const e = bump(dom);
      e.pages.add(url);
      e.packs.add(p.id);
      if (r?.topPrompt.trim()) e.prompts.add(r.topPrompt.trim());
    }
  }
  const domains: CompetitorDomain[] = [...domMap.entries()]
    .map(([domain, e]) => ({
      domain,
      citationCount: e.citations,
      promptCount: e.prompts.size,
      actionPackCount: e.packs.size,
      topPrompts: [...e.prompts].slice(0, 4),
      topPages: [...e.pages].slice(0, 4),
    }))
    .sort((a, b) => b.citationCount - a.citationCount || b.actionPackCount - a.actionPackCount);
  return { domains, domMap };
}

/** ActionPacks tied to competitor pages. PURE over the packs. */
function buildActionPacks(packs: ActionPack[]): CompetitorActionPack[] {
  return packs
    .map((p: ActionPack) => ({ p, beat: pagesToBeatFor(p) }))
    .filter(({ beat }) => beat.length > 0)
    .map(({ p, beat }) => ({
      actionPackId: p.id,
      title: p.label,
      targetUrl: p.targetUrl,
      action: ACTION_LABEL_FALLBACK(p.actionType),
      competitorPagesToBeat: beat.slice(0, 5),
      evidenceSources: p.evidenceSources,
    }))
    .sort((a, b) => b.competitorPagesToBeat.length - a.competitorPagesToBeat.length);
}

/** The lean slice the /prompts "Who AI recommends instead of you" section
 *  (FP10b) needs: rival domains + the moves that beat them. Reads ONLY the
 *  request-memoized ActionPack worklist - never the teardown audit cache or
 *  the teardown planner, whose demand-graph walk is what makes the full
 *  loader slow enough to need a render deadline. */
export type CompetitorRivals = {
  domains: CompetitorDomain[];
  actionPacks: CompetitorActionPack[];
};

async function loadRivalsUncached(tenantId: string): Promise<CompetitorRivals> {
  const wl = await loadActionPackWorklistForTenant(tenantId).catch(() => null);
  if (!wl) return { domains: [], actionPacks: [] };
  return { domains: buildDomains(wl.packs).domains, actionPacks: buildActionPacks(wl.packs) };
}

/** Request-memoized lean rivals loader (domains + moves only). */
export const loadCompetitorRivals = cache(
  async (): Promise<CompetitorRivals> => loadRivalsUncached(await currentTenantId()),
);

async function loadUncached(tenantId: string): Promise<CompetitorIntel> {
  const [wl, audits] = await Promise.all([
    loadActionPackWorklistForTenant(tenantId).catch(() => null),
    getCompetitorAuditsForTenant().catch(() => new Map()),
  ]);
  if (!wl) return EMPTY;
  const packs = wl.packs;

  // Index teardown audits by canonical URL.
  const auditByUrl = new Map<string, { fetchStatus: string; facts: unknown }>();
  for (const a of audits.values()) {
    auditByUrl.set(canon(a.url), { fetchStatus: a.fetchStatus, facts: a.facts });
  }
  const teardownStatusOf = (url: string): CompetitorPage["teardownStatus"] => {
    const a = auditByUrl.get(canon(url));
    if (!a) return "not_read";
    if (a.fetchStatus === "ok") return "read";
    return "blocked";
  };

  // ── Domains (who AI cites instead of us) — from profound receipts ──
  const { domains, domMap } = buildDomains(packs);

  // ── Pages to beat — from competitorPagesToBeat, with teardown status ──
  const pageMap = new Map<string, CompetitorPage>();
  for (const p of packs) {
    for (const url of pagesToBeatFor(p)) {
      const key = canon(url);
      const existing = pageMap.get(key);
      if (existing) {
        existing.actionPackIds.push(p.id);
        if (p.profoundReceipt?.topPrompt.trim()) existing.prompts.push(p.profoundReceipt.topPrompt.trim());
        continue;
      }
      const a = auditByUrl.get(key);
      pageMap.set(key, {
        url,
        domain: domainOf(url),
        prompts: p.profoundReceipt?.topPrompt.trim() ? [p.profoundReceipt.topPrompt.trim()] : [],
        actionPackIds: [p.id],
        actionPackLabel: p.label,
        teardownStatus: teardownStatusOf(url),
        whatWins: a && a.fetchStatus === "ok" ? (whatWins(a.facts as never) || null) : null,
      });
    }
  }
  const pages = [...pageMap.values()].sort(
    (a, b) => b.actionPackIds.length - a.actionPackIds.length || b.prompts.length - a.prompts.length,
  );

  // ── ActionPacks tied to competitors ──
  const actionPacks: CompetitorActionPack[] = buildActionPacks(packs);

  // ── Prioritized "read these first" queue ──
  // CRITICAL: planTeardownTargetsForTenant is the SAME function the crawler runs, over
  // the SAME population (graph.moves), so the queue shows EXACTLY the URLs the crawler
  // reads — clicking "Read top N" flips THESE rows' badges, not a hidden set of URLs.
  const { targets: planned } = await planTeardownTargetsForTenant(tenantId, { limit: 20 }).catch(
    () => ({ targets: [] as Awaited<ReturnType<typeof planTeardownTargetsForTenant>>["targets"] }),
  );
  // Recover a pack per target (for prompt / draft / demand "why") by URL membership.
  const packByCompUrl = new Map<string, ActionPack>();
  for (const p of packs) {
    for (const u of p.competitorPagesToBeat) {
      const k = canon(u);
      if (!packByCompUrl.has(k)) packByCompUrl.set(k, p);
    }
  }
  const readQueue: CompetitorReadItem[] = planned.map((t) => {
    const key = canon(t.url);
    const audit = auditByUrl.get(key);
    const teardownStatus: CompetitorReadItem["teardownStatus"] = audit
      ? audit.fetchStatus === "ok"
        ? "read"
        : "blocked"
      : "not_read";
    const wins = audit && audit.fetchStatus === "ok" ? whatWins(audit.facts as never) || null : null;
    const dom = domainOf(t.url);
    const domCit = domMap.get(dom)?.citations ?? 0;
    const pk = packByCompUrl.get(key);
    const why: string[] = [];
    let priority = pk?.priorityScore ?? 0;
    if (pk?.draftStatus === "ready") { priority += 1000; why.push("a ready-to-ship move targets it"); }
    if (pk?.gscDemand) { priority += 300; why.push("backs a high-demand worklist move"); }
    if (pk?.profoundReceipt?.ownAbsent) { priority += 200; why.push("AI cites it, not you"); }
    if (t.overlap) { priority += 150; why.push("Google + AI both cite it"); }
    if (domCit > 1) { priority += domCit * 10; why.push(`${dom} cited ${domCit}×`); }
    return {
      url: t.url,
      domain: dom,
      prompt: pk?.profoundReceipt?.topPrompt?.trim() || null,
      moveLabel: pk?.label ?? t.label,
      why: why.slice(0, 2).join("; ") || "backs a worklist move",
      teardownStatus,
      whatWins: wins,
      priority,
    };
  });
  // Unread first (the to-do), then by priority — read items keep their what-wins as the
  // payoff so the queue shows progress, not just an endless backlog.
  readQueue.sort((a, b) => {
    const ua = a.teardownStatus === "read" ? 1 : 0;
    const ub = b.teardownStatus === "read" ? 1 : 0;
    return ua - ub || b.priority - a.priority;
  });
  const readQueueTop = readQueue.slice(0, 20);

  const notTornDown = pages.filter((pg) => pg.teardownStatus === "not_read").length;
  const needsSerpValidation = packs.filter(
    (p) => p.competitorPagesToBeat.length > 0 && !p.dataforseoValidation,
  ).length;

  return {
    summary: {
      competitorDomains: domains.length,
      competitorPages: pages.length,
      aiCitedDomains: [...domMap.entries()].filter(([, e]) => e.citations > 0).length,
      pagesTornDown: pages.filter((pg) => pg.teardownStatus === "read").length,
      actionPacksToBeatCompetitors: actionPacks.length,
    },
    domains,
    pages,
    readQueue: readQueueTop,
    actionPacks,
    gaps: { notTornDown, needsSerpValidation },
  };
}

/** Request-memoized competitor intelligence, ActionPack-spined, cached sources only. */
export const loadCompetitorIntel = cache(
  async (): Promise<CompetitorIntel> => loadUncached(await currentTenantId()),
);
