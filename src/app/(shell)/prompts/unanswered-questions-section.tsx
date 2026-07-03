import "server-only";

import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { Pill } from "@/components/ui/pill";
import { currentTenantId } from "@/lib/tenant-context";
import { loadWithDeadline } from "@/lib/load-with-deadline";
import {
  describeQuestionSources,
  uncoveredQuestions,
  type UniverseQuestionRow,
} from "@/domains/research/question-universe";
import { loadQuestionUniverseForTenant } from "@/domains/research/question-universe-loader";

/**
 * UnansweredQuestionsSection (BEACON_500 R11 / N30, 2026-07-03) - "Questions
 * people ask that no one answers well", folded into /prompts. Reads the
 * nightly-built demand-ranked question universe (question-universe-loader.ts)
 * and shows the top 5 questions with real demand behind them that none of the
 * tenant's pages answers yet. Each row names its evidence in plain words
 * ("shown on Google 340 times in the last 90 days; AI engines expand into
 * this") - never a raw source key.
 *
 * SELF-HIDING: renders nothing when the universe has not been built yet, when
 * every question is already answered, or when the read misses the render
 * deadline - /prompts never shows an empty chrome block for this.
 */

const MAX_QUESTIONS_SHOWN = 5;

export async function UnansweredQuestionsSection() {
  const tenantId = await currentTenantId().catch(() => "");
  if (!tenantId) return null;
  const raced = await loadWithDeadline(
    loadQuestionUniverseForTenant(tenantId).catch((): UniverseQuestionRow[] => []),
  );
  if (raced.timedOut) return null; // self-hiding on a slow cold read too
  const rows = raced.data ?? [];
  const top = uncoveredQuestions(rows, MAX_QUESTIONS_SHOWN).filter((r) => r.demandScore > 0);
  if (top.length === 0) return null; // self-hiding, no empty chrome

  return (
    <section aria-labelledby="unanswered-questions-heading" className="space-y-3">
      <SectionHeader
        title="Questions people ask that no one answers well"
        sub="Real questions with demand behind them that none of your pages answers yet. I rebuild this list every night from your Google queries, AI question expansions, People also ask, and your tracked questions."
      />
      <div className="grid gap-3">
        {top.map((r) => (
          <Card key={r.id} padding="md">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="text-[15px] font-semibold text-foreground">{r.question}</span>
              <Pill intent={r.coverageStatus === "partial" ? "neutral" : "attention"}>
                {r.coverageStatus === "partial" ? "Mentioned, not answered" : "No answer yet"}
              </Pill>
            </div>
            <p className="mt-1.5 text-[12px] text-muted-foreground">{describeQuestionSources(r)}.</p>
            {r.ownership ? (
              <p className="mt-1 text-[12px] text-muted-foreground">
                {r.coverageDetail ?? ""} Best home for the answer: {r.ownership}
              </p>
            ) : (
              <p className="mt-1 text-[12px] text-muted-foreground">No page of yours owns this question yet.</p>
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}
