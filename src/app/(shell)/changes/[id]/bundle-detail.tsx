/** bundle-detail - THE TWO-LAYER CHANGE DETAIL: layer 1 decides (the recommendation, the exact edits, why it
 *  is the smartest move, what was checked); layer 2 proves, behind one expander. Nothing here reads the
 *  database: the route hands it the row it already resolved. */
import Link from "next/link";
import { causeLabel, componentIdOf, confirmedVersion, dangerousComponents, deliverableGaps, openHold, sameComponentId, unsettledCause } from "@/domains/decision";
import type { ChangeProposal, ChangeBundle, BundleComponent, BundleEvidenceItem } from "@/domains/decision";
import { monthDayLabel } from "@/components/data/receipt-line";
import { ConfirmDangerous, CopyButton, MarkImplemented, SetAsideChange } from "../change-controls";
import { pageLabel } from "../types";

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[14px] font-semibold text-foreground">{children}</h2>;
}

const EVIDENCE_GROUP: Record<BundleEvidenceItem["kind"], string> = {
  gsc_demand: "What people search on Google",
  keyword: "How much demand there is",
  serp: "What Google shows today",
  diagnosis: "Why this looks like the problem",
  independent_source: "What independent sources say",
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
 *  part of the sentence, so "163 clicks lost in 4 weeks" and "163 clicks lost in 4 weeks (checked August 9)"  are one fact, said once. */
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

/** Layer 1 decides, layer 2 proves; a new-page bundle rides the same two layers with insert-only pieces. */
export function BundleDetail({ proposal, bundle, recorded }: { proposal: ChangeProposal; bundle: ChangeBundle; recorded: Set<string> }) {
  const facts = new Map(bundle.receipt.items.map((i) => [i.key, i]));
  const chips = [...bundle.scope.queries, ...bundle.scope.prompts];
  const isNew = proposal.kind === "new_page";
  // THE HOLD TRAVELS TO THE DETAIL PAGE. The queue says nothing in the review lane is ready to paste or can be marked done, and a direct link used to hand the operator a Copy button and a Mark done on exactly the card it had just held. One boundary, read on both screens: the LANE first (only `ready` may be pasted), then the unsettled cause.
  // THE ONE SERVABILITY VERDICT, THE SAME ONE THE LIST LANES BY. This read status and unsettledCause and skipped
  // openHold, so a stored ready row the queue itself demotes (a typed fault, a blocking hold) rendered here with a
  // Copy press and a Mark done on a direct link while the list refused to offer it: the list and the detail
  // disagreed about the same row. One rule everywhere: the lane first, then the hold's own blocking reason (the
  // safety hold excepted, because this page hosts the two-step confirmation it asks for), then the unsettled cause.
  const hold0 = openHold(proposal);
  const held = proposal.status !== "ready" ? "This change is still being reviewed, so nothing here is ready to paste and nothing here can be marked done yet."
    : (hold0.safetyHold ? null : hold0.blocking) ?? unsettledCause(proposal);
  // AND A HELD CHANGE THAT MOVES OR HIDES A PAGE HAS SOMEWHERE TO GO. Everything the operator needs to decide is already on this page: the pieces, the addresses, where a forward lands, what survives it, the copy, the risks and the evidence behind each one. The confirmation belongs beside them, never on a page of its own. Offered ONLY on finished work whose own cause is settled: review work held because a quality gate refused it is not up for a yes, and confirming it would promote copy nobody stands behind.
  const confirmable = proposal.status === "needs_review" && dangerousComponents(bundle.components).length > 0 && deliverableGaps(proposal).length === 0 && unsettledCause(proposal) == null ? confirmedVersion(proposal) : null;
  // ONE SENTENCE, ONCE ON THE PAGE. The same fact reached the screen three times over ("What this is based on", "Why this is the smartest move", "What was checked"), which reads as padding rather than proof.
  // Claimed in render order, first occurrence wins, and a section left with nothing to say does not print its heading.
  const seen = new Set<string>();
  fresh(seen, [bundle.objective, proposal.whyItMatters]); // the head of the page says these first, so nothing repeats them
  const cited = bundle.components.map((c) => fresh(seen, c.evidenceKeys.map((k) => facts.get(k)?.fact)));
  const reasons = fresh(seen, bundle.confidenceReasons);
  const checked = EVIDENCE_ORDER
    // THE DATE IS NOT THE FACT. A receipt line that came through with nothing written on it still carried its reading date, so it printed a bullet saying "(checked Aug 10)" and nothing else.
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
        <h2 className="text-[14px] font-semibold text-foreground">The recommendation</h2>
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
        {/* A LONG CORRECTION LIST IS WORKED IN BATCHES: groups of ten fold, first open, each correction with
            its own copy control and identity. Every other bundle renders its pieces exactly as before. */}
        {bundle.components.length > 10 && bundle.components.every((c) => c.kind === "factual_correction")
          ? Array.from({ length: Math.ceil(bundle.components.length / 10) }, (_, b) => (
            <details key={b} open={b === 0} className="rounded-2xl border border-border bg-surface-inset/40 p-2" data-correction-batch={b + 1}>
              <summary className="cursor-pointer px-2 py-1 text-[13px] font-semibold text-foreground">
                Batch {b + 1} of {Math.ceil(bundle.components.length / 10)}: corrections {b * 10 + 1} to {Math.min((b + 1) * 10, bundle.components.length)}
              </summary>
              <div className="mt-2 space-y-3">
                {bundle.components.slice(b * 10, (b + 1) * 10).map((c, i) => (
                  <ComponentCard key={i} component={c} cited={cited[b * 10 + i] ?? []} isNew={isNew} held={held != null} />
                ))}
              </div>
            </details>
          ))
          : bundle.components.map((c, i) => (
            <ComponentCard key={i} component={c} cited={cited[i] ?? []} isNew={isNew} held={held != null} />
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
        {held ? <p className="text-[13px] leading-relaxed text-foreground">{held}{waitingOn(proposal) ?? ""}</p> : <MarkImplemented
          proposalId={proposal.id}
          label={isNew ? "Mark done" : "Mark done"}
          newPage={isNew}
          components={bundle.components.map((c, i) => ({ id: componentIdOf(c, i), kind: c.kind, label: c.label,
            // Era-tolerant, exactly as the server matches: a piece recorded before its copy joined its name still shows as recorded.
            moves: dangerousComponents([c]).length > 0, recorded: [...recorded].some((r) => sameComponentId(r, componentIdOf(c, i))) }))}
        />}
        {held ? null : <p className="text-[12px] text-muted-foreground">After you make it, the page is checked and the measurement starts from what is found.</p>}
        {confirmable ? <ConfirmDangerous proposalId={proposal.id} version={confirmable} /> : null}
        <SetAsideChange proposalId={proposal.id} />
      </section>
    </div>
  );
}

/** One ranking factor's effect IN WORDS AND NO SCORE: how hard it pushed, out of how hard it could ever
 *  push; a factor that changed nothing says so instead of a zero. */
function weightWord(contribution: number, max: number): string {
  const share = max > 0 ? Math.abs(contribution) / max : 0;
  if (Math.round(Math.abs(contribution) * 10) / 10 === 0) return "did not move this one either way";
  if (contribution < 0) return "held it back";
  return share >= 0.66 ? "a strong push" : share >= 0.33 ? "a fair push" : "a small push";
}

/** WHAT THIS CHANGE IS WAITING ON BEFORE ANYBODY CAN DO IT, read off the row's own typed next step and printed where the change is, never only inside the ranking receipt behind an expander: a change ranked above smaller finished work reads as an order somebody could work straight through until it says what it waits for. */ const waitingOn = (p: ChangeProposal): string | null => ((w: string) => (w ? ` ${w[0]!.toUpperCase()}${w.slice(1)}.` : null))((p.rankingReceipt?.factors ?? []).find((f) => f.name === "readiness")?.input?.trim() ?? "");
/** LAYER 2: THE INVESTIGATION, behind one expander. All four parts come off the cause ladder: the named
 * cause and its explanation, what else was weighed and why each lost, the falsifier, and what was never
 * weighed because its evidence is not on file ("not considered" is a finding, never a silence). The ranking
 * receipt sits with them, so the operator sees which inputs put this change where it is. */
function Investigation({ proposal, seen }: { proposal: ChangeProposal; seen: Set<string> }) {
  const finding = proposal.causeFinding;
  const receipt = proposal.rankingReceipt;
  // What was read to get here is the same evidence the sections above already printed more often than not, and an empty hint printed a bullet with nothing beside it.
  const hints = fresh(seen, proposal.evidence?.hints ?? []);
  const factors = (receipt?.factors ?? []).filter((f) => (f.input ?? "").trim().length > 0);
  // AN EXPANDER PROMISES REASONING. With neither a cause nor a ranking receipt there is none, and
  // the hints alone are the same evidence line the card above already carries, so opening "Show me how you worked this out" landed on one repeated sentence. No reasoning, no expander.
  if (!finding && !receipt) return null;
  return (
    <details className="rounded-2xl border border-border bg-surface-raised p-5" data-investigation="true">
      <summary className="cursor-pointer text-[14px] font-semibold text-foreground">
        How this was worked out
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
              {/* A LABEL IS NOT A SCORE: readiness contributes nothing on purpose, so "(did not move this one either way)" after the sentence saying what the change waits on read as a shrug about the dependency. */}
              {factors.map((f, i) => <li key={i} className="tabular-nums">{f.input}{f.max === 0 ? "" : ` (${weightWord(f.contribution, f.max)})`}</li>)}
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
  held,
}: {
  component: BundleComponent;
  /** The facts this piece stands on that the page has NOT already printed, resolved by the caller. */
  cited: string[];
  isNew: boolean;
  /** TRUE while the whole change is held for review, which takes the Copy control with it. */
  held: boolean;
}) {
  // Where it lands, what it achieves, why it works and the sources still owed all ride the row and render here.
  const plan: [string, string | undefined][] = [["Where it goes", component.where], ["What it does", component.objective], ["Why it works", component.mechanism]];
  const pack = component.sourcePack ?? null;
  // A MERGE, A FORWARD, A CANONICAL OR A DE-INDEX IS THE ONE CHANGE A SENTENCE CANNOT TAKE BACK. Where it sends people, what survives it, what it drops and how to reverse it belong on the screen BEFORE the
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
          {/* A SOURCED CORRECTION IS DETERMINISTIC BANK WORK: its exact replacement stays copyable while the
              bundle waits on review. Copying is reading; the record still goes through the same doors. */}
          {!moves && component.after.trim() && (!held || component.kind === "factual_correction")
            ? <CopyButton text={component.after} label="Copy" /> : null}
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

/** THE ONE-LAYER DETAIL for a card with no deep bundle: the same edit the list shows, said in full on its own
 *  page. Before this, a live bundleless row REDIRECTED back to /changes, and once the queue became mostly
 *  suggestion and sweep cards, every "See the change" press bounced. Steps render as steps, a pasteable line
 *  keeps its Copy press, and Mark done and Skip work here exactly as they do on the list. */
export function SimpleDetail({ proposal }: { proposal: ChangeProposal }) {
  const c = proposal.recommendedChange;
  const after = (c.kind === "new_page" ? c.proposedTitle : c.after ?? "").trim();
  const before = c.kind === "new_page" ? null : (c.before ?? "").trim() || null;
  const steps = (proposal.operatorSteps ?? []).map((s) => s.replace(/^\d+[.)]\s*/, "").trim()).filter(Boolean);
  // A DIRECT LINK STILL REACHES A ROW THE QUEUE NO LONGER RANKS, so the detail page asks the SAME completeness boundary: an unfinished deliverable is read, never pasted and never recorded as done here either. A
  // card carrying no steps at all (an ownership decision asks the operator for nothing) leads with its own line, or the page would print an empty list where the finding should be.
  const research = deliverableGaps(proposal).length > 0;
  // LIFECYCLE, NOT SHAPE. Completeness answered "are the words written", and this page asked nothing else: a finished card sitting in the review lane, which the list refuses to offer, was handed over here with a
  // Copy press and a Mark done on a direct link. READY IS THE ONLY LANE THAT MAY BE PASTED, and it is asked here, on the row itself, exactly as the list and the mutation ask it.
  const hold1 = openHold(proposal);
  const held = proposal.status !== "ready"
    ? "This change is still being reviewed, so nothing here is ready to paste and nothing here can be marked done yet."
    : (hold1.safetyHold ? null : hold1.blocking) ?? unsettledCause(proposal); // the SAME one verdict the list lanes by, so a direct link can never out-offer the queue
  const shownSteps = research && after && !(steps[0] ?? "").startsWith(after.slice(0, 25)) ? [after, ...steps] : steps;
  const checks = proposal.evidence?.hints ?? [];
  // TWO THINGS THE RENDERED APP CAUGHT ON 2026-09-05. A HEADLINE THAT CARRIES AN ADDRESS IS THE WRITER'S BRIEF, NOT THE CUSTOMER'S SENTENCE: the detail led with "Write a real description on /iran-flags/parthian-empire-flag: 7 pages share one templated line", a file name printed at the operator above the very address it names. AND BEACON'S OWN OBJECTIONS ARE NOT THE OPERATOR'S CAVEATS: the same row printed "its copy carries no record of what it stands on" under Keep in mind, which names an internal record and no next step; the hold this page already computed names those sentences, so no second vocabulary decides it here.
  const brief = (proposal.opportunityType || "").trim().replace(/_/g, " "), edit = proposal.recommendedChange, caveats = ((f) => proposal.limitations.filter((l) => !f.has(l)))(new Set(hold1.why));
  const action = (/(^|\s)\//.test(brief) ? "" : brief) || (edit.kind === "new_page" ? `Build a new page that answers "${proposal.primaryQuery}"` : `Update the ${({ title: "page title", meta: "meta description", h1: "page headline", answer_block: "answer at the top of the page", section: "section", schema: "structured data" } as Record<string, string>)[edit.field] ?? "page"} to sharpen it for "${proposal.primaryQuery}"`); // never the bland shrug: the operator reads the page name and then what is being done to it
  return (
    <div className="space-y-5" data-simple-detail="true">
      {/* THE HEADLINE IS THE PAGE AND THE WORK, NEVER THE ARGUMENT. This h1 used to be the whole
          whyItMatters paragraph, printed again word for word as the body two blocks down. */}
      <div className="space-y-1">
        <h2 className="text-[17px] font-semibold leading-relaxed text-foreground">
          {proposal.pagePath ? pageLabel(proposal.pagePath) : (proposal.pageLabel || "This page")}: {action}
        </h2>
        <p className="text-[12px] text-muted-foreground">{proposal.pagePath ?? proposal.pageLabel}</p>
      </div>
      {research || (steps.length > 0 && !after) ? (
        <div className="space-y-1">
          <Heading>What is settled, and what is still owed:</Heading>
          <ol className="list-none space-y-1 text-[14px] leading-relaxed text-muted-foreground">
            {shownSteps.map((s, i) => <li key={i}><span className="tabular-nums font-semibold">{i + 1}. </span>{s}</li>)}
          </ol>
        </div>
      ) : after ? (
        <div className="space-y-1">
          {before ? <p className="text-[13px] text-muted-foreground">Now: <span className="line-through">{before}</span></p> : null}
          <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-accent-primary/40 bg-accent-primary/5 px-3 py-2">
            <p className="min-w-0 flex-1 whitespace-pre-line text-[15px] font-semibold leading-relaxed text-foreground">{after}</p>
            {research || held ? null : <CopyButton text={after} label="Copy" />}
          </div>
          {/* WHERE IT GOES, ON THE PAGE THAT SHOWS THE COPY. Copy that lands somewhere new carries its placement
              and this page printed the words without it, so the operator read finished copy and still had to guess. */}
          {c.kind === "existing_edit" && c.where ? <p className="text-[13px] text-muted-foreground">Where it goes: {c.where}</p> : null}
        </div>
      ) : null}
      <p className="text-[14px] leading-relaxed text-foreground">{proposal.whyItMatters}</p>
      {/* THE RETIREMENT RECEIPT: finished words a later pass genuinely replaced stay inspectable here. */}
      {proposal.previousCopy ? (
        <p className="text-[12px] leading-relaxed text-muted-foreground" data-previous-copy="true">
          An earlier finished version was retired because {proposal.previousCopy.retiredBecause}. Its words: &ldquo;{proposal.previousCopy.after.slice(0, 220)}&rdquo;
        </p>
      ) : null}
      {caveats.length > 0 ? (
        <div className="space-y-1">
          <Heading>Keep in mind</Heading>
          <Bullets items={caveats} />
        </div>
      ) : null}
      {checks.length > 0 ? (
        <div className="space-y-1">
          <Heading>What was checked</Heading>
          <Bullets items={[...checks]} />
        </div>
      ) : null}
      {/* WHAT EACH SENTENCE STANDS ON, IN THE EVIDENCE'S OWN WORDS. This printed "(from page-copy-1)", which is a
          symbolic id and not a fact: nothing on the screen said what page-copy-1 says, so the one thing that makes
          drafted copy checkable was unreadable exactly where the operator decides whether to paste it. The exact
          quoted words the editor was shown ride on the row now, and an id with no quoted words behind it is shown
          as unquoted rather than dressed up as evidence. */}
      {(proposal.claims ?? []).length > 0 ? (
        <div className="space-y-1">
          <Heading>What each line stands on</Heading>
          <Bullets items={(proposal.claims ?? []).map((c) => `${c.text}. Stands on: ${[...c.supportedBy]
            .map((id) => { const f = (proposal.supportFacts ?? []).find((x) => x.id === id); return f ? `"${f.fact}"` : `${id} (the words behind this were not banked with the copy)`; })
            .join(" ")}`)} />
        </div>
      ) : null}
      {/* A RESEARCH CARD HAS NOTHING TO MARK DONE: no copy has been written for this page, so recording it as
          applied would start a reading of a change nobody made. A card still in review has nothing to mark done
          either, for the same reason the list refuses to offer it. Setting it aside stays either way, because
          deciding not to chase a question is a real answer. */}
      {held && !research ? <p className="text-[13px] leading-relaxed text-foreground" data-held-reason="true">{held}{waitingOn(proposal) ?? ""}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        {research || held ? null : <MarkImplemented proposalId={proposal.id} />}
        <SetAsideChange proposalId={proposal.id} />
      </div>
    </div>
  );
}
