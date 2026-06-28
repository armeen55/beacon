import "server-only";
import { cache } from "react";

import { currentTenantId } from "@/lib/tenant-context";
import { loadActionPackWorklistForTenant } from "@/domains/action-pack/load";
import { getCompetitorAuditsForTenant, whatWins } from "@/domains/demand-graph/competitor-page-audit";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import type { ActionPack } from "@/domains/action-pack/types";

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
  const domMap = new Map<string, { citations: number; prompts: Set<string>; packs: Set<string>; pages: Set<string> }>();
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
    for (const url of p.competitorPagesToBeat) {
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

  // ── Pages to beat — from competitorPagesToBeat, with teardown status ──
  const pageMap = new Map<string, CompetitorPage>();
  for (const p of packs) {
    for (const url of p.competitorPagesToBeat) {
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
  const actionPacks: CompetitorActionPack[] = packs
    .filter((p) => p.competitorPagesToBeat.length > 0)
    .map((p: ActionPack) => ({
      actionPackId: p.id,
      title: p.label,
      targetUrl: p.targetUrl,
      action: ACTION_LABEL_FALLBACK(p.actionType),
      competitorPagesToBeat: p.competitorPagesToBeat.slice(0, 5),
      evidenceSources: p.evidenceSources,
    }))
    .sort((a, b) => b.competitorPagesToBeat.length - a.competitorPagesToBeat.length);

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
    actionPacks,
    gaps: { notTornDown, needsSerpValidation },
  };
}

/** Request-memoized competitor intelligence, ActionPack-spined, cached sources only. */
export const loadCompetitorIntel = cache(
  async (): Promise<CompetitorIntel> => loadUncached(await currentTenantId()),
);
