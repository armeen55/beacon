import { PageHeader } from "@/components/data/page-header";
import Link from "next/link";

export default function MethodologyPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="How Beacon works"
        description="Reference guide to Beacon's methodology, metrics, and evidence boundaries. Use this page to understand — or defend — any number Beacon shows you."
      />

      {/* ── Section 1: How Beacon works ── */}
      <section id="overview" className="mb-12">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Beacon imports visibility observations from external tools (like Profound), crawls your
          public site HTML, and compares the two over time. From those inputs it computes four things:
        </p>
        <ol className="mt-3 space-y-2 text-sm text-muted-foreground leading-relaxed list-decimal pl-5">
          <li>
            <span className="font-medium text-foreground">Findings</span> — what changed on your
            site between consecutive crawls (title, meta, schema, FAQs, content, links).
          </li>
          <li>
            <span className="font-medium text-foreground">Attribution</span> — which site changes
            correlate with visibility shifts, based on timing, topic overlap, URL alignment, and
            platform. This is correlation, not causation — no A/B test or holdout exists.
          </li>
          <li>
            <span className="font-medium text-foreground">Market position</span> — your citation
            share within the imported observation sample, compared to configured competitors. This is
            share-of-sample, not share-of-market.
          </li>
          <li>
            <span className="font-medium text-foreground">Recommendations</span> — the
            highest-leverage next step based on available evidence. A prioritized suggestion, not a
            guarantee of outcomes.
          </li>
        </ol>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          Every metric in Beacon is bounded by the imported sample. When sample size is small,
          coverage is partial, or data is stale, Beacon tells you — through freshness strips,
          coverage tone indicators, and sample quality labels.
        </p>
      </section>

      {/* ── Section 2: What the metrics mean ── */}
      <section id="metrics" className="mb-12">
        <SectionHeading>What the metrics mean</SectionHeading>

        <MetricBlock id="citation-share" title="Citation Share">
          <p>
            &ldquo;Your Citation Share&rdquo; is the percentage of citations that mention your domain
            out of all citations in the imported observation set. The denominator is always shown
            (&ldquo;of N observations&rdquo;). It is <em>directional</em> — a useful indicator of
            relative position within your tracked sample, not a census of all AI-generated answers.
          </p>
        </MetricBlock>

        <MetricBlock id="sample-quality" title="Sample quality">
          <p>
            Beacon classifies your observation count into three tiers:
          </p>
          <ul className="mt-1.5 list-disc pl-5 space-y-1">
            <li>
              <span className="font-medium text-foreground">Limited</span> (&lt;200 observations) —
              percentages are volatile; treat as an early signal.
            </li>
            <li>
              <span className="font-medium text-foreground">Moderate</span> (200–1,000) — trend data
              is directional.
            </li>
            <li>
              <span className="font-medium text-foreground">Strong</span> (&gt;1,000) — directional
              comparisons are meaningful.
            </li>
          </ul>
          <p className="mt-1.5">
            These thresholds are heuristic, not statistically derived. Beacon has no margin-of-error
            model.
          </p>
        </MetricBlock>

        <MetricBlock id="strongest-correlate" title="&ldquo;Strongest correlate&rdquo;">
          <p>
            When Beacon labels a change as the &ldquo;Strongest correlate&rdquo; for a visibility
            shift, it means the change scored ≥70/100 on a composite of timing, topic, URL, platform,
            and geo alignment. It does <em>not</em> mean the change caused the shift. Other factors —
            algorithm updates, competitor actions, seasonal demand — could be responsible.
          </p>
        </MetricBlock>

        <MetricBlock id="evidence-quality" title="Evidence quality labels">
          <p>
            Recommendation confidence uses evidence-quality framing, not outcome certainty:
          </p>
          <ul className="mt-1.5 list-disc pl-5 space-y-1">
            <li>
              <span className="font-medium text-foreground">Strong evidence</span> — input signals
              are solid (multiple matches, high evidence tier).
            </li>
            <li>
              <span className="font-medium text-foreground">Moderate evidence</span> — supporting
              signal exists but is not conclusive.
            </li>
            <li>
              <span className="font-medium text-foreground">Early signal</span> — limited data;
              treat as directional.
            </li>
          </ul>
          <p className="mt-1.5">
            &ldquo;Strong evidence&rdquo; means the inputs are strong — not that the recommended
            action will definitely work.
          </p>
        </MetricBlock>

        <MetricBlock id="verdicts" title="Change verdicts">
          <p>
            Each change in your changelog receives a verdict based on attribution evidence:
          </p>
          <ul className="mt-1.5 list-disc pl-5 space-y-1">
            <li>
              <span className="font-medium text-foreground">Validated</span> — operator-confirmed or
              strong multi-event evidence. Does not mean proven ROI.
            </li>
            <li>
              <span className="font-medium text-foreground">Partial</span> — some positive signal,
              not conclusive.
            </li>
            <li>
              <span className="font-medium text-foreground">Inconclusive</span> — not enough evidence
              to determine impact.
            </li>
            <li>
              <span className="font-medium text-foreground">Too early</span> — change is recent; still
              building signal.
            </li>
            <li>
              <span className="font-medium text-foreground">No impact</span> — no positive outcome
              events detected within the attribution window.
            </li>
            <li>
              <span className="font-medium text-foreground">Negative</span> — visibility declined in
              the same observation window.
            </li>
          </ul>
        </MetricBlock>
      </section>

      {/* ── Section 3: What Beacon knows vs doesn't know ── */}
      <section id="boundaries" className="mb-12">
        <SectionHeading>What Beacon knows vs. doesn&rsquo;t know</SectionHeading>

        <div className="grid gap-6 sm:grid-cols-2">
          <BoundaryCard
            title="Observed signals"
            items={[
              "HTML content of your pages at each crawl",
              "Citation frequency per domain in the imported sample",
              "Timing and topic overlap between changes and visibility shifts",
              "Competitor citation frequency within the same sample",
              "Data freshness and sample size",
            ]}
          />
          <BoundaryCard
            title="Inferred relationships"
            items={[
              "Attribution scores link changes to outcomes by multi-factor correlation",
              "Pattern matching connects validated changes to structural playbooks",
              "Replication targets are flagged by structural and topic similarity",
              "Recommendations combine evidence strength, pattern fit, and priority scoring",
            ]}
          />
          <BoundaryCard
            variant="muted"
            title="What Beacon does not know"
            items={[
              "Whether a change caused a visibility shift (correlation only)",
              "Your actual market share across all AI queries",
              "Whether AI platforms have indexed your latest changes",
              "What AI models will say in future responses",
              "The business revenue impact of any change",
              "How representative your prompt sample is of real demand",
              "Whether a recommendation will produce the expected outcome",
            ]}
          />
        </div>
      </section>

      {/* ── Section 4: How to interpret recommendations ── */}
      <section id="recommendations" className="mb-12">
        <SectionHeading>How to interpret recommendations</SectionHeading>

        <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
          <p>
            Beacon surfaces the highest-leverage next step based on available evidence. The priority
            score blends impact confidence, evidence strength, pattern strength, replication
            potential, urgency, and recency into a composite. This score reflects input quality — not
            outcome certainty.
          </p>
          <div className="rounded-lg border border-border/50 bg-surface-inset/15 px-4 py-3 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80">Key principles</p>
            <ul className="list-disc pl-5 space-y-1 text-[12px]">
              <li>
                <span className="font-medium text-foreground">Evidence ≠ guarantee.</span>{" "}
                &ldquo;Strong evidence&rdquo; means the supporting data is solid. It does not promise
                the action will improve visibility.
              </li>
              <li>
                <span className="font-medium text-foreground">Patterns ≠ predictions.</span> A pattern
                that worked on one page may not work on another. Context, competition, and timing
                differ.
              </li>
              <li>
                <span className="font-medium text-foreground">Operator judgment required.</span> Beacon
                prioritizes based on data. You decide based on business context, feasibility, and
                strategic fit.
              </li>
              <li>
                <span className="font-medium text-foreground">Outcomes are not guaranteed.</span>{" "}
                AI visibility is probabilistic. The same prompt can produce different answers on
                different days.
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── Section 5: FAQ ── */}
      <section id="faq" className="mb-12">
        <SectionHeading>Frequently asked questions</SectionHeading>
        <div className="space-y-1">
          <FaqEntry
            question="How do you know this change caused anything?"
            answer="Beacon does not know that. It identifies the strongest correlate — the best-fit match between a site change and a visibility shift based on timing, topic overlap, URL alignment, and platform. This is correlation, not causation. No A/B test or holdout exists. The operator can manually confirm a link in Review, which is the strongest trust signal — but is still a correlational judgment."
          />
          <FaqEntry
            question="Is &ldquo;Citation Share&rdquo; my actual market share?"
            answer="No. Citation Share is your share within Beacon's imported observation sample. No AI visibility tool can measure total market share because no one has access to all AI queries. The denominator (observation count) is always shown. The scope line reads: &ldquo;Directional — based on your tracked prompt sample, not a market census.&rdquo;"
          />
          <FaqEntry
            question="Why is Beacon recommending this if it cannot guarantee outcomes?"
            answer="Beacon recommends the highest-leverage next step based on available evidence — not a guaranteed outcome. &ldquo;Strong evidence&rdquo; means the input signals are solid, not that the result is certain. The priority score blends impact confidence, evidence strength, and pattern fit. It is a prioritized suggestion, not a guarantee."
          />
          <FaqEntry
            question="What does &ldquo;sample quality: limited&rdquo; mean?"
            answer="It means your observation count is below 200. At this level, percentages are volatile and competitive rankings are unreliable. Treat everything as a directional early signal, not a firm measurement. Import more data to move from limited to moderate or strong."
          />
          <FaqEntry
            question="What does &ldquo;Strongest correlate&rdquo; actually mean?"
            answer="It means this change is the best-fit match for this visibility shift based on timing, topic overlap, URL alignment, and platform — scoring ≥70 out of 100. It does not mean Beacon proved causation. Other unmeasured factors could be the actual cause."
          />
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border/40 pt-6 pb-4 text-[11px] text-muted-foreground space-y-2">
        <p>
          This page summarizes Beacon&rsquo;s methodology for the operator who needs to understand or
          defend a number. For daily workflow, see{" "}
          <Link href="/" className="text-accent-primary hover:underline">Today</Link>.
          For raw imported data, see{" "}
          <Link href="/settings/history" className="text-accent-primary hover:underline">Settings → Data</Link>.
        </p>
        <p>
          Beacon identifies the strongest correlates, not proven causes — no A/B test or holdout
          exists. All percentages are share-of-sample, not share-of-market. Recommendations are
          prioritized suggestions; outcomes are not guaranteed.
        </p>
      </footer>
    </div>
  );
}

/* ─── Local helper components (page-scoped, no separate file needed) ─── */

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[15px] font-semibold tracking-tight text-foreground mb-4">
      {children}
    </h3>
  );
}

function MetricBlock({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="mb-6 scroll-mt-20">
      <h4 className="text-[13px] font-semibold text-foreground mb-1">{title}</h4>
      <div className="text-sm text-muted-foreground leading-relaxed">{children}</div>
    </div>
  );
}

function BoundaryCard({
  title,
  items,
  variant = "default",
}: {
  title: string;
  items: string[];
  variant?: "default" | "muted";
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        variant === "muted"
          ? "border-status-warning/30 bg-status-warning/[0.04] sm:col-span-2"
          : "border-border/50 bg-surface-inset/15"
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80 mb-2">{title}</p>
      <ul className="list-disc pl-4 space-y-1 text-[12px] text-muted-foreground leading-relaxed">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function FaqEntry({ question, answer }: { question: string; answer: string }) {
  return (
    <details className="group rounded-lg border border-border/50 bg-surface-inset/15 text-[12px]">
      <summary className="cursor-pointer list-none px-4 py-3 font-medium text-foreground hover:bg-surface-inset/30 [&::-webkit-details-marker]:hidden">
        {question}
      </summary>
      <div className="border-t border-border/40 px-4 py-3 text-muted-foreground leading-relaxed">
        {answer}
      </div>
    </details>
  );
}
