/**
 * chunker (2026-07-02, master plan item 50) - the retrieval twin's pure text splitter.
 *
 * Turns a page's headings + body text into ~200-token, paragraph-ish chunks, each carrying
 * its nearest heading as context (so a chunk that reads "Nowruz begins on the first day of
 * spring." embeds together with the "When is Nowruz?" heading above it, matching how a real
 * answer engine retrieves passages WITH their surrounding structure, not bare sentences).
 *
 * PURE. No I/O, no OpenAI, no Supabase. Deterministic on the same input.
 *
 * Token estimate: ~4 chars per token (the same rough ratio OpenAI's own tokenizer guidance
 * uses for English text), so ~200 tokens is about 800 chars. We chunk by paragraph boundaries
 * first, then a soft word-count budget, so a sentence is never split mid-word.
 */

const CHARS_PER_TOKEN = 4;
const DEFAULT_TARGET_TOKENS = 200;
const MAX_CHUNK_CHARS = 1200; // matches the retrieval_chunks table's chunk_text cap

export type TextSection = {
  /** The nearest heading above this text (H1/H2/H3/title), or null when there is none yet. */
  heading: string | null;
  /** The paragraph/section body text. */
  text: string;
};

export type Chunk = {
  /** The heading context carried into the chunk (prefixed for embedding + display). */
  heading: string | null;
  /** The chunk's own text, capped at MAX_CHUNK_CHARS. */
  text: string;
  /** heading + text combined - what actually gets embedded (heading gives the model + the
   *  retrieval index the "what is this passage about" signal a bare paragraph loses). */
  embedText: string;
};

/**
 * Split a block of page text into heading-aware sections. Recognizes plain-text heading
 * lines (a short line, <= 80 chars, with no trailing punctation other than "?" or ":")
 * followed by body paragraphs, OR a caller-supplied list of {heading, text} sections
 * (see chunkStructuredPage below for the common case of h1/h2/faq input).
 *
 * Paragraphs are split on blank lines (one or more). Pure.
 */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);
}

function isLikelyHeadingLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 80) return false;
  if (/[.!]$/.test(t)) return false; // sentences end in . or ! ; headings rarely do
  return true;
}

/**
 * Parse a single free-text blob into {heading, text} sections by treating short
 * non-sentence lines as headings for the paragraphs that follow. Falls back to one
 * headingless section when no heading-shaped lines are found.
 */
export function sectionizePlainText(raw: string): TextSection[] {
  const text = (raw ?? "").trim();
  if (!text) return [];
  const lines = text.split(/\n/);
  const sections: TextSection[] = [];
  let currentHeading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const joined = buffer.join("\n\n").trim();
    if (joined) sections.push({ heading: currentHeading, text: joined });
    buffer = [];
  };

  for (const line of lines) {
    if (isLikelyHeadingLine(line)) {
      flush();
      currentHeading = line.trim();
    } else if (line.trim()) {
      buffer.push(line.trim());
    } else {
      buffer.push(""); // preserve paragraph breaks
    }
  }
  flush();

  if (sections.length === 0) {
    // No heading-shaped lines at all: treat the whole thing as one headingless section.
    return [{ heading: null, text }];
  }
  return sections;
}

/**
 * Merge whole paragraphs into a chunk up to ~targetTokens, never splitting a paragraph
 * mid-sentence. A single paragraph longer than MAX_CHUNK_CHARS is hard-capped (rare - most
 * page prose is far shorter than that per paragraph).
 */
function packParagraphs(paragraphs: string[], targetTokens: number): string[] {
  const targetChars = targetTokens * CHARS_PER_TOKEN;
  const out: string[] = [];
  let buf = "";
  for (const p of paragraphs) {
    const candidate = buf ? `${buf} ${p}` : p;
    if (candidate.length > targetChars && buf) {
      out.push(buf);
      buf = p;
    } else {
      buf = candidate;
    }
    while (buf.length > MAX_CHUNK_CHARS) {
      out.push(buf.slice(0, MAX_CHUNK_CHARS));
      buf = buf.slice(MAX_CHUNK_CHARS);
    }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * The main entry point: raw page text (plain text, headings on their own short lines) ->
 * ~200-token chunks, each carrying its nearest heading. Pure, deterministic, no I/O.
 */
export function chunkPageText(raw: string, opts: { targetTokens?: number } = {}): Chunk[] {
  const targetTokens = opts.targetTokens ?? DEFAULT_TARGET_TOKENS;
  const sections = sectionizePlainText(raw);
  const chunks: Chunk[] = [];
  for (const section of sections) {
    const paragraphs = splitParagraphs(section.text);
    if (paragraphs.length === 0) continue;
    const packed = packParagraphs(paragraphs, targetTokens);
    for (const text of packed) {
      const capped = text.length > MAX_CHUNK_CHARS ? text.slice(0, MAX_CHUNK_CHARS) : text;
      const embedText = section.heading ? `${section.heading}\n${capped}` : capped;
      chunks.push({
        heading: section.heading,
        text: capped,
        embedText: embedText.length > MAX_CHUNK_CHARS ? embedText.slice(0, MAX_CHUNK_CHARS) : embedText,
      });
    }
  }
  return chunks;
}

/**
 * Build chunks directly from structured fields (title, h1, h2 outline, FAQ questions,
 * meta description, body paragraphs) - the shape both the owned page_snapshots store and
 * the competitor-page-audit store actually persist (structural facts, not raw HTML). Each
 * heading + its associated text (an FAQ question's own text stands in for both, since we
 * never persist FAQ answer bodies for competitors) becomes one or more chunks.
 *
 * Pure. Skips empty/whitespace-only fields. Caps output at maxChunks (best-first: title/h1
 * lead, then body paragraphs, then outline headings, then FAQ questions) so one page can
 * never blow an indexing run's budget.
 */
export type StructuredPageInput = {
  title?: string | null;
  metaDescription?: string | null;
  h1?: string | null;
  headings?: string[]; // h2/h3 outline, in document order
  bodyParagraphs?: string[]; // full paragraphs when we have them (owned pages)
  faqQuestions?: string[]; // questions only - never answer bodies
};

export function chunkStructuredPage(input: StructuredPageInput, opts: { targetTokens?: number; maxChunks?: number } = {}): Chunk[] {
  const maxChunks = opts.maxChunks ?? 30;
  const parts: TextSection[] = [];

  const titleLine = [input.title, input.h1].filter((s): s is string => Boolean(s && s.trim())).join(" - ");
  if (titleLine || input.metaDescription) {
    parts.push({ heading: input.h1?.trim() || input.title?.trim() || null, text: (input.metaDescription ?? "").trim() || titleLine });
  }

  for (const p of input.bodyParagraphs ?? []) {
    const t = (p ?? "").trim();
    if (t) parts.push({ heading: input.h1?.trim() || input.title?.trim() || null, text: t });
  }

  for (const h of input.headings ?? []) {
    const t = (h ?? "").trim();
    if (t) parts.push({ heading: t, text: t });
  }

  for (const q of input.faqQuestions ?? []) {
    const t = (q ?? "").trim();
    if (t) parts.push({ heading: t, text: t });
  }

  const targetTokens = opts.targetTokens ?? DEFAULT_TARGET_TOKENS;
  const chunks: Chunk[] = [];
  for (const section of parts) {
    if (!section.text.trim()) continue;
    const packed = packParagraphs(splitParagraphs(section.text) || [section.text], targetTokens);
    for (const text of packed.length ? packed : [section.text]) {
      const capped = text.length > MAX_CHUNK_CHARS ? text.slice(0, MAX_CHUNK_CHARS) : text;
      const embedText = section.heading && section.heading !== capped ? `${section.heading}\n${capped}` : capped;
      chunks.push({
        heading: section.heading,
        text: capped,
        embedText: embedText.length > MAX_CHUNK_CHARS ? embedText.slice(0, MAX_CHUNK_CHARS) : embedText,
      });
      if (chunks.length >= maxChunks) return chunks;
    }
  }
  return chunks;
}
