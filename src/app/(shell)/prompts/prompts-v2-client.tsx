/**
 * PromptsV2Client — strategic prompt surface for /prompts?v2=1.
 *
 * Bundle (2026-05-11) — second pass at /prompts per the maximum-
 * depth UI audit (`~/.claude/plans/i-want-a-maximum-depth-curried-
 * curry.md`).
 *
 * Goal: keep the legacy 5-category framing (it's the strongest
 * piece on the page) but project it through a customer-safe
 * vocabulary layer so each prompt feels like one buyer question +
 * one strategic answer-engine state, not a categorization row.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ Header                                                  │
 *   │ Counter strip: Winning / Almost there / Missing /       │
 *   │                 Outranked / Still learning              │
 *   │                                                         │
 *   │ Section: Winning (lead line, then cards)                │
 *   │ Section: Almost there                                   │
 *   │ Section: Missing                                        │
 *   │ Section: Outranked                                      │
 *   │ Section: Still learning                                 │
 *   │                                                         │
 *   │ Footer: Open legacy view → /prompts?legacy=1            │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Pure presentation. Reuses the same `DecisionMatrix` + prompt-
 * text lookup the legacy page consumes; no new data fetches, no
 * server-action wiring.
 *
 * Customer-vocabulary contract (forbidden-vocabulary guardrail):
 *   • No "Z-score", "evidence tier", "native observation",
 *     "decision matrix", "resolver tier", or any internal name in
 *     rendered copy.
 *   • Category labels are customer-safe.
 *   • Platform labels are branded.
 *   • Empty states read as intentional, not broken.
 */
import Link from "next/link";

import { PageHeader } from "@/components/data/page-header";
import { cn } from "@/lib/utils";
import {
  computePromptsV2Counters,
  projectPromptsToSections,
  type PromptsV2Counter,
  type PromptsV2Section,
} from "@/domains/prompts/v2-projection";
import type { PromptOpportunity } from "@/domains/prompts/opportunity-classify";

import { PromptsV2Card } from "@/components/prompts/v2/prompts-v2-card";

export type PromptsV2ClientProps = {
  /** Already-classified opportunities from `buildPromptDecisionMatrix`. */
  prompts: ReadonlyArray<PromptOpportunity>;
  /** Plain-text lookup keyed by prompt id. Cards display this verbatim. */
  promptTextById: ReadonlyMap<string, string>;
};

export function PromptsV2Client({
  prompts,
  promptTextById,
}: PromptsV2ClientProps) {
  const counters = computePromptsV2Counters(prompts);
  const sections = projectPromptsToSections(prompts, promptTextById);

  const totalPrompts = prompts.length;

  return (
    <div
      className="max-w-5xl"
      data-prompts-layout="v2-strategic-surface"
    >
      <PageHeader
        title="AI questions"
        description="The questions buyers ask AI assistants about businesses like yours, and whether AI mentions you in the answer."
      />

      {totalPrompts === 0 ? (
        <PromptsV2EmptyState />
      ) : (
        <>
          <CounterStrip counters={counters} />

          <div className="space-y-5">
            {sections.map((section) => (
              <CategorySection
                key={section.category.kind}
                section={section}
              />
            ))}
          </div>
        </>
      )}

      {/* Legacy view rollback: `/prompts?legacy=1` still routes to
          the legacy decision view in `page.tsx`. The customer-facing
          footer CTA was removed on 2026-05-12 because v2 is the
          production default and the visible link made the product
          feel unfinished. The `?legacy=1` query param remains for
          rollback. */}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Counter strip
// ─────────────────────────────────────────────────────────────────────

const COUNTER_TONE: Record<PromptsV2Counter["tone"], string> = {
  success: "border-status-success/35",
  warning: "border-status-warning/35",
  danger: "border-status-danger/35",
  info: "border-accent-primary/35",
  muted: "border-border/60",
};

function CounterStrip({
  counters,
}: {
  counters: ReadonlyArray<PromptsV2Counter>;
}) {
  return (
    <section
      data-prompts-v2-counters="true"
      className="mb-6 grid grid-cols-2 md:grid-cols-5 gap-3"
      aria-label="Prompt category counters"
    >
      {counters.map((c) => (
        <div
          key={c.kind}
          data-prompts-v2-counter={c.kind}
          className={cn(
            "rounded-lg border bg-surface-base px-3 py-3",
            COUNTER_TONE[c.tone],
          )}
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {c.label}
          </p>
          <p className="mt-1 text-[20px] font-semibold tabular-nums text-foreground">
            {c.count}
          </p>
        </div>
      ))}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Category section
// ─────────────────────────────────────────────────────────────────────

function CategorySection({ section }: { section: PromptsV2Section }) {
  const { category, rows } = section;
  return (
    <section
      data-prompts-v2-section={category.kind}
      aria-labelledby={`prompts-v2-section-${category.kind}-heading`}
      className="rounded-lg border border-border/60 bg-surface-inset/20 px-4 py-4"
    >
      <header className="mb-3">
        <h2
          id={`prompts-v2-section-${category.kind}-heading`}
          className="text-[14px] font-semibold tracking-tight text-foreground"
          data-prompts-v2-section-heading={category.kind}
        >
          {category.label}{" "}
          <span className="text-muted-foreground font-normal tabular-nums">
            · {rows.length}
          </span>
        </h2>
        <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
          {category.lead}
        </p>
      </header>

      {rows.length === 0 ? (
        <p
          className="text-[12.5px] text-muted-foreground italic"
          data-prompts-v2-section-empty="true"
        >
          No prompts in this group right now.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.promptId}>
              <PromptsV2Card row={row} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────

function PromptsV2EmptyState() {
  return (
    <section
      className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-8 text-center"
      role="status"
      data-prompts-v2-empty="true"
    >
      <p className="text-[14px] font-semibold text-foreground">
        You haven&rsquo;t added any questions yet.
      </p>
      <p className="mt-1.5 text-[12px] text-muted-foreground leading-relaxed max-w-md mx-auto">
        Add the questions your buyers ask, and we&rsquo;ll start tracking how
        AI answers them. Results will appear here soon after.
      </p>
      <Link
        href="/settings/prompts"
        className="mt-4 inline-flex text-[12px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
        data-prompts-v2-empty-cta="manage"
      >
        Add your questions →
      </Link>
    </section>
  );
}
