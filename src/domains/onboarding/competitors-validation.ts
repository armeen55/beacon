/**
 * competitors-validation — Gap C.3 (2026-05-07).
 *
 * Pure validators + normalizers for the /onboard/competitors step
 * (step 3 of 4): operator picks 1-5 competitors they want Beacon to
 * track.
 *
 * Field semantics: free-text COMPANY NAMES (not URLs). Operator types
 * "De Mattei Construction" or "Kasten Builders", not "demattei.com".
 * The validator rejects inputs that look like bare URLs/domains and
 * asks for the name — keeps the field consistent with the rest of
 * the wizard's named-entity model. Auto-detect from competitor URLs
 * is deferred to Gap D.
 *
 * No I/O, no env reads, no Supabase, no Next.js. The server action
 * calls these before any DB write.
 */

import { normalizeDomain } from "./profile-validation";

export const COMPETITORS_MAX_COUNT = 5;
export const COMPETITORS_MIN_COUNT = 1;
export const COMPETITOR_NAME_MAX_LENGTH = 100;

/**
 * Heuristic: input "looks like a URL/domain" if normalizeDomain
 * accepts it AND the input contains no whitespace (real company
 * names usually have spaces — "De Mattei Construction"). One-word
 * brands like "Houzz" remain accepted because normalizeDomain
 * rejects single-label inputs.
 */
function looksLikeUrlOrDomain(s: string): boolean {
  if (/\s/.test(s)) return false; // has whitespace → name, not URL
  return normalizeDomain(s) !== null;
}

/**
 * Normalize a raw competitor list into clean, deduped names.
 * Accepts string (newline- or comma-separated) OR array of strings.
 *
 * Rules:
 *   - Trim each token.
 *   - Drop empty tokens.
 *   - Drop tokens that exceed COMPETITOR_NAME_MAX_LENGTH.
 *   - Dedupe case-insensitively (first-occurrence wins).
 *   - Preserve user's case (e.g., "deMattei" stays "deMattei",
 *     "BNB Builders" stays "BNB Builders").
 *
 * Returns the cleaned list. May be empty — caller decides whether
 * empty is acceptable (validateCompetitorsProfile rejects empty).
 *
 * Note: does NOT reject URL-shaped tokens here. The validator does
 * that with a typed error so the UI can render a useful message;
 * normalizeCompetitorList stays a pure renormalizer.
 */
export function normalizeCompetitorList(input: unknown): string[] {
  let tokens: string[] = [];
  if (typeof input === "string") {
    if (/\n/.test(input)) {
      tokens = input.split(/\n+/);
    } else {
      tokens = input.split(/,/);
    }
  } else if (Array.isArray(input)) {
    tokens = input.map((v) => (typeof v === "string" ? v : ""));
  } else {
    return [];
  }

  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const raw of tokens) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.length > COMPETITOR_NAME_MAX_LENGTH) continue;
    const dedupKey = trimmed.toLowerCase();
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    cleaned.push(trimmed);
  }
  return cleaned;
}

export type CompetitorsProfileInput = {
  /** Free-text (newline or comma separated) OR pre-split array. */
  competitors: string | string[];
};

export type CompetitorsProfileValidationResult =
  | {
      ok: true;
      normalized: { competitors: string[] };
    }
  | {
      ok: false;
      errors: { competitors?: string };
    };

/**
 * Validate + normalize the competitors-step submitted form.
 *
 * Rules:
 *   - At least COMPETITORS_MIN_COUNT (=1) and at most
 *     COMPETITORS_MAX_COUNT (=5) competitors after normalization.
 *   - At least one entry must look like a name (has whitespace OR
 *     isn't URL-shaped). If every entry is a bare URL/domain,
 *     reject with the "names not URLs" message — the field is for
 *     company names, not websites.
 */
export function validateCompetitorsProfile(
  input: CompetitorsProfileInput,
): CompetitorsProfileValidationResult {
  const errors: { competitors?: string } = {};

  const normalized = normalizeCompetitorList(input.competitors);
  if (normalized.length === 0) {
    errors.competitors = "List at least one competitor you want to track.";
  } else if (normalized.length > COMPETITORS_MAX_COUNT) {
    errors.competitors = `Pick ${COMPETITORS_MAX_COUNT} competitors or fewer for now — you can add more after launch.`;
  } else {
    // Reject the case where EVERY entry is URL-shaped — operator
    // typed websites instead of names. Mixed lists (some names, some
    // URLs) still get rejected per-token below.
    const allUrlShape = normalized.every(looksLikeUrlOrDomain);
    if (allUrlShape) {
      errors.competitors =
        "Enter competitor names (e.g. \"De Mattei Construction\"), not website URLs.";
    } else {
      // Reject if ANY token is URL-shaped — keeps the list pure
      // names. The error names the offender so the operator can
      // fix it.
      const offender = normalized.find(looksLikeUrlOrDomain);
      if (offender) {
        errors.competitors = `Enter the company name, not a website (got \"${offender}\").`;
      }
    }
  }

  if (errors.competitors) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    normalized: { competitors: normalized.slice(0, COMPETITORS_MAX_COUNT) },
  };
}
