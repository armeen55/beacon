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

/**
 * Snippet-promise audit (BEACON_500 R8 / N18, 2026-07-03). Args: the plain
 * promise label ("the cost"), the plural missing-signal phrase ("never give a
 * number"), and the 90-day impressions count. NO em or en dashes (hard rule).
 */
export function snippetPromiseCopy(
  promiseLabel: string,
  missingSignal: string,
  impressions: number,
): string {
  return (
    "This page's search listing promises " +
    promiseLabel +
    ", and about " +
    impressions.toLocaleString() +
    " searches saw that promise in the last 90 days, but its first lines " +
    missingSignal +
    ". Move the promised answer into the opening so the page keeps the promise its listing makes."
  );
}

/**
 * Featured-snippet capture (BEACON_500 R11 / N29, 2026-07-03). Args: the
 * query, the answer-box owner's domain, the plain format phrase ("a numbered
 * list"), our rank, and the format-matched instruction ("Match the list
 * format with a tight numbered list high on the page"). Always "answer box",
 * never a lab word. NO em or en dashes (hard rule).
 */
export function snippetCaptureCopy(
  query: string,
  ownerDomain: string,
  formatPhrase: string,
  ownRank: number,
  matchInstruction: string,
): string {
  return (
    'Google answers "' +
    query +
    '" with ' +
    formatPhrase +
    " from " +
    ownerDomain +
    " in the answer box above your #" +
    ownRank +
    " spot. " +
    matchInstruction +
    " to compete for that box."
  );
}

/**
 * Claim conflict (BEACON_500 R13 / N3, 2026-07-03). Two of the tenant's own
 * pages carry materially different values for the same fact. Args: the plain
 * subject label ("the year Persepolis was built"), each side's literal value
 * and page path. The ask is a decision, not an edit - once the operator
 * picks one, Beacon keeps the pages consistent (the N26 seed). NO em or en
 * dashes (hard rule).
 */
export function claimConflictCopy(
  subjectLabel: string,
  valueA: string,
  pageA: string,
  valueB: string,
  pageB: string,
): string {
  return (
    "Two of your pages disagree about " +
    subjectLabel +
    " (" +
    valueA +
    " on " +
    pageA +
    ", " +
    valueB +
    " on " +
    pageB +
    "). Pick one and I will keep them consistent."
  );
}

/**
 * Stale-fact check (BEACON_500 R13b / N25, 2026-07-03). A fact whose newest
 * confirmation is past its freshness deadline. Args: page path, a plain
 * deterministic fact label ("a 2023 population figure"), the age label
 * ("8 months ago"), and the plural fact word ("Numbers" / "Dates" /
 * "Details"). Honest by construction: says the fact is OLD, never that it
 * is wrong (calibrated abstention). NO em or en dashes (hard rule).
 */
export function staleFactCopy(
  pagePath: string,
  factLabel: string,
  ageLabel: string,
  factWordPlural: string,
): string {
  return (
    "Your " +
    pagePath +
    " page cites " +
    factLabel +
    " I last confirmed " +
    ageLabel +
    ". " +
    factWordPlural +
    " like this age; worth a fresh check."
  );
}

/**
 * Buried page - nothing links to it (BEACON_500 R18 / N23). A page with real
 * Google demand that no other page on the site links to. Never says "orphaned"
 * or "PageRank" (lab words); says plainly that nothing links to it and Google
 * treats it as an afterthought. Args: the page path and its 90-day impressions.
 * NO em or en dashes (hard rule).
 */
export function buriedNoLinksCopy(pagePath: string, impressions: number): string {
  return (
    "Your " +
    pagePath +
    " page gets real Google demand (" +
    impressions.toLocaleString("en-US") +
    " times shown in the last 90 days) but nothing else on your site links to it, so Google sees it as an afterthought. Add links to it from 2 or 3 related pages."
  );
}

/**
 * Buried page - too many clicks from home (BEACON_500 R18 / N23). An important,
 * high-demand page that sits many link hops from the homepage. Never says
 * "click-depth" (lab phrasing) in the number; says plainly it is buried deep and
 * important pages should be near the front door. Args: the page path, its hop
 * count from home, and its 90-day impressions. NO em or en dashes (hard rule).
 */
export function buriedTooDeepCopy(
  pagePath: string,
  hopsFromHome: number,
  impressions: number,
): string {
  return (
    "Your " +
    pagePath +
    " page is " +
    hopsFromHome +
    " clicks from your homepage and gets real Google demand (" +
    impressions.toLocaleString("en-US") +
    " times shown in the last 90 days). Important pages should be 2 or 3 clicks from home, so add a link to it from a page closer to the front."
  );
}

/**
 * Entity auto-interlink (BEACON_500 R18 / P7, v1 95/112). This page talks about a
 * topic another page of yours owns, but never links to it. Args: the topic label
 * (the anchor to add) and the destination page path. Never says "entity" or
 * "owner page" (lab framing); says plainly you already have a page for it. NO em
 * or en dashes (hard rule).
 */
export function entityInterlinkCopy(topicLabel: string, destinationPath: string): string {
  return (
    "This page talks about " +
    topicLabel +
    ", and you already have a page for it (" +
    destinationPath +
    ") that this page never links to. Add a link on the words “" +
    topicLabel +
    "” so readers and Google can find it."
  );
}

/**
 * Term-coverage gap (BEACON_500 R18 / P7, v1 411). A page ranking just off the
 * top whose demand-backed subtopics it does not cover. Names the biggest missing
 * subtopics so the fix is concrete. Args: the query, the ranking position, and
 * the 1 to 3 missing subtopic labels. Never says "coverage score" or "SERP"
 * (lab words); says plainly that the pages beating you all cover these. NO em or
 * en dashes (hard rule).
 */
export function termCoverageGapCopy(
  query: string,
  position: number,
  missingLabels: readonly string[],
): string {
  const list = missingLabels.slice(0, 3);
  const listText =
    list.length === 1
      ? list[0]!
      : list.length === 2
        ? `${list[0]} and ${list[1]}`
        : `${list[0]}, ${list[1]}, and ${list[2]}`;
  return (
    "You rank around #" +
    Math.round(position) +
    " for “" +
    query +
    "”, and the pages beating you all cover " +
    listText +
    " while yours does not. Add a section on each to close the gap."
  );
}

/**
 * Device click gap (BEACON_500 R17b, v1 item 268). Phones carry most of the
 * site's Google demand but click far below desktop at comparable rankings.
 * Args are clicks-per-100-appearances strings for phones and computers
 * ("1.4", "3.8") so the copy carries the concrete numbers, never a rate in
 * lab words. NO em or en dashes (hard rule).
 */
export function deviceCtrGapCopy(
  mobileClicksPer100: string,
  desktopClicksPer100: string,
): string {
  return (
    "Phones make up most of your Google traffic but click far less often than computers do " +
    "on the same rankings. Last week phones earned " +
    mobileClicksPer100 +
    " clicks per 100 appearances versus " +
    desktopClicksPer100 +
    " on computers. Something about how your titles and descriptions read on a phone is " +
    "costing clicks, so open your top pages in a phone-sized search result and check what gets cut off."
  );
}

// ── Content-lifecycle engine (BEACON_500 R19 / N24, 2026-07-03) ──────────────
// Three page-lifecycle cards: remove-or-fold (prune), merge-and-redirect
// (merge), and point-to-current-year (retire). Never says "prune", "retire",
// "orphaned", or "PageRank" (lab words); says plainly what the page is doing
// wrong and what to do. Every one is a PROPOSAL the operator approves; nothing
// here is ever executed automatically. NO em or en dashes (hard rule).

/**
 * Prune candidate: a page with almost no Google demand, very thin, that nothing
 * links to. Args: the page path and its 90-day impressions. The ask offers both
 * options (remove OR fold in) so the operator keeps the call.
 */
export function lifecyclePruneCopy(pagePath: string, impressions: number): string {
  const times = impressions === 1 ? "time" : "times";
  return (
    "Your " +
    pagePath +
    " page gets almost no Google traffic (" +
    impressions.toLocaleString("en-US") +
    " " +
    times +
    " shown in 90 days), is very thin, and nothing links to it. " +
    "Consider removing it or folding it into a stronger page so it stops diluting your site."
  );
}

/**
 * Merge candidate: two owned pages target the same topic and one clearly
 * dominates. Args: the dominant page path, the weaker page path, and the
 * dominant page's traffic share as a whole-number percent. The ask names the
 * redirect so the authority points one way.
 */
export function lifecycleMergeCopy(
  ownerPath: string,
  foldPath: string,
  ownerPercent: number,
): string {
  return (
    "Your " +
    ownerPath +
    " and " +
    foldPath +
    " pages both target the same topic, and " +
    ownerPath +
    " gets " +
    ownerPercent +
    " percent of the traffic. Fold " +
    foldPath +
    " into " +
    ownerPath +
    " and redirect it so all the authority points one way."
  );
}

/**
 * Retire candidate: a page about a passed, dated event whose demand has
 * collapsed. Args: the page path and its 90-day impressions. The ask offers
 * retiring or redirecting to a current-year page so its links keep their value.
 */
export function lifecycleRetireCopy(pagePath: string, impressions: number): string {
  const times = impressions === 1 ? "time" : "times";
  return (
    "Your " +
    pagePath +
    " page is about something that already happened and barely gets searched now (" +
    impressions.toLocaleString("en-US") +
    " " +
    times +
    " shown in 90 days). " +
    "Consider retiring it or pointing it to a page about the current year so its links keep their value."
  );
}

/**
 * JS-shell content warning (BEACON_500 R19 / N22, 2026-07-03). A page whose
 * source HTML is nearly empty because the content is injected by JavaScript.
 * Honest about the heuristic: it detects the smell, it does not run a headless
 * render. Arg: the page path. NO em or en dashes (hard rule).
 */
export function jsShellContentCopy(pagePath: string): string {
  return (
    "Your " +
    pagePath +
    " page's main content only appears after JavaScript runs, so the page Google and AI crawlers first receive looks nearly empty. " +
    "Some AI crawlers and older bots do not run JavaScript and may see an empty page. " +
    "Open this URL with JavaScript turned off, or view its page source, and confirm the real content is in the HTML the server sends."
  );
}

/**
 * Noindex on a page with real demand (BEACON_500 R19 / N21, 2026-07-03). Google
 * shows the page for real searches, but the page tells search engines not to
 * index it. Names the likely mistake plainly. Args: the page path and its
 * 90-day impressions. NO em or en dashes (hard rule).
 */
export function noindexOnDemandPageCopy(pagePath: string, impressions: number): string {
  const times = impressions === 1 ? "time" : "times";
  return (
    "Google shows your " +
    pagePath +
    " page for real searches (" +
    impressions.toLocaleString("en-US") +
    " " +
    times +
    " in the last 90 days), but the page tells search engines not to index it. " +
    "That is likely a mistake. Remove the noindex tag if this page should be found."
  );
}

/**
 * Broken status on a page with real demand (BEACON_500 R19 / N21, 2026-07-03).
 * Google still sends searches to a URL that now returns an error or redirect.
 * Args: the page path, the HTTP status number, and its 90-day impressions. NO em
 * or en dashes (hard rule).
 */
export function statusOnDemandPageCopy(
  pagePath: string,
  httpStatus: number,
  impressions: number,
): string {
  const times = impressions === 1 ? "time" : "times";
  return (
    "Google still shows your " +
    pagePath +
    " page for real searches (" +
    impressions.toLocaleString("en-US") +
    " " +
    times +
    " in the last 90 days), but the page now returns a " +
    httpStatus +
    " instead of loading. Restore a working page here, or send this address to the page that replaced it, so those searches do not hit a dead end."
  );
}

/**
 * Canonical points elsewhere on a page with real demand (BEACON_500 R19 / N21,
 * 2026-07-03). Google sends searches to a page whose canonical tag names a
 * different page as the real one. Args: the page path and its 90-day
 * impressions. NO em or en dashes (hard rule).
 */
export function canonicalOnDemandPageCopy(pagePath: string, impressions: number): string {
  const times = impressions === 1 ? "time" : "times";
  return (
    "Google shows your " +
    pagePath +
    " page for real searches (" +
    impressions.toLocaleString("en-US") +
    " " +
    times +
    " in the last 90 days), but the page's canonical tag points at a different page as the real one. " +
    "If this page is the one you want found, update the canonical tag to point at itself."
  );
}

// ── P11 technical-SEO pack (2026-07-03): dead-URL recovery, broken links,
//    redirect chains, soft-404s. Plain English, first person, always a concrete
//    number, always a next step, NO em or en dashes, no lab words ("Google's
//    index", never "crawler").

/**
 * Dead URL with real demand (BEACON_500 P11 v1 320/321). Google is still sending
 * real searches to a URL that is now gone, so the traffic hits a dead end. Names
 * the number and the recovery play (restore or redirect). Args: the page path,
 * the reason token, its 90-day impressions, and its 90-day clicks.
 */
export function deadUrlRecoveryCopy(
  pagePath: string,
  reason: "http_not_found" | "http_gone" | "index_dropped",
  impressions: number,
  clicks: number,
): string {
  const times = impressions === 1 ? "time" : "times";
  const demand =
    "Google still sends people to your " +
    pagePath +
    " page (" +
    impressions.toLocaleString("en-US") +
    " " +
    times +
    " in the last 90 days" +
    (clicks > 0
      ? ", " + clicks.toLocaleString("en-US") + " of them clicked through"
      : "") +
    "), ";
  const problem =
    reason === "http_gone"
      ? "but the page has been taken down and now returns Gone. "
      : reason === "http_not_found"
        ? "but the page now returns Not Found. "
        : "but Google's index has dropped the page, so it no longer shows in search. ";
  return (
    demand +
    problem +
    "Restore the page, or point this address at the page that replaced it, to stop the bleed."
  );
}

/**
 * Broken internal links on a page (BEACON_500 P11 v1 319/475). Some links on this
 * page point at pages that no longer exist, so readers and Google hit dead ends
 * moving through the site. Args: the source page path and how many links are dead.
 */
export function brokenLinksCopy(sourcePath: string, deadCount: number): string {
  const links = deadCount === 1 ? "link" : "links";
  const point = deadCount === 1 ? "points" : "point";
  return (
    deadCount.toLocaleString("en-US") +
    " " +
    links +
    " on your " +
    sourcePath +
    " page " +
    point +
    " at pages that no longer exist. Fixing them keeps readers and Google moving through your site."
  );
}

/**
 * Redirect chain (BEACON_500 P11 v1 320/517). A URL bounces through several
 * redirects before it lands, and every extra hop leaks a little ranking. Args: the
 * page path and how many hops it takes.
 */
export function redirectChainCopy(pagePath: string, hopCount: number): string {
  return (
    "Your " +
    pagePath +
    " address points through " +
    hopCount.toLocaleString("en-US") +
    " redirects before it lands. Point it straight at the final page so Google keeps the ranking and readers load faster."
  );
}

/**
 * Soft-404 (BEACON_500 P11 v1 320/517). The page returns a normal 200 but Google
 * looked at it and found it empty, so it treats it as a missing page. Args: the
 * page path and its 90-day impressions.
 */
export function soft404Copy(pagePath: string, impressions: number): string {
  const searches = impressions === 1 ? "search" : "searches";
  return (
    "Your " +
    pagePath +
    " page loads with a normal response, but Google's index reads it as empty and treats it as a missing page. " +
    "It still shows for " +
    impressions.toLocaleString("en-US") +
    " " +
    searches +
    " in the last 90 days. Put real content on the page, or send this address to the right page, so Google stops dropping it."
  );
}

/**
 * Broken-competitor opportunity (BEACON_500 P9 v1 250+259, 2026-07-03). A rival
 * page that used to rank in Google's top results for a tracked search just
 * dropped off. The demand is still there, so the vacated spot is an opening.
 * Args: the search text, the rival domain, and the best rank it held while
 * present. Always "Google results", never a lab word. NO em or en dashes (hard
 * rule).
 */
export function brokenCompetitorCopy(query: string, competitorDomain: string, bestRank: number): string {
  return (
    competitorDomain +
    ' used to show up at #' +
    bestRank +
    ' on Google for "' +
    query +
    '" and just dropped off. The search still has demand, so this is your opening to take that spot with a strong page.'
  );
}

/**
 * Google-results feature appeared (BEACON_500 P9 v1 251, 2026-07-03). Google
 * just added a result feature the tenant could win (an answer box, a People
 * Also Ask block, or an image row) for a tracked search. Args: the plain
 * feature label ("an answer box"), the search text, and the plain instruction
 * to grab it ("Add a clear answer block near the top"). Always "Google
 * results", never "SERP". NO em or en dashes (hard rule).
 */
export function serpFeatureAppearedCopy(featureLabel: string, query: string, grabInstruction: string): string {
  return (
    "Google just added " +
    featureLabel +
    ' for "' +
    query +
    '". ' +
    grabInstruction +
    " to grab it before a competitor does."
  );
}

/**
 * Google-results feature disappeared (BEACON_500 P9 v1 251, 2026-07-03). A
 * result feature that used to show for a tracked search is gone now, which
 * changes how the page should compete. Args: the plain feature label and the
 * search text. Always "Google results", never "SERP". NO em or en dashes.
 */
export function serpFeatureDisappearedCopy(featureLabel: string, query: string): string {
  return (
    "Google dropped " +
    featureLabel +
    ' for "' +
    query +
    '", so the classic top link matters more here again. Keep this page sharp on the basics to hold the top spot.'
  );
}

/**
 * Add image alt text (BEACON_500 P24 image-SEO lane, v1 248, 2026-07-03). One or
 * more pictures on a real-demand page have no alt text, the words screen readers
 * and Google Images read. Names the page path and the count, and shows the
 * description Beacon drafted for the first one so the fix is one copy-paste away.
 * Says "picture"/"alt text" plainly, never a lab word. Args: the page path, the
 * missing count, and the first drafted description. NO em or en dashes (hard
 * rule) - commas and periods only.
 */
export function addImageAltTextCopy(
  pagePath: string,
  missingCount: number,
  firstDraft: string,
): string {
  const pictures = missingCount === 1 ? "picture" : "pictures";
  const has = missingCount === 1 ? "has" : "have";
  const them = missingCount === 1 ? "it" : "them";
  return (
    missingCount.toLocaleString("en-US") +
    " " +
    pictures +
    " on " +
    pagePath +
    " " +
    has +
    " no alt text, the words screen readers and Google read. Add short descriptions so Google Images and screen readers understand " +
    them +
    ". I drafted: “" +
    firstDraft +
    "”."
  );
}

/**
 * AEO zero-source opening (BEACON 500 P8 v1 ~192, 2026-07-03). A question AI
 * gets asked where AI does not confidently recommend anyone yet, so it is a
 * first-mover opening. Args: the plain topic label, the number of AI answers
 * seen. First person, concrete number, next step. No lab words (says "AI
 * answers", never "AEO"). NO em or en dashes (hard rule).
 */
export function aeoZeroSourceOpeningCopy(topicLabel: string, aiAnswers: number): string {
  return (
    'On "' +
    topicLabel +
    '", AI does not confidently recommend anyone yet across about ' +
    aiAnswers.toLocaleString("en-US") +
    " answers I checked. Publish a clear, quotable answer for this on your site now and you can own it before a competitor does."
  );
}

/**
 * AEO defend-a-cited-query (BEACON 500 P8 v1 ~116/117, 2026-07-03). A
 * competitor just started getting recommended by AI for a question you already
 * earned, so strengthen your answer before they lock it in. Args: the plain
 * topic label, the competitor domain that newly appeared. First person, names
 * the rival, next step. No lab words. NO em or en dashes (hard rule).
 */
export function aeoDefendCitedQueryCopy(topicLabel: string, competitorDomain: string): string {
  return (
    competitorDomain +
    ' just started getting recommended by AI for "' +
    topicLabel +
    '", a question you used to own. Strengthen your answer block on this topic now, before they lock in the spot.'
  );
}

/**
 * AEO brand-description accuracy (BEACON 500 P8 v1 ~255, 2026-07-03). AI is
 * describing the brand with a fact that contradicts the tenant's own site, so
 * correct the record. Args: the wrong descriptor AI used, the tenant's own
 * true fact. First person, owns the problem plainly, next step. No lab words.
 * NO em or en dashes (hard rule).
 */
export function aeoBrandDescriptionCheckCopy(aiDescriptor: string, ownFact: string): string {
  return (
    "AI is describing you as " +
    aiDescriptor +
    ", but your site says you are " +
    ownFact +
    ". Add one clear line stating what you actually are, high on your homepage, so AI has the correct fact to learn from."
  );
}

/**
 * Sitewide entity + sameAs (BEACON 500 P10 v1 118/218, 2026-07-03). A content
 * page is about a thing Google already knows in its Knowledge Graph, but the
 * page never links to it, so Google cannot connect the page to the topic. Args:
 * the first named thing, and how many such things the page names. Names the real
 * thing, gives a next step. Says "a thing Google already knows", never the lab
 * word "entity". NO em or en dashes (hard rule).
 */
export function entityLinkGapCopy(firstEntityName: string, count: number): string {
  const rest = count - 1;
  const others =
    rest === 1
      ? " and 1 other thing your page names"
      : rest > 1
        ? " and " + rest.toLocaleString("en-US") + " other things your page names"
        : "";
  return (
    "This page is about " +
    firstEntityName +
    others +
    ", which Google already knows in its Knowledge Graph. I built the structured data that links your page to it. Paste it into the page so Google and AI connect your page to the topic."
  );
}

/**
 * Author / reviewer byline (BEACON 500 P10 v1 243/263, 2026-07-03). A guide
 * page names no author, which Google and AI lean on to decide who to trust.
 * No-arg (Beacon never fabricates a person's name). Names the gap, gives a next
 * step. Says "who wrote this", never a lab word. NO em or en dashes (hard rule).
 */
export function authorBylineGapCopy(): string {
  return "This guide page does not say who wrote it. Add a real author byline and Person structured data so Google and AI can trust who wrote this. A named, credible author is one of the strongest trust signals a content page can carry.";
}

/**
 * Knowledge-Graph / brand presence (BEACON 500 P10 v1 372/507, 2026-07-03). The
 * site does not clearly establish the brand as a thing Google can recognize.
 * Args: the brand name, and which gap ("no_org_schema" = no brand schema at all,
 * "no_sameas" = brand schema present but no cross-links). Names the brand, owns
 * it plainly, gives a next step. No lab words. NO em or en dashes (hard rule).
 */
export function brandPresenceGapCopy(
  brandName: string,
  gap: "no_org_schema" | "no_sameas",
): string {
  if (gap === "no_sameas") {
    return (
      "Google can see " +
      brandName +
      " by name, but nothing on your site links out to the profiles that prove who you are. I built the brand structured data. Paste it in and add your real profile links as sameAs so Google can confirm you are one clear brand."
    );
  }
  return (
    "Google does not yet clearly know " +
    brandName +
    " as a brand. I built the Organization structured data that names who you are and links to your site. Paste it into your homepage, then add your real profile links, so Google can lock in who you are."
  );
}

/**
 * Spelling-demand consolidation (BEACON 500 P20, v1 129, 2026-07-03). People
 * type the same thing several ways, so the demand splits across spellings and no
 * single one shows its true size. This adds them up and points at owning all of
 * them with one page. Args: the canonical spelling, the combined monthly demand,
 * how many spellings folded together, and the biggest single spelling's demand.
 * Concrete numbers, a clear next step, no lab words. NO em or en dashes.
 */
export function spellingDemandConsolidationCopy(
  canonical: string,
  combinedDemand: number,
  spellingCount: number,
  topSpellingDemand: number,
): string {
  const otherCount = Math.max(0, spellingCount - 1);
  const spellingsPhrase =
    otherCount === 1
      ? "1 other spelling of it"
      : otherCount + " other spellings of it";
  return (
    "“" +
    canonical +
    "” and " +
    spellingsPhrase +
    " get " +
    combinedDemand.toLocaleString("en-US") +
    " searches a month combined, more than any single spelling shows on its own (the biggest one is only " +
    topSpellingDemand.toLocaleString("en-US") +
    "). One page built around “" +
    canonical +
    "” that also names the other spellings can own all of that demand at once."
  );
}

/**
 * AI crawler skip (RANK-4, 2026-07-06). AI assistants send crawlers to read your
 * site so they know what to recommend. This page gets real Google demand but the
 * crawlers fetched the rest of the site and skipped it, so AI has never read it
 * and can never recommend it. Names the page path, its 90-day search demand, and
 * how many other pages the crawlers DID reach, then asks for links to it from
 * those crawled pages. Says "AI assistants" plainly, never "crawler" / "bot" /
 * "crawlability" (lab words). NO em or en dashes (hard rule).
 */
export function aiCrawlerSkipCopy(
  pagePath: string,
  impressions: number,
  crawledPageCount: number,
): string {
  return (
    "AI assistants read " +
    crawledPageCount.toLocaleString("en-US") +
    " of your pages but skipped " +
    pagePath +
    ", even though people see it " +
    impressions.toLocaleString("en-US") +
    " times in Google search over the last 90 days. Until AI reads this page it can never recommend it, so add links to it from the pages AI already reads."
  );
}
