/**
 * 2026-05-26 Phase A.2 (Section 3.4 / Decision Lock E4) — cross-tenant
 * pattern-description privacy scrubber.
 *
 * THE single most safety-critical primitive of the cross-tenant brain.
 * When the producer (Section 3.2 — still a `[]` stub until ≥2 tenants
 * accumulate ships AND `BEACON_CROSS_TENANT_BRAIN=1`) emits a
 * `CrossTenantPattern`, its operator/customer-readable `description`
 * MUST NOT expose ANY other tenant's identifying strings. A single
 * leak here (a competitor's brand, another tenant's domain) is a
 * product-killing trust failure.
 *
 * This module is PURE: `(description, blocklist) -> string`. No I/O,
 * no env reads, no Supabase, no tenant context. The producer assembles
 * the blocklist from the locked E4 scope — tenant/business names,
 * domains, aliases, competitor + tracked-entity names — and passes it
 * here before the description is ever persisted or packeted.
 *
 * Privacy-first failure mode (locked design choice): OVER-redaction is
 * safe, under-redaction is a leak. Therefore:
 *   • Case-INSENSITIVE substring matching (catches "Ritzbuilders" and
 *     "ritzbuilders.com" even when the surrounding text differs in
 *     case). Substring (not whole-word) is deliberate — a leak hiding
 *     inside a longer token is still a leak.
 *   • Longest-term-first so "ritzbuilders.com" is redacted as one unit
 *     before the substring "ritz" could fragment it.
 *   • Every blocklist term is regex-escaped (names/domains can contain
 *     `.`/`-`/etc.) so no term is ever interpreted as a pattern.
 *
 * Determinism: no `Date`, no `Math.random`. Same inputs → same output.
 *
 * Will be pinned by a behavioral architecture invariant once the
 * producer is wired (Section 3.9: "every CrossTenantPattern.description
 * is scrubbed before persistence"). Until then, `privacy.test.ts`
 * exhaustively pins the contract below.
 */

/** Neutral replacement token. Kept generic so a scrubbed description
 *  still reads as a sentence ("…helped [a tracked brand] 73%…") without
 *  exposing which brand. */
export const REDACTION_TOKEN = "[redacted]";

/**
 * Normalize + de-duplicate a raw blocklist into the terms actually
 * worth scrubbing:
 *   • trims whitespace,
 *   • drops empty / whitespace-only entries,
 *   • drops 1-character entries (too aggressive — a single letter would
 *     shred the description; real tenant/brand/domain tokens are ≥ 2
 *     chars),
 *   • de-duplicates case-insensitively (keeps the first spelling seen),
 *   • sorts by length DESCENDING so longer terms (e.g. a full domain)
 *     are redacted before any shorter substring of them.
 */
export function normalizeBlocklist(
  blocklist: ReadonlyArray<string>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of blocklist) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length < 2) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  // Longest first. Stable tiebreak by lowercased value for determinism.
  out.sort((a, b) => b.length - a.length || (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
  return out;
}

function escapeRegExp(literal: string): string {
  // Escape every regex metacharacter so a blocklist term is matched as
  // a pure literal (domains/names contain ., -, +, etc.).
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove every blocklisted term from `description`, replacing each
 * occurrence with `REDACTION_TOKEN`. Case-insensitive, substring,
 * longest-first. Pure + deterministic.
 *
 * Returns the original string unchanged when the blocklist is empty or
 * matches nothing. Collapses a redaction immediately adjacent to
 * another redaction's whitespace is NOT performed — readability is
 * secondary to never leaking; the producer may post-trim if desired.
 */
export function scrubPatternDescription(
  description: string,
  blocklist: ReadonlyArray<string>,
): string {
  if (typeof description !== "string" || description.length === 0) {
    return typeof description === "string" ? description : "";
  }
  const terms = normalizeBlocklist(blocklist);
  if (terms.length === 0) return description;

  let out = description;
  for (const term of terms) {
    const re = new RegExp(escapeRegExp(term), "gi");
    out = out.replace(re, REDACTION_TOKEN);
  }
  return out;
}

/**
 * Defensive post-scrub assertion helper for the producer: returns true
 * if ANY blocklisted term still appears in `text` (case-insensitive
 * substring). The producer can call this AFTER scrubbing and, if it
 * ever returns true (it should not), drop the pattern entirely + log —
 * a belt-and-suspenders guard against a future scrubber regression.
 */
export function containsBlocklistedTerm(
  text: string,
  blocklist: ReadonlyArray<string>,
): boolean {
  if (typeof text !== "string" || text.length === 0) return false;
  const terms = normalizeBlocklist(blocklist);
  const haystack = text.toLowerCase();
  for (const term of terms) {
    if (haystack.includes(term.toLowerCase())) return true;
  }
  return false;
}
