/**
 * CX2.4 — Brand alias resolver.
 *
 * Given a tenant's identity (business_name, domain), derives all
 * plausible aliases and provides:
 *
 *   isMentioned(text, aliases)   — brand mentioned in answer text?
 *   findOwnedCitations(urls, domain) — which citation URLs belong to us?
 *
 * Fuzziness safeguards:
 *   - Aliases shorter than 4 chars require word-boundary match
 *   - "Ritz" does NOT match "Ritz Carlton" — requires isolation from
 *     other branded terms
 *   - Domain matching normalizes protocol, www, and trailing slashes
 */

// ---------------------------------------------------------------------------
// Alias generation
// ---------------------------------------------------------------------------

const LEGAL_SUFFIXES = [
  "llc",
  "inc",
  "corp",
  "ltd",
  "co",
  "company",
  "group",
  "builders",
  "construction",
  "contracting",
  "homes",
  "building",
];

/**
 * Generate all plausible aliases for a business.
 * Returns aliases sorted longest-first for greedy matching.
 */
export function generateAliases(opts: {
  businessName: string;
  domain: string;
  slug?: string;
}): string[] {
  const { businessName, domain, slug } = opts;
  const aliases = new Set<string>();

  // Exact name
  aliases.add(businessName.trim());

  // Without legal suffixes ("Ritz Builders LLC" → "Ritz Builders")
  for (const suffix of LEGAL_SUFFIXES) {
    const pattern = new RegExp(`\\s+${suffix}\\.?$`, "i");
    const stripped = businessName.trim().replace(pattern, "").trim();
    // Only keep suffixed-stripped aliases that are specific enough:
    // ≥6 chars OR contain 2+ words. Short single-word results like
    // "Ritz" (from "Ritz Builders") would match "Ritz Carlton".
    const wordCount = stripped.split(/\s+/).length;
    if (
      stripped !== businessName.trim() &&
      (stripped.length >= 6 || wordCount >= 2)
    ) {
      aliases.add(stripped);
    }
  }

  // Domain without TLD ("ritzbuilders.com" → "ritzbuilders")
  const domainBase = domain
    .replace(/^(https?:\/\/)?(www\.)?/, "")
    .replace(/\.[a-z]{2,}$/, "")
    .trim();
  if (domainBase.length >= 4) {
    aliases.add(domainBase);
  }

  // Slug if provided
  if (slug && slug.length >= 4) {
    aliases.add(slug);
  }

  // Sorted longest first for greedy matching
  return [...aliases].sort((a, b) => b.length - a.length);
}

// ---------------------------------------------------------------------------
// Brand mention detection
// ---------------------------------------------------------------------------

/**
 * Check if any alias is mentioned in the given text.
 *
 * For short aliases (<4 chars), requires word-boundary isolation to
 * prevent false positives ("ABC" matching "ABCDEF").
 *
 * Returns the first matching alias or null.
 */
export function findMention(
  text: string,
  aliases: string[],
): string | null {
  const textLower = text.toLowerCase();

  for (const alias of aliases) {
    const aliasLower = alias.toLowerCase();

    if (aliasLower.length < 4) {
      // Short alias: require word boundaries
      const pattern = new RegExp(`\\b${escapeRegex(aliasLower)}\\b`, "i");
      if (pattern.test(text)) return alias;
    } else {
      // Standard case-insensitive contains
      if (textLower.includes(aliasLower)) {
        // Guard: check this isn't embedded in a longer brand name.
        // E.g., "Ritz" should NOT match "Ritz Carlton".
        const idx = textLower.indexOf(aliasLower);
        const afterEnd = idx + aliasLower.length;
        const charAfter = textLower[afterEnd];
        const charBefore = idx > 0 ? textLower[idx - 1] : " ";

        // If the character after the match is a letter (part of another
        // word), skip — this is a substring of a longer brand.
        const isEmbeddedAfter =
          charAfter !== undefined && /[a-z]/.test(charAfter);
        const isEmbeddedBefore = /[a-z]/.test(charBefore);

        if (!isEmbeddedAfter && !isEmbeddedBefore) {
          return alias;
        }
      }
    }
  }

  return null;
}

/**
 * Convenience: check if any alias is mentioned (boolean).
 */
export function isMentioned(text: string, aliases: string[]): boolean {
  return findMention(text, aliases) !== null;
}

// ---------------------------------------------------------------------------
// Citation domain matching
// ---------------------------------------------------------------------------

function normalizeDomain(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^(https?:\/\/)?(www\.)?/, "")
    .replace(/\/.*$/, "")
    .trim();
}

/**
 * Check if a citation URL belongs to the tenant's domain.
 */
export function isOwnedUrl(
  url: string,
  tenantDomain: string,
): boolean {
  const citDomain = normalizeDomain(url);
  const ownDomain = normalizeDomain(tenantDomain);
  return citDomain === ownDomain || citDomain.endsWith(`.${ownDomain}`);
}

/**
 * Filter citations to only those matching the tenant's domain.
 */
export function findOwnedCitations(
  urls: string[],
  tenantDomain: string,
): string[] {
  return urls.filter((u) => isOwnedUrl(u, tenantDomain));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
