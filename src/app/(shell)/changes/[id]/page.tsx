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
import { actionableProposalFailures, loadChangeProposal, resolveCurrentBasis, validateProposal } from "@/domains/decision";
import type { ChangeProposal } from "@/domains/decision";
import { monthDayLabel } from "@/components/data/receipt-line";
import { pageLabel } from "../types";
import { BundleDetail, SimpleDetail } from "./bundle-detail";

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
    // THE SAME ONE VERDICT THE LIST ASKS. A link is not a side entrance: a receipt that stopped resolving, a
    // merge sitting in ready and readings that went cold are refused here exactly as they are refused there.
    const [proposal, basis] = await Promise.all([loadChangeProposal(tenantId, id), resolveCurrentBasis(tenantId)]);
    const found = proposal && actionableProposalFailures(proposal, { tenantId, currentBasis: basis }).length === 0
      && (proposal.kind !== "new_page" || validateProposal(proposal).verdict !== "rejected") ? proposal : null;
    // WHAT IS ALREADY ON FILE, so the picker opens on the pieces nobody has recorded yet. Fail-soft: an unreadable ledger offers
    // everything, which the server subtracts from anyway, so no press can record one piece twice.
    if (found?.bundle) {
      const recorded = new Set((await loadProofLedgerPersisted(tenantId).catch(() => []))
        .filter((r) => r.proposalId === found.id)
        .flatMap((r) => (r.componentsApplied ?? []).map((c) => c.id).filter((cid): cid is string => Boolean(cid))));
      return <BundleDetail proposal={found} bundle={found.bundle} recorded={recorded} />;
    }
    // LIVE WORK WITH NOTHING TO UNPACK still gets its own page: once the queue became mostly suggestion and
    // sweep cards, the old redirect-to-the-list here bounced every "See the change" press straight back.
    if (found) return <SimpleDetail proposal={found} />;
    const stored = proposal ?? (await loadChangeProposal(tenantId, id, { retired: "include" }).catch(() => null));
    // A CHANGE ALREADY RECORDED IS NOT A MISSING PAGE. Pressing Mark done and reopening this address fell all
    // the way through to the changelog lookup and rendered the framework's unstyled 404, which is the worst
    // possible answer to "did my action work". It now says what was done, when, and when the reading lands.
    if (stored?.status === "implemented_pending_verification") {
      const row = (await loadProofLedgerPersisted(tenantId).catch(() => [])).find((r) => r.proposalId === stored.id);
      return <DoneDetail proposal={stored} markedAt={row?.implementedAt ?? row?.shippedAt ?? null} />;
    }
    if (stored != null) return <SetAsideDetail unreadable={basis == null} />;

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

/** The honest end of a stale direct link: no exact copy, no before and after, and
 *  no way to record work I no longer stand behind. One decision, one way back. */
function SetAsideDetail({ unreadable }: { unreadable: boolean }) {
  return (
    <div className="max-w-3xl">
      <section className="space-y-2 rounded-2xl border border-border bg-surface-raised p-5">
        <h2 className="text-[14px] font-semibold text-foreground">{unreadable ? "This one cannot be shown right now" : "This idea was set aside"}</h2>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {unreadable
            ? "Which of your saved ideas still hold could not be confirmed just now, so no unbacked copy is handed over. Beacon is checking again automatically, and every change that stands is ranked on Changes."
            : "The bar for what counts as worth your time went up, and this idea no longer clears it, so no copy without evidence behind it is handed over. Your pages are still being checked, and every change that earns its place is ranked on Changes."}
        </p>
        <Link href="/changes" className="inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2">
          See the work that stands now
        </Link>
      </section>
    </div>
  );
}

/** WHAT WAS DONE AND WHEN THE ANSWER COMES, for a change already recorded. No copy to paste, no control to press
 *  again, and no invented outcome: the reading is the ledger's job and Results is where it lands. */
function DoneDetail({ proposal, markedAt }: { proposal: ChangeProposal; markedAt: string | null }) {
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
          {day ? `Marked done ${day}. ` : "Marked done. "}Measuring for 28 days; the first reading lands at 7 days.
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
