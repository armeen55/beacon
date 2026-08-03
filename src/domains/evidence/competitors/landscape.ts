/**
 * evidence/competitors/landscape - THE competitor landscape for one account: every domain that recurs in the evidence, classified, ordered by how strongly it
 * recurs, with the operator's own corrections applied on top. A snapshot and a list of overrides in, rows out, plus ONE durable side: the settled verdict on
 * whether a recurring domain is actually a business competing with this account (see "is it actually a business competing with you", below).
 *
 * FOUR SOURCES, ONE ROW PER DOMAIN. The recurring domains bought per case, the winning pages I actually looked at, the AI citations on the exact result
 * pages, and the citation analysis over stored answers all describe the SAME domain from different angles. So a domain's count is the strongest single
 * source's count and NEVER a sum: adding four partial views of one citation would invent citations that never happened, the same way adding overlapping
 * search volumes invents demand.
 *
 * OVERRIDES ARE THE OPERATOR'S LAST WORD, on every read. An excluded domain leaves entirely and is never even inspected, a pinned domain is a commercial
 * competitor even when the evidence is thin (and appears even when I have no evidence at all, because a pin that silently vanishes is a lie), and a corrected
 * group wins over my rule and over any verdict on file.
 */

import { createHash } from "node:crypto";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { domainOf } from "../relevance-gate";
import type { ResearchPageExtract } from "../funnel/research-evidence";
import type { EvidenceSnapshot } from "../snapshot";
import { classifyDomain, type ClassifiedDomain, type CompetitorKind } from "./classify";

/** ONE operator instruction about ONE domain. Stored on the business profile beside the competitors the operator typed, so it survives without a migration. */
export type CompetitorOverride = {
  domain: string;
  action: "pin" | "exclude" | "correct";
  /** Required by "correct", ignored otherwise. */
  kind?: CompetitorKind;
};

/** The landscape never grows past what an operator can actually read. */
const MAX_ROWS = 50;

type Tally = { organicRows: number; caseKeywords: number; queryKeys: Set<string>; winnerCitations: number; serpCitations: number; analysisCitations: number };

const blank = (): Tally => ({ organicRows: 0, caseKeywords: 0, queryKeys: new Set(), winnerCitations: 0, serpCitations: 0, analysisCitations: 0 });
const clean = (d: string): string => d.trim().replace(/^www\./, "").toLowerCase();

/**
 * Fold the snapshot's four competitor-bearing sources into one classified, ordered list. Consumed by Visibility; Decision already reads the raw per-case
 * domains it is built from. `adjudicate` is the ONE paid seam and it is optional by design: Runtime passes it inside the research run, a page render passes
 * nothing and therefore physically cannot spend a cent, and either way a verdict already on file is served at $0. Without it, a domain nobody has inspected
 * stays honestly unresolved rather than being guessed into a rival.
 */
export async function competitorLandscape(
  snapshot: EvidenceSnapshot,
  overrides: readonly CompetitorOverride[] = [],
  adjudicate?: OverlapAsk,
): Promise<ClassifiedDomain[]> {
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
  for (const c of research.caseCompetitors ?? []) for (const row of c.domains) {
    const t = get(row.domain);
    if (t) t.caseKeywords = Math.max(t.caseKeywords, row.keywordsCount ?? 1);
  }
  // 2. The winning pages, split by what the appearance actually was.
  for (const page of research.winningPages) {
    const t = get(page.domain || domainOf(page.url));
    if (!t) continue;
    for (const a of page.appearances) {
      if (a.kind !== "serp_organic") { t.winnerCitations += 1; continue; }
      t.organicRows += 1;
      if (a.query) t.queryKeys.add(a.query.trim().toLowerCase());
    }
  }
  // 3. The AI blocks printed on the exact result pages I looked at.
  for (const s of research.serpEvidence) for (const cite of [...s.aiOverview, ...s.aiMode]) {
    const t = get(cite.domain || domainOf(cite.url));
    if (t) t.serpCitations += 1;
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

  // THE INSPECTION, BEFORE ANY DOMAIN IS CALLED A RIVAL. Overrides are honoured first, so the operator's own word never buys a look and an excluded domain is
  // never inspected at all.
  const overlap = await overlapVerdicts(snapshot, [...tallies.keys()].filter((d) => !excluded.has(d) && !pinned.has(d) && !corrected.has(d)), adjudicate);
  const rows: ClassifiedDomain[] = [];
  for (const [domain, t] of tallies) {
    if (excluded.has(domain)) continue;
    const isOwned = !!site && (domain === site || domain.endsWith(`.${site}`));
    const row = classifyDomain(domain, {
      serpAppearances: Math.max(t.organicRows, t.caseKeywords),
      competingQueries: Math.max(t.queryKeys.size, t.caseKeywords),
      aiCitations: Math.max(t.winnerCitations, t.serpCitations, t.analysisCitations),
      overlap: overlap.get(domain) ?? null,
      isOwned,
    });
    // THE OPERATOR'S WORD IS NEVER AMBIGUOUS. A row they pinned or corrected is settled, so nothing downstream may spend a model call second-guessing them.
    if (pinned.has(domain)) rows.push({ ...row, kind: "commercial_competitor", ambiguous: false, why: "You pinned this, so I treat it as a competitor whatever my own reading says." });
    else if (corrected.has(domain)) rows.push({ ...row, kind: corrected.get(domain)!, ambiguous: false, why: `You set this, so I hold it as ${KIND_WORDS[corrected.get(domain)!]}.` });
    else rows.push(row);
  }
  return rows.sort((a, b) => b.evidence.competingQueries - a.evidence.competingQueries || b.evidence.serpAppearances - a.evidence.serpAppearances ||
    b.evidence.aiCitations - a.evidence.aiCitations || a.domain.localeCompare(b.domain)).slice(0, MAX_ROWS);
}

// ── is it actually a business competing with you ─────────────────────────────
/**
 * THE INSPECTION recurrence is not allowed to stand in for. Ranking beside you proves a domain is worth classifying; only its own pages can say whether it
 * sells a comparable product or service to the same customers, and that is the whole of what `commercial_competitor` means. In this order, and the order is
 * the cost story: (1) the verdict already on file for this domain AT THIS EVIDENCE, served forever at $0 while the evidence does not move, so an unchanged
 * landscape asks nobody anything; (2) the page evidence the research run ALREADY read for that domain (its address, title, headings, meta description and
 * opening words) - nothing here fetches a page, and a domain with nothing readable in hand simply stays unresolved, because guessing from counts is the
 * defect being repaired; (3) ONE bounded structured verdict through `adjudicate`, which Runtime injects and a render never does. The stored row is
 * inspectable on purpose: the exact pages it was decided on, the reason, the model that said it, and when. A model that refuses, is capped or comes back in
 * a shape I cannot read writes NOTHING, so a row can never harden into a guess.
 */
type OverlapAsk = (input: { domain: string; pages: string[]; site: string | null; ownedPages: string[] })
  => Promise<{ verdict: OverlapVerdict; reason: string; model: string } | null>;
type OverlapVerdict = "same_business" | "not_a_business";
/** ONE settled adjudication. Per account (another account's rival is not yours) and durable across deploys. */
type OverlapRow = { domain: string; evidenceHash: string; verdict: OverlapVerdict; evidenceIds: string[]; reason: string; decidedBy: string; decidedAt: string };

const OVERLAP_STORE = "competitor-overlap";
/** The landscape is capped at 50 rows and an account's history of them is not worth unbounded growth. */
const MAX_VERDICTS = 200;
const hashOf = (parts: readonly string[]): string => createHash("sha256").update(parts.join("\x00")).digest("hex").slice(0, 24);
/** One already-read page, flattened to the words an inspection can actually judge. Never the page itself. */
const pageLine = (url: string, e: ResearchPageExtract): string =>
  [url, e.title, e.h1, e.metaDescription, e.headings.slice(0, 8).join(" | "), e.openingSample].filter(Boolean).join(" :: ").slice(0, 900);

async function overlapVerdicts(snapshot: EvidenceSnapshot, domains: readonly string[], adjudicate?: OverlapAsk): Promise<Map<string, OverlapVerdict>> {
  const out = new Map<string, OverlapVerdict>();
  const tenantId = snapshot.scope.tenantId;
  if (!tenantId || domains.length === 0) return out;
  const held = await readStore<OverlapRow>(OVERLAP_STORE, [], { tenantId }).catch(() => [] as OverlapRow[]);
  const onFile = new Map(held.map((r) => [r.domain, r]));
  // WHO I AM is half of "the same customers", so it belongs in the evidence hash: a business that changes what it sells deserves a fresh reading of everybody
  // it was ever measured against.
  const site = snapshot.scope.site;
  const ownedPages = snapshot.ownedPages.slice(0, 6).map((p) => `${p.url} :: ${p.content?.title ?? ""}`.slice(0, 200));
  const mine = hashOf([site ?? "", ...ownedPages]);
  let wrote = false;
  for (const domain of domains) {
    const read = snapshot.research.winningPages.filter((p) => clean(p.domain || domainOf(p.url)) === domain && p.extract).slice(0, 3);
    if (read.length === 0) continue; // nothing of theirs has been read: unresolved, and nobody is asked
    const pages = read.map((p) => pageLine(p.url, p.extract!));
    const evidenceHash = hashOf([mine, ...pages]);
    const prior = onFile.get(domain);
    if (prior?.evidenceHash === evidenceHash) { out.set(domain, prior.verdict); continue; } // unchanged evidence asks nobody
    if (!adjudicate) continue;
    const said = await adjudicate({ domain, pages, site, ownedPages }).catch(() => null);
    if (!said) continue; // refused, capped or unreadable: still unresolved, never a guessed rival
    onFile.set(domain, { domain, evidenceHash, verdict: said.verdict, evidenceIds: read.map((p) => p.url),
      reason: said.reason.slice(0, 300), decidedBy: said.model, decidedAt: new Date().toISOString() });
    out.set(domain, said.verdict);
    wrote = true;
  }
  if (wrote) await writeStore<OverlapRow>(OVERLAP_STORE, [...onFile.values()].slice(-MAX_VERDICTS), { tenantId }).catch(() => {});
  return out;
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
