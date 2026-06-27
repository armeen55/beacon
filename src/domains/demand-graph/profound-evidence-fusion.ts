/**
 * Profound AEO EVIDENCE fusion (2026-06-26, PURE).
 *
 * Attaches Profound prompt intelligence to existing demand-graph Moves as
 * EVIDENCE/CONTEXT — never as an action selector or a score input. The output
 * lets a Move card say: "AI is asked '<prompt>', fans out into N questions,
 * cites <competitors>, and does not cite you." Evidence-only (operator guard):
 * this NEVER creates internal_link_fix/consolidate actions and NEVER reranks.
 *
 * Matching is deliberately CONSERVATIVE to avoid the compiler's generic-token
 * over-match (e.g. "famous Iranian films" → athletes). The strong, generic-token
 * -immune signal is COMPETITOR-DOMAIN overlap (if AI cites the same competitor
 * for the Move's topic and the prompt, they're about the same thing) plus an
 * OWNED-URL citation match. Subject-token overlap is a secondary gate computed
 * with prompt-corpus IDF, so pervasive tokens ("iran"/"persian"/"famous")
 * down-weight automatically — no hardcoded tenant words.
 *
 * PURE: no I/O. The cached durable opportunities are loaded by the caller
 * (load-graph) and passed in; this module never touches the network.
 */
import type { MoveCandidate } from "./build-graph";
import type { PromptOpportunity } from "@/domains/profound-question-intelligence/prompt-opportunity";

export type AeoEvidence = {
  source: "profound";
  /** The AI questions this Move answers (highest-attention first, capped). */
  prompts: string[];
  /** Total prompts matched (prompts[] may be capped for display). */
  promptCount: number;
  /** Downstream fan-out questions a winning page must also answer. */
  fanoutQueries: string[];
  /** Pages AI cites now (owned flagged) — the pages to cite or out-cite. */
  topCitedPages: { url: string; hostname: string; isOwned: boolean; answers: number }[];
  /** Competitor domains AI cites (non-owned), ranked. */
  topCitedDomains: { hostname: string; answers: number }[];
  /** Answers (summed across matched prompts) that cited the owned domain. */
  ownCitationCount: number;
  /** Answers (summed) that cited a competitor. */
  competitorCitationCount: number;
  /** Dominant recommended content shape among the matched prompts. */
  recommendedContentShape: string;
  confidence: "high" | "medium" | "low";
  /** Human-readable: why these prompts were matched to this Move. */
  matchBasis: string;
};

const DIRECTORY = new Set([
  "reddit.com", "youtube.com", "wikipedia.org", "en.wikipedia.org", "quora.com",
  "facebook.com", "instagram.com", "x.com", "twitter.com", "pinterest.com", "tiktok.com", "linkedin.com",
]);

// Generic English / question-frame stopwords (tenant-AGNOSTIC). Tenant-specific
// pervasive tokens (iran/persian/famous) are handled by prompt-corpus IDF, not a
// hardcoded list, so this stays portable.
const STOP = new Set([
  "the", "and", "for", "with", "your", "you", "are", "what", "which", "who", "how",
  "why", "when", "where", "best", "top", "list", "guide", "about", "into", "from",
  "their", "they", "them", "this", "that", "these", "those", "have", "has", "good",
]);

const stripWww = (h: string): string => h.replace(/^www\./i, "").toLowerCase();

function hostOf(u: string): string {
  if (!u) return "";
  const withScheme = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  try {
    return stripWww(new URL(withScheme).hostname);
  } catch {
    const h = u.replace(/^https?:\/\//i, "").split("/")[0]?.replace(/^www\./i, "").toLowerCase();
    return h && h.includes(".") ? h : "";
  }
}

function normUrl(u: string | null | undefined): string {
  if (!u) return "";
  const withScheme = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  try {
    const x = new URL(withScheme);
    return (stripWww(x.hostname) + x.pathname).replace(/\/+$/, "").toLowerCase();
  } catch {
    return u.replace(/\/+$/, "").toLowerCase();
  }
}

const deplural = (w: string): string => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);

function tokens(s: string): string[] {
  return [
    ...new Set(
      s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t)).map(deplural),
    ),
  ];
}

/** IDF over the prompt corpus: a token in MANY prompts (iran/persian/famous) is
 *  generic → low weight; a rare token (kebab/soccer/names) → high. Continuous. */
function buildPromptIdf(opportunities: PromptOpportunity[]): (t: string) => number {
  const n = opportunities.length;
  if (n === 0) return () => 1;
  const df = new Map<string, number>();
  for (const o of opportunities) for (const t of tokens(o.prompt)) df.set(t, (df.get(t) ?? 0) + 1);
  const maxIdf = Math.log(n + 1);
  return (t: string): number => {
    const d = df.get(t) ?? 0;
    const idf = Math.log((n + 1) / (d + 1));
    return maxIdf === 0 ? 1 : 0.1 + 0.9 * (idf / maxIdf);
  };
}

/** Specific tokens of a string = tokens whose prompt-corpus IDF clears the bar. */
function specificTokens(s: string, w: (t: string) => number, min = 0.5): Set<string> {
  return new Set(tokens(s).filter((t) => w(t) >= min));
}

type Prepared = {
  o: PromptOpportunity;
  competitorDomains: Set<string>;
  ownedUrls: Set<string>;
  specific: Set<string>;
};

function prepare(opportunities: PromptOpportunity[], w: (t: string) => number): Prepared[] {
  return opportunities.map((o) => {
    const competitorDomains = new Set<string>();
    for (const d of o.topCompetitorDomains) {
      const h = stripWww(d.hostname);
      if (h && !DIRECTORY.has(h)) competitorDomains.add(h);
    }
    for (const p of o.topCitedPages) {
      if (p.isOwned) continue;
      const h = stripWww(p.hostname);
      if (h && !DIRECTORY.has(h)) competitorDomains.add(h);
    }
    const ownedUrls = new Set<string>([...o.ownCitedUrls.map(normUrl), ...o.topCitedPages.filter((p) => p.isOwned).map((p) => normUrl(p.url))].filter(Boolean));
    return { o, competitorDomains, ownedUrls, specific: specificTokens(o.prompt, w) };
  });
}

const SHAPE_LABEL: Record<string, string> = {
  answer_block: "answer block",
  expand_page: "expand the page",
  create_page: "create a page",
  source_gap: "be the cited source",
};

/**
 * Attach Profound AEO evidence to each Move (evidence-only). Returns a NEW moves
 * array; Moves with no confident Profound match are returned unchanged (no
 * `aeoEvidence`). Never mutates score/components/gap.
 */
export function attachProfoundEvidenceToMoves(
  moves: MoveCandidate[],
  opportunities: PromptOpportunity[],
): MoveCandidate[] {
  if (opportunities.length === 0) return moves;
  const w = buildPromptIdf(opportunities);
  const prepared = prepare(opportunities, w);

  return moves.map((m) => {
    const moveDomains = new Set<string>(m.competitorUrls.map(hostOf).filter((h) => h && !DIRECTORY.has(h)));
    const moveOwned = normUrl(m.ownedUrl);
    const moveSpecific = specificTokens(m.label, w);
    // Move's own fan-out seeds also carry subject tokens (helps create moves).
    for (const f of m.fanoutSeeds) for (const t of specificTokens(f, w)) moveSpecific.add(t);

    type Hit = { p: Prepared; conf: "high" | "medium"; basis: string; strength: number };
    const hits: Hit[] = [];
    for (const p of prepared) {
      const ownedMatch = !!moveOwned && p.ownedUrls.has(moveOwned);
      let sharedComp = 0;
      for (const d of moveDomains) if (p.competitorDomains.has(d)) sharedComp++;
      let sharedSubj = 0;
      for (const t of moveSpecific) if (p.specific.has(t)) sharedSubj++;

      if (ownedMatch) {
        hits.push({ p, conf: "high", basis: "AI cites this exact page", strength: 100 + p.o.executions });
      } else if (sharedComp >= 1 && sharedSubj >= 1) {
        hits.push({ p, conf: "high", basis: "same competitors + subject", strength: 50 + sharedComp * 5 + sharedSubj + p.o.executions });
      } else if (sharedSubj >= 2) {
        hits.push({ p, conf: "medium", basis: "subject match", strength: 10 + sharedSubj + p.o.executions });
      }
    }
    if (hits.length === 0) return m;

    hits.sort((a, b) => b.strength - a.strength);
    const matched = hits.slice(0, 6);

    // Aggregate evidence across the matched prompts.
    const promptList = matched.map((h) => h.p.o.prompt);
    const fanouts = new Set<string>();
    const pagesByUrl = new Map<string, { url: string; hostname: string; isOwned: boolean; answers: number }>();
    const domainsByHost = new Map<string, number>();
    let ownCitationCount = 0;
    let competitorCitationCount = 0;
    const shapeTally = new Map<string, number>();
    for (const h of matched) {
      const o = h.p.o;
      for (const f of o.fanoutQueries) fanouts.add(f);
      for (const pg of o.topCitedPages) {
        const prev = pagesByUrl.get(pg.url);
        if (prev) prev.answers += pg.answers;
        else pagesByUrl.set(pg.url, { url: pg.url, hostname: pg.hostname, isOwned: pg.isOwned, answers: pg.answers });
      }
      for (const d of o.topCompetitorDomains) domainsByHost.set(d.hostname, (domainsByHost.get(d.hostname) ?? 0) + d.answers);
      ownCitationCount += o.ownCitationCount;
      competitorCitationCount += o.topCompetitorDomains.reduce((s, d) => s + d.answers, 0);
      shapeTally.set(o.recommendedMove, (shapeTally.get(o.recommendedMove) ?? 0) + 1);
    }
    const topShape = [...shapeTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "answer_block";
    const anyHigh = matched.some((h) => h.conf === "high");

    const aeoEvidence: AeoEvidence = {
      source: "profound",
      prompts: promptList,
      promptCount: hits.length,
      fanoutQueries: [...fanouts].slice(0, 12),
      topCitedPages: [...pagesByUrl.values()].sort((a, b) => b.answers - a.answers).slice(0, 6),
      topCitedDomains: [...domainsByHost.entries()].map(([hostname, answers]) => ({ hostname, answers })).sort((a, b) => b.answers - a.answers).slice(0, 6),
      ownCitationCount,
      competitorCitationCount,
      recommendedContentShape: SHAPE_LABEL[topShape] ?? topShape,
      confidence: anyHigh ? "high" : "medium",
      matchBasis: matched[0]!.basis,
    };
    return { ...m, aeoEvidence };
  });
}

/** One-line plain-language evidence sentence for a Move card (the "magic" line). */
export function aeoEvidenceSentence(e: AeoEvidence): string {
  const top = e.prompts[0] ?? "";
  const fan = e.fanoutQueries.length;
  const comps = e.topCitedDomains.slice(0, 3).map((d) => d.hostname).join(", ");
  const absent = e.ownCitationCount === 0 ? " and does not cite you" : ` (you're cited in ${e.ownCitationCount})`;
  const fanPart = fan > 0 ? `, fans out into ${fan} related question${fan === 1 ? "" : "s"}` : "";
  const compPart = comps ? `, cites ${comps}${absent}` : absent.trim() ? `${absent}` : "";
  return `AI is asked “${top}”${fanPart}${compPart}.`;
}
