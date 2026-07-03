/**
 * claim-graph (BEACON_500 R13 / N3, 2026-07-03, Quality Constitution law 1:
 * believe) - the claim-level provenance graph. Every factual claim Beacon
 * publishes or relies on is linked to its source, date, reliability, and the
 * pages it affects.
 *
 * PURE / deterministic / no I/O / no LLM. Same input always produces the same
 * output. The I/O boundary lives in claim-graph-loader.ts (bounded
 * page_snapshots read + teardown cache read + the "claim-graph" store).
 *
 * This GENERALIZES the N8 factual-entailment primitive
 * (src/domains/drafts/factual-entailment.ts): where N8 answers "is this ONE
 * draft's claim backed by something", the graph remembers every claim, who
 * said it, when, how much to trust it, and which pages repeat it - so N25
 * stale-fact detection (a fast-volatility claim whose lastConfirmedAt aged
 * out), N26 fact propagation (fix one conflicting claim on every
 * affectedPage), and N27 volatility classes can ride this substrate without
 * a rebuild.
 *
 * The claim model:
 *   - id: stable fnv-1a hash of normalized claim text + subject key.
 *   - subject: distinguishing topic tokens (>= CLAIM_TOKEN_FLOOR, stopwords
 *     and the value itself excluded) - the "what this claim is about".
 *   - value: the extractable fact (a number, a date, a defining name, or
 *     free text for registered claims with no extractable shape).
 *   - sources: where the claim was seen, each with a kind, a ref, an
 *     observation date, and a RULE-BASED reliability (operator input high,
 *     dated authoritative domains high, competitor pages medium, undated
 *     low, own stored pages medium - a page can be stale).
 *   - affectedPages: full URLs of owned pages whose stored text contains the
 *     claim (value + at least CLAIM_TOKEN_FLOOR subject tokens).
 *   - volatilityClass (the N27 seed): rule-based defaults by claim shape -
 *     years/dates fast, populations/counts slow, definitions static.
 *   - status: conflicting when two sources (or two records on the same
 *     subject) carry MATERIALLY different values - numbers differing more
 *     than 5 percent or dates differing, never punctuation or formatting;
 *     consistent when confirmed (2+ sources or one high-reliability source);
 *     unverified otherwise.
 *
 * Extraction is deliberately bounded and narrow: sentences containing a
 * number, a date, or an is-a definition, with at least two distinguishing
 * tokens, capped per page and per tenant (highest-traffic pages first), so a
 * flag or a source line is always defensible in one plain sentence.
 */

export type ClaimSourceKind = "page_extract" | "teardown" | "operator" | "correction_evidence";
export type ClaimReliability = "high" | "medium" | "low";
export type ClaimVolatility = "static" | "slow" | "fast";
/** stale_check_due (R13b / N27, additive to the R13 set): the claim's newest
 *  source observation is past its volatility class's freshness deadline. It
 *  says the fact is OLD, never that it is wrong (calibrated abstention). */
export type ClaimStatus = "consistent" | "conflicting" | "unverified" | "stale_check_due";
export type ClaimValueKind = "number" | "date" | "name" | "free";

export type ClaimSource = {
  kind: ClaimSourceKind;
  /** What to point at: an owned page URL (page_extract/operator), a
   *  competitor domain or URL (teardown), or a plain-English source name
   *  like "Search Console" (correction_evidence). */
  ref: string;
  /** ISO timestamp (or plain date string) the source was observed. Null =
   *  undated, which caps reliability at low. */
  observedAt: string | null;
  reliability: ClaimReliability;
};

export type ClaimValue = {
  kind: ClaimValueKind;
  /** The literal value as it appeared ("515 BC", "1,200", "a critically endangered subspecies"). */
  raw: string;
  /** Punctuation/case/thousands-separator-free form used for comparisons -
   *  "1,000" and "1000" are the SAME value, never a conflict. */
  normalized: string;
};

export type ClaimRecord = {
  tenant_id: string;
  /** Stable id: fnv-1a over normalized claim text + subject key. */
  id: string;
  /** The claim sentence, trimmed and capped. */
  claimText: string;
  /** Distinguishing topic tokens, lowercased, deduped, in appearance order. */
  subject: string[];
  /** Conflict-grouping key: sorted subject tokens + value kind. Two claims
   *  with the same subjectKey but materially different values conflict. */
  subjectKey: string;
  value: ClaimValue;
  sources: ClaimSource[];
  firstSeenAt: string;
  /** Latest observedAt across sources (falls back to firstSeenAt). */
  lastConfirmedAt: string;
  /** Full URLs of owned pages whose stored text contains this claim. */
  affectedPages: string[];
  volatilityClass: ClaimVolatility;
  status: ClaimStatus;
  /** N26 (R13b): set once when a correction's propagation plan for this
   *  record emitted, so the plan fires once, not nightly forever. Preserved
   *  across rebuilds like firstSeenAt. Optional: legacy rows predate it. */
  propagationPlannedAt?: string | null;
};

/** Cap the graph per tenant; highest-traffic pages register first. */
export const MAX_CLAIMS_PER_TENANT = 500;
/** One page never hogs the graph. */
export const MAX_CLAIMS_PER_PAGE = 25;
/** A claim needs at least this many distinguishing tokens to register. */
export const CLAIM_TOKEN_FLOOR = 2;
/** Numbers within this relative difference are the same fact, not a conflict. */
export const NUMBER_CONFLICT_THRESHOLD = 0.05;
const MAX_SENTENCES_PER_PAGE = 80;
const MAX_CLAIM_TEXT_CHARS = 200;
const MAX_SUBJECT_TOKENS = 6;
const MAX_AFFECTED_PAGES = 10;

// ---------------------------------------------------------------------------
// hashing (fnv-1a, same dependency-free convention as question-universe.ts)
// ---------------------------------------------------------------------------

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Stable claim id: hash of normalized claim text + subject key. */
export function claimId(claimText: string, subjectKey: string): string {
  return `cl-${fnv1a(`${normalizeForCompare(claimText)}::${subjectKey}`)}`;
}

/** Lowercase alphanumeric-and-spaces form - punctuation and formatting can
 *  never make two values "different". */
export function normalizeForCompare(text: string): string {
  return stripThousands(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const stripThousands = (s: string) => s.replace(/(?<=\d),(?=\d)/g, "");

// ---------------------------------------------------------------------------
// extraction
// ---------------------------------------------------------------------------

/** Generic English function/filler words that never distinguish a subject. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "in", "on", "at", "to", "for",
  "from", "by", "with", "as", "is", "are", "was", "were", "has", "have", "had",
  "will", "would", "can", "could", "should", "may", "might", "be", "been",
  "being", "this", "that", "these", "those", "it", "its", "their", "there",
  "they", "he", "she", "we", "you", "your", "our", "his", "her", "them",
  "which", "who", "when", "where", "why", "how", "what", "not", "also",
  "than", "then", "some", "any", "all", "each", "every", "one", "two",
  "about", "into", "over", "under", "around", "between", "during", "after",
  "before", "while", "more", "most", "less", "least", "very", "just", "only",
  "such", "other", "another", "same", "new", "old", "first", "last", "many",
  "much", "still", "even", "both", "per", "via", "like", "known", "called",
]);

/** "515 BC", "2026 CE", or a plain modern year 1000-2999. */
const DATE_YEAR_RE = /\b(\d{3,4})\s*(bc|bce|ad|ce)\b|\b([12]\d{3})\b/i;
const MONTH_DAY_RE =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?\b/i;
/** A standalone number with at least 2 digits (thousands separators allowed). */
const NUMBER_RE = /\b\d{1,3}(?:,\d{3})+\b|\b\d{2,}(?:\.\d+)?\b/;
/** An is-a definition: "<Subject> is a/an/the <complement>". */
const DEFINITION_RE =
  /\b((?:[A-Z][A-Za-z'’-]*)(?:\s+[A-Za-z'’-]+){0,4})\s+(?:is|are|was|were)\s+(?:a|an|the)\s+([a-z][^.!?]{2,100})/;

export type ExtractedClaim = {
  claimText: string;
  subject: string[];
  subjectKey: string;
  value: ClaimValue;
};

function depluralize(w: string): string {
  return w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

/** Distinguishing tokens of a sentence: length >= 3, not a stopword, not part
 *  of the value, lowercased, deduped, appearance order. */
function distinguishingTokens(sentence: string, valueRaw: string): string[] {
  const valueTokens = new Set(
    normalizeForCompare(valueRaw)
      .split(" ")
      .filter(Boolean),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of sentence.toLowerCase().match(/[a-z'’-]{3,}/g) ?? []) {
    const w = raw.replace(/[''’]/g, "");
    if (STOPWORDS.has(w) || valueTokens.has(w)) continue;
    const key = depluralize(w);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
    if (out.length >= MAX_SUBJECT_TOKENS) break;
  }
  return out;
}

function subjectKeyOf(subject: string[], valueKind: ClaimValueKind): string {
  return `${[...subject.map(depluralize)].sort().join("|")}::${valueKind}`;
}

/** Detect the ONE extractable fact in a sentence: date beats number beats
 *  definition (dates are the most volatile and the most fixable). Null when
 *  the sentence makes no checkable claim. */
function detectValue(sentence: string): ClaimValue | null {
  const dateMatch = sentence.match(DATE_YEAR_RE);
  if (dateMatch) {
    const raw = dateMatch[0].trim();
    return { kind: "date", raw, normalized: normalizeForCompare(raw) };
  }
  const monthDay = sentence.match(MONTH_DAY_RE);
  if (monthDay) {
    const raw = monthDay[0].trim();
    return { kind: "date", raw, normalized: normalizeForCompare(raw) };
  }
  const num = sentence.match(NUMBER_RE);
  if (num) {
    const raw = num[0].trim();
    return { kind: "number", raw, normalized: normalizeForCompare(raw) };
  }
  const def = sentence.match(DEFINITION_RE);
  if (def) {
    const raw = def[2]!.trim().slice(0, 80).trim();
    return { kind: "name", raw, normalized: normalizeForCompare(raw) };
  }
  return null;
}

function splitSentences(text: string): string[] {
  return (text ?? "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && s.length <= 320);
}

/**
 * Mine the checkable claims out of one blob of page text (body samples +
 * card texts + FAQ answers joined). Bounded, pure, narrow by design: only
 * sentences with a number, a date, or an is-a definition AND at least
 * CLAIM_TOKEN_FLOOR distinguishing tokens register. One claim per sentence.
 */
export function extractClaimsFromText(text: string, opts?: { maxClaims?: number }): ExtractedClaim[] {
  const max = opts?.maxClaims ?? MAX_CLAIMS_PER_PAGE;
  const out: ExtractedClaim[] = [];
  const seenIds = new Set<string>();
  for (const sentence of splitSentences(text).slice(0, MAX_SENTENCES_PER_PAGE)) {
    if (out.length >= max) break;
    const value = detectValue(sentence);
    if (!value) continue;
    const subject = distinguishingTokens(sentence, value.raw);
    if (subject.length < CLAIM_TOKEN_FLOOR) continue;
    const claimText = sentence.slice(0, MAX_CLAIM_TEXT_CHARS).trim();
    const key = subjectKeyOf(subject, value.kind);
    const id = claimId(claimText, key);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    out.push({ claimText, subject, subjectKey: key, value });
  }
  return out;
}

// ---------------------------------------------------------------------------
// reliability rules (rule-based, never a guess)
// ---------------------------------------------------------------------------

/** Domains whose dated facts count as authoritative (high reliability). */
const AUTHORITATIVE_HOSTS = new Set(["wikipedia.org", "britannica.com"]);

function hostOf(ref: string): string {
  try {
    const u = new URL(ref.startsWith("http") ? ref : `https://${ref}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return ref.replace(/^www\./, "").toLowerCase();
  }
}

function isAuthoritativeDomain(ref: string): boolean {
  const host = hostOf(ref);
  if (!host || host.includes(" ")) return false;
  if (host.endsWith(".gov") || host.endsWith(".edu")) return true;
  if (AUTHORITATIVE_HOSTS.has(host)) return true;
  return [...AUTHORITATIVE_HOSTS].some((a) => host.endsWith(`.${a}`));
}

/**
 * The reliability rules, in order: undated is low no matter who said it;
 * the operator's own input is high; a dated authoritative domain is high;
 * competitor pages (teardowns) are medium; the tenant's own stored pages are
 * medium (a page can be stale - that is the whole point of this graph).
 */
export function reliabilityForSource(kind: ClaimSourceKind, ref: string, observedAt: string | null): ClaimReliability {
  if (!observedAt) return "low";
  if (kind === "operator") return "high";
  if (kind === "correction_evidence") return "high";
  if (isAuthoritativeDomain(ref)) return "high";
  if (kind === "teardown") return "medium";
  return "medium"; // page_extract: dated but own-page, medium
}

export function makeSource(kind: ClaimSourceKind, ref: string, observedAt: string | null): ClaimSource {
  return { kind, ref, observedAt, reliability: reliabilityForSource(kind, ref, observedAt) };
}

// ---------------------------------------------------------------------------
// volatility (N27: rule-based classes by claim shape, each with a freshness
// deadline)
// ---------------------------------------------------------------------------

/**
 * N27 freshness deadlines, in days, per volatility class. A fast fact (years,
 * dates, anything whose value carries an already-old year) is due a fresh
 * check after 180 days; a slow fact (counts, figures) after 540 days; a
 * static fact (definitions) never ages out. A claim whose newest source
 * observation is older than its deadline flips to status "stale_check_due" -
 * that status says the fact is OLD, never that it is wrong.
 */
export const FAST_FRESHNESS_DEADLINE_DAYS = 180;
export const SLOW_FRESHNESS_DEADLINE_DAYS = 540;

/** Days before a claim of this class is due a fresh check; null = never. */
export function freshnessDeadlineDays(volatility: ClaimVolatility): number | null {
  if (volatility === "fast") return FAST_FRESHNESS_DEADLINE_DAYS;
  if (volatility === "slow") return SLOW_FRESHNESS_DEADLINE_DAYS;
  return null; // static: definitions stay put
}

/** How many whole years back a year inside a VALUE must sit before the claim
 *  is automatically fast-class (a "population of Tehran in 2023" style fact
 *  ages by definition). Strictly older than 2 years ago: with today in 2026,
 *  a 2023 value is aged, a 2024 value is not yet. */
const AGED_YEAR_LOOKBACK_YEARS = 2;

function valueCarriesAgedYear(value: ClaimValue, nowIso: string): boolean {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return false;
  const nowYear = new Date(nowMs).getUTCFullYear();
  for (const m of value.normalized.match(/\b[12]\d{3}\b/g) ?? []) {
    const year = Number.parseInt(m, 10);
    if (year < nowYear - AGED_YEAR_LOOKBACK_YEARS) return true;
  }
  return false;
}

/** Rule-based class by claim shape: years/dates fast, populations/counts
 *  slow, definitions static. N27 refinement: a value carrying a year older
 *  than 2 years ago is automatically fast (a "population of Tehran in 2023"
 *  style fact ages by definition). Number values are exempt from the year
 *  scan - a four-digit COUNT ("1,200 shops") is not a year, and extraction
 *  already classifies real year values as dates. */
export function volatilityFor(value: ClaimValue, nowIso?: string): ClaimVolatility {
  if (nowIso && value.kind !== "number" && valueCarriesAgedYear(value, nowIso)) return "fast";
  if (value.kind === "date") return "fast";
  if (value.kind === "number") return "slow";
  if (value.kind === "name") return "static";
  return "slow";
}

/** N27: is this claim past its class's freshness deadline? Compares the
 *  newest source observation (lastConfirmedAt) against the deadline. */
export function isStaleCheckDue(
  record: Pick<ClaimRecord, "volatilityClass" | "lastConfirmedAt">,
  nowIso: string,
): boolean {
  const deadlineDays = freshnessDeadlineDays(record.volatilityClass);
  if (deadlineDays == null) return false;
  const last = Date.parse(record.lastConfirmedAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(last) || !Number.isFinite(now)) return false;
  return now - last > deadlineDays * 86_400_000;
}

// ---------------------------------------------------------------------------
// conflicts (materially different: numbers differ > 5 percent or dates
// differ - NEVER punctuation or formatting)
// ---------------------------------------------------------------------------

function numericValueOf(v: ClaimValue): number | null {
  const m = v.normalized.match(/\d+(?:\s\d+)?(?:\.\d+)?/);
  if (!m) return null;
  const n = Number.parseFloat(m[0].replace(/\s+/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** True when two values of the same kind are MATERIALLY different. */
export function valuesMateriallyDiffer(a: ClaimValue, b: ClaimValue): boolean {
  if (a.kind !== b.kind) return false;
  if (a.normalized === b.normalized) return false;
  if (a.kind === "date") {
    // Any real difference in the normalized date text (515 bc vs 518 bc,
    // 1971 vs 1979, march 20 vs march 21) is a conflict. Formatting and
    // punctuation were already normalized away above.
    return true;
  }
  if (a.kind === "number") {
    const na = numericValueOf(a);
    const nb = numericValueOf(b);
    if (na == null || nb == null) return false;
    if (na === nb) return false;
    const rel = Math.abs(na - nb) / Math.max(Math.abs(na), Math.abs(nb));
    return rel > NUMBER_CONFLICT_THRESHOLD;
  }
  // Definitions and free-text values never conflict deterministically -
  // wording differences are not evidence of a factual disagreement.
  return false;
}

export type ClaimConflictSide = {
  claimId: string;
  /** The literal value as written ("515 BC"). */
  value: string;
  /** Full URL of the owned page carrying this value. */
  pageUrl: string;
  /** Display path ("/persepolis"). */
  pagePath: string;
};

export type ClaimConflict = {
  /** Plain label for what the pages disagree about ("the year Persepolis was built"). */
  subjectLabel: string;
  subjectKey: string;
  a: ClaimConflictSide;
  b: ClaimConflictSide;
};

export function pathOfUrl(url: string): string {
  const p = (url ?? "").replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  return p || "/";
}

/** Original-cased display tokens for a subject, recovered from the claim text. */
function displayTokens(claim: Pick<ClaimRecord, "claimText" | "subject">): string[] {
  const wanted = new Set(claim.subject.map(depluralize));
  const out: string[] = [];
  for (const w of claim.claimText.match(/[A-Za-z'’-]{3,}/g) ?? []) {
    if (wanted.has(depluralize(w.toLowerCase().replace(/[''’]/g, "")))) {
      out.push(w);
      wanted.delete(depluralize(w.toLowerCase().replace(/[''’]/g, "")));
    }
  }
  return out;
}

/**
 * Plain-English label for what a conflicting claim is about. For dates:
 * "the year <claim text minus the value>", producing e.g.
 * "the year Persepolis was built". For numbers: "the number for
 * "<subject tokens>"". Deterministic, no LLM.
 */
export function subjectLabelFor(claim: Pick<ClaimRecord, "claimText" | "subject" | "value">): string {
  if (claim.value.kind === "date") {
    const stripped = claim.claimText
      .replace(new RegExp(`\\s*(?:in|on|at|of|around|about|circa|by|since)?\\s*${escapeRegExp(claim.value.raw)}`, "i"), "")
      .replace(/\s+/g, " ")
      .replace(/[\s.,;:!?]+$/g, "")
      .trim();
    if (stripped.length >= 8 && stripped.length <= 90) return `the year ${stripped}`;
  }
  const tokens = displayTokens(claim).slice(0, 4).join(" ");
  const noun = claim.value.kind === "date" ? "the date" : "the number";
  return `${noun} for "${tokens}"`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The owned page a claim lives on: its first affected page. Null when the
 *  claim has no owned-page home (e.g. teardown-only records). */
function homePageOf(record: ClaimRecord): string | null {
  return record.affectedPages[0] ?? record.sources.find((s) => s.kind === "page_extract")?.ref ?? null;
}

/**
 * Find OWNED-PAGE conflicts: two records with the same subjectKey, materially
 * different values (numbers > 5 percent apart, dates differing - never
 * punctuation), living on two DIFFERENT owned pages. One conflict per
 * subjectKey (the first materially-different pair, graph order = traffic
 * order), deterministic.
 */
export function findClaimConflicts(records: readonly ClaimRecord[]): ClaimConflict[] {
  const bySubject = new Map<string, ClaimRecord[]>();
  for (const r of records) {
    if (r.value.kind !== "number" && r.value.kind !== "date") continue;
    const list = bySubject.get(r.subjectKey);
    if (list) list.push(r);
    else bySubject.set(r.subjectKey, [r]);
  }
  const out: ClaimConflict[] = [];
  for (const [subjectKey, group] of bySubject) {
    if (group.length < 2) continue;
    let found: ClaimConflict | null = null;
    outer: for (let i = 0; i < group.length && !found; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        if (!valuesMateriallyDiffer(a.value, b.value)) continue;
        const pageA = homePageOf(a);
        const pageB = homePageOf(b);
        if (!pageA || !pageB || pathOfUrl(pageA) === pathOfUrl(pageB)) continue;
        found = {
          subjectLabel: subjectLabelFor(a),
          subjectKey,
          a: { claimId: a.id, value: a.value.raw, pageUrl: pageA, pagePath: pathOfUrl(pageA) },
          b: { claimId: b.id, value: b.value.raw, pageUrl: pageB, pagePath: pathOfUrl(pageB) },
        };
        break outer;
      }
    }
    if (found) out.push(found);
  }
  return out;
}

/**
 * N26: the exact sentence of a page's stored text that carries a claim -
 * the SAME rule affectedPages uses (the sentence must contain the value plus
 * at least CLAIM_TOKEN_FLOOR subject tokens), applied sentence-by-sentence so
 * a propagation fix can quote the one line to change. Null when no sentence
 * qualifies (the page may have changed since the graph was built).
 */
export function findClaimSentence(
  text: string,
  claim: Pick<ClaimRecord, "value" | "subject">,
): string | null {
  for (const sentence of splitSentences(text)) {
    const hay = normalizeForCompare(sentence);
    if (!hay.includes(claim.value.normalized)) continue;
    let hits = 0;
    for (const token of claim.subject) {
      if (hay.includes(depluralize(token))) hits++;
      if (hits >= CLAIM_TOKEN_FLOOR) return sentence;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// graph build (merge extraction + teardown attach + prior records; cap;
// affected pages; statuses)
// ---------------------------------------------------------------------------

export type PageTextInput = {
  /** Full page URL (page_snapshots key). */
  url: string;
  /** 90d impressions (or any traffic proxy) - highest first fills the cap. */
  traffic: number;
  /** Stored body samples + card texts + FAQ answers, joined. */
  text: string;
  /** ISO timestamp of the snapshot backing `text` (null = undated). */
  observedAt: string | null;
};

export type TeardownTextInput = {
  domain: string;
  url: string;
  observedAt: string | null;
  /** Title/H1/outline/FAQ questions - the text the teardown stored. */
  texts: string[];
};

export type BuildClaimGraphArgs = {
  tenantId: string;
  pages: readonly PageTextInput[];
  teardowns?: readonly TeardownTextInput[];
  /** Previous store rows for this tenant - keeps firstSeenAt stable and
   *  preserves operator/correction sources across rebuilds. */
  priorRecords?: readonly ClaimRecord[];
  nowIso: string;
  maxClaims?: number;
};

function mergeSources(into: ClaimSource[], add: ClaimSource): void {
  const existing = into.find((s) => s.kind === add.kind && s.ref === add.ref);
  if (!existing) {
    into.push(add);
    return;
  }
  // Same source seen again: keep the newest observation date.
  if (add.observedAt && (!existing.observedAt || add.observedAt > existing.observedAt)) {
    existing.observedAt = add.observedAt;
    existing.reliability = reliabilityForSource(existing.kind, existing.ref, existing.observedAt);
  }
}

function lastConfirmedOf(sources: readonly ClaimSource[], fallback: string): string {
  let latest: string | null = null;
  for (const s of sources) {
    if (s.observedAt && (!latest || s.observedAt > latest)) latest = s.observedAt;
  }
  return latest ?? fallback;
}

/**
 * Build (or incrementally rebuild) one tenant's claim graph. Pure: the
 * loader owns every read. Highest-traffic pages register first; the graph is
 * capped at `maxClaims` (500 default). Prior records keep their firstSeenAt
 * and their operator/correction sources; prior records not re-extracted this
 * run survive only if they carry an operator or correction source (a shipped
 * draft's registered facts are never silently dropped by a page falling out
 * of the traffic window).
 */
export function buildClaimGraph(args: BuildClaimGraphArgs): ClaimRecord[] {
  const max = args.maxClaims ?? MAX_CLAIMS_PER_TENANT;
  const priorById = new Map((args.priorRecords ?? []).map((r) => [r.id, r]));
  const records: ClaimRecord[] = [];
  const byId = new Map<string, ClaimRecord>();
  const bySubjectAndValue = new Map<string, ClaimRecord>();

  const pages = [...args.pages].sort((a, b) => b.traffic - a.traffic || a.url.localeCompare(b.url));

  const upsert = (extracted: ExtractedClaim, source: ClaimSource): ClaimRecord => {
    const id = claimId(extracted.claimText, extracted.subjectKey);
    let record = byId.get(id);
    if (!record) {
      const prior = priorById.get(id);
      record = {
        tenant_id: args.tenantId,
        id,
        claimText: extracted.claimText,
        subject: extracted.subject,
        subjectKey: extracted.subjectKey,
        value: extracted.value,
        sources: [],
        firstSeenAt: prior?.firstSeenAt ?? args.nowIso,
        lastConfirmedAt: args.nowIso,
        affectedPages: [],
        volatilityClass: volatilityFor(extracted.value, args.nowIso),
        status: "unverified",
        // N26: a plan already emitted for this claim stays emitted (once-only
        // survives the nightly rebuild, exactly like firstSeenAt).
        propagationPlannedAt: prior?.propagationPlannedAt ?? null,
      };
      // Preserve operator/correction sources registered by shipped drafts.
      for (const s of prior?.sources ?? []) {
        if (s.kind === "operator" || s.kind === "correction_evidence") mergeSources(record.sources, s);
      }
      byId.set(id, record);
      records.push(record);
      bySubjectAndValue.set(`${extracted.subjectKey}::${extracted.value.normalized}`, record);
    }
    mergeSources(record.sources, source);
    return record;
  };

  // 1. Own pages, highest traffic first, capped per page and per tenant.
  for (const page of pages) {
    if (records.length >= max) break;
    const room = Math.min(MAX_CLAIMS_PER_PAGE, max - records.length);
    for (const extracted of extractClaimsFromText(page.text, { maxClaims: room })) {
      upsert(extracted, makeSource("page_extract", page.url, page.observedAt));
    }
  }

  // 2. Teardown texts ATTACH to existing subjects only (they confirm or
  //    dispute what the tenant's own pages claim; they never fill the cap
  //    with facts about pages we do not own). A matching value adds a
  //    confirming dated source; a materially different value registers as
  //    its own record so the disagreement is visible.
  for (const teardown of args.teardowns ?? []) {
    const text = teardown.texts.filter(Boolean).join(". ");
    if (!text) continue;
    for (const extracted of extractClaimsFromText(text)) {
      const same = bySubjectAndValue.get(`${extracted.subjectKey}::${extracted.value.normalized}`);
      if (same) {
        mergeSources(same.sources, makeSource("teardown", teardown.domain, teardown.observedAt));
        continue;
      }
      const sibling = records.find(
        (r) => r.subjectKey === extracted.subjectKey && valuesMateriallyDiffer(r.value, extracted.value),
      );
      if (sibling && records.length < max) {
        upsert(extracted, makeSource("teardown", teardown.domain, teardown.observedAt));
      }
    }
  }

  // 3. Prior records not re-extracted this run: operator/correction-backed
  //    claims survive (a shipped fact is never dropped by traffic rotation).
  for (const prior of priorById.values()) {
    if (byId.has(prior.id) || records.length >= max) continue;
    if (!prior.sources.some((s) => s.kind === "operator" || s.kind === "correction_evidence")) continue;
    const kept: ClaimRecord = { ...prior, tenant_id: args.tenantId, sources: prior.sources.map((s) => ({ ...s })) };
    byId.set(kept.id, kept);
    records.push(kept);
    bySubjectAndValue.set(`${kept.subjectKey}::${kept.value.normalized}`, kept);
  }

  const capped = records.slice(0, max);

  // 4. Affected pages: owned pages whose stored text contains the claim
  //    (value + at least CLAIM_TOKEN_FLOOR subject tokens).
  const pageHaystacks = pages.map((p) => ({ url: p.url, hay: normalizeForCompare(p.text) }));
  for (const record of capped) {
    const affected: string[] = [];
    for (const { url, hay } of pageHaystacks) {
      if (affected.length >= MAX_AFFECTED_PAGES) break;
      if (!hay.includes(record.value.normalized)) continue;
      let hits = 0;
      for (const token of record.subject) {
        if (hay.includes(depluralize(token))) hits++;
        if (hits >= CLAIM_TOKEN_FLOOR) break;
      }
      if (hits >= CLAIM_TOKEN_FLOOR) affected.push(url);
    }
    record.affectedPages = affected;
    record.lastConfirmedAt = lastConfirmedOf(record.sources, record.firstSeenAt);
  }

  // 5. Statuses: conflicting when ANY record (or source) on the same subject
  //    carries a materially different value; consistent when confirmed (2+
  //    sources or one high-reliability source); unverified otherwise.
  //    N27: a non-conflicting claim whose newest source observation is past
  //    its volatility class's freshness deadline becomes stale_check_due
  //    (a conflict is the more urgent flag, so it always outranks age).
  const bySubject = new Map<string, ClaimRecord[]>();
  for (const r of capped) {
    const list = bySubject.get(r.subjectKey);
    if (list) list.push(r);
    else bySubject.set(r.subjectKey, [r]);
  }
  for (const group of bySubject.values()) {
    for (const r of group) {
      const disputed = group.some((other) => other !== r && valuesMateriallyDiffer(r.value, other.value));
      if (disputed) r.status = "conflicting";
      else if (isStaleCheckDue(r, args.nowIso)) r.status = "stale_check_due";
      else if (r.sources.length >= 2 || r.sources.some((s) => s.reliability === "high")) r.status = "consistent";
      else r.status = "unverified";
    }
  }

  return capped;
}

// ---------------------------------------------------------------------------
// shipped-draft registration (pure part; the loader owns the store write)
// ---------------------------------------------------------------------------

export type DraftCorrectionEvidence = {
  /** Plain-English source name (from the N8 entailment finding). */
  source: string;
  /** The finding's date string. */
  date: string;
  /** The full finding message - used to match which claim it backs. */
  message: string;
};

/**
 * Turn one SHIPPED draft's checked facts into claim records: every
 * extractable claim in the draft registers with an operator source (the
 * operator approved and shipped this text - high reliability), and any N8
 * correction finding whose message names the claim's value attaches as a
 * dated correction_evidence source. Pure; merge/persist lives in the loader.
 */
export function registrationRecordsForDraft(args: {
  tenantId: string;
  targetUrl: string;
  draftText: string;
  corrections?: readonly DraftCorrectionEvidence[];
  nowIso: string;
}): ClaimRecord[] {
  const out: ClaimRecord[] = [];
  for (const extracted of extractClaimsFromText(args.draftText, { maxClaims: MAX_CLAIMS_PER_PAGE })) {
    const sources: ClaimSource[] = [makeSource("operator", args.targetUrl, args.nowIso)];
    for (const c of args.corrections ?? []) {
      // N8 correction messages quote the value (often just its digits, e.g.
      // "515" for a "515 BC" claim) - match on either form.
      const rawLower = extracted.value.raw.toLowerCase();
      const digits = rawLower.match(/\d{2,}/)?.[0] ?? null;
      if (c.message.toLowerCase().includes(rawLower) || (digits != null && c.message.includes(digits))) {
        mergeSources(sources, makeSource("correction_evidence", c.source, c.date));
      }
    }
    out.push({
      tenant_id: args.tenantId,
      id: claimId(extracted.claimText, extracted.subjectKey),
      claimText: extracted.claimText,
      subject: extracted.subject,
      subjectKey: extracted.subjectKey,
      value: extracted.value,
      sources,
      firstSeenAt: args.nowIso,
      lastConfirmedAt: args.nowIso,
      affectedPages: [args.targetUrl],
      volatilityClass: volatilityFor(extracted.value, args.nowIso),
      status: "consistent",
    });
  }
  return out;
}

/** Merge freshly registered records into existing tenant rows (by id: union
 *  sources, keep the earliest firstSeenAt). Pure. */
export function mergeRegisteredRecords(existing: readonly ClaimRecord[], registered: readonly ClaimRecord[]): ClaimRecord[] {
  const byId = new Map(existing.map((r) => [r.id, { ...r, sources: r.sources.map((s) => ({ ...s })) }]));
  for (const reg of registered) {
    const prior = byId.get(reg.id);
    if (!prior) {
      byId.set(reg.id, reg);
      continue;
    }
    for (const s of reg.sources) mergeSources(prior.sources, s);
    prior.lastConfirmedAt = lastConfirmedOf(prior.sources, prior.firstSeenAt);
    if (prior.status === "unverified") prior.status = "consistent";
    // N27: a just-shipped operator source IS a fresh confirmation - the
    // stale check is answered until the deadline runs down again.
    if (prior.status === "stale_check_due") prior.status = "consistent";
    if (!prior.affectedPages.includes(reg.affectedPages[0]!) && prior.affectedPages.length < MAX_AFFECTED_PAGES) {
      prior.affectedPages = [...prior.affectedPages, reg.affectedPages[0]!];
    }
  }
  return [...byId.values()].slice(0, MAX_CLAIMS_PER_TENANT);
}

// ---------------------------------------------------------------------------
// surface lines ("From your /iran-flags page, confirmed Mar 2026.")
// ---------------------------------------------------------------------------

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthYear(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "today" / "3 days ago" / "3 weeks ago" / "8 months ago". Exported for the
 *  N25 stale-fact sentence ("I last confirmed 8 months ago"). */
export function relativeAge(iso: string | null, nowIso: string): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return null;
  const days = Math.max(0, Math.floor((now - then) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

/**
 * One plain source line for a claim's best source. Examples (pinned):
 *   page_extract         "From your /iran-flags page, confirmed Mar 2026."
 *   teardown             "From britannica.com, seen 3 weeks ago."
 *   operator             "From a change you approved, Jun 2026."
 *   correction_evidence  "From Search Console, dated Jun 2026."
 */
export function formatClaimSourceLine(source: ClaimSource, nowIso: string): string {
  if (source.kind === "page_extract") {
    const when = monthYear(source.observedAt);
    return when
      ? `From your ${pathOfUrl(source.ref)} page, confirmed ${when}.`
      : `From your ${pathOfUrl(source.ref)} page.`;
  }
  if (source.kind === "teardown") {
    const age = relativeAge(source.observedAt, nowIso);
    return age ? `From ${hostOf(source.ref)}, seen ${age}.` : `From ${hostOf(source.ref)}.`;
  }
  if (source.kind === "operator") {
    const when = monthYear(source.observedAt);
    return when ? `From a change you approved, ${when}.` : "From a change you approved.";
  }
  const when = monthYear(source.observedAt);
  return when ? `From ${source.ref}, dated ${when}.` : `From ${source.ref}.`;
}

const RELIABILITY_RANK: Record<ClaimReliability, number> = { high: 0, medium: 1, low: 2 };

/** A claim's best source: highest reliability, newest observation. */
export function bestSourceOf(record: ClaimRecord): ClaimSource | null {
  if (record.sources.length === 0) return null;
  return [...record.sources].sort(
    (a, b) =>
      RELIABILITY_RANK[a.reliability] - RELIABILITY_RANK[b.reliability] ||
      (b.observedAt ?? "").localeCompare(a.observedAt ?? ""),
  )[0]!;
}

export type ClaimEvidenceLine = {
  /** Short fact label (the claim text, capped). */
  fact: string;
  /** The source line ("From your /iran-flags page, confirmed Mar 2026."). */
  sourceLine: string;
};

const MAX_EVIDENCE_LINES = 3;
const MAX_FACT_CHARS = 90;

/**
 * The per-claim source lines for one draft's evidence section: claims whose
 * value actually appears in the draft text (the draft's own facts, matched
 * first) or that live on the target page. One line per claim, capped at 3,
 * conflicting claims excluded (a disputed fact must never be presented as a
 * confirmed source - it surfaces through the conflict trigger instead).
 * Empty in = empty out, byte-identical.
 */
export function claimEvidenceForDraft(
  records: readonly ClaimRecord[],
  args: { pageUrl: string; draftText?: string | null; nowIso: string },
): ClaimEvidenceLine[] {
  if (records.length === 0) return [];
  const pagePath = pathOfUrl(args.pageUrl);
  const draftHay = normalizeForCompare(args.draftText ?? "");

  const inDraft = (r: ClaimRecord): boolean => {
    if (!draftHay || !draftHay.includes(r.value.normalized)) return false;
    let hits = 0;
    for (const token of r.subject) {
      if (draftHay.includes(depluralize(token))) hits++;
      if (hits >= CLAIM_TOKEN_FLOOR) return true;
    }
    return false;
  };
  const onPage = (r: ClaimRecord): boolean => r.affectedPages.some((u) => pathOfUrl(u) === pagePath);

  const matched = records
    .filter((r) => r.status !== "conflicting")
    .map((r) => ({ r, draftMatch: inDraft(r), pageMatch: onPage(r) }))
    .filter((m) => m.draftMatch || m.pageMatch)
    .sort((a, b) => Number(b.draftMatch) - Number(a.draftMatch));

  const out: ClaimEvidenceLine[] = [];
  for (const { r } of matched) {
    if (out.length >= MAX_EVIDENCE_LINES) break;
    const best = bestSourceOf(r);
    if (!best) continue;
    out.push({
      fact: r.claimText.length > MAX_FACT_CHARS ? `${r.claimText.slice(0, MAX_FACT_CHARS - 3).trimEnd()}...` : r.claimText,
      sourceLine: formatClaimSourceLine(best, args.nowIso),
    });
  }
  return out;
}
