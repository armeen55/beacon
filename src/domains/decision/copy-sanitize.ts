/**
 * decision/copy-sanitize: the shared nets every piece of drafted copy is held to, in ONE
 * place. Does this string leak a raw id, name a website, or promise that something goes
 * live by itself? The drafter and the final validator used to keep private copies of the
 * last two: the validator knew thirteen public suffixes and the drafter thirty-three, so
 * an invented .wiki address passed both and reached the operator as a source to check.
 *
 * That is all that is left, and all that was ever used. The rest of this file was a
 * render-time scrubber for a recommendation queue, a cluster-label cleaner and a
 * write-time token blocklist, every one of them built for layers that no longer exist
 * and every one of them called by nothing. A guard nobody runs guards nothing.
 *
 * PURE and deterministic.
 */

/** RFC 4122 shape, 8-4-4-4-12 hex, with or without a truncation tail a model sometimes emits. */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.\.\.)?\b/i;

/** True when the text carries at least one id-shaped token. The one validator treats
 *  that as a hard safety trip: an operator is never handed a raw id as if it were copy. */
export function containsUuid(text: string | null | undefined): boolean {
  return !!text && UUID.test(text);
}

/** A written web address, told from ordinary prose by its public suffix: the generic suffixes
 *  in real use plus ANY two-letter country code. Narrowed by CODE_SUFFIX, because "Node.js"
 *  and "README.md" are file names, not websites, and throwing away a whole draft over one
 *  would read as nonsense. Broad on purpose: an address I never showed the model is a
 *  fabricated source, and a suffix list is the only thing standing between that and copy. */
export const HOST_RE = /\b[a-z0-9][a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:[a-z]{2}|com|org|net|edu|gov|mil|int|info|biz|name|pro|dev|app|xyz|online|site|store|shop|tech|blog|cloud|agency|studio|media|news|live|world|club|space|design|digital|wiki|guru|travel|press|recipes|expert|center|life|today|guide|tips|reviews|directory|academy|institute|foundation|community|network|systems|solutions|services|company|group|team|works|example)\b/gi;
export const CODE_SUFFIX = /\.(?:js|ts|py|rb|go|rs|kt|cs|sh|md)$/i;
/** Nothing Beacon drafts goes live by itself, and no draft may say it does. Every phrasing
 *  here was reachable by a real model: "I will put this page live for you" walked past the
 *  first version of this net, which only knew the verb "publish". */
export const AUTOPUBLISH_RE = /\b(auto-?publish|automatically (?:publish|post|upload|push|goes? live)|(?:publish|post|upload|push)ed automatically|i will (?:publish|post|upload|push|handle publishing|put this .{0,20}live)|i(?:'ll| will) (?:take care of|handle) (?:the )?publish|goes? live (?:by itself|on its own|automatically)|puts? (?:it|this|the page) live for you|publishes? (?:it|this) for you)\b/i;
/** A proportion written out in words. Both figure nets tokenize digits, so "nine in ten
 *  households" was a fabricated statistic that walked straight into pasteable copy. */
export const SPELLED_PROPORTION_RE = /\b(?:per ?cent|percent)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|half|most|nearly all|almost all)\s+(?:in|out of)\s+(?:two|three|four|five|ten|100|10)\b/i;
