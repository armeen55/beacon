/**
 * Self-check diagnostics surface (BEACON_500 R22b, 2026-07-03).
 *
 * The eval / regression safety net, made visible to the operator in one place:
 * how Beacon scores itself against its own known-good cases (the benchmark),
 * which signals actually carry the correct decisions (the ablation), whether the
 * current logic still reproduces every recorded decision (the replay), and
 * whether the model fallback plan is sound and loud (the fallback benchmark).
 *
 * Operator-only. Read-only. Everything on this page is computed by PURE modules
 * (no I/O, no LLM, no spend), so the page is a deterministic snapshot of Beacon's
 * self-assessment. Diagnostics-only by design: the honest "I checked myself"
 * line lives here, never on a primary customer surface.
 */

import { notFound } from "next/navigation";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { PageHeader } from "@/components/data/page-header";
import { runBenchmark, benchmarkOperatorLine } from "@/domains/eval/benchmark";
import { runAblation } from "@/domains/eval/ablation";
import { replayGoldBaseline } from "@/domains/eval/replay";
import { runModelFallbackBenchmark } from "@/domains/eval/model-fallback";
import { NO_BLIND_HOLDOUT_LINE } from "@/domains/eval/blind-holdout-contract";

export const dynamic = "force-dynamic";

function isOperator(): boolean {
  return isOperatorModeServer() || process.env.NODE_ENV === "test";
}

export default async function SelfCheckPage() {
  if (!isOperator()) notFound();

  const benchmark = runBenchmark();
  const ablation = runAblation();
  const replay = replayGoldBaseline();
  const fallback = runModelFallbackBenchmark();

  return (
    <div className="space-y-8 p-6">
      <PageHeader
        title="How I check myself"
        description="Known-case regression checks catch backsliding. They do not prove I can judge a new opportunity I have never seen."
      />

      {/* The honest headline line - diagnostics-only, Beacon voice. */}
      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <p className="text-sub font-medium" data-diagnostic="self-check-benchmark-line">
          {benchmarkOperatorLine(benchmark)}
        </p>
        {benchmark.misses.length > 0 && (
          <ul className="mt-2 space-y-1 text-meta text-muted-foreground">
            {benchmark.misses.map((m) => (
              <li key={`${m.case}-${m.axis}`}>
                {m.case}: I expected {m.expected} for {m.axis} but got {m.got}.
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <h2 className="text-section font-semibold">Fresh blind validation</h2>
        <p className="mt-2 text-body text-muted-foreground" data-diagnostic="self-check-blind-holdout-line">
          {NO_BLIND_HOLDOUT_LINE}
        </p>
      </section>

      {/* Replay: did I change any settled decision? */}
      <section className="space-y-2">
        <h2 className="text-section font-semibold">Did I change any past call?</h2>
        <p className="text-body text-muted-foreground" data-diagnostic="self-check-replay-line">
          {replay.divergences.length === 0
            ? `I re-ran my current logic over ${replay.total} decisions I made before and reproduced every one of them.`
            : `I re-ran ${replay.total} past decisions and ${replay.divergences.length} of them would come out differently now. Worth a look before I ship new logic.`}
        </p>
        {replay.divergences.length > 0 && (
          <ul className="space-y-1 text-meta text-muted-foreground">
            {replay.divergences.map((d) => (
              <li key={d.case}>
                {d.case}: was {d.priorAction}, now {d.currentAction}.
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Ablation: which signals actually carry the decisions? */}
      <section className="space-y-2">
        <h2 className="text-section font-semibold">Which signals are pulling their weight?</h2>
        <p className="text-body text-muted-foreground">
          I get {ablation.baselineCorrect} of {ablation.casesTotal} known-good cases right with everything on. Here is
          how many I would get wrong if I lost each signal.
        </p>
        <ul className="space-y-1 text-body">
          {ablation.contributions.map((c) => (
            <li key={c.signal} data-diagnostic={`self-check-ablation-${c.signal}`}>
              {c.sentence}
            </li>
          ))}
        </ul>
      </section>

      {/* Model fallback plan health. */}
      <section className="space-y-2">
        <h2 className="text-section font-semibold">Is my model fallback plan sound?</h2>
        <p className="text-body text-muted-foreground" data-diagnostic="self-check-fallback-line">
          {fallback.sentence}
        </p>
        {fallback.chainIssues.length > 0 && (
          <ul className="space-y-1 text-meta text-muted-foreground">
            {fallback.chainIssues.map((i, idx) => (
              <li key={idx}>
                {i.rungModel ? `${i.rungModel}: ` : ""}
                {i.problem}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
