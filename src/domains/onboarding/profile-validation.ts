/**
 * profile-validation — Gap C.1 (2026-05-07).
 *
 * Pure validators + normalizers for the /onboard/business step.
 *
 * No I/O, no env reads, no Supabase, no Next.js. Easy to test, safe to
 * import on the server or in a server action. The server action calls
 * these before any DB write.
 *
 * Rules pinned by tests:
 *   - business name: trimmed, non-empty, length 1-80.
 *   - domain: input may be a bare hostname, a URL with protocol, or
 *     include path/query/whitespace. Normalized to a lowercased
 *     hostname. Must contain at least one dot and only RFC-1123-shaped
 *     labels (alphanumerics + dashes, no leading/trailing dash).
 *     Multi-label TLDs are accepted (acme.co.uk).
 *
 * Out of scope (deferred to Gap D auto-detect):
 *   - DNS resolution / homepage 200-check.
 *   - Robots.txt readability.
 *   - WHOIS / age checks.
 */

export const BUSINESS_NAME_MAX_LENGTH = 80;
export const DOMAIN_MAX_LENGTH = 253; // RFC 1035 max FQDN length

/**
 * Strip a URL-ish string down to its hostname. Returns null when the
 * input doesn't look like a hostname after stripping.
 *
 * Examples:
 *   "https://acme.com"          → "acme.com"
 *   "http://www.acme.com/about" → "www.acme.com"
 *   "ACME.COM/path?q=1"         → "acme.com"
 *   "  acme.com  "              → "acme.com"
 *   "acme"                      → null  (single-label, no TLD)
 *   "javascript:alert(1)"       → null  (not http/https)
 *   ""                          → null
 */
export function normalizeDomain(input: string): string | null {
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (!s) return null;

  // If a scheme is present, only allow http/https. Anything else
  // (javascript:, data:, file:, mailto:) is rejected as not-a-domain.
  const schemeMatch = s.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") return null;
    s = s.slice(schemeMatch[0].length);
    // Strip leading "//" if present.
    if (s.startsWith("//")) s = s.slice(2);
  }

  // Strip everything from the first "/", "?", "#", or whitespace.
  const cut = s.search(/[/?#\s]/);
  if (cut >= 0) s = s.slice(0, cut);

  // Strip user:pass@ prefix and :port suffix.
  const atIdx = s.indexOf("@");
  if (atIdx >= 0) s = s.slice(atIdx + 1);
  const colonIdx = s.indexOf(":");
  if (colonIdx >= 0) s = s.slice(0, colonIdx);

  s = s.toLowerCase();
  if (!s) return null;
  if (s.length > DOMAIN_MAX_LENGTH) return null;

  // Validate as a hostname: at least one dot, every label matches
  // RFC-1123 (1-63 chars, alphanumeric + dash, no leading/trailing dash).
  const labels = s.split(".");
  if (labels.length < 2) return null; // require a TLD
  const labelRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
  for (const label of labels) {
    if (!labelRegex.test(label)) return null;
  }
  // TLD-shape sanity: last label must contain at least one letter
  // (rejects "1.2.3.4" being treated as a domain).
  const tld = labels[labels.length - 1];
  if (!/[a-z]/.test(tld)) return null;

  return s;
}

export type BusinessProfileInput = {
  businessName: string;
  domain: string;
};

export type BusinessProfileValidationResult =
  | {
      ok: true;
      normalized: { businessName: string; domain: string };
    }
  | {
      ok: false;
      errors: { businessName?: string; domain?: string };
    };

/**
 * Validate + normalize the business-profile step's submitted form.
 * Pure. Returns either the trimmed/normalized values ready for write,
 * or per-field error messages ready for the form to render.
 */
export function validateBusinessProfile(
  input: BusinessProfileInput,
): BusinessProfileValidationResult {
  const errors: { businessName?: string; domain?: string } = {};

  const trimmedName = (input.businessName ?? "").trim();
  if (!trimmedName) {
    errors.businessName = "Please enter your business name.";
  } else if (trimmedName.length > BUSINESS_NAME_MAX_LENGTH) {
    errors.businessName = `Business name must be ${BUSINESS_NAME_MAX_LENGTH} characters or fewer.`;
  }

  const rawDomain = (input.domain ?? "").trim();
  let normalizedDomain: string | null = null;
  if (!rawDomain) {
    errors.domain = "Please enter your website.";
  } else {
    normalizedDomain = normalizeDomain(rawDomain);
    if (!normalizedDomain) {
      errors.domain = "Enter a valid website (e.g. acme.com or https://acme.com).";
    }
  }

  if (errors.businessName || errors.domain) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    normalized: {
      businessName: trimmedName,
      domain: normalizedDomain!,
    },
  };
}
