/**
 * Behavioral tests — UX.6.3 AIVisibilityHero (2026-05-08).
 *
 * Pure presentation component. Renders to static markup, asserts the
 * operator-locked copy + numbers + data attributes that the
 * architecture invariants pin separately. No DOM events, no async.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AIVisibilityHero,
  type AIVisibilityHeroProps,
} from "./ai-visibility-hero";

const RITZ_FULL: AIVisibilityHeroProps = {
  brandName: "Ritz Builders",
  score: 64.2,
  delta: 2.1,
  rank: 1,
  totalRanked: 6,
  closestChallenger: { name: "De Mattei Construction", score: 49.3 },
  currentSampledDays: 12,
  latestReadingDate: "2026-05-08",
  chatgptPrimaryPct: 42,
  perplexityPrimaryPct: 18,
  sampleState: "full",
};

describe("AIVisibilityHero — happy path (Ritz mature data)", () => {
  it("renders the executive section header + brand-name copy", () => {
    const html = renderToStaticMarkup(<AIVisibilityHero {...RITZ_FULL} />);
    expect(html).toContain('data-today-section="ai-visibility-hero"');
    expect(html).toContain("AI Visibility");
    expect(html).toContain(
      "How often Ritz Builders appears across tracked AI answers",
    );
  });

  it("lead sentence answers 'where do we rank?' first", () => {
    const html = renderToStaticMarkup(<AIVisibilityHero {...RITZ_FULL} />);
    expect(html).toContain('data-today-hero-lead="true"');
    expect(html).toContain(
      "Ritz Builders is #1 across tracked AI answers.",
    );
  });

  it("4 metric cards render with stable data-attrs (score, rank, closest-challenger, sample)", () => {
    const html = renderToStaticMarkup(<AIVisibilityHero {...RITZ_FULL} />);
    expect(html).toContain('data-today-hero-metric="score"');
    expect(html).toContain('data-today-hero-metric="rank"');
    expect(html).toContain('data-today-hero-metric="closest-challenger"');
    expect(html).toContain('data-today-hero-metric="sample"');
  });

  it("score card shows '64.2%' headline with positive delta within the window", () => {
    // Phase 2B follow-up (2026-05-13): delta semantic flipped from
    // "vs previous Nd" to "within this window" so hero + chart show
    // the same number with the same meaning.
    const html = renderToStaticMarkup(<AIVisibilityHero {...RITZ_FULL} />);
    expect(html).toContain("64.2%");
    expect(html).toContain("+2.1 pts in this window");
    expect(html).not.toContain("pts vs previous 14d");
    // Positive tone class.
    expect(html).toContain("text-status-success");
  });

  it("rank card shows '#1' headline with the tracked-set subtext", () => {
    // QA polish (2026-05-12): the pre-polish subtext "of 6 ranked"
    // implied the entire market had only 6 companies. New subtext
    // makes the tracked-set framing explicit so the rank doesn't
    // make the market look artificially tiny.
    const html = renderToStaticMarkup(<AIVisibilityHero {...RITZ_FULL} />);
    expect(html).toContain("#1");
    expect(html).toContain("among tracked brands cited by AI");
    // Regression guards: the misleading denominator is gone.
    expect(html).not.toMatch(/of\s+\d+\s+ranked/);
    expect(html).not.toContain("of 6 ranked");
  });

  it("closest challenger card surfaces name + score", () => {
    const html = renderToStaticMarkup(<AIVisibilityHero {...RITZ_FULL} />);
    expect(html).toContain("De Mattei Construction");
    // The challenger score is a window-average mention rate, labeled distinctly
    // from the brand hero's latest-day score so the two aren't read as identical.
    expect(html).toContain("AI named them in 49.3% of answers");
  });

  it("sample card shows day count + latest reading date in 'May 8' format", () => {
    const html = renderToStaticMarkup(<AIVisibilityHero {...RITZ_FULL} />);
    expect(html).toContain("12 days");
    expect(html).toContain("Latest May 8");
  });

  it("per-platform footer surfaces ChatGPT + Perplexity primary %", () => {
    const html = renderToStaticMarkup(<AIVisibilityHero {...RITZ_FULL} />);
    expect(html).toContain('data-today-hero-platforms="true"');
    expect(html).toContain('data-today-hero-platform="chatgpt"');
    expect(html).toContain('data-today-hero-platform="perplexity"');
    expect(html).toContain("ChatGPT");
    expect(html).toContain("names you first 42% of the time");
    expect(html).toContain("Perplexity");
    expect(html).toContain("names you first 18% of the time");
  });

  it("'Full sample' badge renders when sampleState='full'", () => {
    const html = renderToStaticMarkup(<AIVisibilityHero {...RITZ_FULL} />);
    expect(html).toContain('data-today-hero-sample-state="full"');
    expect(html).toContain("Full sample");
  });
});

describe("AIVisibilityHero — 'Why this number?' anchor (#372)", () => {
  it("omits the 'Why this number?' link by default (no dead anchor on v2)", () => {
    // The v2 command center mounts the hero but NOT the
    // <TodayMetricsDisclosure> jump target, so the link must not render
    // — otherwise clicking it scrolled nowhere.
    const html = renderToStaticMarkup(<AIVisibilityHero {...RITZ_FULL} />);
    expect(html).toContain('data-today-hero-platforms="true"');
    expect(html).not.toContain("Why this number?");
    expect(html).not.toContain("#today-metrics-disclosure");
  });

  it("renders the link only when whyThisNumberHref is supplied (legacy /today)", () => {
    const html = renderToStaticMarkup(
      <AIVisibilityHero
        {...RITZ_FULL}
        whyThisNumberHref="#today-metrics-disclosure"
      />,
    );
    expect(html).toContain("Why this number?");
    expect(html).toContain('href="#today-metrics-disclosure"');
  });

  it("does not render the link when the platforms footer is hidden", () => {
    // No platform pcts → footer suppressed → link must not orphan.
    const html = renderToStaticMarkup(
      <AIVisibilityHero
        {...RITZ_FULL}
        chatgptPrimaryPct={null}
        perplexityPrimaryPct={null}
        whyThisNumberHref="#today-metrics-disclosure"
      />,
    );
    expect(html).not.toContain("Why this number?");
  });
});

describe("AIVisibilityHero — partial-sample state", () => {
  it("'Partial sample' badge renders when sampleState='partial'", () => {
    const html = renderToStaticMarkup(
      <AIVisibilityHero {...RITZ_FULL} sampleState="partial" />,
    );
    expect(html).toContain('data-today-hero-sample-state="partial"');
    expect(html).toContain("Partial sample");
    expect(html).not.toContain("Full sample");
  });

  it("no badge when sampleState is undefined (don't lie about coverage)", () => {
    const html = renderToStaticMarkup(
      <AIVisibilityHero {...RITZ_FULL} sampleState={undefined} />,
    );
    expect(html).not.toContain("Full sample");
    expect(html).not.toContain("Partial sample");
    expect(html).not.toContain("data-today-hero-sample-state");
  });
});

describe("AIVisibilityHero — freshness pill (2026-05-13)", () => {
  it("renders 'fresh' freshness pill with the loader's label", () => {
    const html = renderToStaticMarkup(
      <AIVisibilityHero
        {...RITZ_FULL}
        freshness={{ status: "fresh", label: "Updated 2h ago" }}
      />,
    );
    expect(html).toContain('data-today-hero-freshness="fresh"');
    expect(html).toContain("Updated 2h ago");
  });

  it("renders 'stale' freshness pill with warning tone", () => {
    const html = renderToStaticMarkup(
      <AIVisibilityHero
        {...RITZ_FULL}
        freshness={{ status: "stale", label: "Updated 3 days ago" }}
      />,
    );
    expect(html).toContain('data-today-hero-freshness="stale"');
    expect(html).toContain("Updated 3 days ago");
    expect(html).toContain("status-warning");
  });

  it("renders 'rebuilding' freshness pill with accent tone", () => {
    const html = renderToStaticMarkup(
      <AIVisibilityHero
        {...RITZ_FULL}
        freshness={{ status: "rebuilding", label: "Refreshing…" }}
      />,
    );
    expect(html).toContain('data-today-hero-freshness="rebuilding"');
    expect(html).toContain("Refreshing");
    expect(html).toContain("accent-primary");
  });

  it("renders 'empty' freshness pill with neutral tone + no-data copy", () => {
    const html = renderToStaticMarkup(
      <AIVisibilityHero
        {...RITZ_FULL}
        freshness={{ status: "empty", label: "No data yet" }}
      />,
    );
    expect(html).toContain('data-today-hero-freshness="empty"');
    expect(html).toContain("No data yet");
  });

  it("renders no pill when freshness prop is omitted (back-compat)", () => {
    const html = renderToStaticMarkup(<AIVisibilityHero {...RITZ_FULL} />);
    expect(html).not.toContain("data-today-hero-freshness");
  });
});

describe("AIVisibilityHero — delta cases", () => {
  it("negative delta renders red tone", () => {
    const html = renderToStaticMarkup(
      <AIVisibilityHero {...RITZ_FULL} delta={-3.4} />,
    );
    expect(html).toContain("-3.4 pts in this window");
    expect(html).toContain("text-status-danger");
  });

  it("flat delta (0.0) reads neutral on the score metric subline", () => {
    const html = renderToStaticMarkup(
      <AIVisibilityHero {...RITZ_FULL} delta={0} sampleState={undefined} />,
    );
    expect(html).toContain("0.0 pts in this window");
    // Scope the tone check to the score metric's subline — the prior
    // assertion `not.toContain("text-status-success")` false-failed
    // when the "Full sample" badge added a status-success class
    // elsewhere in the markup. Disabling sampleState here removes
    // the badge so the check is unambiguous.
    expect(html).toMatch(
      /text-muted-foreground\/80[^"]*">0\.0 pts in this window/,
    );
    expect(html).not.toContain("text-status-success");
    expect(html).not.toContain("text-status-danger");
  });

  it("null delta (limited window data) shows honest message, not fake +0", () => {
    const html = renderToStaticMarkup(
      <AIVisibilityHero {...RITZ_FULL} delta={null} />,
    );
    expect(html).toContain("in this window, limited data");
    expect(html).not.toContain("0.0 pts");
  });
});

describe("AIVisibilityHero — empty / first-reading edge cases", () => {
  it("score=null shows '—' headline and 'Awaiting' subline", () => {
    const html = renderToStaticMarkup(
      <AIVisibilityHero
        {...RITZ_FULL}
        score={null}
        delta={null}
      />,
    );
    expect(html).toContain('data-today-hero-metric="score"');
    expect(html).toContain("Awaiting sampled data");
  });

  it("rank=null shows '—' headline and 'Awaiting leaderboard' subline", () => {
    const html = renderToStaticMarkup(
      <AIVisibilityHero {...RITZ_FULL} rank={null} totalRanked={0} />,
    );
    expect(html).toContain("Awaiting leaderboard");
    // Lead sentence falls back to non-rank framing.
    expect(html).toContain("Ritz Builders is being tracked across AI answers.");
    expect(html).not.toContain("Ritz Builders is #");
  });

  it("closestChallenger=null shows 'No competitor in range yet' subline", () => {
    const html = renderToStaticMarkup(
      <AIVisibilityHero {...RITZ_FULL} closestChallenger={null} />,
    );
    expect(html).toContain("No competitor in range yet");
  });

  it("latestReadingDate=null shows 'Awaiting first reading' subline", () => {
    const html = renderToStaticMarkup(
      <AIVisibilityHero {...RITZ_FULL} latestReadingDate={null} />,
    );
    expect(html).toContain("Getting your first results");
  });

  it("both platform pcts null: footer is hidden entirely (no orphan separator)", () => {
    const html = renderToStaticMarkup(
      <AIVisibilityHero
        {...RITZ_FULL}
        chatgptPrimaryPct={null}
        perplexityPrimaryPct={null}
      />,
    );
    expect(html).not.toContain("data-today-hero-platforms");
    expect(html).not.toContain("primary");
  });

  it("only ChatGPT pct present: renders ChatGPT side without Perplexity", () => {
    const html = renderToStaticMarkup(
      <AIVisibilityHero
        {...RITZ_FULL}
        chatgptPrimaryPct={42}
        perplexityPrimaryPct={null}
      />,
    );
    expect(html).toContain('data-today-hero-platform="chatgpt"');
    expect(html).not.toContain('data-today-hero-platform="perplexity"');
    expect(html).toContain("names you first 42% of the time");
  });
});

describe("AIVisibilityHero — copy must be customer-safe (no internal jargon)", () => {
  it("does not leak SQL / Supabase / cron / debug language", () => {
    const html = renderToStaticMarkup(<AIVisibilityHero {...RITZ_FULL} />);
    expect(html).not.toMatch(/\bSupabase\b/i);
    expect(html).not.toMatch(/\bcron\b/i);
    expect(html).not.toMatch(/\bSQL\b/);
    expect(html).not.toMatch(/\bUTC\b/);
    expect(html).not.toMatch(/\bschema\b/i);
    expect(html).not.toMatch(/\bRLS\b/);
    expect(html).not.toMatch(/\btenant_id\b/);
    expect(html).not.toMatch(/\bobservation_run\b/);
  });

  it("long competitor names are truncated, not exploded into multi-line", () => {
    const html = renderToStaticMarkup(
      <AIVisibilityHero
        {...RITZ_FULL}
        closestChallenger={{
          name: "An Enormous Competitor Name That Overflows",
          score: 33.1,
        }}
      />,
    );
    // 24-char cap (defined inside the component) + ellipsis. The
    // truncate helper does s.slice(0, max - 1).trimEnd() + "…".
    expect(html).toContain("An Enormous Competitor…");
    expect(html).not.toContain("An Enormous Competitor Name That Overflows");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Bundle 2 hosted-verification fix (2026-05-11) — second-person grammar.
//
// When the brand resolves to "You" (the fallback when no real brand
// is configured), the third-person verb forms ("You is", "You appears")
// read as a typo. The hero pluralizes the verb so any subject — "Ritz
// Builders is", "You are" — stays grammatical.
// ─────────────────────────────────────────────────────────────────────

describe("AIVisibilityHero — second-person grammar (Bundle 2 verification fix)", () => {
  it("renders 'You are #N' (not 'You is #N') when brandName is 'You' and rank is set", () => {
    const html = renderToStaticMarkup(
      <AIVisibilityHero {...RITZ_FULL} brandName="You" />,
    );
    expect(html).toContain("You are #1 across tracked AI answers.");
    expect(html).not.toContain("You is #");
  });

  it("renders 'You are being tracked' (not 'You is being tracked') when rank is null", () => {
    const html = renderToStaticMarkup(
      <AIVisibilityHero
        {...RITZ_FULL}
        brandName="You"
        rank={null}
        totalRanked={0}
      />,
    );
    expect(html).toContain("You are being tracked across AI answers.");
    expect(html).not.toContain("You is being tracked");
  });

  it("renders 'How often You appear' (not 'How often You appears') in the subline", () => {
    const html = renderToStaticMarkup(
      <AIVisibilityHero {...RITZ_FULL} brandName="You" />,
    );
    expect(html).toContain("How often You appear across tracked AI answers");
    expect(html).not.toContain("How often You appears");
  });

  it("third-person ('Ritz Builders') still uses 'is' / 'appears'", () => {
    // Negative pin to make sure the second-person fix didn't break
    // the existing brand path. RITZ_FULL has brandName='Ritz Builders'.
    const html = renderToStaticMarkup(<AIVisibilityHero {...RITZ_FULL} />);
    expect(html).toContain("Ritz Builders is #1 across tracked AI answers.");
    expect(html).toContain(
      "How often Ritz Builders appears across tracked AI answers",
    );
    expect(html).not.toContain("Ritz Builders are");
    expect(html).not.toContain("Ritz Builders appear ");
  });

  it("case-insensitive: 'you' (lowercase) and 'YOU' (uppercase) both pluralize", () => {
    const lower = renderToStaticMarkup(
      <AIVisibilityHero {...RITZ_FULL} brandName="you" />,
    );
    expect(lower).toContain("you are #1 across tracked AI answers.");
    const upper = renderToStaticMarkup(
      <AIVisibilityHero {...RITZ_FULL} brandName="YOU" />,
    );
    expect(upper).toContain("YOU are #1 across tracked AI answers.");
  });
});

describe("AIVisibilityHero — no sampled data honesty (audit-4)", () => {
  const NO_DATA: AIVisibilityHeroProps = {
    ...RITZ_FULL,
    brandName: "Iranopedia",
    score: null,
    rank: null,
    delta: null,
    closestChallenger: null,
    currentSampledDays: 0,
    latestReadingDate: null,
    chatgptPrimaryPct: null,
    perplexityPrimaryPct: null,
    sampleState: undefined,
    freshness: { status: "empty", label: "No data yet" },
  };

  it("with NO sampled data: states the absence, does NOT claim active tracking OR contradict a connected source", () => {
    const html = renderToStaticMarkup(<AIVisibilityHero {...NO_DATA} />);
    expect(html).toContain("No AI-answer visibility sampled for Iranopedia yet");
    expect(html).not.toContain("is being tracked across AI answers");
    // Honesty: must NOT tell the operator to connect a source — that contradicts
    // the data-sources strip when the AI-answer source is connected (citations
    // present) but visibility sampling is just empty.
    expect(html).not.toContain("Connect an AI-answer source");
    // Header subline is descriptive, not a "how often it appears" claim.
    expect(html).not.toContain("How often Iranopedia appears across tracked AI answers");
    expect(html).toContain("AI answers Beacon has sampled for Iranopedia");
  });

  it("with sampled data but no competitive rank: keeps the 'being tracked' lead", () => {
    const html = renderToStaticMarkup(
      <AIVisibilityHero
        {...RITZ_FULL}
        rank={null}
        totalRanked={1}
        closestChallenger={null}
      />,
    );
    // score + sampled days present → tracking IS happening → lead stands.
    expect(html).toContain("being tracked across AI answers");
    expect(html).not.toContain("No AI answers sampled");
  });
});
