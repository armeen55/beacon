/**
 * redirect-hygiene (2026-07-03, BEACON_500 P11 v1 320/517 - "redirect chains +
 * soft-404s").
 *
 * PURE / no I/O. Two distinct hygiene defects, one engine:
 *
 *   1. REDIRECT CHAIN: a URL that redirects to a URL that redirects again before
 *      landing on the final page. Every extra hop leaks a little ranking and
 *      slows the reader. When Beacon has the resolved redirect chain for a URL
 *      (built by the liveness pass, mockable + capped + fail-soft in the trigger),
 *      a chain of 2+ hops earns a "point it straight at the final page" Move.
 *
 *   2. SOFT-404: a page that returns a 200 (looks fine to a naive fetch) but is
 *      really an empty or error shell - "page not found" content served at 200.
 *      The AUTHORITATIVE, false-positive-safe signal is Google's own URL
 *      Inspection coverage_state === "Soft 404": Google fetched it, rendered it
 *      (JavaScript included), and concluded it is empty. We do NOT infer soft-404
 *      from a raw-HTML word count, because a client-rendered site (Wix) serves a
 *      near-empty pre-hydration shell at 200 that is a perfectly real page once JS
 *      runs (the JS-shell trap the empty-shell guard already documents). Relying
 *      on Google's post-render verdict sidesteps that trap entirely.
 *
 * Byte-identical when every URL is clean. No em or en dashes. No lab words on the
 * sentence (we say "Google's index", never "crawler").
 */

import {
  redirectChainCopy,
  soft404Copy,
} from "@/domains/recommendation-intelligence/customer-copy-templates";

export type RedirectHygieneKind = "redirect_chain" | "soft_404";

export type RedirectHygienePageInput = {
  /** Canonical page URL. */
  url: string;
  /** The resolved redirect hop chain for this URL, in order, EXCLUDING the URL
   *  itself: [firstRedirectTarget, ..., finalUrl]. Empty when the URL does not
   *  redirect or the liveness pass has not resolved it. Length >= 2 means a
   *  multi-hop chain. */
  redirectChain: ReadonlyArray<string>;
  /** Google's URL-Inspection coverage_state token, e.g. "Soft 404". Null when
   *  never inspected. */
  coverageState: string | null;
  /** Google impressions over the trailing 90 days (the demand gate). */
  impressions90d: number;
};

export type RedirectHygieneFinding = {
  url: string;
  kind: RedirectHygieneKind;
  /** For a redirect chain: the number of hops (>= 2). For a soft-404: 0. */
  hopCount: number;
  /** For a redirect chain: the final destination. Null for a soft-404. */
  finalUrl: string | null;
  /** Plain first-person-safe sentence, dash-free, no lab words. */
  reason_copy: string;
  /** Operator-only structured trace. */
  evidence: string;
};

/** A page needs at least this many 90-day impressions before a hygiene card is
 *  worth raising. Matches the technical-demand floor. */
export const REDIRECT_HYGIENE_MIN_IMPRESSIONS_90D = 100;

/** Two or more redirect hops before landing = a chain worth collapsing. A single
 *  hop (a normal redirect) is fine and never flagged. */
export const MIN_REDIRECT_CHAIN_HOPS = 2;

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\/+$/, "");
    return p === "" ? "/" : p;
  } catch {
    return url;
  }
}

/** Does Google's coverage state report a soft-404? Pure, case-insensitive
 *  substring match. This is the ONLY soft-404 signal we trust (Google renders JS
 *  before deciding, so a Wix pre-hydration shell is never misread). */
export function coverageSaysSoft404(coverageState: string | null): boolean {
  if (!coverageState) return false;
  return coverageState.trim().toLowerCase().includes("soft 404");
}

/**
 * Classify ONE page's redirect-hygiene findings. A page can carry both (a chain
 * that also soft-404s), so this returns an array; each requires the page to clear
 * the demand floor first. Redirect chain leads (a broken navigation path is more
 * immediately fixable), then soft-404. Stable order for reproducible capping.
 * Pure.
 */
export function classifyRedirectHygiene(
  page: RedirectHygienePageInput,
): RedirectHygieneFinding[] {
  if (page.impressions90d < REDIRECT_HYGIENE_MIN_IMPRESSIONS_90D) return [];
  const out: RedirectHygieneFinding[] = [];
  const path = pathOf(page.url);

  if (page.redirectChain.length >= MIN_REDIRECT_CHAIN_HOPS) {
    const hops = page.redirectChain.length;
    const finalUrl = page.redirectChain[page.redirectChain.length - 1] ?? null;
    out.push({
      url: page.url,
      kind: "redirect_chain",
      hopCount: hops,
      finalUrl,
      reason_copy: redirectChainCopy(path, hops),
      evidence:
        "redirect_hygiene kind=redirect_chain; hops=" +
        String(hops) +
        "; chain=" +
        page.redirectChain.join(" -> ") +
        "; impressions_90d=" +
        String(page.impressions90d),
    });
  }

  if (coverageSaysSoft404(page.coverageState)) {
    out.push({
      url: page.url,
      kind: "soft_404",
      hopCount: 0,
      finalUrl: null,
      reason_copy: soft404Copy(path, page.impressions90d),
      evidence:
        "redirect_hygiene kind=soft_404; coverage_state=" +
        (page.coverageState ?? "null") +
        "; impressions_90d=" +
        String(page.impressions90d),
    });
  }

  return out;
}
