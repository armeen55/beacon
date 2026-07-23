/**
 * snapshot-loader (2026-07-22) — the I/O edge for the EvidenceSnapshot kernel.
 * It REUSES the existing cached connector readers (it does not re-read or
 * re-shape connectors) to assemble the six loaded-source payloads, then hands
 * them to the PURE `buildEvidenceSnapshot`. Every source is wrapped fail-soft:
 * a throw becomes `status: "failed"` with an empty payload, an empty read
 * becomes `status: "empty"`, and native AI with no observation rows becomes
 * `status: "dormant"` — the source slot is ALWAYS present so its absence is
 * honest and visible on every surface.
 *
 * Build-pass note: additive. No consumer is rewired onto this yet; the cutover
 * that repoints Decisions + surfaces and deletes the old engines is later.
 */

import "server-only";

import { log } from "@/lib/logger";
import { loadGscPageSignalsForTenant, type GscPageSignal } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { loadGa4PageValuesForTenant, loadGa4PageRevenueForTenant, type Ga4PageValue } from "@/domains/recommendation-intelligence/ga4-page-values";
import type { PageRevenueValue } from "@/domains/recommendation-intelligence/ga4-revenue";
import { loadClarityPageSignalsForTenant, type ClarityPageSignal } from "@/domains/recommendation-intelligence/clarity-page-signals";
import { readAllCachedKeywordDemand } from "@/domains/serp/dataforseo-keywords";
import { loadNativeIntelForTenant } from "@/domains/ai-visibility/native-intel-loader";
import { getPageSnapshots } from "@/domains/pages/snapshot-store";

import {
  buildEvidenceSnapshot,
  canonicalUrlKey,
  type EvidenceSnapshot,
  type EvidenceSnapshotInput,
  type LoadedSource,
  type OwnedPageContent,
} from "./snapshot";
import { domainOf } from "./relevance-gate";

/** Run one source reader fail-soft, mapping throw → failed, empty → empty. */
async function loadSource<T>(
  label: string,
  read: () => Promise<T>,
  isEmpty: (value: T) => boolean,
  empty: T,
): Promise<LoadedSource<T>> {
  try {
    const value = await read();
    return {
      status: isEmpty(value) ? "empty" : "fresh",
      lastSyncedAt: null,
      payload: value,
    };
  } catch (e) {
    log.warn(`[evidence-snapshot] ${label} read failed (fail-soft)`, {
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    return { status: "failed", lastSyncedAt: null, payload: empty };
  }
}

export type LoadEvidenceSnapshotOptions = {
  /** Site host (e.g. "iranopedia.com") used to tell owned vs competitor AI
   *  citations apart. Falls back to the most common owned-page host. */
  site?: string | null;
  now?: Date;
};

/**
 * Assemble a normalized EvidenceSnapshot for a tenant from cached evidence only
 * ($0 — no paid API call). Deterministic given the cache; the only clock is
 * `now` (→ scope.builtAt).
 */
export async function loadEvidenceSnapshot(
  tenantId: string,
  options: LoadEvidenceSnapshotOptions = {},
): Promise<EvidenceSnapshot> {
  const now = options.now ?? new Date();

  const [gscMap, ga4Map, revenueMap, clarityMap, keywordRows, nativeSource, snapshots] =
    await Promise.all([
      loadGscPageSignalsForTenant(tenantId, now).catch(() => new Map<string, GscPageSignal>()),
      loadGa4PageValuesForTenant(tenantId, now).catch(() => new Map<string, Ga4PageValue>()),
      loadGa4PageRevenueForTenant(tenantId, now).catch(() => new Map<string, PageRevenueValue>()),
      loadClarityPageSignalsForTenant(tenantId, now).catch(() => new Map<string, ClarityPageSignal>()),
      readAllCachedKeywordDemand({ now: () => now }).catch(() => []),
      loadSourceNativeIntel(tenantId),
      getPageSnapshots().catch(() => []),
    ]);

  // ── GSC ──
  const gscPayload = [...gscMap.values()].map((s) => ({
    url: s.page,
    clicks90d: s.clicks90d,
    impressions90d: s.impressions90d,
    ctr90d: s.ctr90d,
    position90d: s.position90d,
    topQueries: (s.topQueries ?? []).map((q) => ({
      query: q.query,
      impressions: q.impressions,
      clicks: q.clicks,
      position: q.position ?? null,
    })),
  }));

  // ── GA4 (engagement joined with revenue) ──
  const ga4Payload = [...ga4Map.values()].map((v) => {
    const rev = revenueMap.get(v.page);
    return {
      url: v.page,
      sessions28d: v.sessions28d,
      engaged28d: v.engaged28d,
      conversions28d: v.conversions28d,
      revenueUsd: rev?.revenue ?? null,
    };
  });

  // ── Clarity ──
  const clarityPayload = [...clarityMap.values()].map((c) => ({
    url: c.url,
    sessions: c.sessions,
    rageClicks: c.rageClicks,
    deadClicks: c.deadClicks,
    quickbacks: c.quickbacks,
    scriptErrors: c.scriptErrors,
    frictionScore: c.rageClicks + c.deadClicks + 2 * c.scriptErrors,
  }));

  // ── Wix / crawl content (owned pages for this tenant) ──
  const wixPayload = snapshots
    .filter((s) => s.tenant_id === tenantId)
    .map((s): { url: string } & OwnedPageContent => ({
      url: s.url,
      title: s.title,
      metaDescription: s.meta_description,
      h1: s.h1,
      h2: s.h2_list ?? [],
      outline: [...(s.h2_list ?? []), ...(s.h3_list ?? [])],
      schemaTypes: s.schema_types ?? [],
      hasFaq: (s.faqs?.length ?? 0) > 0,
      faqCount: s.faqs?.length ?? 0,
      wordCount: s.word_count ?? 0,
      internalLinks: (s.internal_links ?? []).map((l) => ({ href: l.href, anchorText: l.anchor_text })),
      fetchedAt: s.fetched_at ?? null,
    }));
  // Keep the newest snapshot per URL only.
  const wixByUrl = new Map<string, { url: string } & OwnedPageContent>();
  for (const row of wixPayload) {
    const key = canonicalUrlKey(row.url);
    const existing = wixByUrl.get(key);
    if (!existing || (row.fetchedAt ?? "") > (existing.fetchedAt ?? "")) wixByUrl.set(key, row);
  }

  // ── DataForSEO keyword volume ──
  const dfsPayload = keywordRows.map((k) => ({
    query: k.keyword,
    searchVolume: k.searchVolume,
    competition: k.competition,
    competitionLevel: k.competitionLevel,
  }));

  // ── site host for owned/competitor split ──
  const ownedHosts = new Map<string, number>();
  for (const p of gscPayload) {
    const h = domainOf(p.url);
    if (h) ownedHosts.set(h, (ownedHosts.get(h) ?? 0) + 1);
  }
  const site =
    options.site ??
    [...ownedHosts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    null;
  const ownedUrlKeys = new Set([
    ...gscPayload.map((p) => canonicalUrlKey(p.url)),
    ...[...wixByUrl.keys()],
  ]);

  const input: EvidenceSnapshotInput = {
    scope: { tenantId, site, builtAt: now.toISOString() },
    gsc: { status: statusFor(gscPayload.length), lastSyncedAt: null, payload: gscPayload },
    ga4: { status: statusFor(ga4Payload.length), lastSyncedAt: null, payload: ga4Payload },
    wix: { status: statusFor(wixByUrl.size), lastSyncedAt: null, payload: [...wixByUrl.values()] },
    clarity: { status: statusFor(clarityPayload.length), lastSyncedAt: null, payload: clarityPayload },
    dataforseo: { status: statusFor(dfsPayload.length), lastSyncedAt: null, payload: dfsPayload },
    nativeAi: buildNativeSourceInput(nativeSource, site, ownedUrlKeys),
  };

  return buildEvidenceSnapshot(input);
}

function statusFor(count: number): "fresh" | "empty" {
  return count > 0 ? "fresh" : "empty";
}

// ── native AI adapter (fail-soft / dormant) ──────────────────────────────────

type NativeSourceResult =
  | { ok: true; report: Awaited<ReturnType<typeof loadNativeIntelForTenant>> }
  | { ok: false };

async function loadSourceNativeIntel(tenantId: string): Promise<NativeSourceResult> {
  try {
    const report = await loadNativeIntelForTenant(tenantId);
    return { ok: true, report };
  } catch (e) {
    log.warn("[evidence-snapshot] native AI read failed (fail-soft / dormant)", {
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    return { ok: false };
  }
}

function buildNativeSourceInput(
  result: NativeSourceResult,
  site: string | null,
  ownedUrlKeys: Set<string>,
): EvidenceSnapshotInput["nativeAi"] {
  if (!result.ok) {
    return {
      status: "failed",
      lastSyncedAt: null,
      note: "I could not read AI-answer observations this run.",
      payload: { citedPages: [], questions: [], rowsScanned: 0, enginesSeen: [] },
    };
  }
  const { report } = result;
  const citedPages = report.recurringPages.map((p) => {
    const key = canonicalUrlKey(p.url);
    const isOwned = ownedUrlKeys.has(key) || (site != null && domainOf(p.url) === site);
    return {
      url: p.url,
      isOwned,
      citationCount: p.citationCount,
      distinctPrompts: p.distinctPrompts,
      engines: p.engines,
      examplePrompts: p.examplePrompts,
    };
  });
  const questions = report.nativeQuestions.map((q) => ({
    text: q.text,
    weight: q.weight,
    sourcePrompts: q.sourcePrompts,
  }));
  // rowsScanned 0 = no observations exist yet → the adapter is present but
  // dormant (not configured / no nightly runs), reported honestly.
  const status = report.rowsScanned === 0 ? "dormant" : citedPages.length > 0 ? "fresh" : "empty";
  return {
    status,
    lastSyncedAt: null,
    payload: {
      citedPages,
      questions,
      rowsScanned: report.rowsScanned,
      enginesSeen: report.enginesSeen,
    },
  };
}
