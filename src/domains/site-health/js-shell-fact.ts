/**
 * js-shell-fact (BEACON_500 P16 v1 382, 2026-07-03) - the READ-SIDE half of the
 * JS-shell check.
 *
 * Detects a page whose raw HTML carries almost no readable body text because the
 * content is injected by JavaScript, so the page Google and AI assistants first
 * receive looks nearly empty. Reuses the pure lifecycle heuristic
 * (looksLikeJsShell) so the READ fact and the Move-emitting trigger
 * (js_shell_content) agree exactly on what counts as a shell - one definition,
 * no drift.
 *
 * PURE / no I/O. Empty-safe: returns null when the page renders real HTML. No em
 * or en dashes. Honest about the heuristic (it detects the smell from the stored
 * source-HTML snapshot; it does not run a headless render).
 */

import {
  looksLikeJsShell,
  type JsShellPageInput,
} from "@/domains/lifecycle/js-shell";

import type { JsShellFact } from "./types";

/** Path (or the whole URL when unparseable) for the customer sentence. */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\/+$/, "");
    return p === "" ? "/" : p;
  } catch {
    return url;
  }
}

/**
 * Build the JS-shell fact for one page, or null when its source HTML holds real
 * content. `url` identifies the page; the remaining fields mirror the lifecycle
 * heuristic's input (server-HTML body signals + a real-destination proof + the
 * demand gate). Pure.
 */
export function detectJsShellFact(
  input: JsShellPageInput,
): JsShellFact | null {
  if (!looksLikeJsShell(input)) return null;
  const path = pathOf(input.url);
  return {
    path,
    headline:
      "Your " +
      path +
      " page loads almost empty until JavaScript runs, so the HTML Google and AI assistants first receive looks blank. " +
      "Some AI crawlers and older bots do not run JavaScript and may see a blank page. " +
      "Add server-rendered text so they can read it.",
    operatorEvidence:
      "site_health.js_shell: url=" +
      input.url +
      "; word_count=" +
      String(input.wordCount) +
      "; body_excerpt_count=" +
      String(input.bodyExcerptCount) +
      "; has_title=" +
      String(input.hasTitle) +
      "; has_h1=" +
      String(input.hasH1) +
      "; impressions_90d=" +
      String(input.impressions90d) +
      " (heuristic: smell only, no headless render)",
  };
}
