/**
 * first-mention-check (W5, 2026-07-09, J-70), "First mention: Persian
 * spelling where available + transliteration + English context." Generalized
 * so this is never Persian-specific: the tenant's own `BusinessConfig.
 * firstMention` config supplies the native SCRIPT (a Unicode character-range
 * source string, the same idea `draft-quality.ts`'s `PERSIAN_SCRIPT` uses,
 * just tenant-configured instead of hardcoded) plus which extra checks to
 * require alongside it.
 *
 * This is a SOFT check. A miss never blocks copy, it downgrades a "ready"
 * verdict to a plain "worth a look" reason, because a missing gloss is a
 * polish issue, not a trust issue (unlike a missing source, which is a hard
 * hold under J-69). Null/absent config = the rule contributes nothing; every
 * tenant without a `firstMention` config gets byte-identical evaluation.
 *
 * PURE, no I/O, no LLM, no randomness. Tenant-agnostic: callers thread in
 * the tenant's own config.
 */

export type FirstMentionConfig = {
  /** Unicode character-range SOURCE string (goes inside `[...]` in a RegExp),
   *  e.g. Persian/Arabic `"؀-ۿ"`. Not a literal word, the script
   *  itself, checked generically the way `PERSIAN_SCRIPT` already is. */
  native: string;
  /** Require a Latin-script transliteration alongside the native spelling. */
  transliteration: boolean;
  /** Require a short English gloss/context clause for readers who don't read
   *  the native script (a parenthetical or a comma-separated explainer). */
  englishContext: boolean;
};

export type FirstMentionCheckResult = { ok: true } | { ok: false; reason: string };

function firstSentenceOf(text: string): string {
  const t = (text ?? "").trim();
  if (!t) return "";
  return t.split(/(?<=[.!?])\s+/)[0] ?? t;
}

/** A short English gloss at first mention: a parenthetical containing a real
 *  word, or a comma-separated explainer clause right after the term. Narrow
 *  heuristics on purpose, this only ever produces a SOFT reason, never a
 *  hard block, so a false negative costs nothing but a review nudge. */
function hasEnglishGloss(sentence: string): boolean {
  if (/\([^)]*[a-z]{2,}[^)]*\)/i.test(sentence)) return true;
  return /,\s*[a-z][a-z\s'-]{3,},/i.test(sentence) || /,\s*[a-z][a-z\s'-]{3,}\.?$/i.test(sentence);
}

/**
 * Check whether `text`'s first sentence honors the tenant's first-mention
 * rule. `config` absent/null = no rule configured, always `{ ok: true }`,
 * byte-identical to a tenant that never adopts J-70. A malformed `native`
 * range (bad regex) also degrades to `{ ok: true }`, a config mistake must
 * never crash or hard-block a draft.
 */
export function checkFirstMention(
  text: string,
  config: FirstMentionConfig | null | undefined,
): FirstMentionCheckResult {
  if (!config || !config.native) return { ok: true };
  const sentence = firstSentenceOf(text);
  if (!sentence) return { ok: true }; // nothing to check yet (malformed/empty handled elsewhere)

  let nativeScript: RegExp;
  try {
    nativeScript = new RegExp(`[${config.native}]`);
  } catch {
    return { ok: true }; // a bad config must never block a draft
  }

  const nativeMatch = new RegExp(`[${config.native}]+`).exec(sentence);
  if (!nativeMatch) {
    return {
      ok: false,
      reason: "First mention has no native-script spelling yet. Add it per your first-mention rule.",
    };
  }

  if (config.transliteration) {
    // Transliteration/gloss convention: it follows immediately after the
    // native-script span (a parenthetical or a bare Latin rendering), so
    // only the text right after the match counts, a Latin word elsewhere
    // in the sentence (ordinary surrounding English prose) never qualifies.
    const after = sentence.slice(nativeMatch.index + nativeMatch[0].length, nativeMatch.index + nativeMatch[0].length + 60);
    if (!/[A-Za-z]{3,}/.test(after)) {
      return {
        ok: false,
        reason: "First mention has the native spelling but no transliteration alongside it.",
      };
    }
  }

  if (config.englishContext && !hasEnglishGloss(sentence)) {
    return {
      ok: false,
      reason: "First mention has no short English context for readers who don't read the native script.",
    };
  }

  return { ok: true };
}
