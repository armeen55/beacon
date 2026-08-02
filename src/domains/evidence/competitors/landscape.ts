/**
 * evidence/competitors/landscape - THE competitor landscape for one account: every domain that
 * recurs in the evidence, classified, ordered by how strongly it recurs, with the operator's own
 * corrections applied on top. PURE: a snapshot and a list of overrides in, rows out.
 *
 * FOUR SOURCES, ONE ROW PER DOMAIN. The recurring domains bought per case, the winning pages I
 * actually looked at, the AI citations on the exact result pages, and the citation analysis over
 * stored answers all describe the SAME domain from different angles. So a domain's count is the
 * strongest single source's count and NEVER a sum: adding four partial views of one citation
 * would invent citations that never happened, the same way adding overlapping search volumes
 * invents demand.
 *
 * OVERRIDES ARE THE OPERATOR'S LAST WORD. An excluded domain leaves entirely, a pinned domain is
 * a commercial competitor even when the evidence is thin (and appears even when I have no evidence
 * at all, because a pin that silently vanishes is a lie), and a corrected group wins over my rule.
 */

import { domainOf } from "../relevance-gate";
import type { EvidenceSnapshot } from "../snapshot";
import { classifyDomain, type ClassifiedDomain, type CompetitorKind } from "./classify";

/** ONE operator instruction about ONE domain. Stored on the business profile beside the
 *  competitors the operator typed, so it survives without a migration. */
export type CompetitorOverride = {
  domain: string;
  action: "pin" | "exclude" | "correct";
  /** Required by "correct", ignored otherwise. */
  kind?: CompetitorKind;
};

/** The landscape never grows past what an operator can actually read. */
const MAX_ROWS = 50;

type Tally = {
  organicRows: number;
  caseKeywords: number;
  queryKeys: Set<string>;
  winnerCitations: number;
  serpCitations: number;
  analysisCitations: number;
};

const blank = (): Tally => ({ organicRows: 0, caseKeywords: 0, queryKeys: new Set(), winnerCitations: 0, serpCitations: 0, analysisCitations: 0 });
const clean = (d: string): string => d.trim().replace(/^www\./, "").toLowerCase();

/**
 * Fold the snapshot's four competitor-bearing sources into one classified, ordered list.
 * Consumed by Visibility; Decision already reads the raw per-case domains it is built from.
 */
export function competitorLandscape(
  snapshot: EvidenceSnapshot,
  overrides: readonly CompetitorOverride[] = [],
): ClassifiedDomain[] {
  const site = clean(snapshot.scope.site ?? "");
  const research = snapshot.research;
  const tallies = new Map<string, Tally>();
  const get = (raw: string): Tally | null => {
    const d = clean(raw);
    if (!d || !d.includes(".")) return null;
    const t = tallies.get(d) ?? blank();
    tallies.set(d, t);
    return t;
  };

  // 1. The recurring domains bought for a whole case's keyword set.
  for (const c of research.caseCompetitors ?? []) {
    for (const row of c.domains) {
      const t = get(row.domain);
      if (t) t.caseKeywords = Math.max(t.caseKeywords, row.keywordsCount ?? 1);
    }
  }
  // 2. The winning pages, split by what the appearance actually was.
  for (const page of research.winningPages) {
    const t = get(page.domain || domainOf(page.url));
    if (!t) continue;
    for (const a of page.appearances) {
      if (a.kind === "serp_organic") {
        t.organicRows += 1;
        if (a.query) t.queryKeys.add(a.query.trim().toLowerCase());
      } else t.winnerCitations += 1;
    }
  }
  // 3. The AI blocks printed on the exact result pages I looked at.
  for (const s of research.serpEvidence) {
    for (const cite of [...s.aiOverview, ...s.aiMode]) {
      const t = get(cite.domain || domainOf(cite.url));
      if (t) t.serpCitations += 1;
    }
  }
  // 4. The citation analysis over stored AI answers.
  for (const c of snapshot.competitors) {
    const t = get(c.domain || domainOf(c.url));
    if (t) t.analysisCitations = Math.max(t.analysisCitations, c.citationCount);
  }

  const excluded = new Set(overrides.filter((o) => o.action === "exclude").map((o) => clean(o.domain)));
  const pinned = new Set(overrides.filter((o) => o.action === "pin").map((o) => clean(o.domain)));
  const corrected = new Map(overrides.filter((o) => o.action === "correct" && o.kind).map((o) => [clean(o.domain), o.kind!]));
  // A pin with no evidence behind it still shows, at honest zeros.
  for (const d of pinned) if (!tallies.has(d) && d) tallies.set(d, blank());

  const rows: ClassifiedDomain[] = [];
  for (const [domain, t] of tallies) {
    if (excluded.has(domain)) continue;
    const isOwned = !!site && (domain === site || domain.endsWith(`.${site}`));
    const row = classifyDomain(domain, {
      serpAppearances: Math.max(t.organicRows, t.caseKeywords),
      competingQueries: Math.max(t.queryKeys.size, t.caseKeywords),
      aiCitations: Math.max(t.winnerCitations, t.serpCitations, t.analysisCitations),
      isOwned,
    });
    if (pinned.has(domain)) rows.push({ ...row, kind: "commercial_competitor", why: "You pinned this, so I treat it as a competitor whatever my own reading says." });
    else if (corrected.has(domain)) rows.push({ ...row, kind: corrected.get(domain)!, why: `You set this, so I hold it as ${KIND_WORDS[corrected.get(domain)!]}.` });
    else rows.push(row);
  }
  return rows
    .sort((a, b) =>
      b.evidence.competingQueries - a.evidence.competingQueries ||
      b.evidence.serpAppearances - a.evidence.serpAppearances ||
      b.evidence.aiCitations - a.evidence.aiCitations ||
      a.domain.localeCompare(b.domain))
    .slice(0, MAX_ROWS);
}

// ── the operator's own words ─────────────────────────────────────────────────

/** Plain English for each group, both for the words an operator types and the words I read back. */
const KIND_WORDS: Record<CompetitorKind, string> = {
  commercial_competitor: "a competitor",
  citation_authority: "a source",
  publisher: "a publisher",
  marketplace_directory: "a marketplace",
  social_community: "a social platform",
  government_educational: "a government or school site",
  owned: "your own site",
  irrelevant_unknown: "not relevant",
};

const KIND_BY_WORD: Record<string, CompetitorKind> = {
  competitor: "commercial_competitor", rival: "commercial_competitor",
  source: "citation_authority", authority: "citation_authority",
  publisher: "publisher", publication: "publisher",
  marketplace: "marketplace_directory", directory: "marketplace_directory",
  social: "social_community", forum: "social_community", community: "social_community",
  government: "government_educational", school: "government_educational",
  mine: "owned", owned: "owned",
  irrelevant: "irrelevant_unknown", unknown: "irrelevant_unknown",
};

const KIND_LIST = Object.keys(KIND_BY_WORD).join(", ");

/** Read ONE stored override back as the line the operator would have typed, so the box they
 *  reopen tomorrow shows exactly the instructions I am holding. */
export function competitorOverrideLine(o: CompetitorOverride): string {
  if (o.action === "correct") return `${o.domain} is ${KIND_WORDS[o.kind ?? "irrelevant_unknown"]}`;
  return `${o.action} ${o.domain}`;
}

const SHAPE = 'Write one instruction per line: "pin example.com", "exclude example.com", or "example.com is a publisher".';
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** Strip anything an operator might paste around a bare host. */
const asDomain = (raw: string): string | null => {
  const d = clean(raw).replace(/^https?:\/\//, "").split("/")[0]!.split("?")[0]!;
  return DOMAIN_RE.test(d) ? d : null;
};

/**
 * Read the operator's instructions about discovered domains. Every line I cannot act on comes back
 * as a sentence that says what I could not do and how to write it instead, and the lines I DID
 * understand are still returned, so one typo never throws away four good corrections.
 */
export function parseCompetitorOverrides(text: string): { overrides: CompetitorOverride[]; errors: string[] } {
  const overrides: CompetitorOverride[] = [];
  const errors: string[] = [];
  for (const raw of (text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const act = /^(pin|exclude)\s+(.+)$/i.exec(line);
    if (act) {
      const domain = asDomain(act[2]!);
      if (!domain) errors.push(`"${act[2]!.trim()}" is not a domain I can use. Write it the way it appears in your results, like example.com.`);
      else overrides.push({ domain, action: act[1]!.toLowerCase() as "pin" | "exclude" });
      continue;
    }
    const set = /^(.+?)\s+is\s+(?:an?\s+)?(.+)$/i.exec(line);
    if (set) {
      const domain = asDomain(set[1]!);
      const kind = KIND_BY_WORD[set[2]!.trim().toLowerCase().split(/\s+/)[0]!];
      if (!domain) errors.push(`"${set[1]!.trim()}" is not a domain I can use. Write it the way it appears in your results, like example.com.`);
      else if (!kind) errors.push(`I do not have a group called "${set[2]!.trim()}". Use one of these words: ${KIND_LIST}.`);
      else overrides.push({ domain, action: "correct", kind });
      continue;
    }
    errors.push(`I could not read "${line}". ${SHAPE}`);
  }
  return { overrides, errors };
}
