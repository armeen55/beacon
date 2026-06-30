/**
 * page-research-pack (2026-06-29) — the PURE "senior strategist" brain for an
 * existing-page Move. Turns the free signals a page already carries (its GSC query
 * universe, AI fan-out questions, cited competitors, on-page facts, proof history)
 * into a structured research pack: which keywords this page should OWN vs hand to a
 * SIBLING vs spin into a NEW page vs just cross-LINK vs ignore as NOISE; which
 * on-page ELEMENT each owned keyword maps to (title / H1 / H2 / FAQ / answer block /
 * internal link / schema); and which LEVER to pull first — respecting proof (a lever
 * that already lost is blocked; a lever mid-measurement is held).
 *
 * This is the structure the (already-wired, dry-run-default) DataForSEO keyword
 * VOLUME + SERP winner-title/format study will later flow into — so a recommendation
 * cites real demand + SERP patterns, not a template. NO LLM, NO paid call here:
 * pure + deterministic + testable. Tenant-AGNOSTIC: "head" tokens are derived
 * corpus-relative from the page's own query set, never a hardcoded stopword list.
 */

import { topicTokens, scoreTopicMatch } from "@/domains/evidence/relevance-gate";

export type ResearchBucket = "own" | "sibling" | "new_page" | "internal_link" | "noise";
export type PageElement = "title" | "h1" | "h2_section" | "faq" | "answer_block" | "internal_link" | "schema";
export type ResearchLever =
  | "title_meta"
  | "answer_block"
  | "internal_links"
  | "content_depth"
  | "ux_fix"
  | "schema"
  | "wait";

export type ResearchKeyword = {
  keyword: string;
  source: "gsc_ranking" | "gsc_losing" | "ai_fanout" | "competitor";
  /** GSC rank/impressions when the signal is search-derived (null otherwise). */
  position: number | null;
  impressions: number | null;
  /** Filled later by DataForSEO search-volume (null in the deterministic/dry-run pack). */
  volume: number | null;
  bucket: ResearchBucket;
  /** Suggested on-page element for an OWNed keyword (null for sibling/new/link/noise). */
  element: PageElement | null;
  /** One-line reason — so the pack reads like a strategist's notes, not a dump. */
  why: string;
};

export type LeverRec = {
  lever: ResearchLever;
  primary: boolean;
  blocked: boolean;
  reason: string;
};

export type PageResearchPack = {
  url: string;
  pageLabel: string;
  /** The head query this page should OWN (highest-impression ranking query, else label). */
  primaryIntent: string | null;
  keywords: ResearchKeyword[];
  /** bucket → the keyword strings in it (the intent-owner map). */
  clusters: Record<ResearchBucket, string[]>;
  /** Ranked levers; exactly one `primary` (unless everything is blocked → `wait`). */
  levers: LeverRec[];
  proofConstraints: { measuringFamilies: string[]; lostFamilies: string[] };
  notes: string[];
};

export type OwnedSibling = { slug: string; label: string };

export type PageResearchInput = {
  url: string;
  pageLabel: string;
  pageFacts?: { title?: string | null; h1?: string | null; h2s?: string[] } | null;
  gscRanking: { query: string; position: number; impressions: number }[];
  gscLosing: { query: string; dropPct: number }[];
  aiFanouts: string[];
  competitorTitles: string[];
  /** Other owned pages on the site — used to route a sibling-intent keyword to its real owner. */
  ownedSiblings: OwnedSibling[];
  /** Proof families (from the proof ledger) that are mid-measurement / already lost on this page. */
  proof?: { measuringFamilies: string[]; lostFamilies: string[] } | null;
};

const QUESTION_RE = /^(what|who|why|how|when|where|which|are|is|do|does|can)\b|\?$/i;

function uniqLower(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.trim().toLowerCase();
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(x.trim());
    }
  }
  return out;
}

/**
 * Corpus-relative "head" tokens: tokens shared by a MAJORITY of the page's own
 * ranking queries carry no distinguishing intent (e.g. for a flags page, "flag";
 * for a names page, "names"). Tenant-agnostic — derived from THIS page's data.
 */
function headTokens(rankingQueries: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const q of rankingQueries) {
    for (const t of new Set(topicTokens(q))) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const threshold = Math.max(2, Math.ceil(rankingQueries.length * 0.6));
  const head = new Set<string>();
  for (const [t, c] of counts) if (c >= threshold) head.add(t);
  return head;
}

function distinguishing(keyword: string, head: Set<string>): string[] {
  return topicTokens(keyword).filter((t) => !head.has(t));
}

/**
 * Build the deterministic research pack for one existing page. Pure.
 */
export function buildPageResearchPack(input: PageResearchInput): PageResearchPack {
  const ranking = [...input.gscRanking].sort((a, b) => b.impressions - a.impressions);
  const primaryIntent = ranking[0]?.query ?? input.pageLabel ?? null;
  const head = headTokens(ranking.map((r) => r.query));

  const losingSet = new Map(input.gscLosing.map((d) => [d.query.toLowerCase(), d.dropPct]));

  // Assemble candidate keywords from the free signals (dedup, keep the richest source).
  const candidates = new Map<string, ResearchKeyword>();
  const add = (kw: string, source: ResearchKeyword["source"], position: number | null, impressions: number | null) => {
    const key = kw.trim().toLowerCase();
    if (!key) return;
    if (candidates.has(key)) return;
    candidates.set(key, {
      keyword: kw.trim(),
      source,
      position,
      impressions,
      volume: null,
      bucket: "noise",
      element: null,
      why: "",
    });
  };
  for (const r of ranking) add(r.query, losingSet.has(r.query.toLowerCase()) ? "gsc_losing" : "gsc_ranking", r.position, r.impressions);
  for (const d of input.gscLosing) add(d.query, "gsc_losing", null, null);
  for (const f of uniqLower(input.aiFanouts)) add(f, "ai_fanout", null, null);

  const siblingByToken = new Map<string, OwnedSibling>();
  for (const s of input.ownedSiblings) {
    for (const t of topicTokens(`${s.label} ${s.slug}`)) if (!head.has(t)) siblingByToken.set(t, s);
  }

  // Classify each candidate into a bucket + element.
  for (const kw of candidates.values()) {
    const dist = distinguishing(kw.keyword, head);
    const isQuestion = QUESTION_RE.test(kw.keyword.trim());
    const match = primaryIntent ? scoreTopicMatch(kw.keyword, primaryIntent) : null;
    // Does a DIFFERENT owned page own this keyword's distinguishing intent?
    const siblingOwner = dist.map((t) => siblingByToken.get(t)).find(Boolean) ?? null;

    // Off-topic → noise, even if phrased as a question (an off-topic fan-out
    // shouldn't be "owned" just because it starts with what/how/where).
    if (match && !match.relevant) {
      kw.bucket = "noise";
      kw.why = "Off-topic for this page — different intent.";
      continue;
    }
    if (siblingOwner && match && match.relevant) {
      // Related intent owned by a sibling page → cross-link, don't fold.
      kw.bucket = "internal_link";
      kw.element = "internal_link";
      kw.why = `Related intent your "${siblingOwner.label}" page owns — cross-link, don't merge.`;
      continue;
    }
    if (isQuestion) {
      kw.bucket = "own";
      kw.element = "answer_block";
      kw.why = "A question this page should answer up top (answer block + FAQ).";
      continue;
    }
    // Owned by this page. Element by how central + whether it's the head.
    kw.bucket = "own";
    const dropPct = losingSet.get(kw.keyword.toLowerCase());
    if (kw.keyword.toLowerCase() === (primaryIntent ?? "").toLowerCase()) {
      kw.element = "title";
      kw.why = "The page's primary intent — own it in the title/H1.";
    } else if (kw.position != null && kw.position >= 4 && kw.position <= 15) {
      kw.element = "title";
      kw.why = `Striking distance (rank ${Math.round(kw.position)}) — a sharper title can capture it.`;
    } else if (dropPct != null) {
      kw.element = "h2_section";
      kw.why = `Losing ground (−${dropPct}%) — reinforce with a dedicated section.`;
    } else {
      kw.element = "h2_section";
      kw.why = "A sub-intent this page can own with a section.";
    }
  }

  const all = [...candidates.values()];
  const clusters: PageResearchPack["clusters"] = { own: [], sibling: [], new_page: [], internal_link: [], noise: [] };
  for (const kw of all) clusters[kw.bucket].push(kw.keyword);

  const proof = { measuringFamilies: input.proof?.measuringFamilies ?? [], lostFamilies: input.proof?.lostFamilies ?? [] };
  const levers = selectLevers(all, proof, input);

  const notes: string[] = [];
  if (clusters.internal_link.length) notes.push(`${clusters.internal_link.length} keyword(s) belong to a sibling page — cross-link, don't consolidate.`);
  if (proof.lostFamilies.length) notes.push(`Proof says these levers already came back flat here: ${proof.lostFamilies.join(", ")}.`);
  if (proof.measuringFamilies.length) notes.push(`A change is mid-measurement (${proof.measuringFamilies.join(", ")}) — a second edit now muddies it.`);

  return { url: input.url, pageLabel: input.pageLabel, primaryIntent, keywords: all, clusters, levers, proofConstraints: proof, notes };
}

/** Map a lever to the proof "family" vocabulary so proof constraints gate it. */
function leverFamily(l: ResearchLever): string {
  if (l === "title_meta") return "title_meta";
  if (l === "answer_block" || l === "schema") return "aeo";
  if (l === "internal_links") return "links";
  if (l === "ux_fix") return "cro";
  return "content";
}

/**
 * Pick the levers, strongest-first, with exactly one primary — blocking a lever that
 * already lost on this page and de-prioritizing one mid-measurement. The "evidence"
 * is the cluster shape + GSC signals (the DataForSEO study refines this later).
 */
function selectLevers(
  kws: ResearchKeyword[],
  proof: { measuringFamilies: string[]; lostFamilies: string[] },
  input: PageResearchInput,
): LeverRec[] {
  const lost = new Set(proof.lostFamilies);
  const measuring = new Set(proof.measuringFamilies);
  const blocked = (l: ResearchLever) => lost.has(leverFamily(l));
  const held = (l: ResearchLever) => measuring.has(leverFamily(l));

  const striking = kws.some((k) => k.bucket === "own" && k.position != null && k.position >= 4 && k.position <= 15);
  const hasQuestions = kws.some((k) => k.element === "answer_block");
  const hasSiblings = kws.some((k) => k.bucket === "internal_link");
  const hasLosing = kws.some((k) => k.source === "gsc_losing");

  // Candidate levers in default strength order, each with its triggering evidence.
  const candidates: { lever: ResearchLever; want: boolean; reason: string }[] = [
    { lever: "title_meta", want: striking, reason: "A striking-distance query (rank 4–15) is the fastest CTR win." },
    { lever: "answer_block", want: hasQuestions || input.aiFanouts.length > 0, reason: "AI fan-out questions this page should answer up top." },
    { lever: "internal_links", want: hasSiblings, reason: "Sibling pages compete for related intent — cross-link to consolidate authority." },
    { lever: "content_depth", want: hasLosing, reason: "Losing ground on owned queries — deepen the page." },
    { lever: "ux_fix", want: false, reason: "On-page friction (Clarity) blocks conversion." },
    { lever: "schema", want: hasQuestions, reason: "FAQ/Article schema helps AI quote the page." },
  ];

  const out: LeverRec[] = [];
  let primaryChosen = false;
  for (const c of candidates) {
    if (!c.want) continue;
    const isBlocked = blocked(c.lever);
    const isHeld = held(c.lever);
    const canBePrimary = !primaryChosen && !isBlocked && !isHeld;
    out.push({
      lever: c.lever,
      primary: canBePrimary,
      blocked: isBlocked,
      reason: isBlocked
        ? `Skip — this lever already measured flat here. ${c.reason}`
        : isHeld
          ? `Hold — a ${leverFamily(c.lever)} change is still measuring here. ${c.reason}`
          : c.reason,
    });
    if (canBePrimary) primaryChosen = true;
  }
  if (out.length === 0 || !primaryChosen) {
    out.unshift({ lever: "wait", primary: !primaryChosen, blocked: false, reason: "No unblocked high-confidence lever — wait for measurement or fresh demand." });
  }
  return out;
}
