/** bundle-detail - THE TWO-LAYER CHANGE DETAIL, lifted out of the route file so `/changes/[id]/page.tsx` is
 *  only the loader and its honest end states. Layer 1 decides (the recommendation, the exact edits with the
 *  press that takes them, why this is the smartest move, what was checked); layer 2 proves, behind one
 *  expander. Nothing here reads the database: the route hands it the row it already resolved. */
import Link from "next/link";
import { causeLabel, componentIdOf, dangerousComponents } from "@/domains/decision";
import type { ChangeProposal, ChangeBundle, BundleComponent, BundleEvidenceItem } from "@/domains/decision";
import { monthDayLabel } from "@/components/data/receipt-line";
import { CopyButton, MarkImplemented, SetAsideChange } from "../change-controls";

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[14px] font-semibold text-foreground">{children}</h2>;
}

const EVIDENCE_GROUP: Record<BundleEvidenceItem["kind"], string> = {
  gsc_demand: "What people search on Google",
  keyword: "How much demand there is",
  serp: "What Google shows today",
  diagnosis: "Why this looks like the problem",
  ai_observation: "What AI assistants answer",
  winning_page: "Pages winning this today",
  page_extract: "What your page says now",
  competitor: "Other sites in this answer",
  internal_link: "Links across your own site",
};
const EVIDENCE_ORDER = Object.keys(EVIDENCE_GROUP) as BundleEvidenceItem["kind"][];

function seenLabel(observedAt: string | null): string {
  const day = monthDayLabel(observedAt);
  return day ? ` (checked ${day})` : "";
}

/** One shape for asking whether this page has already said this. The reading date a receipt line carries is not
 *  part of the sentence, so "163 clicks lost in 4 weeks" and "163 clicks lost in 4 weeks (checked August 9)"
 *  are one fact, said once. */
const normFact = (s: string): string =>
  s.trim().toLowerCase().replace(/\s*\(checked [^)]*\)\s*$/, "").replace(/\s+/g, " ").replace(/[.,;:]+$/, "");

/** WHAT THIS PAGE HAS NOT SAID YET, in the order the page says it. Blank strings never become a bullet: a
 *  receipt line that came through empty printed a bare dot with nothing beside it. */
function fresh(seen: Set<string>, items: (string | undefined | null)[]): string[] {
  const out: string[] = [];
  for (const raw of items) {
    const t = (raw ?? "").trim();
    if (!t) continue;
    const k = normFact(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function Bullets({ items }: { items: (string | undefined | null)[] }) {
  const shown = items.map((t) => (t ?? "").trim()).filter(Boolean);
  if (shown.length === 0) return null;
  return (
    <ul className="list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-muted-foreground">
      {shown.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}

/** Slice 7: the two-layer bundle detail. Layer 1 decides, layer 2 proves.
 *  Slice 8: the same two layers render a new-page bundle. Nothing forks: the
 *  page-does-not-exist truth is stated once and every component is a pure
 *  insertion, so the before/after framing simply drops away. */
export function BundleDetail({ proposal, bundle, recorded }: { proposal: ChangeProposal; bundle: ChangeBundle; recorded: Set<string> }) {
  const facts = new Map(bundle.receipt.items.map((i) => [i.key, i]));
  const chips = [...bundle.scope.queries, ...bundle.scope.prompts];
  const isNew = proposal.kind === "new_page";
  // ONE SENTENCE, ONCE ON THE PAGE. The same fact reached the screen three times over ("What this is based on",
  // "Why this is the smartest move", "What was checked"), which reads as padding rather than proof. Claimed in
  // render order, first occurrence wins, and a section left with nothing to say does not print its heading.
  const seen = new Set<string>();
  fresh(seen, [bundle.objective, proposal.whyItMatters]); // the head of the page says these first, so nothing repeats them
  const cited = bundle.components.map((c) => fresh(seen, c.evidenceKeys.map((k) => facts.get(k)?.fact)));
  const reasons = fresh(seen, bundle.confidenceReasons);
  const checked = EVIDENCE_ORDER
    // THE DATE IS NOT THE FACT. A receipt line that came through with nothing written on it still carried its
    // reading date, so it printed a bullet saying "(checked Aug 10)" and nothing else.
    .map((kind) => ({ kind, items: fresh(seen, bundle.receipt.items
      .filter((i) => i.kind === kind && i.fact.trim().length > 0).map((i) => `${i.fact}${seenLabel(i.observedAt)}`)) }))
    .filter((g) => g.items.length > 0);
  const missing = fresh(seen, bundle.receipt.missing);
  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/changes" className="inline-flex text-[13px] text-muted-foreground hover:text-foreground">
        Back to Changes
      </Link>

      <section className="space-y-2 rounded-2xl border border-accent-primary/40 bg-surface-raised p-5">
        <h1 className="text-[14px] font-semibold text-foreground">The recommendation</h1>
        <p className="text-[15px] font-semibold leading-relaxed text-foreground">{bundle.objective}</p>
        <p className="text-[13px] text-muted-foreground">
          {isNew ? "A new page for" : "On this page"}: {proposal.pageLabel}
        </p>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{proposal.whyItMatters}</p>
      </section>

      <section className="space-y-3">
        <Heading>{isNew ? "The pieces to paste" : "The exact edits"}</Heading>
        {isNew ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground">This page does not exist yet.</p>
        ) : null}
        {bundle.components.map((c, i) => (
          <ComponentCard key={i} component={c} cited={cited[i] ?? []} isNew={isNew} />
        ))}
      </section>

      {reasons.length > 0 || chips.length > 0 ? (
      <section className="space-y-2 rounded-2xl border border-border bg-surface-raised p-5">
        <Heading>Why this is the smartest move</Heading>
        <Bullets items={reasons} />
        {chips.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {chips.map((c, i) => (
              <span key={i} className="rounded-md bg-surface-inset px-2 py-1 text-[12px] text-muted-foreground">
                {c}
              </span>
            ))}
          </div>
        ) : null}
      </section>
      ) : null}

      {checked.length > 0 || missing.length > 0 ? (
      <section className="space-y-3 rounded-2xl border border-border bg-surface-raised p-5">
        <Heading>What was checked</Heading>
        {checked.map((g) => (
          <div key={g.kind} className="space-y-1">
            <p className="text-[12px] font-semibold text-foreground">{EVIDENCE_GROUP[g.kind]}</p>
            <Bullets items={g.items} />
          </div>
        ))}
        {missing.length > 0 ? (
          <div className="space-y-1 border-t border-border pt-3">
            <p className="text-[12px] font-semibold text-foreground">What could not be checked yet</p>
            <Bullets items={missing} />
          </div>
        ) : null}
      </section>
      ) : null}

      {bundle.alternatives.length > 0 ? (
        <section className="space-y-2 rounded-2xl border border-border bg-surface-raised p-5">
          <Heading>What else was considered</Heading>
          <Bullets items={bundle.alternatives.map((a) => `${a.option}: ${a.reason}`)} />
        </section>
      ) : null}

      <Investigation proposal={proposal} seen={seen} />

      {bundle.risks.length > 0 ? (
        <section className="space-y-2 rounded-2xl border border-border bg-surface-raised p-5">
          <Heading>Risks</Heading>
          <Bullets items={bundle.risks} />
        </section>
      ) : null}

      <section className="space-y-2 rounded-2xl border border-border bg-surface-raised p-5">
        <Heading>How it gets measured</Heading>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{bundle.measurementPlan}</p>
        <p className="text-[13px] text-muted-foreground">Watching: {bundle.metric}</p>
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-surface-raised p-5">
        <MarkImplemented
          proposalId={proposal.id}
          label={isNew ? "Mark done" : "Mark done"}
          newPage={isNew}
          components={bundle.components.map((c, i) => ({ id: componentIdOf(c, i), kind: c.kind, label: c.label,
            moves: dangerousComponents([c]).length > 0, recorded: recorded.has(componentIdOf(c, i)) }))}
        />
        <p className="text-[12px] text-muted-foreground">
          After you make it, the page is checked and the measurement starts from what is found.
        </p>
        <SetAsideChange proposalId={proposal.id} />
      </section>
    </div>
  );
}

/** What one ranking factor did to the order, in words rather than a raw score. A factor is
 *  bounded by its own ceiling, so the operator can see that no single input can run away with
 *  the queue, and a factor that changed nothing says so instead of printing a zero. */
function weightWord(contribution: number, max: number): string {
  const n = Math.round(Math.abs(contribution) * 10) / 10;
  const ceiling = Math.round(max * 10) / 10;
  if (n === 0) return "did not move this one either way";
  return contribution > 0 ? `moved it up ${n} of a possible ${ceiling}` : `moved it down ${n} of a possible ${ceiling}`;
}

/**
 * LAYER 2: THE INVESTIGATION. Everything above this decides; this proves. It is behind one
 * expander because an operator who trusts the recommendation should never have to scroll past
 * the reasoning to reach the copy, and an operator who does not trust it must be able to see
 * every step without asking anyone.
 *
 * All four parts are computed by the cause ladder (decision/diagnosis) and were carried on the
 * proposal with nothing rendering them: the named cause and its explanation, what else was on
 * the table and why each lost, what would prove the whole thing wrong, and every cause that was
 * never weighed at all because its evidence is not on file. That last one is the honest one:
 * "not considered" is a finding, never a silence, and it is never dressed up as ruled out.
 *
 * The ranking receipt sits with them, so the operator can see which inputs put this change where
 * it is, and how much each one could ever contribute.
 */
function Investigation({ proposal, seen }: { proposal: ChangeProposal; seen: Set<string> }) {
  const finding = proposal.causeFinding;
  const receipt = proposal.rankingReceipt;
  // What was read to get here is the same evidence the sections above already printed more often than not, and
  // an empty hint printed a bullet with nothing beside it.
  const hints = fresh(seen, proposal.evidence?.hints ?? []);
  const factors = (receipt?.factors ?? []).filter((f) => (f.input ?? "").trim().length > 0);
  // AN EXPANDER PROMISES REASONING. With neither a cause nor a ranking receipt there is none, and
  // the hints alone are the same evidence line the card above already carries, so opening "Show me
  // how you worked this out" landed on one repeated sentence. No reasoning, no expander.
  if (!finding && !receipt) return null;
  return (
    <details className="rounded-2xl border border-border bg-surface-raised p-5" data-investigation="true">
      <summary className="cursor-pointer text-[14px] font-semibold text-foreground">
        Show me how you worked this out
      </summary>
      <div className="mt-4 space-y-4">
        {finding ? (
          <>
            <div className="space-y-1">
              <p className="text-[12px] font-semibold text-foreground">What looks wrong</p>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {causeLabel(finding.cause)}. {finding.explanation}
              </p>
            </div>
            {finding.competingExplanations.length > 0 ? (
              <div className="space-y-1">
                <p className="text-[12px] font-semibold text-foreground">What else was considered and why it lost</p>
                <Bullets items={finding.competingExplanations.map((c) => `${causeLabel(c.cause)}: ${c.reason}.`)} />
              </div>
            ) : null}
            <div className="space-y-1">
              <p className="text-[12px] font-semibold text-foreground">What would overturn this</p>
              <p className="text-[13px] leading-relaxed text-muted-foreground">{finding.falsifier}</p>
            </div>
            {finding.notConsidered.length > 0 ? (
              <div className="space-y-1">
                <p className="text-[12px] font-semibold text-foreground">What could not be tested, and why</p>
                <Bullets items={finding.notConsidered.map((n) => `${causeLabel(n.cause)}: ${n.missing}`)} />
              </div>
            ) : null}
          </>
        ) : null}

        {hints.length > 0 ? (
          <div className="space-y-1">
            <p className="text-[12px] font-semibold text-foreground">What was read to get here</p>
            <Bullets items={hints} />
          </div>
        ) : null}

        {receipt && factors.length > 0 ? (
          <div className="space-y-1">
            <p className="text-[12px] font-semibold text-foreground">Why this one ranks where it does</p>
            <ul className="space-y-1 text-[13px] leading-relaxed text-muted-foreground">
              {factors.map((f, i) => (
                <li key={i} className="tabular-nums">
                  {f.input} ({weightWord(f.contribution, f.max)})
                </li>
              ))}
            </ul>
            <p className="text-[12px] leading-relaxed text-muted-foreground">{receipt.basis}</p>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function ComponentCard({
  component,
  cited,
  isNew,
}: {
  component: BundleComponent;
  /** The facts this piece stands on that the page has NOT already printed, resolved by the caller. */
  cited: string[];
  isNew: boolean;
}) {
  // The producer already answered where this lands, what it achieves and why it works, and named the sources
  // still owed before it goes out. All four were carried on the row and rendered nowhere, so the operator was
  // handed copy with no place to put it and a source pack they could not see.
  const plan: [string, string | undefined][] = [["Where it goes", component.where], ["What it does", component.objective], ["Why it works", component.mechanism]];
  const pack = component.sourcePack ?? null;
  // A MERGE, A FORWARD, A CANONICAL OR A DE-INDEX IS THE ONE CHANGE A SENTENCE CANNOT TAKE BACK. Where it
  // sends people, what survives it, what it drops and how to reverse it belong on the screen BEFORE the
  // operator confirms it, and every line is held on the change itself, never worked out afterwards.
  const moves = dangerousComponents([component]).length > 0;
  const to = component.redirectTo;
  const consequences = moves ? [
    to ? `Anyone who opens the old address lands on ${to}.` : "This page stops answering at its own address.",
    ...(component.preserves?.keeps.length ? [`What survives the change: ${component.preserves.keeps.join(", ")}.`] : []),
    ...(component.preserves?.losses ?? []).map((l) => `Dropped: ${l.what}, because ${l.why}.`),
    to ? `To undo it: take the forward to ${to} off and publish this page at its own address again.`
      : "To undo it: put the page back the way it was, then say so here, and it is read again before anything is claimed.",
  ] : [];
  return (
    <div className="space-y-2 rounded-2xl border border-border bg-surface-raised p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] font-semibold text-foreground">{component.label}</p>
        {component.risk === "review" ? (
          <span className="rounded bg-status-warning/10 px-1.5 py-0.5 text-[11px] text-status-warning">
            Worth a quick fact check
          </span>
        ) : null}
      </div>
      {isNew ? null : component.before ? (
        <div className="space-y-1">
          <p className="text-[12px] text-muted-foreground">On the page now</p>
          <p className="whitespace-pre-wrap break-words rounded-lg bg-surface-inset px-3 py-2 text-[13px] text-muted-foreground line-through">
            {component.before}
          </p>
        </div>
      ) : (
        // A piece that RETIRES or FORWARDS a page is not a page that happens to have nothing there today.
        <p className="text-[12px] italic text-muted-foreground">
          {moves ? "This one does not add anything to the page. Read what it does below before you confirm it." : "This page has none today."}
        </p>
      )}
      {/* THE COPY CONTROL BELONGS WHERE THE COPY IS. The exact words were handed over here with no way to take
          them, so the one screen that holds the whole change was the one screen you had to retype it from. */}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] text-muted-foreground">Use this</p>
          {!moves && component.after.trim() ? <CopyButton text={component.after} label="Copy" /> : null}
        </div>
        <CopyBlock component={component} />
      </div>
      {consequences.length > 0 ? (
        <div className="space-y-1 rounded-lg border border-status-warning/40 bg-status-warning/5 px-3 py-2" data-destructive-detail="true">
          <p className="text-[12px] font-semibold text-foreground">What this does to your site</p>
          <Bullets items={consequences} />
        </div>
      ) : null}
      {plan.some(([, v]) => v) ? (
        <div className="space-y-0.5 text-[12px] leading-relaxed text-muted-foreground">
          {plan.map(([label, value]) => (value ? <p key={label}><span className="font-semibold text-foreground">{label}:</span> {value}</p> : null))}
        </div>
      ) : null}
      {pack && (pack.sourceRequirements.length > 0 || pack.factRequirements.length > 0) ? (
        <div className="space-y-1 rounded-lg bg-surface-inset px-3 py-2">
          <p className="text-[12px] font-semibold text-foreground">Sources to add before this goes out</p>
          {pack.sourceRequirements.length > 0 ? <Bullets items={pack.sourceRequirements} /> : null}
          {pack.factRequirements.length > 0 ? (
            <>
              <p className="text-[12px] text-muted-foreground">Check these lines against the source you pick</p>
              <Bullets items={pack.factRequirements} />
            </>
          ) : null}
        </div>
      ) : null}
      {cited.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[12px] font-semibold text-foreground">What this is based on</p>
          <Bullets items={cited} />
        </div>
      ) : null}
    </div>
  );
}

/** Slice 8: the copy-ready block. A page plan reads as a list and a source pack
 *  puts each source on its own line, so a multi-line insertion stays readable
 *  instead of one wall of text. Every other component stays one exact block. */
function CopyBlock({ component }: { component: BundleComponent }) {
  const box =
    "rounded-lg border border-accent-primary/40 bg-accent-primary/5 px-3 py-2 text-[13px] leading-relaxed text-foreground";
  const lines = component.after.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && component.kind === "section") {
    return (
      <ul className={`${box} list-disc space-y-1 break-words pl-7`}>
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    );
  }
  if (lines.length > 1 && component.kind === "source_pack") {
    return (
      <div className={`${box} space-y-1`}>
        {lines.map((l, i) => (
          <p key={i} className="break-words">
            {l}
          </p>
        ))}
      </div>
    );
  }
  return <p className={`${box} whitespace-pre-wrap break-words`}>{component.after}</p>;
}

/** The honest read failure. It deliberately does NOT fall back to anything cached: the whole point of the
 *  fresh-read pattern is that this page never contradicts /changes. */
function ChangeDetailReadError({ error }: { error: unknown }) {
  return (
    <div className="max-w-3xl">
      <section className="rounded-lg border border-status-warning/40 bg-status-warning/5 px-5 py-5" aria-labelledby="change-read-error">
        <h2 id="change-read-error" className="text-[13px] font-semibold tracking-tight text-foreground">Couldn&apos;t load this change</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{error instanceof Error ? error.message : "Unknown error reading changelog entry"}</p>
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          The database could not be reached just now. Refresh to retry: cached truth is never shown by accident.
        </p>
        <Link href="/changes" className="mt-4 inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85">
          Back to Changes
        </Link>
      </section>
    </div>
  );
}
