import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ChangelogEntry } from "@/domains/measurement/changelog/types";
import { getRepository } from "@/lib/persistence/repositories";
import { requireReadyAccount } from "@/domains/account";
import { currentTenantId } from "@/lib/tenant-context";
import {
  createPerfTrace,
  readPerfTraceIdFromHeaders,
} from "@/lib/perf-trace";
import { loadProofLedgerPersisted } from "@/domains/measurement";
import { findProofForChange, proofResultHref } from "@/domains/measurement";
import { causeLabel, loadChangeProposal, resolveCurrentBasis } from "@/domains/decision";
import type { ChangeProposal, ChangeBundle, BundleComponent, BundleEvidenceItem } from "@/domains/decision";
import { monthDayLabel } from "@/components/data/receipt-line";
import { MarkImplemented, SetAsideChange } from "../../changes-list-client";

// Force dynamic render so every request runs the fresh-repo-read pattern below. Matches /changes.
export const dynamic = "force-dynamic";

/**
 * `/changes/[id]`. A current-basis proposal carrying a bundle renders its two-layer detail; a set-aside one
 * renders a single honest page; anything else resolves the changelog entry and redirects to Results, which
 * owns the measurement truth, without inventing an outcome.
 */
export default async function ChangeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const trace = createPerfTrace("loader:/changes/[id]", {
    traceId: await readPerfTraceIdFromHeaders(),
    route: "/changes/[id]",
  });
  try {
    const { id: rawId } = await params;
    // Next hands the path segment URL-encoded; proposal ids carry "::" and "/".
    const id = decodeURIComponent(rawId);
    const tenantId = await currentTenantId();
    const { access } = await requireReadyAccount(tenantId);
    if (access.kind === "suspended") redirect("/");

    // ONE bounded row read serves both answers: the id names the row and the CURRENT basis proves it is
    // live work, so no cached release resurrects set-aside copy and no unlimited queue is poured out to
    // find one row whose address is already in hand. No bundle falls through to the redirect below.
    const [proposal, basis] = await Promise.all([loadChangeProposal(tenantId, id), resolveCurrentBasis(tenantId)]);
    const found = proposal && basis != null && proposal.basis === basis
      && (proposal.status === "ready" || proposal.status === "needs_review") ? proposal : null;
    if (found?.bundle) return <BundleDetail proposal={found} bundle={found.bundle} />;
    // A bar I could not READ is not a bar I raised: claiming I judged this idea when
    // I never resolved the account would be a lie the operator cannot check.
    if (await isSetAside(tenantId, id)) return <SetAsideDetail unreadable={basis == null} />;

    // Fresh per-request repo read: a module-level array hydrated at lambda cold start made entries
    // written by another lambda invisible here, and the page rendered notFound.
    const repository = getRepository().forTenant(tenantId);
    let freshChangelogEntries: ChangelogEntry[];
    try {
      freshChangelogEntries = await repository.getChangelogEntries();
    } catch (error) {
      return <ChangeDetailReadError error={error} />;
    }

    const entry = freshChangelogEntries.find((c) => c.id === id);
    if (!entry) notFound();

    // Results owns the measurement truth. A tracked change deep-links to its
    // exact proof card (including compound-package semantics); an older
    // untracked changelog row lands on Results without inventing an outcome.
    const proofLedger = await loadProofLedgerPersisted(tenantId).catch(() => []);
    const canonicalProof = findProofForChange(entry, proofLedger);
    redirect(canonicalProof ? proofResultHref(canonicalProof) : "/results");
  } finally {
    trace.flush();
  }
}

/** A saved proposal the current queue no longer carries. An IMPLEMENTED one is not set aside. */
async function isSetAside(tenantId: string, id: string): Promise<boolean> {
  const stored = await loadChangeProposal(tenantId, id).catch(() => null);
  return stored != null && stored.status !== "implemented_pending_verification";
}

/** The honest end of a stale direct link: no exact copy, no before and after, and
 *  no way to record work I no longer stand behind. One decision, one way back. */
function SetAsideDetail({ unreadable }: { unreadable: boolean }) {
  return (
    <div className="max-w-3xl">
      <section className="space-y-2 rounded-2xl border border-border bg-surface-raised p-5">
        <h1 className="text-[14px] font-semibold text-foreground">{unreadable ? "I cannot show you this one right now" : "I set this idea aside"}</h1>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {unreadable
            ? "I could not confirm which of your saved ideas still hold just now, so I am not handing you copy I cannot back. I am checking again automatically, and every change I stand behind is ranked on Changes."
            : "I raised the bar for what counts as worth your time, and this idea no longer clears it, so I am not handing you copy I cannot back with evidence. I am still checking your pages, and every change that earns its place is ranked on Changes."}
        </p>
        <Link href="/changes" className="inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2">
          See what I am working on now
        </Link>
      </section>
    </div>
  );
}

const EVIDENCE_GROUP: Record<BundleEvidenceItem["kind"], string> = {
  gsc_demand: "What people search on Google",
  keyword: "How much demand there is",
  serp: "What Google shows today",
  diagnosis: "Why I think this is the problem",
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

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[14px] font-semibold text-foreground">{children}</h2>;
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-muted-foreground">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}

/** Slice 7: the two-layer bundle detail. Layer 1 decides, layer 2 proves.
 *  Slice 8: the same two layers render a new-page bundle. Nothing forks: the
 *  page-does-not-exist truth is stated once and every component is a pure
 *  insertion, so the before/after framing simply drops away. */
function BundleDetail({ proposal, bundle }: { proposal: ChangeProposal; bundle: ChangeBundle }) {
  const facts = new Map(bundle.receipt.items.map((i) => [i.key, i]));
  const chips = [...bundle.scope.queries, ...bundle.scope.prompts];
  const isNew = proposal.kind === "new_page";
  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/changes" className="inline-flex text-[13px] text-muted-foreground hover:text-foreground">
        Back to Changes
      </Link>

      <section className="space-y-2 rounded-2xl border border-accent-primary/40 bg-surface-raised p-5">
        <h1 className="text-[14px] font-semibold text-foreground">What I recommend</h1>
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
          <ComponentCard key={i} component={c} facts={facts} isNew={isNew} />
        ))}
      </section>

      <section className="space-y-2 rounded-2xl border border-border bg-surface-raised p-5">
        <Heading>Why this is the smartest move</Heading>
        {bundle.confidenceReasons.length > 0 ? <Bullets items={bundle.confidenceReasons} /> : null}
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

      <section className="space-y-3 rounded-2xl border border-border bg-surface-raised p-5">
        <Heading>What I checked</Heading>
        {EVIDENCE_ORDER.map((kind) => {
          const items = bundle.receipt.items.filter((i) => i.kind === kind);
          if (items.length === 0) return null;
          return (
            <div key={kind} className="space-y-1">
              <p className="text-[12px] font-semibold text-foreground">{EVIDENCE_GROUP[kind]}</p>
              <Bullets items={items.map((i) => `${i.fact}${seenLabel(i.observedAt)}`)} />
            </div>
          );
        })}
        {bundle.receipt.missing.length > 0 ? (
          <div className="space-y-1 border-t border-border pt-3">
            <p className="text-[12px] font-semibold text-foreground">What I could not check yet</p>
            <Bullets items={bundle.receipt.missing} />
          </div>
        ) : null}
      </section>

      {bundle.alternatives.length > 0 ? (
        <section className="space-y-2 rounded-2xl border border-border bg-surface-raised p-5">
          <Heading>What else I considered</Heading>
          <Bullets items={bundle.alternatives.map((a) => `${a.option}: ${a.reason}`)} />
        </section>
      ) : null}

      <Investigation proposal={proposal} />

      {bundle.risks.length > 0 ? (
        <section className="space-y-2 rounded-2xl border border-border bg-surface-raised p-5">
          <Heading>Risks</Heading>
          <Bullets items={bundle.risks} />
        </section>
      ) : null}

      <section className="space-y-2 rounded-2xl border border-border bg-surface-raised p-5">
        <Heading>How I will measure it</Heading>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{bundle.measurementPlan}</p>
        <p className="text-[13px] text-muted-foreground">I will watch: {bundle.metric}</p>
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-surface-raised p-5">
        <MarkImplemented
          proposalId={proposal.id}
          label={isNew ? "I built this page" : "I made this change"}
          newPage={isNew}
          components={bundle.components.map((c) => ({ kind: c.kind, label: c.label }))}
        />
        <p className="text-[12px] text-muted-foreground">
          After you make it, I check the page myself and the measurement starts from what I find.
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
function Investigation({ proposal }: { proposal: ChangeProposal }) {
  const finding = proposal.causeFinding;
  const receipt = proposal.rankingReceipt;
  const hints = (proposal.evidence?.hints ?? []).filter((h) => h.trim().length > 0);
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
              <p className="text-[12px] font-semibold text-foreground">What I think is wrong</p>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {causeLabel(finding.cause)}. {finding.explanation}
              </p>
            </div>
            {finding.competingExplanations.length > 0 ? (
              <div className="space-y-1">
                <p className="text-[12px] font-semibold text-foreground">What else I considered and why it lost</p>
                <Bullets items={finding.competingExplanations.map((c) => `${causeLabel(c.cause)}: ${c.reason}.`)} />
              </div>
            ) : null}
            <div className="space-y-1">
              <p className="text-[12px] font-semibold text-foreground">What would change my mind</p>
              <p className="text-[13px] leading-relaxed text-muted-foreground">{finding.falsifier}</p>
            </div>
            {finding.notConsidered.length > 0 ? (
              <div className="space-y-1">
                <p className="text-[12px] font-semibold text-foreground">What I could not test, and why</p>
                <Bullets items={finding.notConsidered.map((n) => `${causeLabel(n.cause)}: ${n.missing}`)} />
              </div>
            ) : null}
          </>
        ) : null}

        {hints.length > 0 ? (
          <div className="space-y-1">
            <p className="text-[12px] font-semibold text-foreground">What I read to get here</p>
            <Bullets items={hints} />
          </div>
        ) : null}

        {receipt ? (
          <div className="space-y-1">
            <p className="text-[12px] font-semibold text-foreground">Why this one ranks where it does</p>
            <ul className="space-y-1 text-[13px] leading-relaxed text-muted-foreground">
              {receipt.factors.map((f, i) => (
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
  facts,
  isNew,
}: {
  component: BundleComponent;
  facts: Map<string, BundleEvidenceItem>;
  isNew: boolean;
}) {
  const cited = component.evidenceKeys.map((k) => facts.get(k)).filter((i): i is BundleEvidenceItem => Boolean(i));
  // The producer already answered where this lands, what it achieves and why it works, and named the sources
  // still owed before it goes out. All four were carried on the row and rendered nowhere, so the operator was
  // handed copy with no place to put it and a source pack they could not see.
  const plan: [string, string | undefined][] = [["Where it goes", component.where], ["What it does", component.objective], ["Why it works", component.mechanism]];
  const pack = component.sourcePack ?? null;
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
        <p className="text-[12px] italic text-muted-foreground">This page has none today.</p>
      )}
      <div className="space-y-1">
        <p className="text-[12px] text-muted-foreground">Use this</p>
        <CopyBlock component={component} />
      </div>
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
          <Bullets items={cited.map((i) => i.fact)} />
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

/**
 * Phase 1.6 (Sprint 1 follow-up, 2026-04-24) — honest error state.
 *
 * Rendered when the repository fetch fails. Deliberately does NOT fall back
 * to the stale module-level `changelogEntries` array that this page used to
 * read from — the whole point of the fresh-read pattern is that operators
 * never see a detail page that conflicts with /changes. A transient read
 * failure is rare enough that a plain retry message is the right UX.
 * Matches the error shape on /changes main list.
 */
function ChangeDetailReadError({ error }: { error: unknown }) {
  const message =
    error instanceof Error
      ? error.message
      : "Unknown error reading changelog entry";
  return (
    <div className="max-w-3xl">
      <section
        className="rounded-lg border border-status-warning/40 bg-status-warning/5 px-5 py-5"
        aria-labelledby="change-detail-read-error-heading"
      >
        <h2
          id="change-detail-read-error-heading"
          className="text-[13px] font-semibold text-foreground tracking-tight"
        >
          Couldn&apos;t load this change
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {message}
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          This usually means the database is temporarily unreachable. Refresh
          the page to retry. We never fall back to cached data here, so you
          won&apos;t see stale truth by accident.
        </p>
        <Link
          href="/changes"
          className="mt-4 inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
        >
          ← Back to Changes
        </Link>
      </section>
    </div>
  );
}
