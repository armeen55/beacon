/**
 * /prompts/[id] v2B — PromptDetailV2Client render contract.
 *
 * Pins:
 *   • layout marker `data-prompt-detail-layout="v2-prompt-brief"`
 *   • back link to /prompts?v2=1
 *   • header h1 + ONE category pill + summary + platform badges
 *   • all 5 acts with semantic h2 headings
 *   • Act 2 platform cards with state + microcopy + detail copy
 *   • Act 2 sparkline appears only when present
 *   • Act 3 competitor rows OR calm empty state
 *   • Act 4 movement rows OR calm "still gathering readings" copy
 *   • Act 5 ordered CTAs with emphasis attrs + legacy escape
 *   • no-leak invariant against internal vocabulary
 *   • not-found state from the standalone component
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PromptDetailV2Client } from "@/app/(shell)/prompts/[id]/prompt-detail-v2-client";
import { PromptDetailV2NotFound } from "@/app/(shell)/prompts/[id]/prompt-detail-v2-not-found";
import type { PromptsV2BriefProps } from "@/domains/prompts/v2-brief-projection";
import { categoryForLegacy } from "@/domains/prompts/v2-projection";

function baseProps(over: Partial<PromptsV2BriefProps> = {}): PromptsV2BriefProps {
  return {
    promptId: "p-1",
    header: {
      promptText: "What is the best builder in Atherton?",
      category: categoryForLegacy("winning"),
      summary: "Primary on Perplexity for 3 of 4 readings.",
      platformBadges: [],
    },
    whyItMatters: null,
    platforms: [],
    competitors: [],
    recentMovement: [],
    nextActions: [
      {
        kind: "keep_monitoring",
        label: "Keep monitoring",
        href: "/prompts/p-1?v2=1",
        emphasis: "primary",
      },
      {
        kind: "open_legacy_detail",
        label: "Open full record",
        href: "/prompts/p-1?legacy=1",
        emphasis: "secondary",
      },
      {
        kind: "back_to_prompts",
        label: "Back to prompts",
        href: "/prompts?v2=1",
        emphasis: "secondary",
      },
    ],
    ...over,
  };
}

function render(over: Partial<PromptsV2BriefProps> = {}): string {
  return renderToStaticMarkup(<PromptDetailV2Client {...baseProps(over)} />);
}

describe("PromptDetailV2Client — 5-act prompt brief", () => {
  it("renders the v2 layout marker and the back link to /prompts?v2=1", () => {
    const html = render();
    expect(html).toContain('data-prompt-detail-layout="v2-prompt-brief"');
    expect(html).toContain('data-prompt-detail-back="true"');
    expect(html).toContain('href="/prompts?v2=1"');
    expect(html).toContain("← Prompts");
  });

  it("header surfaces prompt text + one customer-safe category pill + summary", () => {
    const html = render();
    expect(html).toContain('data-prompt-detail-title="true"');
    expect(html).toContain("What is the best builder in Atherton?");
    expect(html).toContain('data-prompt-detail-pill="winning"');
    expect(html).toContain("Winning");
    expect(html).toContain('data-prompt-detail-summary="true"');
    expect(html).toContain("Primary on Perplexity for 3 of 4 readings.");
    // Exactly ONE category pill in the header.
    const pillMatches = html.match(/data-prompt-detail-pill="/g) ?? [];
    expect(pillMatches.length).toBe(1);
  });

  it("header renders per-platform badges when supplied", () => {
    const html = render({
      header: {
        ...baseProps().header,
        platformBadges: [
          {
            platform: "perplexity",
            label: "Perplexity",
            state: "primary",
            microcopy: "Recommended first",
          },
          {
            platform: "chatgpt",
            label: "ChatGPT",
            state: "cited",
            microcopy: "Cited",
          },
        ],
      },
    });
    expect(html).toContain('data-prompt-detail-header-platforms="true"');
    expect(html).toContain('data-prompts-v2-platform="perplexity"');
    expect(html).toContain('data-prompts-v2-platform="chatgpt"');
    expect(html).toContain("Perplexity");
    expect(html).toContain("ChatGPT");
    expect(html).toContain("Recommended first");
    expect(html).toContain("Cited");
  });

  it("renders ALL 5 acts with semantic h2 headings", () => {
    const html = render();
    for (const n of [1, 2, 3, 4, 5]) {
      expect(html, `act ${n}`).toContain(`data-prompt-detail-act="act-${n}"`);
      expect(html, `act ${n} h2 id`).toContain(
        `id="prompt-detail-act-${n}-heading"`,
      );
    }
    expect(html).toContain(">What you&#x27;re tracking</h2>");
    expect(html).toContain(">Where you stand</h2>");
    expect(html).toContain(">Other businesses AI recommends</h2>");
    expect(html).toContain(">What changed recently</h2>");
    expect(html).toContain(">What to do next</h2>");
  });

  it("Act 1 surfaces a 'why this matters' line when present", () => {
    const html = render({
      whyItMatters:
        "Buyers in Bay Area ask AI this kind of question about Whole Home Renovation.",
    });
    expect(html).toContain('data-prompt-detail-act1-why="true"');
    expect(html).toContain(
      "Buyers in Bay Area ask AI this kind of question about Whole Home Renovation",
    );
  });

  it("Act 1 falls back to a calm 'Beacon tracks every reading' line when whyItMatters is null", () => {
    const html = render({ whyItMatters: null });
    expect(html).toContain('data-prompt-detail-act1-why-empty="true"');
    expect(html).toContain(
      "Beacon tracks every AI reading this prompt gets each time you refresh your connected data",
    );
  });

  it("Act 2 renders a calm 'no platform readings yet' message when platforms is empty", () => {
    const html = render({ platforms: [] });
    expect(html).toContain('data-prompt-detail-act2-empty="true"');
    expect(html).toContain("No platform readings yet");
  });

  it("Act 2 renders per-platform cards with state + microcopy + detail copy", () => {
    const html = render({
      platforms: [
        {
          platform: "perplexity",
          label: "Perplexity",
          state: "primary",
          microcopy: "Recommended first",
          detail: "Recommended first in 3 of 4 readings.",
          sparkline: null,
        },
        {
          platform: "chatgpt",
          label: "ChatGPT",
          state: "absent",
          microcopy: "Not mentioned",
          detail: "Absent from every reading (4 checks).",
          sparkline: null,
        },
      ],
    });
    expect(html).toContain('data-prompt-detail-act2-platforms="true"');
    expect(html).toContain('data-prompt-detail-platform="perplexity"');
    expect(html).toContain('data-prompt-detail-platform-state="primary"');
    expect(html).toContain('data-prompt-detail-platform="chatgpt"');
    expect(html).toContain('data-prompt-detail-platform-state="absent"');
    expect(html).toContain("Recommended first in 3 of 4 readings");
    expect(html).toContain("Absent from every reading (4 checks)");
  });

  it("Act 2 renders sparkline only for platforms with a 2+ day series", () => {
    const html = render({
      platforms: [
        {
          platform: "perplexity",
          label: "Perplexity",
          state: "absent",
          microcopy: "Not mentioned",
          detail: "Absent from every reading (3 checks).",
          sparkline: [
            { date: "2026-05-01", count: 1 },
            { date: "2026-05-02", count: 1 },
            { date: "2026-05-03", count: 1 },
          ],
        },
        {
          platform: "chatgpt",
          label: "ChatGPT",
          state: "absent",
          microcopy: "Not mentioned",
          detail: "Absent from every reading (1 check).",
          sparkline: null,
        },
      ],
    });
    const sparkMatches =
      html.match(/data-prompt-detail-platform-sparkline="true"/g) ?? [];
    expect(sparkMatches.length).toBe(1);
    expect(html).toContain("<svg");
  });

  it("Act 3 renders the calm empty state when there are no competitors", () => {
    const html = render({ competitors: [] });
    expect(html).toContain('data-prompt-detail-act3-empty="true"');
    expect(html).toContain("No consistent competitor pattern yet");
  });

  it("Act 3 renders competitor rows with N/M + summary copy", () => {
    const html = render({
      competitors: [
        {
          name: "CRC Builders",
          appearances: 3,
          totalObservations: 4,
          summary: "Cited in 3 of 4 readings.",
        },
        {
          name: "Homestead",
          appearances: 1,
          totalObservations: 4,
          summary: "Cited in 1 of 4 readings.",
        },
      ],
    });
    expect(html).toContain('data-prompt-detail-act3-competitors="true"');
    expect(html).toContain('data-prompt-detail-competitor="CRC Builders"');
    expect(html).toContain('data-prompt-detail-competitor="Homestead"');
    expect(html).toContain("Cited in 3 of 4 readings");
  });

  it("Act 4 renders the calm 'still gathering readings' fallback when empty", () => {
    const html = render({ recentMovement: [] });
    expect(html).toContain('data-prompt-detail-act4-empty="true"');
    expect(html).toContain("Beacon is still gathering readings for this prompt");
  });

  it("Act 4 renders humanized movement rows (no raw enum names)", () => {
    const html = render({
      recentMovement: [
        {
          kind: "came_back",
          label: "Came back into the rankings",
          summary:
            "Perplexity started citing you again on 2026-05-04.",
          tone: "success",
          date: "2026-05-04",
        },
        {
          kind: "dropped",
          label: "Dropped from the rankings",
          summary: "ChatGPT stopped citing you on 2026-05-05.",
          tone: "danger",
          date: "2026-05-05",
        },
      ],
    });
    expect(html).toContain('data-prompt-detail-act4-movements="true"');
    expect(html).toContain('data-prompt-detail-movement-kind="came_back"');
    expect(html).toContain('data-prompt-detail-movement-tone="success"');
    expect(html).toContain('data-prompt-detail-movement-kind="dropped"');
    expect(html).toContain('data-prompt-detail-movement-tone="danger"');
    expect(html).toContain("Came back into the rankings");
    expect(html).toContain("Dropped from the rankings");
    // Raw enums must NOT appear.
    expect(html).not.toContain("first_appearance");
    expect(html).not.toContain("visibility_lost");
  });

  it("Act 5 renders ordered CTAs with emphasis attrs + legacy escape", () => {
    const html = render();
    expect(html).toContain('data-prompt-detail-cta="keep_monitoring"');
    expect(html).toContain('data-prompt-detail-cta-emphasis="primary"');
    expect(html).toContain('data-prompt-detail-cta="open_legacy_detail"');
    expect(html).toContain('data-prompt-detail-cta="back_to_prompts"');
    expect(html).toContain('href="/prompts/p-1?legacy=1"');
    expect(html).toContain('href="/prompts?v2=1"');
  });

  it("never leaks internal vocabulary in the rendered output", () => {
    const html = render({
      header: {
        promptText: "Best modern home builder near Atherton?",
        category: categoryForLegacy("outranked"),
        summary: "Competitors dominate this prompt across 6 readings.",
        platformBadges: [
          {
            platform: "chatgpt",
            label: "ChatGPT",
            state: "absent",
            microcopy: "Not mentioned",
          },
        ],
      },
      whyItMatters:
        "Buyers in Atherton ask AI this kind of question about Modern Build.",
      platforms: [
        {
          platform: "chatgpt",
          label: "ChatGPT",
          state: "absent",
          microcopy: "Not mentioned",
          detail: "Absent from every reading (6 checks).",
          sparkline: null,
        },
      ],
      competitors: [
        {
          name: "CRC Builders",
          appearances: 5,
          totalObservations: 6,
          summary: "Cited in 5 of 6 readings.",
        },
      ],
      recentMovement: [
        {
          kind: "mentions_slowed",
          label: "Mentions slowed down",
          summary: "ChatGPT stopped mentioning you on 2026-05-05.",
          tone: "danger",
          date: "2026-05-05",
        },
      ],
      nextActions: [
        {
          kind: "open_recommendations_queue",
          label: "See related recommendations",
          href: "/recommendations?v2=1",
          emphasis: "primary",
        },
        {
          kind: "back_to_prompts",
          label: "Back to prompts",
          href: "/prompts?v2=1",
          emphasis: "secondary",
        },
      ],
    });
    const lower = html.toLowerCase();
    const banned = [
      "z-score",
      "evidence tier",
      "evidence_tier",
      "evidence_hash",
      "resolver tier",
      "resolver_tier",
      "lifecycle",
      "decision matrix",
      "decision queue",
      "pattern brain",
      "candidate cause",
      "native observation",
      "prompt_answer_observations",
      "stablekey",
      "first_appearance",
      "visibility_regained",
      "mention_surge",
      "visibility_lost",
      "mention_decline",
    ];
    for (const term of banned) {
      expect(lower, `rendered HTML leaked '${term}'`).not.toContain(term);
    }
  });
});

describe("PromptDetailV2NotFound", () => {
  it("renders the calm not-found state with a back-to-prompts CTA", () => {
    const html = renderToStaticMarkup(<PromptDetailV2NotFound />);
    expect(html).toContain('data-prompt-detail-not-found="true"');
    expect(html).toContain("This prompt is no longer available");
    expect(html).toContain('data-prompt-detail-not-found-back="true"');
    expect(html).toContain('data-prompt-detail-not-found-cta="back-to-prompts"');
    expect(html).toContain('href="/prompts?v2=1"');
  });

  it("never leaks operator vocabulary in the not-found state", () => {
    const html = renderToStaticMarkup(<PromptDetailV2NotFound />);
    const lower = html.toLowerCase();
    expect(lower).not.toContain("z-score");
    expect(lower).not.toContain("evidence tier");
    expect(lower).not.toContain("resolver");
    expect(lower).not.toContain("decision queue");
  });
});
