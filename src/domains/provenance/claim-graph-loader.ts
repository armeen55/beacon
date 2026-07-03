import "server-only";

import { cache } from "react";

import { log } from "@/lib/logger";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { currentTenantId } from "@/lib/tenant-context";
import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { getCompetitorAuditsForTenant } from "@/domains/demand-graph/competitor-page-audit";
import { readPageBodyTextForEntailment } from "@/domains/drafts/factual-entailment-store";
import { checkFactualEntailment } from "@/domains/drafts/factual-entailment";

import {
  buildClaimGraph,
  findClaimSentence,
  mergeRegisteredRecords,
  registrationRecordsForDraft,
  MAX_CLAIMS_PER_TENANT,
  type ClaimRecord,
  type DraftCorrectionEvidence,
  type PageTextInput,
  type TeardownTextInput,
} from "./claim-graph";
import {
  buildFactPropagationPlan,
  findFactCorrections,
  prepareCarrierFix,
  propagationCarriers,
  type FactPropagationCarrierFix,
  type FactPropagationPlan,
} from "./fact-propagation";

/**
 * claim-graph-loader (BEACON_500 R13 / N3, 2026-07-03) - the I/O boundary for
 * provenance/claim-graph.ts. Reads only what Beacon ALREADY stores ($0, no
 * paid call, no LLM anywhere here):
 *
 *   pages      page_snapshots body samples + card texts + FAQ answers for the
 *              highest-traffic pages (GSC 90d impressions rank the cap fill)
 *   teardowns  the competitor-page-audit cache (title/H1/outline/FAQ text,
 *              each dated by auditedAt) - dated competitor sources
 *   prior      this tenant's previous "claim-graph" rows (keeps firstSeenAt
 *              stable and preserves shipped-draft registrations)
 *
 * Persisted to the "claim-graph" json-store (GLOBAL classification, rows
 * carry tenant_id - written by the nightly cron fan-out with no request
 * context; Supabase-mirrored so the graph survives Vercel lambda recycling).
 * Rebuilt nightly as one isolated fail-soft cron phase; consumers read the
 * persisted rows and self-hide when the store is empty.
 *
 * Ship-time registration: registerShippedDraftClaims() is called (fail-soft,
 * never blocking) from the stage path after a live push lands - the shipped
 * draft's checked facts enter the graph with their evidence, including any
 * N8 correction findings' dated sources.
 */

export const CLAIM_GRAPH_STORE = "claim-graph";
/** N26 (R13b): the per-correction propagation plans, newest first. */
export const FACT_PROPAGATION_STORE = "fact-propagation-plans";

/** Bound the nightly read: this many highest-traffic pages feed extraction. */
const MAX_EXTRACT_PAGES = 60;
/** Bound the teardown attach pass. */
const MAX_TEARDOWN_SOURCES = 40;
/** One ship never plans more than this many corrections (bounded I/O). */
const MAX_PROPAGATION_PLANS_PER_SHIP = 3;
/** The propagation history is capped per tenant, newest kept. */
const MAX_PROPAGATION_PLANS_PER_TENANT = 100;

type SnapshotBodyRow = {
  url: string;
  fetched_at: string | null;
  body_paragraph_sample: string[] | null;
  card_texts: string[] | null;
  faqs: { answer_excerpt?: string }[] | null;
};

/** Bounded page_snapshots body read (newest snapshot per URL wins), joined
 *  with the traffic rank. Fail-soft -> []. */
async function readPageTexts(tenantId: string): Promise<PageTextInput[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const traffic = await loadGscPageSignalsForTenant(tenantId).catch(
      () => new Map<string, { impressions90d: number }>(),
    );
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("page_snapshots")
      .select("url, fetched_at, body_paragraph_sample, card_texts, faqs")
      .eq("tenant_id", tenantId)
      .order("fetched_at", { ascending: false })
      .limit(MAX_EXTRACT_PAGES * 3);
    if (error || !Array.isArray(data)) return [];
    const byUrl = new Map<string, PageTextInput>();
    for (const r of data as SnapshotBodyRow[]) {
      const key = (r.url ?? "").toLowerCase();
      if (!key || byUrl.has(key)) continue; // newest snapshot per URL wins
      const text = [
        ...(r.body_paragraph_sample ?? []),
        ...(r.card_texts ?? []),
        ...(r.faqs ?? []).map((f) => f?.answer_excerpt ?? "").filter(Boolean),
      ]
        .join(" ")
        .trim();
      if (!text) continue;
      const signal = traffic.get(r.url) ?? traffic.get(key);
      byUrl.set(key, {
        url: r.url,
        traffic: signal?.impressions90d ?? 0,
        text,
        observedAt: r.fetched_at ?? null,
      });
    }
    return [...byUrl.values()]
      .sort((a, b) => b.traffic - a.traffic || a.url.localeCompare(b.url))
      .slice(0, MAX_EXTRACT_PAGES);
  } catch (e) {
    log.warn("[claim-graph] page text read failed (fail-soft)", {
      tenantId,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    return [];
  }
}

/** The teardown cache as dated competitor text sources. Fail-soft -> [].
 *  getCompetitorAuditsForTenant reads the TENANT-SCOPED store off ambient
 *  tenant context, so in a cron fan-out this only contributes when the
 *  ambient tenant matches the one being rebuilt - otherwise it honestly
 *  skips (never misfiles another tenant's teardown text into this graph). */
async function readTeardownTexts(tenantId: string): Promise<TeardownTextInput[]> {
  try {
    const ambient = await currentTenantId().catch(() => null);
    if (ambient !== tenantId) return [];
    const audits = await getCompetitorAuditsForTenant();
    return [...audits.values()]
      .filter((a) => a.facts != null)
      .slice(0, MAX_TEARDOWN_SOURCES)
      .map((a) => ({
        domain: a.domain,
        url: a.url,
        observedAt: a.auditedAt ?? null,
        texts: [
          a.facts?.title ?? "",
          a.facts?.h1 ?? "",
          ...(a.facts?.outline ?? []),
          ...(a.facts?.faqQuestions ?? []),
        ].filter(Boolean),
      }));
  } catch (e) {
    log.warn("[claim-graph] teardown read failed (fail-soft)", {
      tenantId,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    return [];
  }
}

async function readTenantRows(tenantId: string): Promise<ClaimRecord[]> {
  const all = await readStore<ClaimRecord>(CLAIM_GRAPH_STORE, []);
  return all.filter((r) => r.tenant_id === tenantId);
}

async function writeTenantRows(tenantId: string, rows: readonly ClaimRecord[]): Promise<void> {
  const all = await readStore<ClaimRecord>(CLAIM_GRAPH_STORE, []);
  const others = all.filter((r) => r.tenant_id !== tenantId);
  await writeStore(CLAIM_GRAPH_STORE, [...others, ...rows.slice(0, MAX_CLAIMS_PER_TENANT)]);
}

export type ClaimGraphRebuildResult = {
  tenantId: string;
  claims: number;
  conflicting: number;
  consistent: number;
  unverified: number;
};

/**
 * The nightly cron phase entry: rebuild this tenant's claim graph from the
 * stored page bodies + teardown cache, merged with prior rows (firstSeenAt
 * stable; shipped-draft registrations preserved), and persist it, replacing
 * ONLY this tenant's rows. Never throws.
 */
export async function rebuildClaimGraphForTenant(tenantId: string): Promise<ClaimGraphRebuildResult> {
  const empty: ClaimGraphRebuildResult = { tenantId, claims: 0, conflicting: 0, consistent: 0, unverified: 0 };
  if (!tenantId) return empty;
  try {
    const [pages, teardowns, prior] = await Promise.all([
      readPageTexts(tenantId),
      readTeardownTexts(tenantId),
      readTenantRows(tenantId).catch(() => [] as ClaimRecord[]),
    ]);
    if (pages.length === 0 && prior.length === 0) return empty;
    const records = buildClaimGraph({
      tenantId,
      pages,
      teardowns,
      priorRecords: prior,
      nowIso: new Date().toISOString(),
    });
    try {
      await writeTenantRows(tenantId, records);
    } catch (e) {
      log.warn("[claim-graph] persist failed (graph still built in-memory)", {
        tenantId,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }
    return {
      tenantId,
      claims: records.length,
      conflicting: records.filter((r) => r.status === "conflicting").length,
      consistent: records.filter((r) => r.status === "consistent").length,
      unverified: records.filter((r) => r.status === "unverified").length,
    };
  } catch (e) {
    log.warn("[claim-graph] rebuild failed (fail-soft)", {
      tenantId,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    return empty;
  }
}

/**
 * The consumer read: this tenant's persisted claim records. Empty when the
 * nightly phase has not built a graph yet - every consumer treats empty as
 * byte-identical silence (no evidence lines, no trigger, self-hiding
 * diagnostics section). React cache()-d per request. Never throws.
 */
export const loadClaimGraphForTenant = cache(async (tenantId: string): Promise<ClaimRecord[]> => {
  if (!tenantId) return [];
  try {
    return await readTenantRows(tenantId);
  } catch (e) {
    log.warn("[claim-graph] read failed (fail-soft to empty)", {
      tenantId,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    return [];
  }
});

/**
 * Ship-time registration (the same seam N8 factual-entailment occupies): a
 * draft that just SHIPPED registers its checked facts into the graph with
 * their evidence. The entailment check re-runs here (pure, cheap) against
 * the page's stored body so any dated correction finding attaches as a
 * correction_evidence source; every other extractable claim registers with
 * an operator source (the operator approved and shipped this text).
 * Fail-soft and additive: never throws, never blocks a landed stage.
 */
export async function registerShippedDraftClaims(args: {
  tenantId: string;
  targetUrl: string;
  draftText: string | null | undefined;
}): Promise<void> {
  const draftText = (args.draftText ?? "").trim();
  if (!args.tenantId || !args.targetUrl || !draftText) return;
  try {
    let corrections: DraftCorrectionEvidence[] = [];
    try {
      const pageBodyText = await readPageBodyTextForEntailment(args.tenantId, args.targetUrl);
      const result = checkFactualEntailment({ draftText, pageBodyText });
      corrections = result.findings
        .filter((f) => f.kind === "correction" && f.source && f.date)
        .map((f) => ({ source: f.source!, date: f.date!, message: f.message }));
    } catch {
      /* registration proceeds with operator sources only */
    }
    const nowIso = new Date().toISOString();
    const registered = registrationRecordsForDraft({
      tenantId: args.tenantId,
      targetUrl: args.targetUrl,
      draftText,
      corrections,
      nowIso,
    });
    if (registered.length === 0) return;
    const existing = await readTenantRows(args.tenantId).catch(() => [] as ClaimRecord[]);
    let merged = mergeRegisteredRecords(existing, registered);

    // N26 (R13b): the operator just corrected a fact when a shipped claim
    // MATERIALLY differs from a prior record on the same subject. Plan the
    // propagation ONCE per corrected record (propagationPlannedAt), find
    // every OTHER affected page still carrying the old value, and prepare
    // the same one-line fix for each from its stored sentence. Fail-soft:
    // a propagation failure never blocks the registration write.
    try {
      const plannedIds = new Set<string>();
      const plans: FactPropagationPlan[] = [];
      for (const correction of findFactCorrections({ existing, registered }).slice(
        0,
        MAX_PROPAGATION_PLANS_PER_SHIP,
      )) {
        const carriers = propagationCarriers(correction.oldRecord, args.targetUrl);
        if (carriers.length === 0) continue;
        const fixes: FactPropagationCarrierFix[] = [];
        for (const carrier of carriers) {
          const pageText = await readPageBodyTextForEntailment(args.tenantId, carrier.pageUrl).catch(
            () => null,
          );
          fixes.push(
            prepareCarrierFix({
              ...carrier,
              sentence: pageText ? findClaimSentence(pageText, correction.oldRecord) : null,
              oldValueRaw: correction.oldRecord.value.raw,
              newValueRaw: correction.newValue.raw,
            }),
          );
        }
        plans.push(
          buildFactPropagationPlan({
            tenantId: args.tenantId,
            correction,
            correctedPageUrl: args.targetUrl,
            carriers: fixes,
            nowIso,
          }),
        );
        plannedIds.add(correction.oldRecord.id);
      }
      if (plans.length > 0) {
        merged = merged.map((r) =>
          plannedIds.has(r.id) ? { ...r, propagationPlannedAt: nowIso } : r,
        );
        await appendPropagationPlans(args.tenantId, plans);
      }
    } catch (e) {
      log.warn("[claim-graph] fact propagation planning failed (fail-soft)", {
        tenantId: args.tenantId,
        targetUrl: args.targetUrl,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }

    await writeTenantRows(args.tenantId, merged);
  } catch (e) {
    log.warn("[claim-graph] shipped-draft registration failed (fail-soft)", {
      tenantId: args.tenantId,
      targetUrl: args.targetUrl,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
  }
}

// ---------------------------------------------------------------------------
// N26 propagation plan store (append at ship time; read by diagnostics)
// ---------------------------------------------------------------------------

/** Append this ship's plans (newest first), replacing ONLY this tenant's
 *  slice, deduped by plan id, capped per tenant. */
async function appendPropagationPlans(
  tenantId: string,
  plans: readonly FactPropagationPlan[],
): Promise<void> {
  const all = await readStore<FactPropagationPlan>(FACT_PROPAGATION_STORE, []);
  const others = all.filter((p) => p.tenant_id !== tenantId);
  const seen = new Set<string>();
  const mine: FactPropagationPlan[] = [];
  for (const p of [...plans, ...all.filter((r) => r.tenant_id === tenantId)]) {
    if (seen.has(p.id) || mine.length >= MAX_PROPAGATION_PLANS_PER_TENANT) continue;
    seen.add(p.id);
    mine.push(p);
  }
  await writeStore(FACT_PROPAGATION_STORE, [...others, ...mine]);
}

/**
 * The propagation history for /diagnostics/provenance, newest first. Empty
 * until a correction ships that other pages still carry - every consumer
 * treats empty as byte-identical silence. Never throws.
 */
export const loadFactPropagationPlansForTenant = cache(
  async (tenantId: string): Promise<FactPropagationPlan[]> => {
    if (!tenantId) return [];
    try {
      const all = await readStore<FactPropagationPlan>(FACT_PROPAGATION_STORE, []);
      return all.filter((p) => p.tenant_id === tenantId);
    } catch (e) {
      log.warn("[claim-graph] propagation plan read failed (fail-soft to empty)", {
        tenantId,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      return [];
    }
  },
);
