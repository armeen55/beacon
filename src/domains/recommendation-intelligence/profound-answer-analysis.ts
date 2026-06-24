/**
 * Profound answer analysis (2026-06-24) — turns RAW Profound answers
 * (`/v1/prompts/answers`, one row per AI answer with mentions[] + cited
 * hostnames + topic/model) into per-TOPIC AEO gaps:
 *
 *   "For topic X, AI answers cite competitor1.com / competitor2.com but NOT
 *    you, and never mention your brand — here is exactly who owns the answer."
 *
 * This is the real AEO wedge: 0% owned citation share in a topic the tenant
 * SHOULD own is the strongest signal there is — and we can name the domains to
 * displace. Pure / deterministic / no I/O / NO hardcoding (all brand + domain +
 * directory inputs are explicit args, so it works for ANY tenant — Iranopedia,
 * Ritz, anyone). Pinned by profound-answer-analysis.test.ts.
 */

import type { ProfoundAnswerRow } from "@/lib/connectors/profound/client";

export type ProfoundTopicGap = {
  topic: string;
  /** Distinct AI answers observed for this topic (the denominator). */
  totalAnswers: number;
  /** Answers whose mentions[] named the owned brand. */
  ownedMentioned: number;
  /** Answers that cited the owned domain (suffix-aware). */
  ownedCited: number;
  /** owned citation share over answers in this topic (0..1). */
  ownedCitationShare: number;
  /** Competitor domains cited in this topic, ranked by answers citing them. */
  competitorDomains: { hostname: string; answers: number }[];
  /** Models the topic was seen on (ChatGPT, Perplexity, …). */
  models: string[];
  /** Higher = bigger opportunity: real demand (answers) + competitors present +
   *  owned absent. Sort desc to prioritize. */
  gapScore: number;
};

export type ProfoundAnswerAnalysis = {
  totalAnswers: number;
  /** Owned citation share across ALL analyzed answers (0..1). */
  ownedCitationShare: number;
  /** Owned brand mention rate across all answers (0..1). */
  ownedMentionRate: number;
  /** Topics where the tenant is absent/weak while competitors are cited,
   *  sorted by gapScore desc. THE rec source. */
  gaps: ProfoundTopicGap[];
};

export type AnalyzeProfoundArgs = {
  answers: ReadonlyArray<ProfoundAnswerRow>;
  /** Owned brand names/aliases (matched case-insensitively, whole-token). */
  ownedBrandAliases: ReadonlyArray<string>;
  /** Owned domain, e.g. "iranopedia.com" (subdomains count as owned). */
  ownedDomain: string;
  /** Hostnames that are aggregators/social, NOT displaceable competitors
   *  (reddit.com, youtube.com, …) — excluded from the competitor list. */
  directoryDomains?: ReadonlyArray<string>;
  /** A topic is only a "gap" once it has at least this many answers (demand). */
  minAnswers?: number;
};

const stripWww = (h: string): string => h.replace(/^www\./i, "").toLowerCase();

/** Whole-token, case-insensitive, hyphen-aware brand match (mirrors the
 *  execution-adapter boundary fix: a hyphen/letter adjacency must NOT bridge
 *  into a different proper noun). */
function brandMentioned(
  mentions: ReadonlyArray<string>,
  aliases: ReadonlyArray<string>,
): boolean {
  const norm = aliases
    .map((a) => a.trim().toLowerCase())
    .filter((a) => a.length > 0);
  if (norm.length === 0) return false;
  for (const m of mentions) {
    const lower = m.toLowerCase();
    for (const a of norm) {
      if (lower === a) return true;
      const esc = a.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      if (new RegExp(`(?<![a-z0-9-])${esc}(?![a-z0-9-])`, "i").test(lower)) {
        return true;
      }
    }
  }
  return false;
}

/** Suffix-aware owned-host test (a subdomain of the owned domain is owned). */
function isOwnedHost(host: string, ownedNorm: string): boolean {
  const h = stripWww(host);
  return h === ownedNorm || h.endsWith("." + ownedNorm);
}

export function analyzeProfoundAnswers(
  args: AnalyzeProfoundArgs,
): ProfoundAnswerAnalysis {
  const ownedNorm = stripWww((args.ownedDomain || "").trim());
  const directory = new Set(
    (args.directoryDomains ?? []).map((d) => stripWww(d)),
  );
  const minAnswers = args.minAnswers ?? 3;

  type Acc = {
    total: number;
    ownedMentioned: number;
    ownedCited: number;
    comp: Map<string, number>;
    models: Set<string>;
  };
  const byTopic = new Map<string, Acc>();
  let total = 0;
  let ownedMentionedAll = 0;
  let ownedCitedAll = 0;

  for (const a of args.answers) {
    total += 1;
    const topic = (a.topic ?? "").trim() || "(uncategorized)";
    let acc = byTopic.get(topic);
    if (!acc) {
      acc = { total: 0, ownedMentioned: 0, ownedCited: 0, comp: new Map(), models: new Set() };
      byTopic.set(topic, acc);
    }
    acc.total += 1;
    if (a.model) acc.models.add(a.model);

    const mentioned = brandMentioned(a.mentions, args.ownedBrandAliases);
    if (mentioned) {
      acc.ownedMentioned += 1;
      ownedMentionedAll += 1;
    }

    // Distinct hosts cited in THIS answer (so one answer counts a domain once).
    const hosts = new Set(a.citationHostnames.map((h) => stripWww(h)).filter(Boolean));
    let ownedHere = false;
    for (const h of hosts) {
      if (ownedNorm && isOwnedHost(h, ownedNorm)) {
        ownedHere = true;
        continue;
      }
      if (directory.has(h)) continue; // not a displaceable competitor
      acc.comp.set(h, (acc.comp.get(h) ?? 0) + 1);
    }
    if (ownedHere) {
      acc.ownedCited += 1;
      ownedCitedAll += 1;
    }
  }

  const gaps: ProfoundTopicGap[] = [];
  for (const [topic, acc] of byTopic) {
    if (acc.total < minAnswers) continue;
    const competitorDomains = [...acc.comp.entries()]
      .map(([hostname, answers]) => ({ hostname, answers }))
      .sort((x, y) => y.answers - x.answers || x.hostname.localeCompare(y.hostname));
    // Only a GAP when competitors are cited AND owned is weak/absent.
    if (competitorDomains.length === 0) continue;
    const ownedShare = acc.total > 0 ? acc.ownedCited / acc.total : 0;
    if (ownedShare >= 0.5) continue; // owned already wins this topic — not a gap
    const topCompetitorAnswers = competitorDomains[0]!.answers;
    const gapScore = Math.round(acc.total * topCompetitorAnswers * (1 - ownedShare));
    gaps.push({
      topic,
      totalAnswers: acc.total,
      ownedMentioned: acc.ownedMentioned,
      ownedCited: acc.ownedCited,
      ownedCitationShare: Math.round(ownedShare * 100) / 100,
      competitorDomains: competitorDomains.slice(0, 8),
      models: [...acc.models].sort(),
      gapScore,
    });
  }
  gaps.sort((a, b) => b.gapScore - a.gapScore);

  return {
    totalAnswers: total,
    ownedCitationShare: total > 0 ? Math.round((ownedCitedAll / total) * 100) / 100 : 0,
    ownedMentionRate: total > 0 ? Math.round((ownedMentionedAll / total) * 100) / 100 : 0,
    gaps,
  };
}
