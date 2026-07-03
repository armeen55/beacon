/**
 * Architecture invariant — Slice 4.5.B.α₀ customer-copy vocab
 * (2026-05-19).
 *
 * Behavioral scan over every exported customer-copy template in
 * `src/domains/recommendation-intelligence/customer-copy-templates.ts`.
 * Each template invocation MUST return a string that passes:
 *
 *   1. No internal taxonomy tokens. Forbidden substrings (case-
 *      sensitive): `trigger_signal`, `action_type`, `actionType`,
 *      `evidence_tier`, `derivedConfidence`, `Mode A`, `Mode B`,
 *      `Mode C`, `aiSearchSignal`, `actualSearchQueries`,
 *      `source_rec_id`, `rec_stable_key`.
 *   2. No revenue / causal overclaim (carry-over from Section 9):
 *      `drove`, `caused`, `generated`, `revenue`, `dollars`, `$`,
 *      `ROI`.
 *   3. No connector-internal names (carry-over from Section 9
 *      `edit-outcomes-tile-vocab`): `Google Analytics`, `GA4`,
 *      `CallRail`.
 *   4. No UUID-shape strings.
 *   5. No `primary recommendation` raw label (Section 6 lock).
 *
 * The behavioral test calls every exported template with a range
 * of plausible inputs and runs the scan on each output. This
 * catches both static leaks (token in the template literal) and
 * dynamic leaks (caller-supplied arg interpolated into copy).
 *
 * α₀ ships 2 templates (`missingTitleCopy`, `missingMetaCopy`),
 * both no-argument. Later slices add more templates that take
 * arguments — the test machinery is set up so each new template
 * registers a probe set.
 */

import { describe, expect, it } from "vitest";

import * as templates from "@/domains/recommendation-intelligence/customer-copy-templates";

const FORBIDDEN_SUBSTRINGS_CASE_SENSITIVE: ReadonlyArray<string> = [
  "trigger_signal",
  "action_type",
  "actionType",
  "evidence_tier",
  "derivedConfidence",
  "Mode A",
  "Mode B",
  "Mode C",
  "aiSearchSignal",
  "actualSearchQueries",
  "source_rec_id",
  "rec_stable_key",
  "Google Analytics",
  "GA4",
  "CallRail",
];

const FORBIDDEN_SUBSTRINGS_CASE_INSENSITIVE: ReadonlyArray<string> = [
  "drove",
  "caused",
  "generated",
  "revenue",
  "dollars",
  "roi",
  "primary recommendation",
];

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Each template gets a probe set. α₀+α₁ templates are no-arg, so
 *  the probes are an empty array — the template is invoked once.
 *  α₂'s duplicate templates take an integer occurrenceCount, so
 *  they're probed with multiple integer values to catch any
 *  plurality-formatting bug.
 *
 *  Slice 4.5.C.α₀ adds 5 no-arg indexability-remediation
 *  templates probed with a single empty-arg invocation each. */
type Probe = ReadonlyArray<unknown>;
const PROBE_SETS: Record<string, ReadonlyArray<Probe>> = {
  missingTitleCopy: [[]],
  missingMetaCopy: [[]],
  // Root-cause-#3 gap (2026-06-16) — improve_meta directive copy. No-arg;
  // paired with the missing-meta predicate's improve_meta branch (a page
  // composeMeta can't auto-draft a meta from). Customer-queue-ready.
  improveMetaCopy: [[]],
  // Slice 4.5.B.α₁ (2026-05-19) — H1 family templates.
  missingH1Copy: [[]],
  weakH1Copy: [[]],
  titleH1MismatchCopy: [[]],
  // Slice 4.5.B.α₂ (2026-05-19) — count-aware duplicate-metadata
  // templates. Multiple integer probes catch any plurality bug
  // (e.g., a future "1 owned page" typo would surface).
  duplicateTitleCopy: [[2], [3], [5], [10]],
  duplicateMetaCopy: [[2], [3], [5], [10]],
  // Slice 4.5.C.α₀ (2026-05-19) — indexability remediation
  // templates. All five no-arg; predicates that emit them land
  // in Slice 4.5.C.α₁ (Tier-1) and α₂ (Tier-2).
  fixSitemapCopy: [[]],
  fixRobotsCopy: [[]],
  fixNoindexCopy: [[]],
  fixStatusCodeCopy: [[]],
  fixCanonicalCopy: [[]],
  // Slice 4.5.C.α₃a (2026-05-20) — internal-linking template.
  // No-arg; paired with the cross-snapshot `orphan-page`
  // predicate which emits at confidence: medium.
  addInternalLinkCopy: [[]],
  // Slice 4.5.C.α₃b (2026-05-20) — structured-data template.
  // No-arg; paired with the per-snapshot `missing-schema`
  // predicate which emits at confidence: low (diagnostic_only).
  addSchemaCopy: [[]],
  // Slice 4.5.E.α₁a (2026-05-21) — H2-rewrite template. No-arg.
  // Paired with the new `weak-h2` predicate which emits at
  // confidence: low → diagnostic_only routing. The LLM gateway
  // drafts the actual replacement text in α₁b.
  rewriteH2Copy: [[]],
  // Night-shift #43 (2026-06-11) — merge-pages (thin_content_overlap).
  mergePagesCopy: [[]],
  // Night-shift #44 (2026-06-11) — stale-content (stale_content).
  staleContentCopy: [[]],
  // fix_schema slice (2026-06-12) — structured-data repair template.
  // No-arg; paired with the per-snapshot `invalid-schema` predicate
  // (medium confidence, customer-queue-ready).
  fixSchemaCopy: [[]],
  // Insight Graph slice 1 (2026-06-12) — GSC low-CTR template. Args:
  // (query, impressions). Probe both a short and a long query.
  gscLowCtrCopy: [["persian tea houses", 480], ["x", 200000]],
  // Insight Graph slice 2 (2026-06-12) — striking-distance template.
  // Args: (keyword, position, volume).
  strikingDistanceCopy: [["persian rugs", 12, 590], ["k", 4, 10]],
  // Rule B (2026-06-12) — first-party striking-distance template.
  gscStrikingDistanceCopy: [["nowruz traditions", 9, 1200], ["q", 4, 100]],
  // Decay slice (2026-06-12) — fading-page template. Arg: dropPct.
  gscDecayCopy: [[25], [80]],
  // Cannibalization slice (2026-06-12). Arg: keyword.
  cannibalizationCopy: [["persian rugs"], ["x"]],
  // Keyword-gap slice (2026-06-12). Args: (keyword, volume).
  keywordGapCopy: [["nowruz gifts", 880], ["q", 10]],
  keywordGapExpandCopy: [["nowruz gifts", 880], ["q", 10]],
  internalLinkOpportunityCopy: [["The Persian Tea Ceremony"], ["x"]],
  uncitedContentCopy: [[], []],
  answerBlockReadinessCopy: [["What is Chaharshanbe Suri"], ["q"]],
  clarityFrictionCopy: [["script_errors"], ["rage_clicks"]],
  // Profound AEO-gap (2026-06-14). Args: (competitor brand name, AI
  // answers observed). Probe a normal competitor + a long count.
  profoundAeoGapCopy: [["Supple Homes", 42], ["X", 250000]],
  // SoV drop alert (BEACON 500 item 79, 2026-07-02). Args: (engine name,
  // topic, flipped-prompt count, prompts polled, example prompt texts).
  // Probe a normal case + a fall-to-zero-style edge case with no examples.
  sovDropAlertCopy: [
    ["Perplexity", "date questions", 3, 5, ["When is Nowruz 2026", "What date is Chaharshanbe Suri"]],
    ["ChatGPT", "x", 1, 1, []],
  ],
  // Displacement check (BEACON 500 item 82, 2026-07-02). Args: (query,
  // priorPosition, recentPosition, clicksAtRiskPerWeek, displacerDomain,
  // whatTheyHave). Probe a normal case, a fell-off-page case (no displacer),
  // and a known-teardown case (whatTheyHave populated).
  displacementCheckCopy: [
    ["persian rugs", 4.2, 8.9, 40, "example.com", null],
    ["nowruz gifts", 3.0, 15.0, 0, null, null],
    ["chaharshanbe suri", 2.1, 6.4, 120, "rival.com", "FAQ schema, answer block, 5 sections"],
  ],
  // Citation loss (BEACON 500 item 83, 2026-07-02). Args: (engineName,
  // prompt, displacerDomain, headlineFact, priorCitationCount). Probe a full
  // case + a no-competitor-domain edge case.
  citationLossCopy: [
    ["ChatGPT", "What is Chaharshanbe Suri", "en.wikipedia.org", "Chaharshanbe Suri is Iran's fire festival", 6],
    ["Perplexity", "x", null, null, 0],
  ],
  // Coverage loss (BEACON 500 item 83, 2026-07-02). Args: (prompt,
  // lastSeenDate). Probe a full case + a null last-seen date.
  coverageLossCopy: [
    ["What is Chaharshanbe Suri", "2026-06-20"],
    ["x", null],
  ],
  // Connector failure streak (BEACON 500 item 84, 2026-07-02). Args:
  // (providerLabel, nights, realError). Probe a normal streak + a one-night edge.
  connectorFailureStreakCopy: [
    ["Search Console", 3, "the sign-in expired"],
    ["Analytics", 1, "x"],
  ],
  // Intent cluster conflict (BEACON_500 item N7, 2026-07-02). Args:
  // (queryCount, ownPageCount). Probe a normal case + singular-count edges.
  intentClusterConflictCopy: [
    [3, 2],
    [1, 1],
    [7, 3],
  ],
  // Snippet-promise audit (BEACON_500 R8 / N18, 2026-07-03). Args:
  // (promiseLabel, missingSignal, impressions). Probe each promise kind +
  // a large-count edge.
  snippetPromiseCopy: [
    ["the cost", "never give a number", 480],
    ["a specific number of items", "never show a count", 120],
    ["the steps", "never start the steps", 250000],
    ["the date", "never name the date", 100],
  ],
  // N29 (2026-07-03) - featured-snippet capture: query, owner domain, plain
  // format phrase, own rank, format-matched instruction.
  snippetCaptureCopy: [
    ["iran flag history", "britannica.com", "a numbered list", 4, "Match the list format with a tight numbered list high on the page"],
    ["persian new year date", "smallblog.com", "a short paragraph answer", 2, "Lead with a two sentence direct answer high on the page"],
    ["farsi numbers chart", "example.org", "a table", 10, "Match the table format with a compact table high on the page"],
  ],
  // N3 (R13, 2026-07-03) - claim conflict: subject label, each side's
  // literal value + page path. Probe the pinned Persepolis example + a
  // number-shaped conflict.
  claimConflictCopy: [
    ["the year Persepolis was built", "515 BC", "/persepolis", "518 BC", "/iran-history"],
    ['the number for "persepolis columns"', "72", "/persepolis", "79", "/iran-history"],
  ],
  // N25 (R13b, 2026-07-03) - stale-fact check: page path, deterministic fact
  // label, age label, plural fact word. Probe the pinned population example +
  // a date-shaped fact.
  staleFactCopy: [
    ["/iran-population", "a 2023 population figure", "8 months ago", "Numbers"],
    ["/persepolis", "a persepolis date", "7 months ago", "Dates"],
  ],
  // R17b (2026-07-03) - device click gap: clicks-per-100-appearances strings
  // for phones and computers. Probe a typical pair + a sub-1 mobile rate.
  deviceCtrGapCopy: [
    ["1.4", "3.8"],
    ["0.6", "2.0"],
  ],
  // R18 / N23 (2026-07-03) - buried page, nothing links to it. Args:
  // (pagePath, impressions). Probe a normal page + a large-count edge.
  buriedNoLinksCopy: [
    ["/iran-visa", 340],
    ["/persian-names", 250000],
  ],
  // R18 / N23 (2026-07-03) - buried page, too many clicks from home. Args:
  // (pagePath, hopsFromHome, impressions).
  buriedTooDeepCopy: [
    ["/iran-visa", 5, 340],
    ["/persian-names", 4, 250000],
  ],
  // R18 / P7 (2026-07-03) - entity auto-interlink. Args: (topicLabel,
  // destinationPath). Probe a normal topic + a short one.
  entityInterlinkCopy: [
    ["Nowruz traditions", "/nowruz"],
    ["x", "/y"],
  ],
  // R18 / P7 (2026-07-03) - term-coverage gap. Args: (query, position,
  // missingLabels[]). Probe 1, 2, and 3 named gaps.
  termCoverageGapCopy: [
    ["iran visa", 8, ["visa fees"]],
    ["iran visa", 9, ["visa fees", "processing time"]],
    ["iran visa", 12, ["visa fees", "processing time", "required documents"]],
  ],
  // R19 / N24 (2026-07-03) - content-lifecycle. Prune: (pagePath, impressions).
  // Probe a normal page, a singular-count edge, and a large count.
  lifecyclePruneCopy: [
    ["/old-thin-page", 3],
    ["/one-view", 1],
    ["/dead-weight", 250000],
  ],
  // R19 / N24 (2026-07-03) - merge and redirect. Args: (ownerPath, foldPath,
  // ownerPercent). Probe a clear winner + an edge share.
  lifecycleMergeCopy: [
    ["/persian-cats", "/persian-cat", 90],
    ["/a", "/b", 83],
  ],
  // R19 / N24 (2026-07-03) - retire dated page. Args: (pagePath, impressions).
  lifecycleRetireCopy: [
    ["/nowruz-2021", 4],
    ["/event-2019", 1],
  ],
  // R19 / N22 (2026-07-03) - JS-shell content warning. Arg: (pagePath).
  jsShellContentCopy: [["/persian-cities"], ["/x"]],
  // P24 (2026-07-03) - image-SEO lane: add alt text. Args: (pagePath,
  // missingCount, firstDraft). Probe the singular case + a multi-picture case
  // with a realistic drafted description.
  addImageAltTextCopy: [
    ["/persian-food", 3, "Plate of Persian koobideh kabob with saffron rice"],
    ["/x", 1, "Nowruz haft-sin table"],
  ],
  // R19 / N21 (2026-07-03) - noindex on a page with demand. Args: (pagePath,
  // impressions).
  noindexOnDemandPageCopy: [
    ["/iran-visa", 340],
    ["/x", 1],
  ],
  // R19 / N21 (2026-07-03) - broken status on a page with demand. Args:
  // (pagePath, httpStatus, impressions).
  statusOnDemandPageCopy: [
    ["/iran-visa", 404, 340],
    ["/redirected", 301, 1],
  ],
  // R19 / N21 (2026-07-03) - canonical elsewhere on a page with demand. Args:
  // (pagePath, impressions).
  canonicalOnDemandPageCopy: [
    ["/iran-visa", 340],
    ["/x", 1],
  ],
  // P11 (2026-07-03) - dead-URL recovery. Args: (pagePath, reason, impressions,
  // clicks). Probe each reason token + a zero-clicks edge.
  deadUrlRecoveryCopy: [
    ["/iran-visa", "http_not_found", 340, 12],
    ["/persian-names", "http_gone", 250000, 0],
    ["/nowruz-2021", "index_dropped", 1, 0],
  ],
  // P11 (2026-07-03) - broken internal links. Args: (sourcePath, deadCount).
  // Probe singular + plural + a large count.
  brokenLinksCopy: [
    ["/persian-food", 1],
    ["/nowruz", 3],
    ["/big-hub", 250000],
  ],
  // P11 (2026-07-03) - redirect chain. Args: (pagePath, hopCount).
  redirectChainCopy: [
    ["/guides/old", 2],
    ["/x", 5],
  ],
  // P11 (2026-07-03) - soft-404. Args: (pagePath, impressions). Probe singular +
  // plural + a large count.
  soft404Copy: [
    ["/guides/old", 1],
    ["/persian-cities", 340],
    ["/x", 250000],
  ],
  // P9 (2026-07-03) - broken-competitor opportunity. Args: (query,
  // competitorDomain, bestRank). Probe a normal case + a #1 vacancy.
  brokenCompetitorCopy: [
    ["persian wedding", "example.com", 3],
    ["nowruz gifts", "smallblog.com", 1],
  ],
  // P9 (2026-07-03) - Google-results feature appeared. Args: (featureLabel,
  // query, grabInstruction). Probe an answer box, a PAA block, an image row.
  serpFeatureAppearedCopy: [
    ["an answer box", "farsi numbers", "Add a clear answer block near the top"],
    ["a People Also Ask block", "iran visa", "Answer the exact questions people ask on this page"],
    ["an image row", "persian rugs", "Add clear, named images to this page"],
  ],
  // P9 (2026-07-03) - Google-results feature disappeared. Args: (featureLabel,
  // query). Probe an answer box + an image row.
  serpFeatureDisappearedCopy: [
    ["the answer box", "farsi numbers"],
    ["the image row", "persian rugs"],
  ],
  // P8 (2026-07-03) - AEO zero-source opening. Args: (topicLabel, aiAnswers).
  // Probe a normal topic + a large-count edge.
  aeoZeroSourceOpeningCopy: [
    ["best time to visit Iran", 42],
    ["x", 250000],
  ],
  // P8 (2026-07-03) - AEO defend-a-cited-query. Args: (topicLabel,
  // competitorDomain). Probe a normal case + a short one.
  aeoDefendCitedQueryCopy: [
    ["persian saffron", "surfiran.com"],
    ["x", "rival.com"],
  ],
  // P8 (2026-07-03) - AEO brand-description accuracy. Args: (aiDescriptor,
  // ownFact). Probe an industry-family contradiction + a short one.
  aeoBrandDescriptionCheckCopy: [
    ["a hotel", "a Persian culture guide"],
    ["a law firm", "a restaurant guide"],
  ],
};

function scanForViolations(output: string): string[] {
  const violations: string[] = [];
  for (const tok of FORBIDDEN_SUBSTRINGS_CASE_SENSITIVE) {
    if (output.includes(tok)) violations.push(`case-sensitive token: ${tok}`);
  }
  const lowered = output.toLowerCase();
  for (const tok of FORBIDDEN_SUBSTRINGS_CASE_INSENSITIVE) {
    if (lowered.includes(tok)) violations.push(`case-insensitive token: ${tok}`);
  }
  if (UUID_RE.test(output)) violations.push("UUID-shape string");
  // Allow `$` only when escaped or inside a price example; for α₀
  // templates we forbid literal `$` entirely (revenue leak vector).
  if (output.includes("$")) violations.push(`literal "$" character`);
  return violations;
}

describe("recommendation-intelligence-customer-copy-vocab", () => {
  it("every exported function in customer-copy-templates has a probe set registered", () => {
    const exportedFns = Object.entries(templates)
      .filter(([, v]) => typeof v === "function")
      .map(([k]) => k);
    expect(exportedFns.length).toBeGreaterThanOrEqual(2);
    for (const name of exportedFns) {
      expect(
        PROBE_SETS[name],
        `Add a probe set for new template '${name}' to this invariant test.`,
      ).toBeDefined();
    }
  });

  it.each(Object.keys(PROBE_SETS))(
    "template `%s` output passes all customer-copy vocab rules",
    (name) => {
      const probes = PROBE_SETS[name]!;
      const fn = (templates as Record<string, unknown>)[name];
      expect(typeof fn).toBe("function");
      for (const probe of probes) {
        const output = (fn as (...args: unknown[]) => unknown).apply(
          null,
          probe as unknown[],
        );
        expect(typeof output).toBe("string");
        const violations = scanForViolations(output as string);
        expect(
          violations,
          `template '${name}' output "${String(output)}" violated: ${violations.join(", ")}`,
        ).toEqual([]);
      }
    },
  );
});
