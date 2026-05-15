/**
 * Section 6 C5 — Prompts detail v2 per-platform primary-share render
 * contract.
 *
 * Pins the customer-visible Act 2 sub-line behavior:
 *   • `claimable` → renders "Primary recommendation: N of M readings
 *                    in the last 14 days (P%)" verbatim (count and
 *                    percent come from the prop, not from sparkline
 *                    or any other client-side computation).
 *   • `claimable` with count=0 → renders the same template with
 *     "0 of M readings ... (0%)" (sub-line visible, not hidden).
 *   • `still_learning` → renders "Primary recommendation: still
 *                        gathering readings".
 *   • `null` → sub-line entirely absent from rendered HTML.
 *   • Mixed platforms (one claimable, one still_learning) → both
 *     sub-lines render with their respective copy.
 *
 * Customer-vocabulary defense:
 *   • No causal tokens (drove / caused / generated)
 *   • No revenue tokens ($ / revenue / dollars)
 *   • No Mode A / Mode B / Mode C language
 *   • No internal enum string leakage in rendered HTML
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PromptDetailV2Client } from "@/app/(shell)/prompts/[id]/prompt-detail-v2-client";
import type { PromptDetailV2ClientProps } from "@/app/(shell)/prompts/[id]/prompt-detail-v2-client";
import type {
  PromptsV2BriefPlatform,
  PromptsV2BriefProps,
} from "@/domains/prompts/v2-brief-projection";
import { categoryForLegacy } from "@/domains/prompts/v2-projection";
import type {
  PromptPrimaryShare,
  PromptPrimaryShareCard,
} from "@/domains/daily-metric-snapshots/prompt-primary-share";

// ─────────────────────────────────────────────────────────────────────
// Fixture helpers — mirrors `tests/app/prompts/prompt-detail-v2-client.test.tsx`
// pattern but accepts a `promptPrimary` override so each case can pin
// a different per-platform share shape.
// ─────────────────────────────────────────────────────────────────────

function platform(
  over: Partial<PromptsV2BriefPlatform> = {},
): PromptsV2BriefPlatform {
  return {
    platform: "perplexity",
    label: "Perplexity",
    state: "primary",
    microcopy: "Recommended first",
    detail: "Cited in 3 of 4 readings",
    sparkline: null,
    ...over,
  };
}

function baseBriefProps(
  over: Partial<PromptsV2BriefProps> = {},
): PromptsV2BriefProps {
  return {
    promptId: "p-1",
    header: {
      promptText: "What is the best builder in Atherton?",
      category: categoryForLegacy("winning"),
      summary: "Primary on Perplexity for 3 of 4 readings.",
      platformBadges: [],
    },
    whyItMatters: null,
    platforms: [platform()],
    competitors: [],
    recentMovement: [],
    nextActions: [
      {
        kind: "keep_monitoring",
        label: "Keep monitoring",
        href: "/prompts/p-1?v2=1",
        emphasis: "primary",
      },
    ],
    ...over,
  };
}

function render(over: Partial<PromptDetailV2ClientProps> = {}): string {
  const briefProps = baseBriefProps(over);
  const props: PromptDetailV2ClientProps = {
    ...briefProps,
    ...over,
  } as PromptDetailV2ClientProps;
  return renderToStaticMarkup(<PromptDetailV2Client {...props} />);
}

const CLAIMABLE_43_14: PromptPrimaryShareCard = {
  count: 6,
  total: 14,
  pct: 43,
  sample_status: "claimable",
};
const CLAIMABLE_0_14: PromptPrimaryShareCard = {
  count: 0,
  total: 14,
  pct: 0,
  sample_status: "claimable",
};
const STILL_LEARNING_3_5: PromptPrimaryShareCard = {
  count: 3,
  total: 5,
  pct: 60,
  sample_status: "still_learning",
};

const FORBIDDEN_TOKENS = [
  "drove",
  "caused",
  "generated",
  "$",
  "revenue",
  "dollars",
  "Mode A",
  "Mode B",
  "Mode C",
  // Internal enum strings the sub-line must NEVER leak verbatim:
  "claimable",
  "still_learning",
  "primary_recommendation_count",
  "total_possible",
  "scope_type",
];

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe("Prompt detail v2 — per-platform primary-share sub-line (Section 6 C5)", () => {
  it("claimable card renders 'Primary recommendation: 6 of 14 readings in the last 14 days (43%)'", () => {
    const html = render({
      platforms: [platform({ platform: "perplexity" })],
      promptPrimary: {
        chatgpt: null,
        perplexity: CLAIMABLE_43_14,
      },
    });
    expect(html).toContain(
      "Primary recommendation: 6 of 14 readings in the last 14 days (43%)",
    );
    expect(html).toContain(
      'data-prompt-detail-v2-primary-share-card="perplexity"',
    );
    expect(html).toContain(
      'data-prompt-detail-v2-primary-share-status="claimable"',
    );
  });

  it("count=0 claimable card renders 0 of M readings (0%) — sub-line VISIBLE not hidden", () => {
    const html = render({
      platforms: [platform({ platform: "perplexity" })],
      promptPrimary: {
        chatgpt: null,
        perplexity: CLAIMABLE_0_14,
      },
    });
    expect(html).toContain(
      "Primary recommendation: 0 of 14 readings in the last 14 days (0%)",
    );
  });

  it("still_learning card renders 'Primary recommendation: still gathering readings'", () => {
    const html = render({
      platforms: [platform({ platform: "perplexity" })],
      promptPrimary: {
        chatgpt: null,
        perplexity: STILL_LEARNING_3_5,
      },
    });
    expect(html).toContain(
      "Primary recommendation: still gathering readings",
    );
    expect(html).toContain(
      'data-prompt-detail-v2-primary-share-status="still_learning"',
    );
    // The numeric template MUST NOT render when status is still_learning.
    expect(html).not.toContain(
      "Primary recommendation: 3 of 5 readings",
    );
  });

  it("null card hides the sub-line entirely (no data-attr, no copy)", () => {
    const html = render({
      platforms: [platform({ platform: "perplexity" })],
      promptPrimary: {
        chatgpt: null,
        perplexity: null,
      },
    });
    expect(html).not.toContain("data-prompt-detail-v2-primary-share-card");
    expect(html).not.toContain("Primary recommendation:");
  });

  it("renders one claimable card and one still_learning card when both platforms supplied", () => {
    const html = render({
      platforms: [
        platform({ platform: "perplexity" }),
        platform({ platform: "chatgpt", label: "ChatGPT" }),
      ],
      promptPrimary: {
        chatgpt: STILL_LEARNING_3_5,
        perplexity: CLAIMABLE_43_14,
      },
    });
    // Perplexity card claimable, ChatGPT card still_learning.
    expect(html).toContain(
      'data-prompt-detail-v2-primary-share-card="perplexity"',
    );
    expect(html).toContain(
      'data-prompt-detail-v2-primary-share-card="chatgpt"',
    );
    expect(html).toContain(
      "Primary recommendation: 6 of 14 readings in the last 14 days (43%)",
    );
    expect(html).toContain(
      "Primary recommendation: still gathering readings",
    );
  });

  it("default (no promptPrimary prop) hides every sub-line — preserves legacy test compat", () => {
    const html = render({
      platforms: [platform({ platform: "perplexity" })],
      // intentionally omit promptPrimary
    });
    expect(html).not.toContain("data-prompt-detail-v2-primary-share-card");
    expect(html).not.toContain("Primary recommendation:");
  });
});

describe("Prompt detail v2 primary-share — customer-vocab guardrail", () => {
  it("does not leak forbidden tokens (causal / revenue / Mode / internal enum) across all states", () => {
    const fixtures: Array<{ name: string; primary: PromptPrimaryShare }> = [
      { name: "claimable", primary: { chatgpt: null, perplexity: CLAIMABLE_43_14 } },
      { name: "claimable-zero", primary: { chatgpt: null, perplexity: CLAIMABLE_0_14 } },
      { name: "still_learning", primary: { chatgpt: null, perplexity: STILL_LEARNING_3_5 } },
      { name: "mixed", primary: { chatgpt: STILL_LEARNING_3_5, perplexity: CLAIMABLE_43_14 } },
    ];
    for (const f of fixtures) {
      const html = render({
        platforms: [
          platform({ platform: "perplexity" }),
          platform({ platform: "chatgpt", label: "ChatGPT" }),
        ],
        promptPrimary: f.primary,
      });
      // Strip data-attribute values so we only scan visible copy.
      const visibleOnly = html.replace(/data-[a-z0-9-]+="[^"]*"/g, "");
      for (const token of FORBIDDEN_TOKENS) {
        expect(
          visibleOnly,
          `${f.name}: forbidden token '${token}' leaked into rendered HTML`,
        ).not.toContain(token);
      }
    }
  });
});
