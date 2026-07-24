/**
 * native-intel (2026-07-02, master plan item D1) - the analysis layer over the
 * native 4-engine poll (run-engine-poll.ts). The poller writes real answers +
 * citations into prompt_answer_observations; this module turns that raw stream
 * into the same shape Profound used to sell: who AI keeps citing, which pages
 * keep winning, whether we are mentioned/cited per prompt per engine, and the
 * follow-up questions AI itself raises inside its own answers.
 *
 * PURE (no I/O, no server-only) so every computation here is directly
 * unit-testable. The loader (native-intel-loader.ts) does the one paged
 * Supabase read and calls into this file.
 *
 * Four outputs, all deterministic, all built ONLY from the tenant's own
 * observation rows (never fabricated):
 *   1. rankRecurringDomains  - third-party domains that keep appearing across
 *      distinct prompts (the people on the lists). Ranked by how many
 *      DISTINCT prompts cite them, then by total citation count.
 *   2. rankRecurringPages    - the exact URLs cited repeatedly, same ranking
 *      shape at the page level.
 *   3. buildPresenceMatrix   - per (prompt, engine): are we mentioned, are we
 *      cited, and the exact answer sentence when we are (never a raw excerpt
 *      dump - the sentence that actually names us).
 *   4. extractNativeQuestions - follow-up/related questions embedded in the
 *      answer text itself (question-mark sentences + "people also ask"-style
 *      list structures), the native twin of a Profound query fanout.
 */

// ---------------------------------------------------------------------------
// Shared input shape - one row per (prompt, engine, observed_at). The loader
// maps prompt_answer_observations rows into this before calling in here.
// ---------------------------------------------------------------------------

export type NativeObservationInput = {
  promptId: string;
  promptText: string;
  /** Engine id, e.g. "chatgpt" | "perplexity" | "gemini" | "claude". */
  engine: string;
  topic: string | null;
  observedAt: string;
  answerText: string;
  citationDomains: string[];
  /** Parallel to citationDomains where available; may be shorter or empty. */
  citationUrls: string[];
  trackedBrandMentioned: boolean | null;
  trackedBrandCited: boolean | null;
};

// ---------------------------------------------------------------------------
// (a) Recurring domains - "the people on the lists"
// ---------------------------------------------------------------------------

export type RecurringDomain = {
  domain: string;
  /** Distinct prompts this domain was cited under - the real recurrence signal
   *  (a domain cited 5x on one prompt is less "everywhere" than one cited once
   *  each on 5 prompts). */
  distinctPrompts: number;
  /** Total citation occurrences across all rows. */
  citationCount: number;
  /** Distinct engines that cited this domain at least once. */
  engines: string[];
  /** Up to 3 example prompts this domain won, most-recent first. */
  examplePrompts: string[];
};

const MAX_EXAMPLE_PROMPTS = 3;

function normDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^www\./, "");
}

/** Own-domain + subdomain match, same rule run-engine-poll.ts uses for
 *  isOwnedHost - so the recurring-domain list never lists the tenant's own
 *  site as a "competitor" citation. */
function isOwnDomain(domain: string, ownedRoot: string): boolean {
  if (!ownedRoot) return false;
  return domain === ownedRoot || domain.endsWith(`.${ownedRoot}`);
}

/** Search-engine grounding/redirect-wrapper hosts. These are infrastructure
 *  the engine's own citation pipeline routes through (e.g. Gemini's grounding
 *  proxy) - they are not a real third-party source AI "keeps recommending",
 *  so they would otherwise flood the recurring-domain list with a fake #1
 *  every single engine cites on every single prompt. Narrow list, exact
 *  observed hosts only - never a broad heuristic that could hide a real
 *  competitor domain. */
const REDIRECT_WRAPPER_DOMAINS = new Set<string>([
  "vertexaisearch.cloud.google.com",
  "www.google.com",
  "google.com",
  "www.bing.com",
  "bing.com",
]);

function isRedirectWrapperDomain(domain: string): boolean {
  return REDIRECT_WRAPPER_DOMAINS.has(domain);
}

/**
 * Rank third-party domains by how many DISTINCT prompts cite them (the "on
 * the lists over and over" signal), tie-broken by total citation count. The
 * tenant's own domain is excluded - this ranks OTHER domains AI keeps
 * recommending. Pure, deterministic.
 */
export function rankRecurringDomains(
  rows: readonly NativeObservationInput[],
  opts: { ownedRoot?: string; limit?: number } = {},
): RecurringDomain[] {
  const ownedRoot = normDomain(opts.ownedRoot ?? "");
  const byDomain = new Map<
    string,
    { prompts: Map<string, string>; count: number; engines: Set<string>; lastSeen: Map<string, string> }
  >();

  for (const row of rows) {
    for (const rawDomain of row.citationDomains) {
      const domain = normDomain(rawDomain);
      if (!domain || !domain.includes(".")) continue;
      if (isOwnDomain(domain, ownedRoot) || isRedirectWrapperDomain(domain)) continue;
      let agg = byDomain.get(domain);
      if (!agg) {
        agg = { prompts: new Map(), count: 0, engines: new Set(), lastSeen: new Map() };
        byDomain.set(domain, agg);
      }
      agg.count += 1;
      agg.engines.add(row.engine);
      agg.prompts.set(row.promptId, row.promptText);
      const prevSeen = agg.lastSeen.get(row.promptId);
      if (!prevSeen || row.observedAt > prevSeen) agg.lastSeen.set(row.promptId, row.observedAt);
    }
  }

  const results: RecurringDomain[] = [];
  for (const [domain, agg] of byDomain) {
    const examplePrompts = [...agg.prompts.entries()]
      .sort((a, b) => (agg.lastSeen.get(b[0]) ?? "").localeCompare(agg.lastSeen.get(a[0]) ?? ""))
      .slice(0, MAX_EXAMPLE_PROMPTS)
      .map(([, text]) => text);
    results.push({
      domain,
      distinctPrompts: agg.prompts.size,
      citationCount: agg.count,
      engines: [...agg.engines].sort(),
      examplePrompts,
    });
  }

  results.sort(
    (a, b) =>
      b.distinctPrompts - a.distinctPrompts ||
      b.citationCount - a.citationCount ||
      a.domain.localeCompare(b.domain),
  );
  return opts.limit != null ? results.slice(0, opts.limit) : results;
}

// ---------------------------------------------------------------------------
// (b) Recurring pages - exact URLs cited repeatedly
// ---------------------------------------------------------------------------

export type RecurringPage = {
  url: string;
  domain: string;
  distinctPrompts: number;
  citationCount: number;
  engines: string[];
  examplePrompts: string[];
};

/** Same ranking shape as rankRecurringDomains, one level more specific (the
 *  exact page, not just the domain). Own-site URLs excluded. */
export function rankRecurringPages(
  rows: readonly NativeObservationInput[],
  opts: { ownedRoot?: string; limit?: number } = {},
): RecurringPage[] {
  const ownedRoot = normDomain(opts.ownedRoot ?? "");
  const byUrl = new Map<
    string,
    { domain: string; prompts: Map<string, string>; count: number; engines: Set<string>; lastSeen: Map<string, string> }
  >();

  for (const row of rows) {
    const urls = row.citationUrls.length > 0 ? row.citationUrls : [];
    for (const rawUrl of urls) {
      if (!rawUrl) continue;
      let host = "";
      try {
        host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
      } catch {
        continue;
      }
      if (!host.includes(".") || isOwnDomain(host, ownedRoot) || isRedirectWrapperDomain(host)) continue;
      let agg = byUrl.get(rawUrl);
      if (!agg) {
        agg = { domain: host, prompts: new Map(), count: 0, engines: new Set(), lastSeen: new Map() };
        byUrl.set(rawUrl, agg);
      }
      agg.count += 1;
      agg.engines.add(row.engine);
      agg.prompts.set(row.promptId, row.promptText);
      const prevSeen = agg.lastSeen.get(row.promptId);
      if (!prevSeen || row.observedAt > prevSeen) agg.lastSeen.set(row.promptId, row.observedAt);
    }
  }

  const results: RecurringPage[] = [];
  for (const [url, agg] of byUrl) {
    const examplePrompts = [...agg.prompts.entries()]
      .sort((a, b) => (agg.lastSeen.get(b[0]) ?? "").localeCompare(agg.lastSeen.get(a[0]) ?? ""))
      .slice(0, MAX_EXAMPLE_PROMPTS)
      .map(([, text]) => text);
    results.push({
      url,
      domain: agg.domain,
      distinctPrompts: agg.prompts.size,
      citationCount: agg.count,
      engines: [...agg.engines].sort(),
      examplePrompts,
    });
  }

  results.sort(
    (a, b) =>
      b.distinctPrompts - a.distinctPrompts ||
      b.citationCount - a.citationCount ||
      a.url.localeCompare(b.url),
  );
  return opts.limit != null ? results.slice(0, opts.limit) : results;
}

// ---------------------------------------------------------------------------
// (c) WE ARE / WE ARE NOT matrix
// ---------------------------------------------------------------------------

export type PresenceCell = {
  engine: string;
  mentioned: boolean;
  cited: boolean;
  /** The exact sentence naming the brand, when mentioned. Null when not
   *  mentioned, or when no sentence boundary could be found around a mention
   *  (never fabricated - falls back to null, not a guess). */
  answerSentence: string | null;
  observedAt: string;
};

export type PromptPresenceRow = {
  promptId: string;
  promptText: string;
  topic: string | null;
  /** One cell per engine that has at least one observation for this prompt. */
  byEngine: PresenceCell[];
  /** True when at least one checked engine mentions or cites us. */
  presentAnywhere: boolean;
  /** True when at least one checked engine was polled and NONE mention us. */
  absentEverywhere: boolean;
};

export type PresenceMatrix = {
  rows: PromptPresenceRow[];
  totals: {
    promptsChecked: number;
    /** Prompts where we're mentioned or cited on at least one engine. */
    present: number;
    /** Prompts where every checked engine came back silent on us. */
    absent: number;
  };
};

/** Split answer text into sentences on ./!/? boundaries, keeping the
 *  punctuation. Deliberately simple - good enough to isolate "the sentence
 *  that names the brand" without a full NLP pass. */
function splitSentences(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g);
  return (matches ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Find the sentence(s) containing any brand variant (case-insensitive). When
 *  the mention is found but not inside a clean sentence boundary (e.g. a
 *  lone brand-name answer with no punctuation), falls back to the whole
 *  trimmed answer text capped to keep it a "sentence-shaped" quote. */
export function findAnswerSentence(answerText: string, brandVariants: readonly string[]): string | null {
  if (!answerText || brandVariants.length === 0) return null;
  const sentences = splitSentences(answerText);
  const lowerVariants = brandVariants.filter(Boolean).map((v) => v.toLowerCase());
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (lowerVariants.some((v) => lower.includes(v))) return sentence;
  }
  // No sentence boundary matched (short/unpunctuated answer) - fall back to a
  // capped whole-text quote only when the brand really is present somewhere.
  const lowerAll = answerText.toLowerCase();
  if (lowerVariants.some((v) => lowerAll.includes(v))) {
    return answerText.length > 240 ? `${answerText.slice(0, 237).trimEnd()}...` : answerText;
  }
  return null;
}

/**
 * Build the per-prompt-per-engine presence matrix. Groups rows by prompt,
 * keeps the LATEST observation per (prompt, engine) pair (a re-poll should
 * reflect what AI says NOW, not a stale answer), computes mentioned/cited +
 * the naming sentence. Pure, deterministic.
 */
export function buildPresenceMatrix(
  rows: readonly NativeObservationInput[],
  opts: { brandVariants?: readonly string[] } = {},
): PresenceMatrix {
  const brandVariants = (opts.brandVariants ?? []).filter((v) => v && v.length >= 2);

  // Latest observation per (prompt, engine).
  const latestByCell = new Map<string, NativeObservationInput>();
  for (const row of rows) {
    const key = `${row.promptId}::${row.engine}`;
    const existing = latestByCell.get(key);
    if (!existing || row.observedAt > existing.observedAt) latestByCell.set(key, row);
  }

  const byPrompt = new Map<string, { promptText: string; topic: string | null; cells: PresenceCell[] }>();
  for (const row of latestByCell.values()) {
    let entry = byPrompt.get(row.promptId);
    if (!entry) {
      entry = { promptText: row.promptText, topic: row.topic, cells: [] };
      byPrompt.set(row.promptId, entry);
    }
    const mentioned = row.trackedBrandMentioned === true;
    const cited = row.trackedBrandCited === true;
    entry.cells.push({
      engine: row.engine,
      mentioned,
      cited,
      answerSentence: mentioned || cited ? findAnswerSentence(row.answerText, brandVariants) : null,
      observedAt: row.observedAt,
    });
  }

  const promptRows: PromptPresenceRow[] = [];
  for (const [promptId, entry] of byPrompt) {
    const byEngine = entry.cells.sort((a, b) => a.engine.localeCompare(b.engine));
    const presentAnywhere = byEngine.some((c) => c.mentioned || c.cited);
    const absentEverywhere = byEngine.length > 0 && !presentAnywhere;
    promptRows.push({
      promptId,
      promptText: entry.promptText,
      topic: entry.topic,
      byEngine,
      presentAnywhere,
      absentEverywhere,
    });
  }

  // Absent-everywhere prompts first (the fixable gap), then by engine breadth.
  promptRows.sort(
    (a, b) =>
      Number(b.absentEverywhere) - Number(a.absentEverywhere) ||
      b.byEngine.length - a.byEngine.length ||
      a.promptText.localeCompare(b.promptText),
  );

  return {
    rows: promptRows,
    totals: {
      promptsChecked: promptRows.length,
      present: promptRows.filter((r) => r.presentAnywhere).length,
      absent: promptRows.filter((r) => r.absentEverywhere).length,
    },
  };
}

// ---------------------------------------------------------------------------
// (d) Native question expansion - follow-up questions embedded in answers
// ---------------------------------------------------------------------------

export type NativeQuestion = {
  /** Normalized question text, as it appeared in the answer (trimmed,
   *  trailing punctuation kept). */
  text: string;
  /** How many distinct source (prompt, engine) pairs produced this exact
   *  question - the native recurrence signal, same idea as fanout weight. */
  weight: number;
  /** Distinct source prompts this question surfaced under. */
  sourcePrompts: string[];
};

const MIN_QUESTION_LEN = 12;
const MAX_QUESTION_LEN = 160;

/** List-marker prefix ("1.", "-", "*", "•") that "people also ask"-style
 *  structures in answer text commonly use ahead of a follow-up question. */
const LIST_MARKER_RE = /^\s*(?:\d+[.)]|[-*•▪])\s+/;

/**
 * Extract candidate follow-up questions from one answer's text: any sentence
 * ending in "?" (question-mark sentences), including list-formatted ones
 * ("- What is the capital of Iran?"). Deterministic - no LLM. Filters out
 * too-short/too-long fragments and pure list-marker noise. Pure.
 */
export function extractQuestionsFromAnswer(answerText: string): string[] {
  if (!answerText) return [];
  const sentences = splitSentences(answerText);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of sentences) {
    if (!raw.endsWith("?")) continue;
    const cleaned = raw.replace(LIST_MARKER_RE, "").trim();
    if (cleaned.length < MIN_QUESTION_LEN || cleaned.length > MAX_QUESTION_LEN) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

/**
 * Roll up native follow-up questions across every observation row into a
 * ranked, deduped list - the native twin of a Profound query fanout. Two
 * questions collapse together when their normalized text is identical
 * (conservative on purpose: near-duplicate clustering belongs to a
 * dedicated demand-ranking pass, not this extractor). The source
 * prompt's own text is excluded from its own expansion (a question
 * shouldn't "expand" into itself). Pure, deterministic.
 */
export function rollUpNativeQuestions(
  rows: readonly NativeObservationInput[],
  opts: { limit?: number } = {},
): NativeQuestion[] {
  const byQuestion = new Map<string, { weight: number; prompts: Set<string> }>();
  for (const row of rows) {
    const candidates = extractQuestionsFromAnswer(row.answerText);
    const ownNorm = row.promptText.trim().toLowerCase().replace(/[?!.]+$/, "");
    for (const q of candidates) {
      const norm = q.toLowerCase().replace(/[?!.]+$/, "");
      if (norm === ownNorm) continue; // don't "expand" a prompt into itself
      let entry = byQuestion.get(q);
      if (!entry) {
        entry = { weight: 0, prompts: new Set() };
        byQuestion.set(q, entry);
      }
      entry.weight += 1;
      entry.prompts.add(row.promptId);
    }
  }
  const results: NativeQuestion[] = [...byQuestion.entries()].map(([text, e]) => ({
    text,
    weight: e.weight,
    sourcePrompts: [...e.prompts],
  }));
  results.sort((a, b) => b.weight - a.weight || a.text.localeCompare(b.text));
  return opts.limit != null ? results.slice(0, opts.limit) : results;
}

// ---------------------------------------------------------------------------
// Combined report shape (what the loader hands to the /prompts surface)
// ---------------------------------------------------------------------------

export type NativeIntelReport = {
  recurringDomains: RecurringDomain[];
  recurringPages: RecurringPage[];
  presence: PresenceMatrix;
  nativeQuestions: NativeQuestion[];
  /** How many raw observation rows fed this report (honesty/coverage line). */
  rowsScanned: number;
  /** Distinct engines represented in the scanned rows. */
  enginesSeen: string[];
};

const DEFAULT_DOMAIN_LIMIT = 15;
const DEFAULT_PAGE_LIMIT = 15;
const DEFAULT_QUESTION_LIMIT = 30;

/** Build the full native-intel report from raw observation rows in one pass.
 *  Pure - the loader is the only I/O boundary. */
export function buildNativeIntelReport(
  rows: readonly NativeObservationInput[],
  opts: { ownedRoot?: string; brandVariants?: readonly string[] } = {},
): NativeIntelReport {
  const enginesSeen = [...new Set(rows.map((r) => r.engine))].sort();
  return {
    recurringDomains: rankRecurringDomains(rows, { ownedRoot: opts.ownedRoot, limit: DEFAULT_DOMAIN_LIMIT }),
    recurringPages: rankRecurringPages(rows, { ownedRoot: opts.ownedRoot, limit: DEFAULT_PAGE_LIMIT }),
    presence: buildPresenceMatrix(rows, { brandVariants: opts.brandVariants }),
    nativeQuestions: rollUpNativeQuestions(rows, { limit: DEFAULT_QUESTION_LIMIT }),
    rowsScanned: rows.length,
    enginesSeen,
  };
}
