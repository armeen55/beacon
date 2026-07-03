import "server-only";

import { log } from "@/lib/logger";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { isNonHtmlAsset } from "@/domains/recommendation-intelligence/page-classifier";
import type { PageSnapshotLinkGraph } from "@/lib/persistence/repositories/types";
import type { OwnershipRegistry } from "@/domains/ownership/registry";
import { loadGapVerdictsForTenant } from "@/domains/demand-graph/native-teardown-runner";
import { loadQuestionUniverseForTenant } from "@/domains/research/question-universe-loader";
import type { UniverseQuestionRow } from "@/domains/research/question-universe";
import type { GscPageSignal } from "@/domains/recommendation-intelligence/gsc-page-signals";

import {
  interlinkCandidatesForPage,
  type InterlinkCandidate,
  type InterlinkDestination,
  type InterlinkSourcePage,
} from "./entity-interlink";
import {
  gradeCoverage,
  type CoveragePageExtract,
  type ExpectedSubtopic,
} from "./term-coverage";
import type { TermCoverageGapItem } from "@/domains/recommendation-intelligence/triggers/term-coverage-gap";

/**
 * load-linkgraph-triggers (2026-07-03, BEACON_500 R18 / P7) - the I/O boundary
 * that assembles the pure inputs for the entity-interlink and term-coverage-gap
 * triggers, keeping the trigger loader thin and the predicates pure.
 *
 * ALL reads here are of already-stored / already-paid-for data (the tenant's
 * page_snapshots link graph + body extracts, the N2 ownership registry the
 * caller already loaded, the nightly gap verdicts, the nightly question
 * universe). Nothing paid, nothing live. Fail-soft: any dead source narrows the
 * output, never throws.
 *
 * CONTRACT (pinned): empty inputs (no owned pages with body text, no owners
 * resolved, no consensus/question rubric) yield empty arrays - so both triggers
 * emit nothing and the pipeline is byte-identical to before this feature.
 */

/** At most this many owner pages get an extract read for coverage grading. */
const MAX_COVERAGE_PAGES = 40;
/** At most this many source pages considered for entity interlinking. */
const MAX_INTERLINK_SOURCES = 60;

type ExtractRow = {
  url: string;
  h2_list: string[] | null;
  h3_list: string[] | null;
  body_paragraph_sample: string[] | null;
  card_texts: string[] | null;
  faqs: { question?: string }[] | null;
};

type BodyExtract = {
  canonUrl: string;
  headings: string[];
  faqQuestions: string[];
  bodyText: string | null;
};

/** Bounded page_snapshots extract read for a fixed canonical-URL set (newest per
 *  URL wins). Keyed by the canonicalized URL (the interlink/coverage node id).
 *  Fail-soft -> empty map. */
async function readBodyExtracts(
  tenantId: string,
  canonUrls: readonly string[],
): Promise<Map<string, BodyExtract>> {
  const out = new Map<string, BodyExtract>();
  const wanted = [...new Set(canonUrls.filter(Boolean))].slice(0, MAX_COVERAGE_PAGES);
  if (!isSupabaseConfigured() || wanted.length === 0) return out;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("page_snapshots")
      .select("url, h2_list, h3_list, body_paragraph_sample, card_texts, faqs, fetched_at")
      .eq("tenant_id", tenantId)
      .order("fetched_at", { ascending: false })
      .limit(2000);
    if (error || !Array.isArray(data)) return out;
    const wantedSet = new Set(wanted);
    for (const r of data as (ExtractRow & { fetched_at?: string })[]) {
      const canon = canonicalizeCitationUrl(r.url ?? "");
      if (!canon || !wantedSet.has(canon) || out.has(canon)) continue;
      const body = [...(r.body_paragraph_sample ?? []), ...(r.card_texts ?? [])].join(" ").trim();
      out.set(canon, {
        canonUrl: canon,
        headings: [...(r.h2_list ?? []), ...(r.h3_list ?? [])].filter(Boolean),
        faqQuestions: (r.faqs ?? []).map((f) => f?.question ?? "").filter(Boolean),
        bodyText: body || null,
      });
    }
    return out;
  } catch (e) {
    log.warn("[load-linkgraph-triggers] extract read failed (fail-soft)", {
      tenantId,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    return out;
  }
}

/**
 * Build the entity-interlink candidates for a tenant. For each owned source page
 * with body text, find OTHER owned pages whose topic the source page mentions but
 * does not link to, resolving the destination OWNER via the N2 registry (never a
 * contender). `graphs` is the link-graph read the caller already did (reused so
 * we do not read it twice).
 */
export async function buildEntityInterlinkCandidates(
  tenantId: string,
  registry: OwnershipRegistry,
  graphs: ReadonlyArray<PageSnapshotLinkGraph>,
): Promise<InterlinkCandidate[]> {
  if (!tenantId || registry.byQuery.size === 0) return [];

  // Owned node universe + outbound owned links per source (canonicalized).
  const byUrl = new Map<string, { canon: string; links: { href: string }[]; fetched_at: string }>();
  for (const g of graphs) {
    if (!g?.url || isNonHtmlAsset(g.url)) continue;
    const canon = canonicalizeCitationUrl(g.url);
    if (!canon) continue;
    const prev = byUrl.get(canon);
    if (!prev || (g.fetched_at ?? "") > (prev.fetched_at ?? "")) {
      byUrl.set(canon, { canon, links: g.internal_links ?? [], fetched_at: g.fetched_at ?? "" });
    }
  }
  const nodeSet = new Set(byUrl.keys());
  if (nodeSet.size < 2) return [];

  // Destination owner set: every DISTINCT owner URL the registry resolves that is
  // also one of our owned nodes, paired with the topic label it owns. One entry
  // per (owner, topic) - a page can be the destination for several topics.
  const destinations: InterlinkDestination[] = [];
  const seenOwnerTopic = new Set<string>();
  for (const [key, entry] of registry.byQuery) {
    if (!entry.owner) continue;
    const ownerCanon = canonicalizeCitationUrl(entry.owner);
    if (!ownerCanon || !nodeSet.has(ownerCanon)) continue;
    const dedupeKey = `${ownerCanon}::${key}`;
    if (seenOwnerTopic.has(dedupeKey)) continue;
    seenOwnerTopic.add(dedupeKey);
    destinations.push({ ownerUrl: ownerCanon, topicLabel: key });
  }
  if (destinations.length === 0) return [];

  // Only source pages get an extract read (bounded to the busiest sources by
  // outbound link volume as a cheap "real content page" proxy, then lexical).
  const sourceCanon = [...nodeSet]
    .sort((a, b) => (byUrl.get(b)!.links.length - byUrl.get(a)!.links.length) || a.localeCompare(b))
    .slice(0, MAX_INTERLINK_SOURCES);
  const extracts = await readBodyExtracts(tenantId, sourceCanon);
  if (extracts.size === 0) return [];

  const out: InterlinkCandidate[] = [];
  for (const canon of sourceCanon) {
    const extract = extracts.get(canon);
    if (!extract?.bodyText) continue;
    const row = byUrl.get(canon)!;
    const linkedOwned: string[] = [];
    for (const link of row.links) {
      try {
        const target = canonicalizeCitationUrl(new URL(link.href, canon).toString());
        if (target && nodeSet.has(target)) linkedOwned.push(target);
      } catch {
        /* skip unresolvable href */
      }
    }
    const source: InterlinkSourcePage = {
      url: canon,
      bodyText: extract.bodyText,
      linkedOwnedUrls: linkedOwned,
    };
    // Only offer destinations OTHER than this page (self excluded in the core too).
    const dests = destinations.filter((d) => d.ownerUrl !== canon);
    out.push(...interlinkCandidatesForPage(source, dests, { maxPerPage: 3 }));
  }
  return out;
}

/**
 * Build the term-coverage-gap items for a tenant. For each owned page that (a)
 * owns a money query ranking in the trigger's band and (b) has a demand-backed
 * subtopic rubric (winner consensus from the nightly gap verdicts + uncovered
 * demand questions from the nightly question universe), grade its coverage
 * against its real stored extracts. The trigger applies the ranking/coverage
 * gates; this just assembles the graded items.
 */
export async function buildTermCoverageItems(
  tenantId: string,
  gscSignals: ReadonlyMap<string, GscPageSignal>,
): Promise<TermCoverageGapItem[]> {
  if (!tenantId || gscSignals.size === 0) return [];

  const [gapVerdicts, universe] = await Promise.all([
    loadGapVerdictsForTenant(tenantId).catch(() => []),
    loadQuestionUniverseForTenant(tenantId).catch(() => [] as UniverseQuestionRow[]),
  ]);
  if (gapVerdicts.length === 0 && universe.length === 0) return [];

  // Consensus rubric labels per owned page (canonicalized), from the gap
  // verdicts. atomic_edit additions + new_page shared headings both describe
  // "what winners cover"; strip the wrapper prose to bare labels.
  const consensusByPage = new Map<string, ExpectedSubtopic[]>();
  for (const v of gapVerdicts) {
    const canon = v.ownedUrl ? canonicalizeCitationUrl(v.ownedUrl) : null;
    if (!canon) continue;
    const labels = new Set<string>();
    if (v.atomicEdit) for (const a of v.atomicEdit.additions) labels.add(stripAdditionLabel(a));
    if (v.newPage) for (const h of v.newPage.sharedHeadingsToInclude) labels.add(h);
    const bucket = consensusByPage.get(canon) ?? [];
    for (const label of labels) {
      const clean = label.trim();
      if (clean) bucket.push({ label: clean, source: "consensus", weight: 100 });
    }
    if (bucket.length > 0) consensusByPage.set(canon, bucket);
  }

  // Uncovered demand questions per owner page (canonicalized), from the universe.
  const questionsByPage = new Map<string, ExpectedSubtopic[]>();
  for (const q of universe) {
    if (!q.ownership) continue;
    if (q.coverageStatus === "answered") continue; // already covered - not a gap
    const canon = canonicalizeCitationUrl(q.ownership);
    if (!canon) continue;
    const bucket = questionsByPage.get(canon) ?? [];
    bucket.push({ label: q.question, source: "question", weight: q.demandScore });
    questionsByPage.set(canon, bucket);
  }

  // Candidate pages: any page with a rubric AND a GSC-owned money query.
  const rubricPages = new Set([...consensusByPage.keys(), ...questionsByPage.keys()]);
  if (rubricPages.size === 0) return [];

  // Map each candidate page to its best owned money query (highest impressions).
  type PageQueryInfo = { canon: string; query: string; position: number; impressions: number };
  const pageQuery = new Map<string, PageQueryInfo>();
  for (const [rawUrl, sig] of gscSignals) {
    const canon = canonicalizeCitationUrl(rawUrl) ?? rawUrl;
    if (!rubricPages.has(canon)) continue;
    const top = [...(sig.topQueries ?? [])].sort((a, b) => b.impressions - a.impressions)[0];
    if (!top) continue;
    const prev = pageQuery.get(canon);
    if (!prev || top.impressions > prev.impressions) {
      pageQuery.set(canon, { canon, query: top.query, position: top.position, impressions: top.impressions });
    }
  }
  if (pageQuery.size === 0) return [];

  const extracts = await readBodyExtracts(tenantId, [...pageQuery.keys()]);

  const items: TermCoverageGapItem[] = [];
  for (const [canon, info] of pageQuery) {
    const expected = [...(consensusByPage.get(canon) ?? []), ...(questionsByPage.get(canon) ?? [])];
    if (expected.length === 0) continue;
    const extract = extracts.get(canon);
    const pageExtract: CoveragePageExtract = extract
      ? { headings: extract.headings, faqQuestions: extract.faqQuestions, bodyText: extract.bodyText }
      : { headings: [], faqQuestions: [], bodyText: null };
    const grade = gradeCoverage(expected, pageExtract);
    items.push({
      url: canon,
      query: info.query,
      position: info.position,
      impressions: info.impressions,
      grade,
    });
  }
  return items;
}

/** Strip the gap-verdict addition prose wrapper down to the bare subtopic label:
 *  `a section covering "visa fees"` -> `visa fees`; leaves already-bare labels
 *  intact. Deterministic. */
export function stripAdditionLabel(addition: string): string {
  const s = (addition ?? "").trim();
  // Prefer a quoted inner label when present.
  const quoted = s.match(/["“]([^"”]+)["”]/);
  if (quoted?.[1]) return quoted[1].trim();
  // Otherwise strip a leading "a/an section covering/on/about" prefix.
  return s
    .replace(/^an?\s+section\s+(covering|on|about)\s+/i, "")
    .replace(/^an?\s+/i, "")
    .trim();
}
