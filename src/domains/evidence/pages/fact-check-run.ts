import "server-only";

/** evidence/pages/fact-check-run - ONE CLAIM, RESEARCHED PROPERLY, PER RENEWED LEASE. The first version was a
 *  Persian-name prototype wearing the word "loop" (Codex, 2026-08-18): it could never reach page two, it judged
 *  claims from search-result TITLES without reading a source, it asked for etymology when the claim was a date,
 *  it read `budgetMs` as a per-call timeout, and it keyed a statement by subject alone so two claims about one
 *  subject overwrote each other.
 *
 *  WHAT IT IS NOW. Take the claim the persisted inventory says is owed, ACQUIRE candidates with a query derived
 *  from the CLAIM TYPE, FETCH the best candidate's actual text, judge the claim against THAT PASSAGE, bank one
 *  row. Every call is preceded by asking whether enough of the absolute deadline remains to persist its result.
 *
 *  `confirmed` REQUIRES A READ SOURCE: not a title, not a domain, not the model's recollection. Everything
 *  weaker stays a finding that never authorizes an edit. */

import { createHash } from "node:crypto";
import { log } from "@/lib/logger";
import { recordFactChecks, recordOwedClaims, supersedeStaleFacts, statementKeyOf,
  type FactCheck, type SourceKind } from "./fact-checks";

const EMPTY_ROW = { proposed: null, literal: null, usage: null, sources: [], agreement: "none_found" as const,
  confidence: "unsupported" as const, verdict: "undecidable" as const, alsoAt: [], note: "", sourceReadAt: null };

/** How many candidate sources one claim weighs, and how many it will actually fetch. */
const CANDIDATES = 6, FETCH_PER_CLAIM = 2;
/** A call is only started when this much of the deadline remains, so its result can always be persisted. */
const RESERVE_MS = 8_000;

const SCHOLARLY = /(^|\.)(iranicaonline\.org|dsal\.uchicago\.edu|jstor\.org|academia\.edu|brill\.com|oup\.com|cambridge\.org|nih\.gov|who\.int)$|\.(edu|gov|ac\.[a-z]{2})$/i;
const DICTIONARY = /(^|\.)(wiktionary\.org|merriam-webster\.com|oed\.com|dehkhoda\.ut\.ac\.ir|vajehyab\.com|abadis\.ir|collinsdictionary\.com)$/i;
const ENCYCLOPEDIA = /(^|\.)(wikipedia\.org|britannica\.com|encyclopedia\.com)$/i;
const REFERENCE = /(^|\.)(behindthename\.com|nameberry\.com|ethnologue\.com|statista\.com|census\.gov)$/i;
const BABYNAME = /(baby|names?)[-.]?(names?|meaning|central|nology)|(^|\.)(momjunction|pampers|thebump|babycenter|parents)\./i;

export function sourceClassOf(domain: string): SourceKind {
  const d = domain.replace(/^www\./, "").toLowerCase();
  if (SCHOLARLY.test(d)) return "scholarly";
  if (DICTIONARY.test(d)) return "dictionary";
  if (ENCYCLOPEDIA.test(d)) return "encyclopedia";
  if (REFERENCE.test(d)) return "reference";
  if (BABYNAME.test(d)) return "babyname";
  return "community";
}
const AUTHORITATIVE = new Set<SourceKind>(["scholarly", "dictionary", "encyclopedia"]);

export const pageHashOf = (body: string): string => createHash("sha256").update(body).digest("hex").slice(0, 16);

/** WHAT KIND OF CLAIM THIS IS, which decides how you go looking for a source. A date is not researched the way
 *  a word's etymology is, and appending "meaning origin etymology" to a statistic is how a prototype betrays
 *  itself. Deterministic and total: an unrecognised claim is a plain definition, which searches plainly. */
export type ClaimType = "word_meaning" | "date_or_event" | "quantity" | "definition" | "specification" | "entity_fact" | "geography";

export function claimTypeOf(subject: string, current: string): ClaimType {
  const t = `${subject} ${current}`.toLowerCase();
  if (/\b(means?|meaning|derives?|derived|etymolog|origin of the name|name meaning|translat)/.test(t)) return "word_meaning";
  if (/\b(1[0-9]{3}|20[0-9]{2}|bce?\b|ad\b|century|founded|born|died|dynasty|war|revolution|treaty)\b/.test(t)) return "date_or_event";
  if (/\b(\d[\d,.]*\s*(percent|%|million|billion|thousand|km|miles|kg|people|residents|users)|population|average|median|rate)\b/.test(t)) return "quantity";
  if (/\b(located|capital|province|region|city of|river|mountain|border)\b/.test(t)) return "geography";
  if (/\b(model|version|specification|dimensions|weight|material|capacity|voltage)\b/.test(t)) return "specification";
  if (/\b(is a|was a|founder|ceo|author|invented|composer|poet|king|shah)\b/.test(t)) return "entity_fact";
  return "definition";
}

/** The search that finds an authority on THIS kind of claim. */
export function sourceQueryFor(type: ClaimType, subject: string): string {
  switch (type) {
    case "word_meaning": return `${subject} name meaning etymology dictionary`;
    case "date_or_event": return `${subject} date history encyclopedia`;
    case "quantity": return `${subject} official statistics figure`;
    case "geography": return `${subject} location geography encyclopedia`;
    case "specification": return `${subject} official specification`;
    case "entity_fact": return `${subject} biography encyclopedia`;
    default: return `${subject} definition reference`;
  }
}

/** A STATEMENT'S IDENTITY is the normalized claim plus where it sits, never the subject alone: a page can say
 *  two different things about one subject and both are real (Codex, 2026-08-18). */
export function claimIdentity(subject: string, current: string, locator?: string | null): string {
  const norm = `${subject}|${current}|${locator ?? ""}`.toLowerCase().replace(/\s+/g, " ").trim();
  return `${statementKeyOf(subject)}#${createHash("sha256").update(norm).digest("hex").slice(0, 10)}`;
}

const CLAIM_SYSTEM = 'You read one web page and list the statements on it that an outside source could confirm or contradict. '
  + 'Return ONLY {"statements":[{"subject","current","locator"}]}: `subject` is what the statement is about as the page writes it; '
  + '`current` is the page\'s own wording, quoted exactly; `locator` is where it sits (the heading or section it is under). '
  + 'Only statements of FACT about the world. Never marketing copy, navigation, or anything about the page itself. At most 40.';

const JUDGE_SYSTEM = 'You compare ONE statement a web page makes against PASSAGES QUOTED FROM SOURCES THAT WERE ACTUALLY FETCHED. '
  + 'Return ONLY {"verdict","proposed","literal","usage","agreement","confidence","supportingQuote","note"}. '
  + 'verdict: page_correct | page_wrong | page_imprecise | undecidable. confidence: confirmed | likely | disputed | unsupported. '
  + 'You may answer "confirmed" ONLY when the passages you were given state the corrected fact plainly and at least one is from a scholarly, dictionary or encyclopedia source. '
  + '`supportingQuote` MUST be copied verbatim from one of the passages; if you cannot quote one, answer unsupported and propose nothing. '
  + 'Distinguish literal etymology from modern usage: a page recording a live usage is not automatically wrong. Never invent a replacement.';

type Extracted = { statements: { subject: string; current: string; locator?: string }[] };
type Judged = { verdict: FactCheck["verdict"]; proposed: string; literal: string; usage: string;
  agreement: FactCheck["agreement"]; confidence: FactCheck["confidence"]; supportingQuote: string; note: string };

/** The one model call a unit may make. `kind` names the STRUCTURED OUTPUT SCHEMA the answer must satisfy, so
 *  a caller cannot quietly ask the editor judge for a claim list and read zero statements for ever. */
export type StructuredRead = (input: { kind: "fact_claim_extraction" | "fact_claim_judgement";
  system: string; user: string; grounded: string; projectedCostUsd: number; maxTokens: number })
  => Promise<Record<string, unknown> | null>;

/** WHERE THE PAGE STANDS, read back from the persisted inventory rather than carried in a lease. */
export type FactCheckCursor = {
  page: string; pageContentHash: string | null; evidenceBasis: string | null;
  /** How many of this page version's claims are researched, out of how many the page makes. */
  checked: number; total: number;
  /** True once every claim for this page version has been checked: the caller may advance to another page. */
  pageComplete: boolean;
};

export type FactCheckUnitDeps = {
  read: StructuredRead;
  /** Candidate sources for a query. */
  searchSources?: (query: string) => Promise<{ organic: { domain: string; url: string; title: string | null }[] } | null>;
  /** THE SOURCE ITSELF: fetch and parse one URL. Absent, or answering null, means nothing may be confirmed. */
  fetchSource?: (url: string) => Promise<{ text: string } | null>;
  page: { url: string; path: string; body: string };
  tenantId: string; now: Date; basis: string | null;
  /** Checks already on file for this page, so a current one is skipped and a stale one is redone. */
  held?: readonly FactCheck[];
  /** The absolute instant this unit must be finished by. */
  deadlineAt: number;
};

/** WHAT ONE UNIT DID, in the run's own vocabulary. `advanced` = one claim researched and STORED. `done` =
 *  this page version owes nothing. `failed` = nothing advanced and the claim is still owed, which is not the
 *  same answer and must never move a run on to publishing. */
export type FactCheckUnitResult = { status: "advanced" | "done" | "failed"; banked: number;
  cursor: FactCheckCursor | null; reason?: string };

const enough = (deadlineAt: number, need: number): boolean => Date.now() + need + RESERVE_MS <= deadlineAt;

/** ONE unit: at most one claim researched, one row banked, and a cursor to resume from. */
export async function runFactCheckUnit(d: FactCheckUnitDeps): Promise<FactCheckUnitResult> {
  const { tenantId, page, now } = d;
  if (!page.body.trim()) return { status: "failed", banked: 0, cursor: null, reason: "no stored words for this page" };
  const hash = pageHashOf(page.body);

  // 1. THE CLAIM INVENTORY FOR THIS PAGE VERSION, READ BACK FROM THE STORE: a lease lost mid page resumes
  // where it stopped instead of paying to extract the same claims again, and completeness outlives the pass.
  const mine = (d.held ?? []).filter((h) => h.page === page.path);
  let inventory = mine.filter((h) => h.pageContentHash === hash && h.state !== "superseded");
  if (inventory.length === 0) {
    if (!enough(d.deadlineAt, 20_000)) return { status: "failed", banked: 0, cursor: null, reason: "not enough of this lease remains to read the page" };
    const extracted = await d.read({ kind: "fact_claim_extraction", system: CLAIM_SYSTEM,
      user: `Page: ${page.url}\n\nIts stored words:\n${page.body.slice(0, 12_000)}\n\nReturn the JSON now.`,
      grounded: page.body.slice(0, 12_000), projectedCostUsd: 0.02, maxTokens: 3000 }).catch(() => null);
    if (!extracted) return { status: "failed", banked: 0, cursor: null, reason: "the page's checkable statements could not be read" };
    const claims = ((extracted as unknown as Extracted).statements ?? [])
      .filter((s) => s.subject?.trim() && s.current?.trim())
      .map((s) => ({ subject: s.subject.trim(), current: s.current.trim(), locator: s.locator?.trim() || null }))
      .map((c) => ({ ...c, statementKey: claimIdentity(c.subject, c.current, c.locator) }))
      .filter((c, i, all) => all.findIndex((x) => x.statementKey === c.statementKey) === i);
    // THE PAGE MOVED ON: whatever was held against an older version, or objects to wording this version no
    // longer carries, becomes history now rather than a second live instruction beside its own replacement.
    const body = page.body.toLowerCase();
    await supersedeStaleFacts(tenantId, page.path, hash, (current) => body.includes(current.trim().toLowerCase()))
      .catch((e) => { log.warn("[fact-check] stale claims could not be retired", { tenantId, page: page.path, error: String(e) }); return 0; });
    if (claims.length === 0) {
      return { status: "done", banked: 0, cursor: { page: page.path, pageContentHash: hash, evidenceBasis: d.basis, checked: 0, total: 0, pageComplete: true },
        reason: "this page makes no checkable statement" };
    }
    // THE INVENTORY IS THE CURSOR, stored BEFORE one claim is researched: researching against an inventory
    // nobody stored is how page two stayed unreachable.
    const wrote = await recordOwedClaims(tenantId, page.path, claims, hash, d.basis).catch(() => -1);
    if (wrote < 0) return { status: "failed", banked: 0, cursor: null, reason: "the page's claim inventory could not be stored, so nothing was researched" };
    inventory = claims.map((c) => ({ ...EMPTY_ROW, page: page.path, statementKey: c.statementKey, subject: c.subject,
      current: c.current, pageLocator: c.locator, pageContentHash: hash, evidenceBasis: d.basis, state: "owed" as const,
      checkedAt: now.toISOString() }));
  }

  // 2. THE NEXT CLAIM THIS PAGE VERSION STILL OWES.
  const owed = inventory.filter((h) => h.state === "owed");
  const progress = { page: page.path, pageContentHash: hash, evidenceBasis: d.basis,
    checked: inventory.length - owed.length, total: inventory.length };
  if (owed.length === 0) {
    return { status: "done", banked: 0, cursor: { ...progress, pageComplete: true }, reason: "every claim on this page version is current" };
  }
  const next = owed[0]!;
  const claim = { subject: next.subject, current: next.current, locator: next.pageLocator };
  const cursor: FactCheckCursor = { ...progress, pageComplete: false };
  const advance: FactCheckCursor = { ...progress, checked: progress.checked + 1, pageComplete: owed.length === 1 };
  const key = next.statementKey;
  const type = claimTypeOf(claim.subject, claim.current);

  const bank = async (row: FactCheck): Promise<FactCheckUnitResult> => {
    const banked = await recordFactChecks(tenantId, page.path, [row]);
    log.info("[fact-check] one claim researched", { tenantId, page: page.path, subject: claim.subject, type, confidence: row.confidence, banked });
    // A WRITE THAT DID NOT LAND IS A FAILED UNIT: advancing past a claim nothing stored would skip it forever.
    return banked > 0 ? { status: "advanced", banked, cursor: advance }
      : { status: "failed", banked: 0, cursor, reason: "the result could not be stored, so this claim is still owed" };
  };
  const base = { page: page.path, statementKey: key, state: "checked" as const, subject: claim.subject, current: claim.current,
    literal: null, usage: null, alsoAt: claim.locator ? [claim.locator] : [],
    pageContentHash: hash, pageLocator: claim.locator, sourceReadAt: null as string | null,
    evidenceBasis: d.basis, checkedAt: now.toISOString() };

  // 3. ACQUIRE candidates with a query derived from the claim type.
  if (!d.searchSources || !enough(d.deadlineAt, 15_000)) return { status: "failed", banked: 0, cursor, reason: "no lease left to look for sources" };
  const found = await d.searchSources(sourceQueryFor(type, claim.subject)).catch(() => null);
  // A PROVIDER THAT DID NOT ANSWER IS NOT A WORLD WITH NO SOURCES (Codex, 2026-08-18): capped, waiting or failed leaves the claim OWED, and only a readable answer with no qualifying source banks `none_found`.
  if (found == null) return { status: "failed", banked: 0, cursor, reason: "the source search did not answer, so this claim is still owed" };
  const candidates = (found.organic ?? []).slice(0, CANDIDATES)
    .map((o) => ({ url: o.url, kind: sourceClassOf(o.domain), title: o.title ?? "" }))
    .filter((c) => c.kind !== "community" && c.kind !== "babyname")
    .sort((a, b) => (AUTHORITATIVE.has(b.kind) ? 1 : 0) - (AUTHORITATIVE.has(a.kind) ? 1 : 0));
  if (candidates.length === 0) {
    return bank({ ...base, proposed: null, sources: [], agreement: "none_found", confidence: "unsupported",
      verdict: "undecidable", note: "No source of any authority came back for this claim, so nothing is proposed." });
  }

  // 4. READ THE SOURCES. A title is not a fact: without a fetched passage nothing may be confirmed.
  const passages: { url: string; kind: SourceKind; text: string; readAt: string }[] = [];
  for (const c of candidates.slice(0, FETCH_PER_CLAIM)) {
    if (!d.fetchSource || !enough(d.deadlineAt, 20_000)) break;
    const got = await d.fetchSource(c.url).catch(() => null);
    if (got?.text?.trim()) passages.push({ url: c.url, kind: c.kind, text: got.text.slice(0, 6_000), readAt: new Date().toISOString() });
  }
  if (passages.length === 0) {
    return bank({ ...base, proposed: null,
      sources: candidates.map((c) => ({ url: c.url, kind: c.kind, says: c.title })),
      agreement: "none_found", confidence: "unsupported", verdict: "undecidable",
      note: "Sources were found but none could be read, so this claim is not judged and nothing is proposed." });
  }

  // 5. JUDGE against the passages only.
  if (!enough(d.deadlineAt, 20_000)) return { status: "failed", banked: 0, cursor, reason: "no lease left to judge this claim" };
  const judged = await d.read({ kind: "fact_claim_judgement", system: JUDGE_SYSTEM,
    user: [`Claim type: ${type}`, `Subject: ${claim.subject}`, `The page says: "${claim.current}"`,
      "Passages fetched from real sources:",
      ...passages.map((p) => `--- [${p.kind}] ${p.url}\n${p.text}`), "", "Return the JSON now."].join("\n"),
    grounded: passages.map((p) => p.text).join("\n"), projectedCostUsd: 0.02, maxTokens: 1500 }).catch(() => null);
  if (!judged) return { status: "failed", banked: 0, cursor, reason: "the claim could not be judged this pass" };
  const v = judged as unknown as Judged;
  const quote = (v.supportingQuote ?? "").trim();
  // A QUOTE MAY NOT BORROW ANOTHER SOURCE'S AUTHORITY: the WHOLE normalized quote must appear in one passage
  // and is credited to THAT source alone (Codex, 2026-08-18).
  const norm = (t: string): string => t.toLowerCase().replace(/\s+/g, " ").trim();
  const owner = quote.length > 0 ? passages.find((p) => norm(p.text).includes(norm(quote))) ?? null : null;
  // AGREEMENT IS COUNTED, never accepted from the model: how many fetched sources carry the supporting words.
  const carriers = quote.length > 0 ? passages.filter((p) => norm(p.text).includes(norm(quote))) : [];
  const agreement: FactCheck["agreement"] = carriers.length > 1 ? "multiple_agree"
    : carriers.length === 1 ? "single_source" : "none_found";
  const confirmable = owner != null && AUTHORITATIVE.has(owner.kind);
  const confidence: FactCheck["confidence"] = v.confidence === "confirmed" && confirmable ? "confirmed"
    : v.confidence === "unsupported" ? "unsupported" : v.confidence === "disputed" ? "disputed" : "likely";
  return bank({ ...base,
    proposed: confidence === "unsupported" ? null : (v.proposed?.trim() || null),
    literal: v.literal?.trim() || null, usage: v.usage?.trim() || null,
    // Only the source that actually carried the words is credited with them.
    sources: passages.map((p) => ({ url: p.url, kind: p.kind, says: carriers.includes(p) ? quote.slice(0, 600) : "" })),
    sourceReadAt: owner?.readAt ?? null,
    agreement, confidence, verdict: v.verdict,
    note: `${v.note ?? ""}${owner ? "" : " No fetched passage carries the quote it relied on, so this is held below confirmed."}`.trim() });
}
