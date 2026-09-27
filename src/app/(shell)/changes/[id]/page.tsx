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
import { actionableProposalFailures, componentIdOf, loadChangeProposal, openHold, resolveCurrentBasis, sameComponentId } from "@/domains/decision";
import type { ChangeProposal } from "@/domains/decision";
import { monthDayLabel } from "@/components/data/receipt-line";
import operatorUiPolicy, { pageLabel } from "../types";
import { BundleDetail, SimpleDetail } from "./bundle-detail";
import { SetAsideChange } from "../change-controls";
type StoredDetail = Parameters<NonNullable<NonNullable<Parameters<typeof loadChangeProposal>[2]>["canonicalRow"]>>[0];

// Force dynamic render so every request runs the fresh-repo-read pattern below. Matches /changes.
export const dynamic = "force-dynamic";

export default async function ChangeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const trace = createPerfTrace("loader:/changes/[id]", {
    traceId: await readPerfTraceIdFromHeaders(),
    route: "/changes/[id]",
  });
  try {
    const { id: rawId } = await params;
    const requestedReturn = (await searchParams)?.returnTo;
    const returnTo = typeof requestedReturn === "string" && /^\/changes(?:\?|$)/.test(requestedReturn) ? requestedReturn : "/changes";
    // Next hands the path segment URL-encoded; proposal ids carry "::" and "/".
    const id = decodeURIComponent(rawId);
    const tenantId = await currentTenantId();
    const { access } = await requireReadyAccount(tenantId);
    if (access.kind === "suspended") redirect("/");

    // One bounded row read and the current basis keep a direct link aligned with the ranked queue.
    let canonical: StoredDetail | undefined; const inspect = (row: StoredDetail) => { canonical = row; };
    const [proposal, basis] = await Promise.all([loadChangeProposal(tenantId, id, { canonicalRow: inspect }), resolveCurrentBasis(tenantId)]);
    const inProof = proposal != null && operatorUiPolicy.isManualEditProofWork(proposal);
    const found = proposal && inProof && actionableProposalFailures(proposal, { tenantId, currentBasis: basis }).length === 0 ? proposal : null;
    // Already-recorded components are disabled in the picker; the server remains idempotent if this read fails.
    if (found?.bundle) {
      const ledger = (await loadProofLedgerPersisted(tenantId).catch(() => [])).filter((r) => r.proposalId === found.id), change = found.recommendedChange;
      const recorded = new Set(found.bundle.components.flatMap((c, i) => {
        const link = ["internal_link_add", "internal_links", "anchor_text"].includes(c.kind), current = { ...c, page: c.page ?? found.pageUrl ?? found.pagePath,
          anchorAfter: link ? (c.anchorAfter ?? (change.kind === "existing_edit" ? change.anchorText : null))?.trim() || null : null, redirectTo: c.redirectTo ?? (link && change.kind === "existing_edit" ? change.linkTo : null) ?? null };
        return ledger.some((r) => (r.componentsApplied ?? []).some((applied) => applied.id && sameComponentId(applied.id, componentIdOf(c, i), [{ ...applied, before: applied.before === undefined && r.componentsApplied?.length === 1 ? r.before : applied.before, page: applied.page ?? r.page }, current]))) ? [componentIdOf(c, i)] : [];
      }));
      return <BundleDetail proposal={found} bundle={found.bundle} recorded={recorded} returnTo={returnTo} />;
    }
    if (found) return <SimpleDetail proposal={found} returnTo={returnTo} />;
    if (proposal && !inProof) return <OutsideProofDetail />;
    const stored = proposal ?? (await loadChangeProposal(tenantId, id, { retired: "include", canonicalOnly: true, canonicalRow: inspect }).catch(() => null));
    if (stored?.status === "implemented_pending_verification") {
      const row = (await loadProofLedgerPersisted(tenantId).catch(() => [])).find((r) => r.proposalId === stored.id);
      return <DoneDetail proposal={stored} markedAt={row?.implementedAt ?? row?.shippedAt ?? null} measurementState={row?.measurementState ?? null} />;
    }
    if (stored != null) {
      const archived = stored.id === id && stored.tenantId === tenantId && canonical?.terminal_disposition != null && canonical.proposal_version > 0 ? stored : null;
      let successor: { id: string; version: number; ready: boolean } | null = null;
      if (archived && canonical?.terminal_disposition === "superseded" && canonical.superseded_by && canonical.superseded_by !== id && canonical.superseded_by.startsWith(`${tenantId}::`)) {
        let next: StoredDetail | undefined; const current = await loadChangeProposal(tenantId, canonical.superseded_by, { canonicalOnly: true, canonicalRow: row => { next = row; } }).catch(() => null);
        const ready = current?.status === "ready" && actionableProposalFailures(current, { tenantId, currentBasis: basis }).length === 0 && !openHold(current).faulted && !openHold(current).blocking;
        const priorMeta = operatorUiPolicy.isMetaPredecessor(archived);
        const unfinished = priorMeta && current?.status === "needs_review" && current.researchOnly === true && current.obligation?.kind === "draft" && current.recommendedChange.kind === "existing_edit" && current.recommendedChange.field === "meta" && current.recommendedChange.before == null && current.pagePath === archived.pagePath && actionableProposalFailures(current, { tenantId, currentBasis: basis }).length === 0;
        if (current?.id === canonical.superseded_by && next?.terminal_disposition == null && next && next.proposal_version > 0 && operatorUiPolicy.isManualEditProofWork(current) && (ready || unfinished)) successor = { id: current.id, version: next.proposal_version, ready: !!ready };
      }
      return <SetAsideDetail unreadable={basis == null} proposal={archived} canonical={canonical} successor={successor} />;
    }

    const repository = getRepository().forTenant(tenantId);
    let freshChangelogEntries: ChangelogEntry[];
    try {
      freshChangelogEntries = await repository.getChangelogEntries();
    } catch (error) {
      return <ChangeDetailReadError error={error} />;
    }

    const entry = freshChangelogEntries.find((c) => c.id === id);
    if (!entry) notFound();

    const proofLedger = await loadProofLedgerPersisted(tenantId).catch(() => []);
    const canonicalProof = findProofForChange(entry, proofLedger);
    redirect(canonicalProof ? proofResultHref(canonicalProof) : "/results");
  } finally {
    trace.flush();
  }
}

function OutsideProofDetail() {
  return <div className="max-w-3xl"><section className="space-y-2 rounded-2xl border border-border bg-surface-raised p-5" data-outside-manual-proof="true">
    <h2 className="text-[14px] font-semibold text-foreground">Kept for the later whole-page phase</h2>
    <p className="text-[13px] leading-relaxed text-muted-foreground">The current proof is existing-page manual edits only. This whole-page opportunity stays on file, but it cannot be copied, confirmed, skipped, or marked done from Today or Changes.</p>
    <Link href="/changes" className="inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2">Back to existing-page edits</Link>
  </section></div>;
}

function SetAsideDetail({ unreadable, proposal, canonical, successor }: { unreadable: boolean; proposal: ChangeProposal | null; canonical?: StoredDetail; successor: { id: string; version: number; ready: boolean } | null }) {
  const pieces = proposal?.bundle?.components ?? (proposal ? [{ kind: proposal.recommendedChange.kind, before: proposal.recommendedChange.kind === "existing_edit" ? proposal.recommendedChange.before : null, after: proposal.recommendedChange.kind === "existing_edit" ? proposal.recommendedChange.after : proposal.recommendedChange.openingAnswer }] : []);
  return <div className="max-w-3xl"><section className="space-y-3 rounded-2xl border border-border bg-surface-raised p-5">
    <h2 className="text-[14px] font-semibold text-foreground">{unreadable ? "This one cannot be shown right now" : "This idea was set aside"}</h2>
    <p className="text-[13px] leading-relaxed text-muted-foreground">{proposal ? `Archived version ${canonical?.proposal_version}. Its draft is retained for inspection and cannot be applied from here.` : unreadable ? "Current saved work could not be confirmed. No unbacked copy is offered." : "This idea is no longer offered. Changes shows the work that stands now."}</p>
    {proposal && canonical?.withdrawn_reason ? <div data-retirement-reason="true"><p className="text-[12px] text-muted-foreground">Historical reason recorded when this version was set aside:</p><p className="text-[13px] leading-relaxed">{canonical.withdrawn_reason}</p></div> : null}
    {proposal ? <><SetAsideChange proposalId={proposal.id} historyOnly /><details data-archived-copy="true"><summary className="text-[13px] font-semibold">Inspect historical draft (not ready to apply)</summary>
      <p className="mt-3 text-[12px]">{proposal.pageUrl ?? proposal.pagePath}{proposal.recommendedChange.kind === "existing_edit" && proposal.recommendedChange.where ? ` — ${proposal.recommendedChange.where}` : ""}</p>
      {pieces.map((piece, i) => <div key={i} className="mt-3 space-y-2 text-[13px]"><p>{piece.kind}</p>{piece.before ? <p>Was: {piece.before}</p> : null}<pre className="whitespace-pre-wrap font-sans">{piece.after}</pre></div>)}
      {(proposal.supportFacts ?? []).map(fact => <p key={fact.id} className="mt-3 text-[12px]">{fact.fact}{fact.sources?.map(source => ` ${source.url}`).join("")}</p>)}
    </details></> : null}
    {successor ? <Link data-successor="true" href={`/changes/${encodeURIComponent(successor.id)}`} className="text-[13px] text-accent-primary underline">{successor.ready ? "See the current replacement" : "Continue preparing the current change"}, version {successor.version}</Link> : null}
    <Link href="/changes" className="inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2">See the work that stands now</Link>
  </section></div>;
}

/** WHAT WAS DONE AND WHEN THE ANSWER COMES, for a change already recorded. No copy to paste, no control to press
 *  again, and no invented outcome: the reading is the ledger's job and Results is where it lands. */
function DoneDetail({ proposal, markedAt, measurementState }: { proposal: ChangeProposal; markedAt: string | null; measurementState: string | null }) {
  const c = proposal.recommendedChange;
  const before = c.kind === "existing_edit" ? c.before : null;
  const after = c.kind === "new_page" ? c.proposedTitle : c.after;
  const day = monthDayLabel(markedAt);
  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/changes" className="inline-flex text-[13px] text-muted-foreground hover:text-foreground">
        Back to Changes
      </Link>
      <section className="space-y-3 rounded-2xl border border-accent-primary/50 bg-surface-raised p-5" data-change-done="true">
        <h2 className="text-[14px] font-semibold text-foreground">{proposal.pagePath ? pageLabel(proposal.pagePath) : (proposal.pageLabel || "This page")}</h2>
        <p className="text-[12px] text-muted-foreground">{proposal.pagePath ?? proposal.pageLabel}</p>
        <p className="text-[15px] font-semibold leading-relaxed text-foreground">{proposal.bundle?.objective ?? proposal.opportunityType}</p>
        {before ? (
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Was: <span className="line-through">{before}</span>
          </p>
        ) : null}
        {after ? (
          <p className="rounded-lg border border-accent-primary/40 bg-accent-primary/5 px-3 py-2 text-[13px] leading-relaxed text-foreground">
            <span className="text-muted-foreground">Now: </span>{after}
          </p>
        ) : null}
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {day ? `Marked done ${day}. ` : "Marked done. "}{operatorUiPolicy.measurementAcknowledgement(measurementState, markedAt ? new Date(markedAt) : new Date())}
        </p>
        <Link href="/results" className="inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2">
          See what every change earned
        </Link>
      </section>
    </div>
  );
}

/** The honest read failure. It deliberately does NOT fall back to anything cached: the whole point of the
 *  fresh-read pattern is that this page never contradicts /changes. THE RAW EXCEPTION NEVER REACHES THE SCREEN:
 *  "TypeError: fetch failed" is not an answer to "did my action work", so the message is logged where an engineer
 *  can read it and the operator gets the same plain copy every other failure door here gives. */
function ChangeDetailReadError({ error }: { error: unknown }) {
  console.error("changes/[id] changelog read failed", error);
  return (
    <div className="max-w-3xl">
      <section className="rounded-lg border border-status-warning/40 bg-status-warning/5 px-5 py-5" aria-labelledby="change-read-error">
        <h2 id="change-read-error" className="text-[13px] font-semibold tracking-tight text-foreground">This change could not be loaded just now</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Your data is safe and nothing was lost. Refresh to read it again: cached truth is never shown by accident.
        </p>
        <Link href="/changes" className="mt-4 inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85">
          Back to Changes
        </Link>
      </section>
    </div>
  );
}
