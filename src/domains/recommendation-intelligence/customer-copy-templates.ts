/**
 * 2026-05-19 — Slice 4.5.B.α₀ + α₁ + α₂ + Slice 4.5.C.α₀ +
 * Slice 4.5.C.α₃a + Slice 4.5.C.α₃b — customer-safe copy templates.
 *
 * Pure templating. LLM NEVER writes `customer_copy`. Each template
 * returns plain prose safe for customer surfaces — though α₀/α₁/α₂
 * candidates ONLY surface on the operator-only diagnostic page
 * (customer-queue flip is Slice 4.5.D), the
 * `recommendation-intelligence-customer-copy-vocab` invariant
 * scans every template for internal taxonomy, forbidden vocab
 * from Section 6 + 9, and UUID-shape strings.
 *
 * α₂ adds two count-aware templates (`duplicateTitleCopy` +
 * `duplicateMetaCopy`) that take an integer occurrenceCount.
 * Implemented with `String()` concatenation rather than
 * `${expression}` template literals so the customer-copy-vocab
 * scan stays straightforward.
 *
 * Slice 4.5.C.α₀ adds five no-arg indexability-remediation
 * templates (`fixSitemapCopy`, `fixRobotsCopy`, `fixNoindexCopy`,
 * `fixStatusCodeCopy`, `fixCanonicalCopy`) paired with the new
 * inactive registry entries. Predicates that consume them land in
 * Slice 4.5.C.α₁ / α₂.
 */

export function missingTitleCopy(): string {
  return "Add a clear page title so AI search platforms can surface this page accurately.";
}

export function missingMetaCopy(): string {
  return "Add a meta description so AI search platforms have a clean snippet to extract.";
}

// improve_meta (2026-06-16) — root-cause-#3 directive copy. Used when a page
// is missing a meta description AND has too little clean text for Beacon to
// auto-draft one (list/label-soup, common on Wix). Plain English, white-label
// (no "Profound", no SEO jargon). Operator-locked phrasing.
export function improveMetaCopy(): string {
  return "This page is missing a meta description and is too thin to draft one automatically. Add a short summary in the words people actually search for, and add a little real description if the page is mostly a list.";
}

export function missingH1Copy(): string {
  return "Add a clear H1 so the page anchors its main topic.";
}

export function weakH1Copy(): string {
  return "Strengthen the H1 to include the right service or location so AI search platforms can anchor the page intent.";
}

export function titleH1MismatchCopy(): string {
  return "Bring the page title and H1 into closer alignment so AI search platforms see consistent intent for this page.";
}

export function duplicateTitleCopy(occurrenceCount: number): string {
  return (
    "This page title is repeated across " +
    String(occurrenceCount) +
    " owned pages. Make each title distinct so AI search platforms can tell the pages apart."
  );
}

export function duplicateMetaCopy(occurrenceCount: number): string {
  return (
    "This meta description is repeated across " +
    String(occurrenceCount) +
    " owned pages. Tailor each description so AI search platforms see distinct snippets."
  );
}

// ── Slice 4.5.C.α₀ (2026-05-19) — indexability remediation copy ─────────
// All five are no-arg, registered inactive; predicates that emit them
// land in Slice 4.5.C.α₁ (Tier-1) and α₂ (Tier-2). Operator-locked
// phrasing — do not edit without operator approval.

export function fixSitemapCopy(): string {
  return "This URL is missing from your sitemap.xml. Add it and resubmit so AI search platforms can discover it.";
}

export function fixRobotsCopy(): string {
  return "Your robots.txt blocks this URL. Update the rule so AI search platforms and Googlebot can crawl this page.";
}

export function fixNoindexCopy(): string {
  return "This page sets a noindex meta tag. Remove it if this page should be discoverable in AI search.";
}

export function fixStatusCodeCopy(): string {
  return "This URL returns an error or redirect. Restore a clean 200 response so AI search platforms can index this page.";
}

export function fixCanonicalCopy(): string {
  return "This page's canonical URL points to a different page. Update the canonical tag if this URL is the intended primary.";
}

// ── Slice 4.5.C.α₃a (2026-05-20) — internal-linking copy ─────────────────
// Operator-locked phrasing — do not edit without operator approval.

export function addInternalLinkCopy(): string {
  return "This page has no internal links pointing to it from elsewhere on your site. Add links from related hub or detail pages so AI search platforms can discover it.";
}

// ── Slice 4.5.C.α₃b (2026-05-20) — structured-data copy ──────────────────
// Operator-locked phrasing — do not edit without operator approval.

export function addSchemaCopy(): string {
  return "Add structured data so AI search platforms can extract this page's purpose more reliably.";
}

// ── Slice 4.5.E.α₁a (2026-05-21) — H2 rewrite copy ───────────────────────
// Operator-locked phrasing — do not edit without operator approval.
// Paired with the new `weak-h2` trigger predicate which emits
// `rewrite_h2` candidates at `confidence: "low"` (routes to
// diagnostic_only via applyQueueRules — never to customer queue
// without operator validation). LLM-drafted replacement text
// lands in a later α₁b slice via the operator-only LLM gateway.

export function rewriteH2Copy(): string {
  return "Rewrite this H2 to include the page's target topic so AI search platforms can understand the section more clearly.";
}

// ── Night-shift #43 (2026-06-11) — merge-pages copy ──────────────────────
// Diagnostic-only trigger (thin_content_overlap); plain English, no
// jargon. Operator-locked phrasing — do not edit without approval.

export function mergePagesCopy(): string {
  return "This short page covers nearly the same topic as another page on your site. Folding them into one stronger page usually earns more AI citations than two thin ones.";
}

// ── Night-shift #44 (2026-06-11) — stale-content copy ────────────────────
// Diagnostic-only trigger (stale_content); operator-locked phrasing.

export function staleContentCopy(): string {
  return "This page hasn't changed in a long time. A refreshed intro with current facts makes it far more quotable for AI search platforms.";
}

// ── fix_schema slice (2026-06-12) — structured-data repair copy ──────────

export function fixSchemaCopy(): string {
  return "This page's structured data has errors AI search platforms will reject. Repair it so the page is read correctly.";
}

// ── Insight Graph slice 1 (2026-06-12) — GSC low-CTR copy ────────────────

export function gscLowCtrCopy(query: string, impressions: number): string {
  return (
    "People searched “" +
    query +
    "” " +
    impressions.toLocaleString("en-US") +
    " times in the last 90 days and saw this page — but few clicked it. A clearer title can win those clicks."
  );
}

// ── Insight Graph slice 2 (2026-06-12) — striking-distance copy ──────────

export function strikingDistanceCopy(
  keyword: string,
  position: number,
  volume: number,
): string {
  return (
    "This page already ranks #" +
    position +
    " in Google for “" +
    keyword +
    "” — searched about " +
    volume.toLocaleString("en-US") +
    " times a month. A focused title update can lift it into the results people actually click."
  );
}

// ── Rule B (2026-06-12) — first-party striking-distance copy ─────────────

export function gscStrikingDistanceCopy(
  query: string,
  position: number,
  impressions: number,
): string {
  return (
    "Google already shows this page around #" +
    position +
    " when people search \u201c" +
    query +
    "\u201d \u2014 " +
    impressions.toLocaleString("en-US") +
    " times in the last 90 days. Naming it in the title can push it into the top results."
  );
}

// ── Decay slice (2026-06-12) — fading-page refresh copy ──────────────────

export function gscDecayCopy(dropPct: number): string {
  return (
    "This page is fading in Google — clicks are down about " +
    dropPct +
    "% versus the previous month. A content refresh usually recovers lost ground fastest."
  );
}

// ── Cannibalization slice (2026-06-12) ───────────────────────────────────

export function cannibalizationCopy(keyword: string): string {
  return (
    "Two of your pages compete in Google for \u201c" +
    keyword +
    "\u201d, splitting their strength. Pointing one at the other makes the stronger page win."
  );
}

// ── Keyword-gap slice (2026-06-12) ───────────────────────────────────────

export function internalLinkOpportunityCopy(destinationTitle: string): string {
  return (
    "Two of your pages cover the same topic, but one never points readers (or Google) to the other. Add a link to \u201c" +
    destinationTitle +
    "\u201d where the topic comes up \u2014 it helps that page get found."
  );
}

export function clarityFrictionCopy(
  reason: "script_errors" | "rage_clicks" | "dead_clicks",
): string {
  if (reason === "script_errors") {
    return "This page is throwing errors that can break it for visitors \u2014 and AI assistants can't read pages that fail to load, so fixing it protects how often you're recommended.";
  }
  if (reason === "dead_clicks") {
    return "Most visitors to this page are clicking things that don't respond \u2014 a strong sign something looks tappable but isn't (a broken link, a dead button, or an image people expect to open). Worth a look at what they're trying to click.";
  }
  return "Visitors are clicking the same spot over and over on this page, a sign something feels broken or unresponsive. Worth a look at what they expect to work.";
}

export function answerBlockReadinessCopy(question: string): string {
  return (
    "People ask \u201c" +
    question +
    "\u201d and this page is the answer \u2014 but it makes them dig for it. " +
    "Add a clear 2\u20133 sentence answer right at the top so AI assistants can quote you directly."
  );
}

export function uncitedContentCopy(): string {
  return (
    "This in-depth page backs up none of its facts with outside sources. " +
    "AI engines favor pages that cite checkable references \u2014 adding a short sources section makes this page easier to trust and recommend."
  );
}

/**
 * Profound AEO-gap (2026-06-14): a topic where AI assistants answer
 * citing a competitor while the tenant is absent. Names the competitor
 * + the number of AI answers seen; the play is an extractable answer
 * block. `competitor` is a caller-supplied brand name (interpolated like
 * the keyword in the gap copies); the vocab scan probes it.
 */
export function profoundAeoGapCopy(competitor: string, aiAnswers: number): string {
  return (
    "On a topic AI assistants get asked about, they\u2019re recommending \u201c" +
    competitor +
    "\u201d \u2014 not you \u2014 across about " +
    aiAnswers.toLocaleString("en-US") +
    " answers. Add a clear, quotable answer on your site for this topic so AI engines can cite you instead."
  );
}

export function keywordGapExpandCopy(keyword: string, volume: number): string {
  return (
    "A rival already wins \u201c" +
    keyword +
    "\u201d in Google \u2014 searched about " +
    volume.toLocaleString("en-US") +
    " times a month \u2014 and you already have a page on this topic. Expanding that page with a section on it beats building a duplicate."
  );
}

export function keywordGapCopy(keyword: string, volume: number): string {
  return (
    "A rival already wins \u201c" +
    keyword +
    "\u201d in Google \u2014 searched about " +
    volume.toLocaleString("en-US") +
    " times a month \u2014 and you have no page for it. A dedicated page puts you in that race."
  );
}

/**
 * SoV drop alert (BEACON 500 item 79, 2026-07-02): an AI engine that used to
 * mention the tenant on a topic stopped doing so this week. Names the
 * engine, the topic, and the exact prompts that flipped so the operator can
 * see the real question that changed, not just a number. NO em or en dashes
 * (hard rule) - this template uses commas and periods only, unlike the
 * older templates above.
 */
export function sovDropAlertCopy(
  engineName: string,
  topic: string,
  flippedCount: number,
  promptsPolled: number,
  examplePrompts: string[],
): string {
  const examples = examplePrompts.slice(0, 2).map((p) => `\u201c${p}\u201d`);
  const exampleText = examples.length > 0 ? `, including ${examples.join(" and ")}` : "";
  return (
    `${engineName} stopped mentioning you on ${flippedCount} of ${promptsPolled} ${topic} questions this week` +
    `${exampleText}. Add a clear, quotable answer on this topic so ${engineName} has something current to cite.`
  );
}

/**
 * Displacement check (BEACON 500 item 82, 2026-07-02): a money query that
 * already earned real clicks fell 3+ Google positions in a week, and a
 * checked competitor page now sits above the tenant's own page. Names the
 * query, the exact before/after position, the weekly clicks at risk, and the
 * page that took the spot. When a cached teardown exists for that page, adds
 * what it has that the tenant's page does not; otherwise offers reading it
 * next as the follow-up (never fetching more without being asked). NO em or
 * en dashes (hard rule) - commas and periods only.
 */
export function displacementCheckCopy(
  query: string,
  priorPosition: number,
  recentPosition: number,
  clicksAtRiskPerWeek: number,
  displacerDomain: string | null,
  whatTheyHave: string | null,
): string {
  const positions = `${priorPosition.toFixed(1)} to ${recentPosition.toFixed(1)}`;
  const clicksPhrase =
    clicksAtRiskPerWeek > 0
      ? `, worth about ${clicksAtRiskPerWeek} clicks a week`
      : "";
  const base = `You fell from ${positions} on "${query}"${clicksPhrase}.`;
  if (!displacerDomain) {
    return `${base} A new result is now ahead of you. I can look at what changed next.`;
  }
  const whoText = ` ${displacerDomain} is now ahead of you.`;
  const whatText = whatTheyHave
    ? ` Their page has ${whatTheyHave}, and yours is missing it.`
    : " I can read their page next to see what changed.";
  return `${base}${whoText}${whatText}`;
}

/**
 * Citation loss (BEACON 500 item 83, 2026-07-02): an AI answer that used to
 * cite the tenant's own page for a prompt stopped doing so this week, and a
 * competitor domain now takes the slot. Names the engine, the prompt, the
 * competitor, and (when available) the headline fact their answer leads
 * with, plus how many times the prompt was cited before, so the operator can
 * judge whether it's worth winning back. NO em or en dashes (hard rule) -
 * commas and periods only.
 */
export function citationLossCopy(
  engineName: string,
  prompt: string,
  displacerDomain: string | null,
  headlineFact: string | null,
  priorCitationCount: number,
): string {
  const timesPhrase =
    priorCitationCount > 0
      ? ` This prompt was cited ${priorCitationCount} time${priorCitationCount === 1 ? "" : "s"} recently, so it is worth winning back.`
      : "";
  if (!displacerDomain) {
    return `${engineName} used to cite you for "${prompt}" and does not anymore.${timesPhrase}`;
  }
  const switched = `${engineName} used to cite you for "${prompt}" and switched to ${displacerDomain} this week.`;
  const factText = headlineFact ? ` Their page leads with: ${headlineFact}` : "";
  return `${switched}${factText}${timesPhrase}`;
}

/**
 * Coverage loss (BEACON 500 item 83, 2026-07-02): a prompt that used to cite
 * the tenant simply stopped being polled by Profound (a data-collection gap,
 * not a lost citation). Deliberately worded differently from citationLossCopy
 * so the two are never confused. NO em or en dashes (hard rule).
 */
export function coverageLossCopy(prompt: string, lastSeenDate: string | null): string {
  const seenPhrase = lastSeenDate ? ` I last saw it checked on ${lastSeenDate}.` : "";
  return `I am not seeing fresh data for "${prompt}" this week, so I cannot tell if you are still cited.${seenPhrase} This is a data gap, not a confirmed loss.`;
}

/**
 * Connector failure streak (BEACON_500 item 84, 2026-07-03): a data source
 * failed to sync three or more nights in a row. Names the provider, the
 * streak length, and the real error, with the one-click reconnect path. NO
 * em or en dashes (hard rule).
 */
export function connectorFailureStreakCopy(
  providerLabel: string,
  nights: number,
  realError: string,
): string {
  return (
    `${providerLabel} did not sync for ${nights} nights in a row. The error was: ${realError}. ` +
    `Reconnect it on your connections page and I will pick data back up the next time it runs.`
  );
}

/**
 * Intent cluster conflict (BEACON_500 item N7, 2026-07-02): Google's own
 * top-10 results show 2+ of the tenant's own pages splitting one intent.
 * Grounded in the literal observed overlap (not title/H1 token similarity
 * like the older mergePagesCopy), so this names the actual number of
 * questions and pages involved. Worded distinctly from mergePagesCopy so
 * the two never read as the same evidence. NO em or en dashes (hard rule).
 */
export function intentClusterConflictCopy(
  queryCount: number,
  ownPageCount: number,
): string {
  const questionWord = queryCount === 1 ? "question" : "questions";
  const pageWord = ownPageCount === 1 ? "page" : "pages";
  return (
    `Google shows the same results for ${queryCount} of your ${questionWord} and sends ${ownPageCount} of your ${pageWord} to fight for them. ` +
    `Combining them into one page usually earns a better spot than splitting the same audience two ways.`
  );
}
