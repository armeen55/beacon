/**
 * owned-coverage (2026-07-28) - the DETERMINISTIC half of ONE question: does this business ALREADY have the page that answers what I just investigated? It builds the bounded set of
 * OWNED pages that could plausibly be that page, each carrying the EVIDENCE that put it there. It never calls a model and never returns a verdict: the adjudicator reasons over
 * these candidates. Every signal is labelled by STRENGTH so a hint can never read as proof:
 *   STRONG  the page takes Search Console impressions for one of the exact queries; its own
 *           URL sits in the exact results I looked at; an engine cites it for a prompt here;
 *           my keyword research records me ranking for one of these queries; or its own
 *           words AND its page shape match what wins.
 *   WEAK    the topic and the page's title or path merely share wording. It may shortlist a
 *           page. It may never establish coverage.
 *   UNKNOWN I do not hold this page's words. That is NOT absence of coverage, and the
 *           difference decides whether Beacon builds a duplicate of a page I have.
 * A word this account puts on nearly everything (weakAnchorsOf, from its OWN corpus) can never map a page on its own. One canonical URL identity and one publisher rollup
 * throughout, so a page is never two pages and a subdomain is never a second publisher. Pure and deterministic: same evidence in, same ordered candidates out.
 */

import type { BusinessProfile } from "@/domains/account";
import { anchoredTopicMatch, canonicalQueryKey, topicTokens } from "@/domains/evidence/relevance-gate";
import { classifyResult, publisherHost } from "@/domains/evidence/serp-shape";
import { canonicalUrlKey, weakAnchorsOf, type EvidenceSnapshot, type OwnedPageEvidence } from "@/domains/evidence/snapshot";
import type { TopicInvestigation } from "@/domains/evidence/topic-investigation";

// ── the contract ─────────────────────────────────────────────────────────────

export type OwnedSignalStrength = "strong" | "weak" | "unknown";

export type OwnedSignalKind =
  | "gsc_exact_query" | "ranks_for_query" | "cited_by_engine" | "ranked_keyword"
  | "same_shape" | "token_overlap" | "body_not_held";

/** ONE reason a page is on the shortlist, with the exact query, prompt or keyword
 *  behind it, so the adjudicator can always check the reason itself. */
export type OwnedSignal = { kind: OwnedSignalKind; strength: OwnedSignalStrength; basis: string; detail: string };

export type OwnedCandidate = {
  /** ONE canonical owned URL: host without www plus path, no trailing slash. */
  url: string; path: string;
  title: string | null; h1: string | null; wordCount: number | null; outlineLength: number;
  openingSample: string | null; entities: string[];
  /** When I last read this page, so staleness is visible rather than assumed. */
  fetchedAt: string | null;
  /** False when I hold no words for this page: unknown coverage, never absent. */
  bodyHeld: boolean;
  signals: OwnedSignal[]; strongSignals: number;
};

/** What a caller already read of an owned page's own words (the targeted body
 *  reader's shape), passed in so this stays pure. */
type HeldBody = { title?: string | null; openingSample?: string | null; entityNames?: string[]; fetchedAt?: string | null };
type Draft = { url: string; page: OwnedPageEvidence | null; signals: OwnedSignal[]; impressions: number };
type Extract = NonNullable<EvidenceSnapshot["research"]["winningPages"][number]["extract"]>;

const MAX_CANDIDATES = 5; // a handful, never the site
const STRENGTH_ORDER: OwnedSignalStrength[] = ["strong", "weak", "unknown"];
const num = (v: number): string => v.toLocaleString("en-US");
const pathOf = (key: string): string => { try { return new URL(`https://${key}`).pathname; } catch { return "/"; } };

// ── the mapper ───────────────────────────────────────────────────────────────

export function ownedCandidatesFor(snapshot: EvidenceSnapshot, investigation: TopicInvestigation,
  held: ReadonlyMap<string, HeldBody> = new Map()): OwnedCandidate[] {
  // WHO I AM, rolled up once: a page on my own subdomain is my page, and a rival's domain can never reach this set, so a competitor never becomes a candidate. When a
  // failed read leaves the scope without my site, the host most of my own pages sit on IS my site; without that fallback the identity repair below silently stops working.
  const hosts = new Map<string, number>();
  for (const p of snapshot.ownedPages) { const h = publisherHost(p.url); if (h.includes(".")) hosts.set(h, (hosts.get(h) ?? 0) + 1); }
  const site = publisherHost(snapshot.scope.site ?? "") || [...hosts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "";
  const publishers = new Set([...hosts.keys(), site].filter((h) => h.includes(".")));
  // ONE identity per page. Some owned rows are stored as a bare path, and read literally that made "/iran-flags/x" a second page beside "site.com/iran-flags/x":
  // the same page twice, which is exactly how a duplicate gets built.
  const keyOf = (raw: string): string => {
    const key = canonicalUrlKey(raw);
    return !key || !site || key.split("/")[0]!.includes(".") ? key : `${site}/${key}`.replace(/\/+$/, "");
  };
  const ownedPages = new Map(snapshot.ownedPages.map((p) => [keyOf(p.url), p]));
  const queryKeys = new Set([...investigation.queries, ...investigation.keywords.map((k) => k.query),
    ...investigation.exactSerps.map((s) => s.query)].map(canonicalQueryKey).filter(Boolean));
  const promptIds = new Set(investigation.trackedPrompts.map((p) => p.promptId));
  const weak = weakAnchorsOf(snapshot.ownedPages, snapshot.research);
  const extracts = new Map(snapshot.research.winningPages.filter((w) => w.extract).map((w) => [keyOf(w.url), w.extract!]));

  const drafts = new Map<string, Draft>();
  const byQuery = new Map<string, Set<string>>();
  /** The canonical key when this URL is MINE, else null. */
  const mine = (rawUrl: string): string | null => {
    const key = keyOf(rawUrl);
    if (!key) return null;
    return ownedPages.has(key) || publishers.has(publisherHost(rawUrl)) ? key : null;
  };
  const add = (key: string, signal: OwnedSignal, impressions = 0): void => {
    const d = drafts.get(key) ?? { url: key, page: ownedPages.get(key) ?? null, signals: [], impressions: 0 };
    if (!d.signals.some((s) => s.kind === signal.kind && s.basis === signal.basis)) d.signals.push(signal);
    d.impressions += impressions;
    drafts.set(key, d);
  };
  const located = (queryKey: string, url: string): void => {
    if (queryKey) byQuery.set(queryKey, (byQuery.get(queryKey) ?? new Set()).add(url));
  };

  // 1. Google already serves this page for one of the EXACT queries.
  for (const [key, page] of ownedPages) {
    for (const q of page.search?.topQueries ?? []) {
      const qk = canonicalQueryKey(q.query);
      if (!queryKeys.has(qk)) continue;
      located(qk, key);
      add(key, { kind: "gsc_exact_query", strength: "strong", basis: q.query,
        detail: `Google already shows this page for "${q.query}": ${num(q.impressions)} views and ${num(q.clicks)} clicks.` }, q.impressions);
    }
  }

  // 2. My own URL is on the exact results page I looked at.
  for (const serp of investigation.exactSerps) {
    for (const row of serp.organicRows) {
      const key = mine(row.url);
      if (!key) continue;
      located(canonicalQueryKey(serp.query), key);
      add(key, { kind: "ranks_for_query", strength: "strong", basis: serp.query,
        detail: `Google already returns this page for "${serp.query}" at organic position ${row.rank}.` });
    }
  }

  // 3. An engine cites this page when it answers a prompt in this investigation.
  for (const w of investigation.winners) {
    const key = mine(w.url);
    if (!key) continue;
    for (const a of w.appearances) {
      const basis = a.promptText ?? a.query ?? "";
      if (!basis) continue;
      if (a.kind === "serp_organic") add(key, { kind: "ranks_for_query", strength: "strong", basis,
        detail: `Google already returns this page for "${basis}".` });
      else add(key, { kind: "cited_by_engine", strength: "strong", basis,
        detail: `${a.engine ?? "An AI engine"} already cites this page when it answers "${basis}".` });
    }
  }
  for (const o of snapshot.research.aiObservations) {
    if (!promptIds.has(o.promptId)) continue;
    for (const c of o.citations ?? []) {
      const key = mine(c.url);
      if (key) add(key, { kind: "cited_by_engine", strength: "strong", basis: o.promptText,
        detail: `${o.engine} already cites this page when it answers "${o.promptText}".` });
    }
  }

  // 4. My keyword research records me ranking for one of these queries. KNOWN LIMIT: the ranked-keyword rows on file carry no ranking URL, so this corroborates the
  // page the evidence above already located and never names a page on its own.
  for (const k of snapshot.research.retainedKeywords) {
    if (k.discoveredVia !== "ranked") continue;
    for (const key of byQuery.get(canonicalQueryKey(k.query)) ?? []) add(key, { kind: "ranked_keyword", strength: "strong",
      basis: k.query, detail: `My keyword research already records this site ranking for "${k.query}".` });
  }

  // 5. The page's OWN words plus the shape that wins here. EVERY distinguishing word of the topic has to be present, never one of them: on one shared word this called
  // a city guide, a shop category and the homepage coverage of a leadership topic none
  // of them mentions. A topic whose only words are ones this account puts on everything has no distinguishing word left, so it maps NO page at all.
  const subject = topicTokens(investigation.label).filter((t) => !weak.has(t));
  const covers = (text: string): boolean => { const owns = new Set(topicTokens(text)); return subject.length > 0 && subject.every((t) => owns.has(t)); };
  for (const [key, page] of ownedPages) {
    const body = held.get(key);
    const x = extracts.get(key);
    const deep = covers([page.content?.title, page.content?.h1, ...(page.content?.outline ?? []),
      body?.openingSample ?? x?.openingSample, ...(body?.entityNames ?? x?.entityNames ?? [])].filter(Boolean).join(" "));
    const shape = classifyResult(page.content?.title ?? null, key);
    if (deep && investigation.pageType !== "unknown" && investigation.pageType !== "mixed" && shape === investigation.pageType) {
      add(key, { kind: "same_shape", strength: "strong", basis: investigation.label,
        detail: `This page already covers ${subject.join(", ")} and is the same kind of page that wins here.` });
    } else if (deep || covers([page.content?.title, key].filter(Boolean).join(" "))) {
      add(key, { kind: "token_overlap", strength: "weak", basis: investigation.label,
        detail: `This page's wording covers ${subject.join(", ")}, which is a hint and not proof that it answers this.` });
    }
  }

  const strongOf = (d: Draft): number => d.signals.filter((s) => s.strength === "strong").length;
  return [...drafts.values()]
    .sort((a, b) => strongOf(b) - strongOf(a) || b.impressions - a.impressions || a.url.localeCompare(b.url))
    .slice(0, MAX_CANDIDATES)
    .map((d) => finish(d, held.get(d.url), extracts.get(d.url)));
}

function finish(d: Draft, body: HeldBody | undefined, x: Extract | undefined): OwnedCandidate {
  const c = d.page?.content ?? null;
  const bodyHeld = !!body?.openingSample || !!x?.openingSample || (!!c && (c.wordCount > 0 || !!c.title));
  const signals = [...d.signals];
  if (!bodyHeld) signals.push({ kind: "body_not_held", strength: "unknown", basis: d.url,
    detail: "This page's words are not on file, so whether it already covers this is unknown." });
  signals.sort((a, b) => STRENGTH_ORDER.indexOf(a.strength) - STRENGTH_ORDER.indexOf(b.strength)
    || a.kind.localeCompare(b.kind) || a.basis.localeCompare(b.basis));
  return {
    url: d.url, path: pathOf(d.url), title: c?.title ?? body?.title ?? x?.title ?? null, h1: c?.h1 ?? x?.h1 ?? null,
    wordCount: c?.wordCount ?? x?.wordCount ?? null, outlineLength: c?.outline.length ?? x?.headings.length ?? 0,
    openingSample: body?.openingSample ?? x?.openingSample ?? null, entities: body?.entityNames ?? x?.entityNames ?? [],
    fetchedAt: c?.fetchedAt ?? body?.fetchedAt ?? x?.fetchedAt ?? null, bodyHeld, signals,
    strongSignals: signals.filter((s) => s.strength === "strong").length,
  };
}

/**
 * The account's own Business Profile topics this investigation collides with. A
 * FACT the adjudicator must see, never a silent drop: a topic the operator ruled out is a reason to stop, and it deserves to be said out loud.
 */
export function topicOutOfScope(snapshot: EvidenceSnapshot, investigation: TopicInvestigation, profile: BusinessProfile | null | undefined): string[] {
  const weak = weakAnchorsOf(snapshot.ownedPages, snapshot.research);
  const subject = [investigation.label, ...investigation.queries].join(" ");
  return (profile?.topicsToExclude?.value ?? []).filter((t) => anchoredTopicMatch(t, subject, weak).relevant);
}

/** A NEW PAGE NEEDS POSITIVE AUTHORIZATION, not the absence of an exclusion (Codex, 2026-08-21). Three ties
 *  make a topic this business's ground: an approved tracked question, a filled business field, or the
 *  account's own demonstrated demand. "You never said no" is how off-vertical pages got built. PURE. */
export function topicPositivelyAuthorized(snapshot: EvidenceSnapshot, investigation: TopicInvestigation, profile: BusinessProfile | null | undefined): boolean {
  const weak = weakAnchorsOf(snapshot.ownedPages, snapshot.research);
  const subject = [investigation.label, ...investigation.queries].join(" ");
  const approved = [...new Set(snapshot.research.aiObservations.map((o) => o.promptText))];
  const confirmed = [...(profile?.topicsToOwn?.value ?? []), ...(profile?.offerings?.value ?? []),
    ...(profile?.customerProblems?.value ?? []), ...approved].filter((t): t is string => typeof t === "string" && t.length > 0);
  if (confirmed.some((t) => anchoredTopicMatch(t, subject, weak).relevant)) return true;
  const askedKeys = new Set([investigation.label, ...investigation.queries].map((q) => canonicalQueryKey(q)).filter(Boolean));
  if (snapshot.ownedPages.some((p) => (p.search?.topQueries ?? []).some((q) =>
    q.impressions > 0 && askedKeys.has(canonicalQueryKey(q.query))))) return true;
  // A keyword bought THROUGH the operator's own anchors carries its authorization; the machine-suggested
  // routes are exactly the drift this gate exists for. Absence of a route is not a route.
  const ANCHORED = new Set(["site", "ranked", "gsc", "profile", "prompt", "related", "suggestion", "ideas"]);
  return snapshot.research.retainedKeywords.some((k) =>
    k.discoveredVia != null && ANCHORED.has(k.discoveredVia) && askedKeys.has(canonicalQueryKey(k.query)));
}
