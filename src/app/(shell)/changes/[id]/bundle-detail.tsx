import Link from "next/link";
import { attributionOf, causeLabel, componentIdOf, confirmedVersion, dangerousComponents, deliverableGaps, nextObligation, openHold, sameComponentId, unsettledCause } from "@/domains/decision";
import type { ChangeProposal, ChangeBundle, BundleComponent, BundleEvidenceItem } from "@/domains/decision";
import { monthDayLabel } from "@/components/data/receipt-line";
import { ConfirmDangerous, CopyButton, PublicationCopy, MarkImplemented, SetAsideChange } from "../change-controls";
import operatorUiPolicy, { cardCaveats, pageLabel } from "../types";
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
const canFinish = (p: ChangeProposal): boolean => p.recommendedChange.kind === "existing_edit" && p.status === "needs_review" && (["draft", "redraft", "review", "evidence"].includes(nextObligation(p)?.kind ?? "") || nextObligation(p)?.kind === "sections" && p.recommendedChange.field === "meta" && p.newPageDraft?.brief.kind === "body_meta" && p.changeFamily !== "full_rewrite" && p.recommendedChange.target?.mode !== "whole_body" && !p.bundle);
const researchNext = (p: ChangeProposal): string => {
  const owed = nextObligation(p);
  if (owed?.kind === "evidence") return ({ serp: "Beacon will read the search results before deciding what this page needs.", page_source: "Beacon will read the current page before writing against it.", competitor_page: "Beacon will read the relevant winning page before deciding what is missing.", factual_source: "Beacon will check a source for the missing claim before writing it.", semantic_review: "Beacon will check the finished copy against its saved sources." } as const)[owed.need.kind];
  if (owed?.kind === "redraft") return `Beacon will revise the saved copy: ${owed.instruction}`;
  if (owed?.kind === "terminal") return owed.reason;
  if (owed?.kind === "operator") return "Review the safety decision before this change can proceed.";
  if (owed?.kind === "review") return "Beacon will review the finished copy and its sources.";
  if (owed?.kind === "sections" || owed?.kind === "draft") return "Beacon will finish and check the publication copy before it can be applied.";
  return p.research?.next?.trim() || "Beacon will recheck this change before it can be applied.";
};

function seenLabel(observedAt: string | null): string {
  const day = monthDayLabel(observedAt);
  return day ? ` (checked ${day})` : "";
}

const normFact = (s: string): string =>
  s.trim().toLowerCase().replace(/\s*\(checked [^)]*\)\s*$/, "").replace(/\s+/g, " ").replace(/[.,;:]+$/, "");

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
type EvidenceLine = { text: string; readings: string[]; sources?: BundleEvidenceItem["sources"] };
function EvidenceText({ text }: { text: string }) {
  const pieces = text.split(/(https?:\/\/[^\s<>"']+)/g);
  return <>{pieces.map((piece, i) => {
    if (!piece.startsWith("http://") && !piece.startsWith("https://")) return piece;
    const href = piece.replace(/[),.;:]+$/, ""), tail = piece.slice(href.length);
    return <span key={`${href}-${i}`}><a href={href} target="_blank" rel="noreferrer" className="break-all font-semibold text-accent-primary underline underline-offset-2">Open source ↗</a>{tail}</span>;
  })}</>;
}
function EvidenceLines({ items }: { items: EvidenceLine[] }) {
  if (items.length === 0) return null;
  return <ul className="list-disc space-y-2 pl-4 text-[13px] leading-relaxed text-muted-foreground">{items.map((item, i) => <li key={i}><EvidenceText text={item.text} />{item.readings.map((id, j) => <span key={id}> <Link href={`/visibility?view=ai&reading=${encodeURIComponent(id)}`} className="inline-flex min-h-11 items-center font-semibold text-accent-primary underline underline-offset-2">Open exact AI reading{item.readings.length > 1 ? ` ${j + 1}` : ""}</Link></span>)}{item.sources?.length ? <ul className="mt-1 space-y-1 border-l border-border pl-3">{item.sources.map((source) => <li key={`${source.channel}:${source.url}`}>{operatorUiPolicy.livePageHref(source.url) ? <a href={operatorUiPolicy.livePageHref(source.url)!} target="_blank" rel="noreferrer" className="font-semibold text-accent-primary underline underline-offset-2">{source.publisher} ↗</a> : <span>{source.publisher}</span>}<span> · {source.channel === "aeo" ? `${source.recurrence ?? 0} cited answer${source.recurrence === 1 ? "" : "s"}` : `Google rank ${source.rank ?? "not recorded"}`}</span>{source.passage ? <p className="mt-0.5 text-[12px] text-muted-foreground">What was read: “{source.passage}”</p> : null}</li>)}</ul> : null}</li>)}</ul>;
}

export function BundleDetail({ proposal, bundle, recorded, returnTo = "/changes" }: { proposal: ChangeProposal; bundle: ChangeBundle; recorded: Set<string>; returnTo?: string }) {
  const facts = new Map(bundle.receipt.items.map((i) => [i.key, i]));
  const chips = [...bundle.scope.queries, ...bundle.scope.prompts];
  const isNew = proposal.kind === "new_page", livePageHref = operatorUiPolicy.livePageHref(proposal.pageUrl);
  const research = proposal.researchOnly === true || deliverableGaps(proposal).length > 0;
  const held = proposal.status !== "ready" ? "This change is still being reviewed, so nothing here is ready to paste and nothing here can be marked done yet."
    : unsettledCause(proposal); // the first defect of the one verdict, typed faults included (journey review, 2026-09-06): `blocking` restated by a second name
  const confirmable = !research && proposal.status === "needs_review" && dangerousComponents(bundle.components).length > 0 && deliverableGaps(proposal).length === 0 && unsettledCause(proposal) == null ? confirmedVersion(proposal) : null;
  const seen = new Set<string>();
  fresh(seen, [bundle.objective, proposal.whyItMatters]); // the head of the page says these first, so nothing repeats them
  const cited = bundle.components.map((c) => c.evidenceKeys.flatMap((key) => {
    const item = facts.get(key); if (!item) return [];
    return fresh(seen, [item.fact]).map((text) => ({ text, readings: item.kind === "ai_observation" ? [...(item.observationIds ?? []), ...(item.observationId ? [item.observationId] : [])] : [], sources: item.sources }));
  }));
  const reasons = fresh(seen, bundle.confidenceReasons);
  const checked = EVIDENCE_ORDER
    .map((kind) => ({ kind, items: bundle.receipt.items.filter((i) => i.kind === kind && i.fact.trim().length > 0)
      .flatMap((item) => fresh(seen, [`${item.fact}${seenLabel(item.observedAt)}`]).map((text) => ({ text, readings: item.kind === "ai_observation" ? [...(item.observationIds ?? []), ...(item.observationId ? [item.observationId] : [])] : [], sources: item.sources }))) }))
    .filter((g) => g.items.length > 0);
  const missing = fresh(seen, cardCaveats(proposal, bundle.receipt.missing, openHold(proposal).settledPriorReceipt)); // the SAME filter the card reads, so a bundle's caveats cannot differ by screen
  return (
    <div className="max-w-3xl space-y-5">
      <Link href={returnTo} className="inline-flex min-h-11 items-center text-[13px] text-muted-foreground hover:text-foreground">
        Back to Changes
      </Link>

      <section className="space-y-2 rounded-2xl border border-accent-primary/40 bg-surface-raised p-5">
        <h2 className="text-[14px] font-semibold text-foreground">The recommendation</h2>
        <p className="text-[15px] font-semibold leading-relaxed text-foreground">{bundle.objective}</p>
        <p className="text-[13px] text-muted-foreground">
          {isNew ? "A new page for" : "On this page"}: {proposal.pageLabel}
        </p>
        {livePageHref ? <a href={livePageHref} target="_blank" rel="noreferrer"
          className="inline-flex min-h-11 items-center text-[12px] font-semibold text-accent-primary underline underline-offset-2">Open live page ↗</a> : null}
        <p className="text-[13px] leading-relaxed text-muted-foreground">{proposal.whyItMatters}</p>
        {proposal.whyRankedAboveNext ? <p className="text-[12px] leading-relaxed text-muted-foreground"><span className="font-semibold text-foreground">Why this ranks above the next opportunity in the full backlog:</span> {proposal.whyRankedAboveNext}</p> : null}
        <p className="text-[12px] capitalize text-muted-foreground">About {proposal.estimatedEffortMinutes} min · {proposal.confidence} confidence · {proposal.riskLevel} risk</p>
        {bundle.risks.length > 0 ? <div className="space-y-1 border-t border-border pt-3"><Heading>Risks to read before copying</Heading><Bullets items={bundle.risks} /></div> : null}
      </section>

      <section className="space-y-3">
        <Heading>{research ? "Prepared pieces, not ready to paste" : isNew ? "The pieces to paste" : "The exact edits"}</Heading>
        {isNew ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground">This page does not exist yet.</p>
        ) : null}
        {bundle.components.length > 10 && bundle.components.every((c) => c.kind === "factual_correction")
          ? Array.from({ length: Math.ceil(bundle.components.length / 10) }, (_, b) => (
            <details key={b} open={b === 0} className="rounded-2xl border border-border bg-surface-inset/40 p-2" data-correction-batch={b + 1}>
              <summary className="flex min-h-11 cursor-pointer items-center px-2 py-1 text-[13px] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary">
                Batch {b + 1} of {Math.ceil(bundle.components.length / 10)}: corrections {b * 10 + 1} to {Math.min((b + 1) * 10, bundle.components.length)}
              </summary>
              <div className="mt-2 space-y-3">
                {bundle.components.slice(b * 10, (b + 1) * 10).map((c, i) => (
                  <ComponentCard key={i} component={c} pageUrl={proposal.pageUrl} cited={cited[b * 10 + i] ?? []} isNew={isNew} held={research || held != null} position={b * 10 + i + 1} total={bundle.components.length} />
                ))}
              </div>
            </details>
          ))
          : bundle.components.map((c, i) => (
            <ComponentCard key={i} component={c} pageUrl={proposal.pageUrl} cited={cited[i] ?? []} isNew={isNew} held={research || held != null} position={i + 1} total={bundle.components.length} />
          ))}
      </section>

      {!isNew && bundle.plan ? (
        <section className="grid gap-4 rounded-2xl border border-border bg-surface-raised p-5 sm:grid-cols-3" data-change-plan="true">
          <div><Heading>Change or add</Heading><Bullets items={bundle.plan.entries.map((e) => `${e.disposition === "add" ? "Add" : "Change"}: ${e.label}`)} /></div>
          <div><Heading>Keep</Heading><Bullets items={bundle.plan.keeps.length ? bundle.plan.keeps : ["No preserved section is named in this plan."]} /></div>
          <div><Heading>Remove</Heading><Bullets items={bundle.plan.removes.length ? bundle.plan.removes.map((r) => `${r.what}: ${r.why}`) : ["No removal is named in this plan."]} /></div>
        </section>
      ) : null}

      {reasons.length > 0 || chips.length > 0 ? (
      <section className="space-y-2 rounded-2xl border border-border bg-surface-raised p-5">
        <Heading>Why this move was selected</Heading>
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
            <EvidenceLines items={g.items} />
          </div>
        ))}
        {missing.length > 0 ? (
          <div className="space-y-1 border-t border-border pt-3">
            <p className="text-[12px] font-semibold text-foreground">Keep in mind</p>{/* ONE HEADING FOR THE CAVEAT BLOCK on the card, the simple detail and here: what could not be checked and what to bear in mind are one list, through one filter. */}
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

      <section className="space-y-2 rounded-2xl border border-border bg-surface-raised p-5">
        <Heading>How it gets measured</Heading>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{bundle.measurementPlan}</p>
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-surface-raised p-5">
        {research || held ? <p className="text-[13px] leading-relaxed text-foreground">{held ?? "This copy is still being prepared, so nothing here is ready to paste or mark done."}{waitingOn(proposal) ?? ""}</p> : <MarkImplemented
          proposalId={proposal.id}
          expectedVersion={confirmedVersion(proposal)}
          newPage={isNew}
          components={bundle.components.map((c, i) => ({ id: componentIdOf(c, i), kind: c.kind, label: c.label,
            ...(c.derivation ? { dependsOn: c.derivation.dependsOn.map((dependency) => dependency.componentId) } : {}),
            moves: dangerousComponents([c]).length > 0, recorded: [...recorded].some((r) => sameComponentId(r, componentIdOf(c, i))) }))}
        />}
        {research ? <p className="text-[13px] leading-relaxed text-foreground" data-research-next="true">Next: {researchNext(proposal)}</p> : null}
        {research || held ? null : <p className="text-[12px] text-muted-foreground">After you make it, the page is checked and the measurement starts from what is found.</p>}
        {confirmable ? <ConfirmDangerous proposalId={proposal.id} version={confirmable} /> : null}
        <SetAsideChange proposalId={proposal.id} finishable={canFinish(proposal) && !confirmable} prepare={nextObligation(proposal)?.kind !== "review" || proposal.recommendedChange.kind === "existing_edit" && !!proposal.recommendedChange.linkTo} />
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
  const hints = fresh(seen, proposal.evidence?.hints ?? []);
  const unbound = (proposal.impactScore != null || proposal.demandImpressions90d != null) && !attributionOf(proposal, new Date());
  const factors = unbound ? [] : (receipt?.factors ?? []).filter((f) => (f.input ?? "").trim().length > 0);
  if (!finding && !receipt) return null;
  return (
    <details className="rounded-2xl border border-border bg-surface-raised p-5" data-investigation="true">
      <summary className="flex min-h-11 cursor-pointer items-center text-[14px] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary">
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

        {receipt && (factors.length > 0 || unbound) ? (
          <div className="space-y-1">
            <p className="text-[12px] font-semibold text-foreground">Why this one ranks where it does</p>
            {factors.length > 0 ? <ul className="space-y-1 text-[13px] leading-relaxed text-muted-foreground">
              {/* A LABEL IS NOT A SCORE: readiness contributes nothing on purpose, so "(did not move this one either way)" after the sentence saying what the change waits on read as a shrug about the dependency. */}
              {factors.map((f, i) => <li key={i} className="tabular-nums">{f.input}{f.max === 0 ? "" : ` (${weightWord(f.contribution, f.max)})`}</li>)}
            </ul> : null}
            <p className="text-[12px] leading-relaxed text-muted-foreground">{unbound ? "No attributable click figure backs this saved ranking receipt. The change remains directional until its reader-task demand is checked again." : receipt.basis}</p>
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
  position,
  total, pageUrl,
}: {
  component: BundleComponent;
  /** The facts this piece stands on that the page has NOT already printed, resolved by the caller. */
  cited: EvidenceLine[];
  isNew: boolean;
  /** TRUE while the whole change is held for review, which takes the Copy control with it. */
  held: boolean;
  position: number;
  total: number; pageUrl?: string | null;
}) {
  const plan: [string, string | undefined][] = [["Where it goes", component.where], ["What it does", component.objective], ["Why it works", component.mechanism]];
  const pack = component.sourcePack ?? null;
  const moves = dangerousComponents([component]).length > 0;
  const to = component.redirectTo;
  const copyable = operatorUiPolicy.isPasteableComponent(component);
  const link = copyable && to && component.anchorAfter ? { href: to, anchor: component.anchorAfter, pageUrl: operatorUiPolicy.livePageHref(component.page, pageUrl) ?? pageUrl } : null;
  const consequences = moves ? [
    to ? `Anyone who opens the old address lands on ${to}.` : "This page stops answering at its own address.",
    ...(component.preserves?.keeps.length ? [`What survives the change: ${component.preserves.keeps.join(", ")}.`] : []),
    ...(component.preserves?.losses ?? []).map((l) => `${l.what}: ${l.why}`),
    to ? `To undo it: take the forward to ${to} off and publish this page at its own address again.`
      : "To undo it: put the page back the way it was, then say so here, and it is read again before anything is claimed.",
  ] : [];
  return (
    <div className="space-y-2 rounded-2xl border border-border bg-surface-raised p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] font-semibold text-foreground"><span className="tabular-nums text-accent-primary">{position} of {total}. </span>{component.label}</p>
        {component.risk === "review" ? (
          <span className="rounded bg-status-warning/10 px-1.5 py-0.5 text-[11px] text-status-warning">
            Worth a quick fact check
          </span>
        ) : null}
      </div>
      {component.page ? <p className="text-[12px] text-muted-foreground">Page: {component.page}</p> : null}
      {component.derivation ? <p className="rounded-lg border border-accent-primary/30 bg-accent-primary/5 px-3 py-2 text-[12px] leading-relaxed text-foreground" data-schema-sync="true">
        This schema is generated from the visible FAQ wording in this same change. Apply the visible copy and this matching block together.
      </p> : null}
      {isNew ? null : component.before ? (
        <div className="space-y-1">
          <p className="text-[12px] text-muted-foreground">On the page now</p>
          <p className="whitespace-pre-wrap break-words rounded-lg bg-surface-inset px-3 py-2 text-[13px] text-muted-foreground line-through">
            {component.before}
          </p>
        </div>
      ) : (
        <p className="text-[12px] italic text-muted-foreground">
          {moves ? "This one does not add anything to the page. Read what it does below before you confirm it." : "Current copy was not captured for this component, so no claim is made about what the page has today."}
        </p>
      )}
      {/* THE COPY CONTROL BELONGS WHERE THE COPY IS. The exact words were handed over here with no way to take
          them, so the one screen that holds the whole change was the one screen you had to retype it from. */}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] text-muted-foreground">{copyable ? held ? "Prepared wording, not ready to paste" : "Paste this" : "Instruction, do not paste"}</p>
          {copyable && !held
            ? <CopyButton text={component.after} units={component.units} link={link} label={`Copy ${component.label.toLowerCase()}`} /> : null}
        </div>
        <div className={`rounded-lg border px-3 py-2 text-[13px] leading-relaxed text-foreground ${copyable && !held ? "border-accent-primary/40 bg-accent-primary/5" : "border-border bg-surface-inset/50"}`}><PublicationCopy text={component.after} units={component.units} link={link} /></div>
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
          <p className="text-[12px] font-semibold text-foreground">{pack.resolved ? "Sources checked" : "Source checking still owed"}</p>
          {pack.sourceRequirements.length > 0 ? <Bullets items={pack.sourceRequirements} /> : null}
          {pack.factRequirements.length > 0 ? (
            <>
              <p className="text-[12px] text-muted-foreground">{pack.resolved ? "Claims checked against those sources" : "Claims that still need a checked source"}</p>
              <Bullets items={pack.factRequirements} />
            </>
          ) : null}
        </div>
      ) : null}
      {cited.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[12px] font-semibold text-foreground">What this is based on</p>
          <EvidenceLines items={cited} />
        </div>
      ) : null}
    </div>
  );
}

export function SimpleDetail({ proposal, returnTo = "/changes" }: { proposal: ChangeProposal; returnTo?: string }) {
  const c = proposal.recommendedChange;
  const after = (c.kind === "new_page" ? c.proposedTitle : c.after ?? "").trim();
  const before = c.kind === "new_page" ? null : (c.before ?? "").trim() || null;
  const units = c.kind === "existing_edit" ? c.units : undefined, link = c.kind === "existing_edit" && c.linkTo ? { href: c.linkTo, anchor: c.anchorText ?? "", pageUrl: proposal.pageUrl } : null;
  const steps = (proposal.operatorSteps ?? []).map((s) => s.replace(/^\d+[.)]\s*/, "").trim()).filter(Boolean);
  const research = proposal.researchOnly === true || deliverableGaps(proposal).length > 0;
  const hold1 = openHold(proposal);
  const held = proposal.status !== "ready" || research
    ? "This change is still being reviewed, so nothing here is ready to paste and nothing here can be marked done yet."
    : unsettledCause(proposal); // the SAME one verdict the list lanes by, so a direct link can never out-offer the queue
  const checks = proposal.evidence?.hints ?? [];
  const brief = (proposal.opportunityType || "").trim().replace(/_/g, " "), edit = proposal.recommendedChange, caveats = cardCaveats(proposal, hold1.caveats, hold1.settledPriorReceipt), tried = proposal.previousCopy, livePageHref = operatorUiPolicy.livePageHref(proposal.pageUrl); // THE HOLD ANSWERS BOTH HALVES (measured, 2026-09-05): filtering the row's raw limitations against the hold's reasons alone still served "its copy carries no record of what it stands on" on /california-persian-cities/fremont, the one sentence that verdict had just DISPROVED from the row's own claims and support facts. What a person should keep in mind is now the same function's answer, so no gate sentence reaches a customer as their own caveat and the typed fault and the obligation still say what is owed.
  const action = (/(^|\s)\//.test(brief) ? "" : brief) || (edit.kind === "new_page" ? `Build a new page that answers "${proposal.primaryQuery}"` : `Update the ${({ title: "page title", meta: "meta description", h1: "page headline", answer_block: "answer at the top of the page", section: "section", schema: "structured data" } as Record<string, string>)[edit.field] ?? "page"} to sharpen it for "${proposal.primaryQuery}"`); // never the bland shrug: the operator reads the page name and then what is being done to it
  return (
    <div className="max-w-3xl space-y-5" data-simple-detail="true">
      <Link href={returnTo} className="inline-flex text-[13px] text-muted-foreground hover:text-foreground">Back to Changes</Link>
      <div className="space-y-1">
        <h2 className="text-[17px] font-semibold leading-relaxed text-foreground">
          {proposal.pagePath ? pageLabel(proposal.pagePath) : (proposal.pageLabel || "This page")}: {action}
        </h2>
        <p className="text-[12px] text-muted-foreground">{proposal.pagePath ?? proposal.pageLabel}</p>
        {livePageHref ? <a href={livePageHref} target="_blank" rel="noreferrer" className="inline-flex text-[12px] font-semibold text-accent-primary underline underline-offset-2">Open live page ↗</a> : null}
        <p className="text-[12px] capitalize text-muted-foreground">About {proposal.estimatedEffortMinutes} min · {proposal.confidence} confidence · {proposal.riskLevel} risk</p>
      </div>
      {caveats.length > 0 ? <div className="space-y-1"><Heading>What to keep in mind</Heading><Bullets items={caveats} /></div> : null}
      {research ? (
        <div className="space-y-1" data-research-next="true"><Heading>What Beacon does next</Heading>
          <p className="text-[14px] leading-relaxed text-foreground">{researchNext(proposal)}</p>
        </div>
      ) : steps.length > 0 && !after ? (
        <div className="space-y-1">
          <Heading>What is settled, and what is still owed:</Heading>
          <ol className="list-none space-y-1 text-[14px] leading-relaxed text-muted-foreground">
            {steps.map((s, i) => <li key={i}><span className="tabular-nums font-semibold">{i + 1}. </span>{s}</li>)}
          </ol>
        </div>
      ) : after ? (
        <div className="space-y-1">
          {before && !(c.kind === "existing_edit" && c.linkMode === "in_place") ? <p className="text-[13px] text-muted-foreground">Now: <span className="line-through">{before}</span></p> : null}
          {c.kind === "existing_edit" && c.linkMode === "in_place" ? <p className="text-[13px] text-muted-foreground">Select only “{c.anchorText}” and link those words to {c.linkTo}. Keep the paragraph’s wording and all other content.</p> : null}
          <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-accent-primary/40 bg-accent-primary/5 px-3 py-2">
            <div className="min-w-0 flex-1 text-[15px] leading-relaxed text-foreground"><PublicationCopy text={after} units={units} link={link} /></div>
            {research || held || c.kind === "existing_edit" && c.linkMode === "in_place" ? null : <CopyButton text={after} units={units} link={link} label="Copy" />}
          </div>
          {c.kind === "existing_edit" && c.linkMode !== "in_place" && c.where ? <p className="text-[13px] text-muted-foreground">Where it goes: {c.where}</p> : null}
        </div>
      ) : null}
      <p className="text-[14px] leading-relaxed text-foreground">{proposal.whyItMatters}</p>
      {tried && tried.after.trim() && !hold1.settledPriorReceipt ? (
        <details className="text-[12px] leading-relaxed text-muted-foreground" data-previous-copy="true">
          <summary className="cursor-pointer">Earlier rejected draft</summary>
          <p>Retired{(tried.attempts ?? 0) >= 1 ? ` on attempt ${tried.attempts}` : ""}: {tried.retiredBecause.replace(/\.?$/, ".")} Its words: &ldquo;{tried.after.slice(0, 220)}&rdquo;</p>
        </details>
      ) : null}
      {checks.length > 0 ? (
        <div className="space-y-1">
          <Heading>{held ? "Research saved with this unfinished draft" : "What was checked"}</Heading>
          <Bullets items={[...checks]} />
        </div>
      ) : null}{/* Atomic edits owe the same diagnosis, alternatives, falsifier and ranking receipt as deep bundles. */}<Investigation proposal={proposal} seen={new Set(checks.map(normFact))} />
      {(proposal.claims ?? []).length > 0 ? (
        <div className="space-y-1">
          <Heading>{held ? "Sources saved with this unfinished draft" : c.kind === "existing_edit" && c.linkMode === "in_place" ? "Why this link fits" : "What each line stands on"}</Heading>
          {!held && c.kind === "existing_edit" && c.linkMode === "in_place" ? <p className="text-[13px] text-muted-foreground">The selected words are on the current page, and the destination article uses matching terms. This link adds no historical wording.</p> : null}
          <details className="text-[13px] text-muted-foreground" data-held-support={held ? true : undefined} open={!held && !(c.kind === "existing_edit" && c.linkMode === "in_place")}><summary className="cursor-pointer">{held ? "Inspect saved wording and sources; change still under review" : "Inspect captured wording"}</summary>
            <EvidenceLines items={(proposal.claims ?? []).map((c) => ({ readings: [], text: `${c.text.replace(/[.\s]+$/, "")}. Stands on: ${[...new Set([...c.supportedBy].map((id) => { const f = (proposal.supportFacts ?? []).find((x) => x.id === id), said = (f?.fact ?? "").trim(), sources = (f?.sources ?? []).map((s) => `${s.kind} source ${s.url}`).join(", "); return /^(?:page-|target-section|section-after|draft-so-far)/.test(id) ? "the words already on this page" : !said ? `${id} (the words behind this were not banked with the copy)` : `"${(/^[\s\S]{40,220}?[.!?]["'”’]?(?=\s|$)/.exec(said)?.[0] ?? said.slice(0, 220)).trim()}"${sources ? ` (${sources})` : ""}`; }))].join(", ")}` }))} />
          </details>
        </div>
      ) : null}
      {held && !research ? <p className="text-[13px] leading-relaxed text-foreground" data-held-reason="true">{held}{waitingOn(proposal) ?? ""}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        {research || held ? null : <MarkImplemented proposalId={proposal.id} expectedVersion={confirmedVersion(proposal)} inPlaceLink={c.kind === "existing_edit" && c.linkMode === "in_place"} />}
        <SetAsideChange proposalId={proposal.id} finishable={canFinish(proposal)} prepare={nextObligation(proposal)?.kind !== "review" || proposal.recommendedChange.kind === "existing_edit" && !!proposal.recommendedChange.linkTo} />
      </div>
    </div>
  );
}
