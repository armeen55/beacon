import "server-only";

/**
 * build-index (2026-07-02, master plan item 50) - the retrieval twin's bounded indexer.
 * Chunks + embeds owned page snapshots and competitor teardown facts into the shared
 * `retrieval_chunks` cache, so `retrieve.ts`/`citation-likelihood.ts` can simulate the
 * retrieval step of an answer engine.
 *
 * Bounded by construction: at most MAX_OWNED_PAGES owned pages (top by GSC impressions,
 * the tenant's own demand signal) and ALL cached competitor audits (already bounded to
 * ~20 by the teardown crawler itself - see competitor-page-audit.ts's DEFAULT_TOP_N).
 * Owned page reads are paged at 1000 rows so a large site's snapshot table is never read
 * unbounded, even though the OWNED page count we actually chunk stays small.
 *
 * Operator-triggered only (see the "Check who wins the answer race" action) - this module
 * has no cron/nightly caller. Fail-soft throughout: a read/embed failure for one page never
 * aborts the whole run.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { getCompetitorAuditsForTenantId, type CompetitorPageAudit } from "@/domains/demand-graph/competitor-page-audit";
import { chunkStructuredPage, type Chunk } from "./chunker";
import { embedChunks, contentHashOf, type EmbeddableChunk } from "./embeddings";
import { log } from "@/lib/logger";

export const MAX_OWNED_PAGES = 150;
const SUPABASE_PAGE_SIZE = 1000;
const MAX_CHUNKS_PER_PAGE = 15;

/** Lean projection of an owned page_snapshots row - only the fields we chunk. Deliberately
 *  narrower than the shared repository projections (which drop body_paragraph_sample/
 *  card_texts to protect hot web-render egress); this indexer runs bounded + operator-
 *  triggered, so pulling those fields for <=MAX_OWNED_PAGES rows is safe. */
type OwnedSnapshotRow = {
  url: string;
  title: string | null;
  meta_description: string | null;
  h1: string | null;
  h2_list: string[] | null;
  body_paragraph_sample: string[] | null;
  card_texts: string[] | null;
  faqs: { question: string }[] | null;
};

/** One row of "which owned URLs matter most" - GSC impressions as the demand proxy. */
export type OwnedPageDemand = { url: string; impressions: number };

/**
 * Rank owned page URLs by demand (GSC impressions, best-first) and take the top N. Pure -
 * the caller supplies the demand rows (already read from gsc_daily_rows or the demand graph).
 * Pages absent from the demand list sort last (impressions treated as 0), so a fresh page
 * with no GSC history yet still gets indexed if there's room within the cap.
 */
export function pickTopOwnedUrls(allUrls: ReadonlyArray<string>, demand: ReadonlyArray<OwnedPageDemand>, limit: number): string[] {
  const byUrl = new Map(demand.map((d) => [d.url, d.impressions]));
  const seen = new Set<string>();
  const deduped = allUrls.filter((u) => {
    if (!u || seen.has(u)) return false;
    seen.add(u);
    return true;
  });
  return [...deduped].sort((a, b) => (byUrl.get(b) ?? 0) - (byUrl.get(a) ?? 0)).slice(0, Math.max(0, limit));
}

/** Read owned page_snapshots for a bounded set of URLs, paged at 1000 rows. Fail-soft -> []. */
async function readOwnedSnapshots(tenantId: string, urls: ReadonlyArray<string>): Promise<OwnedSnapshotRow[]> {
  if (!isSupabaseConfigured() || urls.length === 0) return [];
  const wanted = new Set(urls);
  const out: OwnedSnapshotRow[] = [];
  try {
    const sb = getSupabaseAdmin();
    let from = 0;
    for (;;) {
      const { data, error } = await sb
        .from("page_snapshots")
        .select("url, title, meta_description, h1, h2_list, body_paragraph_sample, card_texts, faqs, fetched_at")
        .eq("tenant_id", tenantId)
        .order("fetched_at", { ascending: false })
        .range(from, from + SUPABASE_PAGE_SIZE - 1);
      if (error) {
        log.warn?.("[retrieval-twin] owned snapshot read failed (non-fatal)", { error: error.message });
        break;
      }
      const rows = (data ?? []) as OwnedSnapshotRow[];
      for (const r of rows) if (wanted.has(r.url) && !out.some((o) => o.url === r.url)) out.push(r);
      if (rows.length < SUPABASE_PAGE_SIZE || out.length >= wanted.size) break;
      from += SUPABASE_PAGE_SIZE;
    }
  } catch (e) {
    log.warn?.("[retrieval-twin] owned snapshot read threw (non-fatal)", { error: e instanceof Error ? e.message : String(e) });
  }
  return out;
}

function ownedRowToChunks(row: OwnedSnapshotRow): Chunk[] {
  return chunkStructuredPage(
    {
      title: row.title,
      metaDescription: row.meta_description,
      h1: row.h1,
      headings: row.h2_list ?? [],
      bodyParagraphs: [...(row.body_paragraph_sample ?? []), ...(row.card_texts ?? [])],
      faqQuestions: (row.faqs ?? []).map((f) => f.question).filter(Boolean),
    },
    { maxChunks: MAX_CHUNKS_PER_PAGE },
  );
}

function competitorAuditToChunks(audit: CompetitorPageAudit): Chunk[] {
  if (!audit.facts) return [];
  return chunkStructuredPage(
    {
      title: audit.facts.title,
      metaDescription: audit.facts.metaDescription,
      h1: audit.facts.h1,
      headings: audit.facts.outline,
      faqQuestions: audit.facts.faqQuestions,
    },
    { maxChunks: MAX_CHUNKS_PER_PAGE },
  );
}

export type IndexRunResult = {
  status: "ok" | "no_content" | "error";
  ownedPagesConsidered: number;
  competitorPagesConsidered: number;
  chunksBuilt: number;
  chunksEmbedded: number;
  cacheHits: number;
  chunksSkipped: number;
  spentUsd: number;
  /** Operator-facing receipt. First person, concrete numbers, no dashes. */
  message: string;
};

export type BuildIndexDeps = {
  readOwnedDemand: (tenantId: string) => Promise<OwnedPageDemand[]>;
  readOwnedUrls: (tenantId: string) => Promise<string[]>;
  readOwnedSnapshots: (tenantId: string, urls: string[]) => Promise<OwnedSnapshotRow[]>;
  readCompetitorAudits: (tenantId: string) => Promise<Map<string, CompetitorPageAudit>>;
  embed: typeof embedChunks;
};

async function defaultReadOwnedUrls(tenantId: string): Promise<string[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const sb = getSupabaseAdmin();
    const out: string[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await sb
        .from("page_snapshots")
        .select("url")
        .eq("tenant_id", tenantId)
        .order("fetched_at", { ascending: false })
        .range(from, from + SUPABASE_PAGE_SIZE - 1);
      if (error || !data) break;
      for (const r of data as { url: string }[]) out.push(r.url);
      if (data.length < SUPABASE_PAGE_SIZE) break;
      from += SUPABASE_PAGE_SIZE;
    }
    return out;
  } catch {
    return [];
  }
}

async function defaultReadOwnedDemand(tenantId: string): Promise<OwnedPageDemand[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const sb = getSupabaseAdmin();
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data, error } = await sb
      .from("gsc_daily_rows")
      .select("page, impressions")
      .eq("tenant_id", tenantId)
      .gte("date", since)
      .limit(20_000);
    if (error || !data) return [];
    const byPage = new Map<string, number>();
    for (const r of data as { page: string; impressions: number }[]) {
      byPage.set(r.page, (byPage.get(r.page) ?? 0) + (Number(r.impressions) || 0));
    }
    return [...byPage.entries()].map(([url, impressions]) => ({ url, impressions }));
  } catch {
    return [];
  }
}

const defaultDeps: BuildIndexDeps = {
  readOwnedDemand: defaultReadOwnedDemand,
  readOwnedUrls: defaultReadOwnedUrls,
  readOwnedSnapshots,
  readCompetitorAudits: getCompetitorAuditsForTenantId,
  embed: embedChunks,
};

const usd = (n: number): string => `$${n.toFixed(4)}`;

/**
 * Run the bounded index build for one tenant. Never throws - every read/embed step is
 * fail-soft, and a total failure to find any content returns status "no_content" rather
 * than an error.
 */
export async function buildRetrievalIndex(tenantId: string, depsOverride: Partial<BuildIndexDeps> = {}): Promise<IndexRunResult> {
  const deps = { ...defaultDeps, ...depsOverride };

  const [allUrls, demand, competitorAudits] = await Promise.all([
    deps.readOwnedUrls(tenantId).catch(() => [] as string[]),
    deps.readOwnedDemand(tenantId).catch(() => [] as OwnedPageDemand[]),
    deps.readCompetitorAudits(tenantId).catch(() => new Map<string, CompetitorPageAudit>()),
  ]);

  const topUrls = pickTopOwnedUrls(allUrls, demand, MAX_OWNED_PAGES);
  const ownedSnapshots = await deps.readOwnedSnapshots(tenantId, topUrls).catch(() => [] as OwnedSnapshotRow[]);

  const toEmbed: EmbeddableChunk[] = [];
  for (const row of ownedSnapshots) {
    for (const c of ownedRowToChunks(row)) {
      if (!c.embedText.trim()) continue;
      toEmbed.push({ id: contentHashOf(c.embedText), source: "owned", pageUrl: row.url, chunkText: c.embedText });
    }
  }

  const competitorList = [...competitorAudits.values()].filter((a) => a.fetchStatus === "ok" && a.facts);
  for (const audit of competitorList) {
    for (const c of competitorAuditToChunks(audit)) {
      if (!c.embedText.trim()) continue;
      const url = canonicalizeCitationUrl(audit.url) || audit.url;
      toEmbed.push({ id: contentHashOf(c.embedText), source: "competitor", pageUrl: url, chunkText: c.embedText });
    }
  }

  if (toEmbed.length === 0) {
    return {
      status: "no_content",
      ownedPagesConsidered: ownedSnapshots.length,
      competitorPagesConsidered: competitorList.length,
      chunksBuilt: 0,
      chunksEmbedded: 0,
      cacheHits: 0,
      chunksSkipped: 0,
      spentUsd: 0,
      message:
        "I do not have enough owned pages or competitor teardowns indexed yet to build the answer-race index. Sync your pages and run a competitor teardown first, then try again.",
    };
  }

  const result = await deps.embed(tenantId, toEmbed);

  const ownedIndexed = result.embedded.filter((e) => e.source === "owned").length;
  const competitorIndexed = result.embedded.filter((e) => e.source === "competitor").length;

  return {
    status: "ok",
    ownedPagesConsidered: ownedSnapshots.length,
    competitorPagesConsidered: competitorList.length,
    chunksBuilt: toEmbed.length,
    chunksEmbedded: result.embedded.length,
    cacheHits: result.cacheHits,
    chunksSkipped: result.skipped.length,
    spentUsd: result.spentUsd,
    message: `I indexed ${ownedSnapshots.length} of your pages and ${competitorList.length} competitor pages into ${result.embedded.length} passages (${ownedIndexed} yours, ${competitorIndexed} competitor) for ${usd(result.spentUsd)}. ${result.cacheHits} passages came from my cache at no extra cost.`,
  };
}
