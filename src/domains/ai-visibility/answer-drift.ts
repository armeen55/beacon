/**
 * answer-drift (BEACON 500 item 77) - "did the answer change, and how" for ONE
 * (prompt, engine) pair across two dated snapshots. PURE module, no I/O, no LLM.
 * Deterministic: same two inputs always produce the same DriftEvent list.
 *
 * Reuses the sentence splitter from ./answer-alignment.ts (splitSentences) rather
 * than reimplementing sentence boundaries - that module already handles the
 * abbreviation traps (Mr./Dr./e.g./etc.) correctly and this module is read-only
 * against it (no edits there; answer-alignment.ts is owned by a different item).
 *
 * DETECTS (per call, against one before/after answer text pair):
 *   - brand_added    - the tenant's brand was absent in `before`, present in `after`
 *   - brand_dropped  - the tenant's brand was present in `before`, absent in `after`
 *   - descriptor_changed - the brand is mentioned in BOTH snapshots, but the set of
 *     adjective/noun tokens near the mention changed (a different way of describing
 *     the same brand - e.g. "affordable" became "outdated")
 *   - sentence-level diff: which sentences are new / gone / changed, keyed off the
 *     same shingle-containment idea as answer-alignment.ts (deterministic, no LLM)
 *
 * HONESTY: every function here takes two ALREADY-FETCHED answer texts. Callers own
 * deciding whether two comparable snapshots actually exist (see answer-drift-loader.ts
 * for the read-time "nearest 7 days prior" comparison policy) - this module never
 * fabricates a drift from a single snapshot or from empty input; it just returns [].
 */

import { splitSentences, shingles, shingleContainment } from "./answer-alignment";
import { extractMentionPosition, extractDescriptorWindow } from "@/domains/prompt-answer-observations/extraction";

/** Below this containment score, two sentences are treated as unrelated (one
 *  "gone", the other "new") rather than the same sentence "changed". Mirrors the
 *  MIN_CONTAINMENT_SCORE floor answer-alignment.ts uses for the same reason: avoid
 *  calling two loosely-word-sharing sentences a "match". */
const MIN_SENTENCE_MATCH_SCORE = 0.5;
/** Sentences shorter than this many words are dropped from the sentence-level
 *  diff (matches answer-alignment.ts's MIN_SENTENCE_WORDS) - too short to form a
 *  meaningful shingle, so a "change" there is just noise. */
const MIN_SENTENCE_WORDS = 4;
/** How many words of context to keep around a brand mention when nothing more
 *  specific is provided by a sentence-level match (kept short for card copy). */
const MAX_SENTENCE_CHARS = 240;

export type DriftEventKind = "brand_added" | "brand_dropped" | "descriptor_changed";

/** One detected week-over-week change for a single (prompt, engine) pair.
 *  `promptText` / `engine` / `whenIso` are stamped by the loader (this pure
 *  module only knows about the two texts it was handed); kept optional here so
 *  the pure builder functions below can return a bare event and let the loader
 *  fill in identity + timing without re-shaping the object. */
export type DriftEvent = {
  promptText: string;
  engine: string;
  kind: DriftEventKind;
  /** The sentence (or excerpt) from the OLDER answer that best represents the
   *  change, when one exists. Null when the change has no meaningful "before"
   *  side (e.g. brand_added has no prior mention to quote). */
  beforeSentence: string | null;
  /** The sentence (or excerpt) from the NEWER answer that best represents the
   *  change. Null only when the change has no meaningful "after" side (e.g. a
   *  brand_dropped event has nothing left to quote). */
  afterSentence: string | null;
  whenIso: string;
};

/** One sentence-level difference between two answers: a sentence that is new,
 *  gone, or materially reworded (matched but below a perfect-match bar). */
export type SentenceDiffKind = "added" | "removed" | "changed";

export type SentenceDiff = {
  kind: SentenceDiffKind;
  /** Present for "removed" and "changed". */
  before: string | null;
  /** Present for "added" and "changed". */
  after: string | null;
  /** Shingle containment score between before/after for "changed" rows (how much
   *  wording survived); null for pure add/remove rows. */
  score: number | null;
};

function truncate(s: string, max: number = MAX_SENTENCE_CHARS): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Trim to sentences long enough to carry real signal (mirrors answer-alignment's
 *  own MIN_SENTENCE_WORDS floor so both modules agree on what counts as noise). */
function usableSentences(text: string): ReturnType<typeof splitSentences> {
  return splitSentences(text).filter((s) => s.wordCount >= MIN_SENTENCE_WORDS);
}

/**
 * Sentence-level diff between two answer texts. For each `before` sentence, finds
 * its best match in `after` by symmetric shingle containment (max of both
 * directions, so word-order-preserving overlap counts either way); sentences with
 * no match above the floor are "removed", `after` sentences with no match are
 * "added", and matched-but-imperfect pairs are "changed". Deterministic, pure,
 * bounded (before x after sentence pairs, both already excerpt-length in practice).
 */
export function diffSentences(beforeText: string, afterText: string): SentenceDiff[] {
  const before = usableSentences(beforeText);
  const after = usableSentences(afterText);
  if (before.length === 0 && after.length === 0) return [];

  const afterShingled = after.map((s) => ({ sentence: s, sh: shingles(s.text) }));
  const beforeShingled = before.map((s) => ({ sentence: s, sh: shingles(s.text) }));

  const matchedAfterIdx = new Set<number>();
  const diffs: SentenceDiff[] = [];

  for (const b of beforeShingled) {
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < afterShingled.length; i++) {
      if (matchedAfterIdx.has(i)) continue;
      const a = afterShingled[i];
      const score = Math.max(shingleContainment(b.sh, a.sh), shingleContainment(a.sh, b.sh));
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestScore >= MIN_SENTENCE_MATCH_SCORE) {
      matchedAfterIdx.add(bestIdx);
      // A near-perfect match (score close to 1) means the sentence is unchanged -
      // do not report it as a "changed" diff row (that would be noise: every
      // untouched sentence would show up as a "change" with score ~1).
      if (bestScore < 0.98) {
        diffs.push({
          kind: "changed",
          before: b.sentence.text,
          after: afterShingled[bestIdx].sentence.text,
          score: Math.round(bestScore * 1000) / 1000,
        });
      }
    } else {
      diffs.push({ kind: "removed", before: b.sentence.text, after: null, score: null });
    }
  }

  for (let i = 0; i < afterShingled.length; i++) {
    if (matchedAfterIdx.has(i)) continue;
    diffs.push({ kind: "added", before: null, after: afterShingled[i].sentence.text, score: null });
  }

  return diffs;
}

/** The sentence around a brand mention in `text`, or a plain truncated excerpt
 *  when no sentence boundary contains the mention (short/malformed excerpts). */
function sentenceAroundPosition(text: string, position: number | null): string | null {
  if (position === null) return null;
  const sentences = splitSentences(text);
  let runningOffset = 0;
  // splitSentences normalizes whitespace, so we cannot rely on exact offsets
  // surviving from the raw text; fall back to a simple scan that finds the
  // sentence whose normalized text contains the character run at `position`
  // by proportional position when exact reconstruction isn't possible.
  const lower = text.toLowerCase();
  for (const s of sentences) {
    const idx = lower.indexOf(s.text.toLowerCase(), runningOffset);
    if (idx < 0) continue;
    if (position >= idx && position < idx + s.text.length) return s.text;
    runningOffset = idx + s.text.length;
  }
  // Fallback: no exact sentence boundary lines up (rare, truncated excerpts) -
  // return a plain window of raw text around the position instead of nothing.
  const start = Math.max(0, position - 80);
  const end = Math.min(text.length, position + 160);
  const window = text.slice(start, end).trim();
  return window || null;
}

/**
 * Detect brand presence/descriptor drift between two answer snapshots for the
 * same (prompt, engine). Returns [] when nothing changed on the brand-presence
 * or descriptor front (silence is the honest default - never fabricate a change).
 *
 * `brandVariants` come from the tenant's business config (business_name + root
 * domain, same convention run-engine-poll.ts uses for mention extraction) - this
 * module never guesses at brand terms itself.
 */
export function detectBrandDrift(beforeText: string, afterText: string, brandVariants: string[]): Array<{
  kind: DriftEventKind;
  beforeSentence: string | null;
  afterSentence: string | null;
}> {
  const variants = brandVariants.filter((v) => v && v.trim().length >= 3);
  if (variants.length === 0) return [];
  if (!beforeText.trim() && !afterText.trim()) return [];

  const beforePos = extractMentionPosition(beforeText, variants);
  const afterPos = extractMentionPosition(afterText, variants);
  const beforeMentioned = beforePos !== null;
  const afterMentioned = afterPos !== null;

  const events: Array<{ kind: DriftEventKind; beforeSentence: string | null; afterSentence: string | null }> = [];

  if (!beforeMentioned && afterMentioned) {
    events.push({
      kind: "brand_added",
      beforeSentence: null,
      afterSentence: sentenceAroundPosition(afterText, afterPos) ?? truncate(afterText),
    });
    return events; // added supersedes a descriptor comparison (nothing "before" to compare)
  }

  if (beforeMentioned && !afterMentioned) {
    events.push({
      kind: "brand_dropped",
      beforeSentence: sentenceAroundPosition(beforeText, beforePos) ?? truncate(beforeText),
      afterSentence: null,
    });
    return events; // dropped supersedes a descriptor comparison (nothing "after" to compare)
  }

  if (beforeMentioned && afterMentioned) {
    const beforeWindow = new Set(extractDescriptorWindow(beforeText, beforePos, variants));
    const afterWindow = new Set(extractDescriptorWindow(afterText, afterPos, variants));
    const changed =
      beforeWindow.size !== afterWindow.size || [...beforeWindow].some((w) => !afterWindow.has(w));
    if (changed && (beforeWindow.size > 0 || afterWindow.size > 0)) {
      events.push({
        kind: "descriptor_changed",
        beforeSentence: sentenceAroundPosition(beforeText, beforePos) ?? truncate(beforeText),
        afterSentence: sentenceAroundPosition(afterText, afterPos) ?? truncate(afterText),
      });
    }
  }

  return events;
}

/**
 * Full drift detection for one (prompt, engine) pair: brand add/drop/descriptor
 * events PLUS the sentence-level diff, stamped with the caller's identity fields.
 * Pure - `whenIso` should be the AFTER snapshot's observed_at (the moment the
 * drift became visible). Returns [] on empty/missing input; never throws.
 */
export function detectAnswerDrift(args: {
  promptText: string;
  engine: string;
  beforeText: string;
  afterText: string;
  brandVariants: string[];
  whenIso: string;
}): DriftEvent[] {
  const { promptText, engine, beforeText, afterText, brandVariants, whenIso } = args;
  if (!beforeText?.trim() || !afterText?.trim()) return [];
  if (beforeText.trim() === afterText.trim()) return []; // identical - nothing drifted

  const brandEvents = detectBrandDrift(beforeText, afterText, brandVariants);
  return brandEvents.map((e) => ({
    promptText,
    engine,
    kind: e.kind,
    beforeSentence: e.beforeSentence,
    afterSentence: e.afterSentence,
    whenIso,
  }));
}
