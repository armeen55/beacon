"use client";

/**
 * changes-list-client (V1 Truth Convergence Phase 8, 2026-08-01): the ranked ChangeProposal
 * queue, with the receipts the kernel already computes actually reaching the operator.
 *
 * EVERY CARD NOW SAYS, WITHOUT BEING OPENED: whether it is one edit or a bundle that has to land
 * together, the exact primary action, how long it takes, its risk, how much evidence stands
 * behind it, and WHY IT SITS ABOVE THE ONE BELOW IT. That last sentence has been stamped by the
 * ranker (rank-proposals.whyRankedAboveNext) since Phase 3 and reached no screen at all, so a
 * ranked queue asked the operator to trust an order it never explained.
 *
 * A DANGEROUS CHANGE CARRIES ITS HOLD. The two-step confirmation in this product is the
 * `needs_review` lifecycle, not a second flag, so a change that moves or hides a page says on the
 * card that it is waiting for the operator to read it and then act.
 *
 * Publishing is MANUAL. The mutating controls are "Mark implemented" (which records the
 * operator's own confirmation and never writes a live page) and "Put this aside".
 */

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { ChangesClientView } from "./changes-data";
import type { ChangeProposal, ChangeBundle } from "@/domains/decision";
import { dismissProposalAction, markProposalImplementedAction } from "./changes/actions";

type Tab = "ready" | "todo";

const RISK_LABEL: Record<ChangeProposal["riskLevel"], string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
};

/** How much comparison evidence stands behind the change, in the same plain words the Today
 *  command uses for the same field. Never "confidence: high" with nothing behind it. */
const EVIDENCE_LABEL: Record<ChangeProposal["confidence"], string> = {
  high: "Strong evidence",
  medium: "Early evidence",
  low: "Still building evidence",
};

/** THE TWO-STEP HOLD, in the operator's words. A component that moves or hides the page is
 *  graded `dangerous` by the validator (which refuses any bundle where it is not), so this is
 *  the one check a surface has to make. */
function dangerousParts(bundle: ChangeBundle | undefined): string[] {
  return (bundle?.components ?? []).filter((c) => c.risk === "dangerous").map((c) => c.label);
}

/** The exact primary action, in one line. A bundle states its objective; an atomic edit names
 *  the field it rewrites and the search it sharpens for. */
function primaryAction(p: ChangeProposal): string {
  if (p.bundle) return p.bundle.objective;
  const c = p.recommendedChange;
  if (c.kind === "new_page") return `Build a new page that answers "${p.primaryQuery}"`;
  const field = c.field === "meta" ? "description" : c.field.replace(/_/g, " ");
  return `Update the ${field} on ${p.pageLabel} to sharpen it for "${p.primaryQuery}"`;
}

export function ChangesListClient({ view }: { view: ChangesClientView }) {
  const [tab, setTab] = useState<Tab>(view.ready.length > 0 ? "ready" : "todo");
  const rows = tab === "ready" ? view.ready : view.toDo;

  return (
    <div className="space-y-4">
      {view.receiptLine ? (
        <p className="text-[12px] text-muted-foreground tabular-nums">{view.receiptLine}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <TabButton active={tab === "ready"} onClick={() => setTab("ready")}>
          Ready {view.summary.ready}
        </TabButton>
        <TabButton active={tab === "todo"} onClick={() => setTab("todo")}>
          To do {view.summary.todo}
        </TabButton>
        <Link
          href="/results"
          className="ml-auto rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground"
        >
          Measuring {view.summary.measuring} · Results {view.summary.results}
        </Link>
      </div>

      {tab === "ready" && view.ready.length === 0 && view.readyZeroHint ? (
        <p className="rounded-2xl border border-dashed border-border bg-surface-raised p-6 text-[13px] leading-relaxed text-muted-foreground">
          {view.readyZeroHint}
        </p>
      ) : null}

      {rows.length === 0 && tab === "todo" ? (
        <p className="rounded-2xl border border-dashed border-border bg-surface-raised p-6 text-center text-[13px] text-muted-foreground">
          Nothing waiting for a review right now.
        </p>
      ) : null}

      <ol className="space-y-3">
        {rows.map((p, i) =>
          p.bundle ? (
            <BundleRow key={p.id} proposal={p} bundle={p.bundle} rank={i + 1} inReadyLane={tab === "ready"} />
          ) : (
            <ProposalRow key={p.id} proposal={p} rank={i + 1} canApply={tab === "ready"} />
          ),
        )}
      </ol>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 tabular-nums transition-colors ${
        active
          ? "border-accent-primary/50 bg-accent-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/** The four facts every card states without being opened. */
function FactsLine({ proposal, extra }: { proposal: ChangeProposal; extra?: string | null }) {
  return (
    <p className="text-[12px] text-muted-foreground tabular-nums" data-change-facts="true">
      {extra ? `${extra} · ` : ""}about {proposal.estimatedEffortMinutes} min · {RISK_LABEL[proposal.riskLevel]} ·{" "}
      {EVIDENCE_LABEL[proposal.confidence]}
    </p>
  );
}

/** WHY THIS SITS WHERE IT SITS. Rendered, never recomputed: the ranker stamped this sentence and
 *  names the one factor that actually separated this change from the next. */
function WhyRanked({ proposal }: { proposal: ChangeProposal }) {
  if (!proposal.whyRankedAboveNext) return null;
  return (
    <p className="text-[12px] leading-relaxed text-muted-foreground" data-why-ranked="true">
      {proposal.whyRankedAboveNext}
    </p>
  );
}

/** The two-step hold, said on the card so it cannot be missed. */
function DangerousHold({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <p
      className="rounded-md border border-status-warning/40 bg-status-warning/5 px-3 py-2 text-[12px] leading-relaxed text-foreground"
      data-dangerous-hold="true"
    >
      {labels.join(" and ")}: this changes where the page lives or whether people can find it, so I am holding
      it for you to read once and confirm before you make the change.
    </p>
  );
}

/**
 * A proposal carrying a Change Bundle is the flagship row: the exact primary action, the
 * strongest reason, the four facts, the hold when there is one, the ranker's own sentence, and
 * two controls (open the full change, or put it aside). The exact copy lives on the detail page.
 * A new-page bundle uses the same row: only the badge and the parts wording change, because a
 * page that does not exist yet has no edits to make, it has pieces to paste.
 */
function BundleRow({ proposal, bundle, rank, inReadyLane }: { proposal: ChangeProposal; bundle: ChangeBundle; rank: number; inReadyLane: boolean }) {
  const checks = bundle.receipt.items.length;
  const parts = bundle.components.length;
  const isNew = proposal.kind === "new_page";
  const partsLabel = isNew
    ? `${parts} ${inReadyLane ? "ready-to-paste" : "drafted"} piece${parts === 1 ? "" : "s"}`
    : `${parts} exact edit${parts === 1 ? "" : "s"}${inReadyLane ? ", copy ready" : ""}`;
  const reason = bundle.confidenceReasons[0] ?? bundle.receipt.items[0]?.fact ?? null;
  const held = dangerousParts(bundle);
  return (
    <li className="space-y-2 rounded-2xl border border-accent-primary/50 bg-surface-raised p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] tabular-nums text-muted-foreground">{rank}</span>
        <span className="rounded bg-accent-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-accent-primary">
          {/* One component is one edit: only genuinely interdependent parts are a bundle. */}
          {isNew ? "New page" : parts > 1 ? "Bundled change" : "One edit"}
        </span>
        <span className="text-[14px] font-semibold text-foreground">{proposal.pageLabel}</span>
      </div>
      <p className="text-[14px] font-semibold leading-relaxed text-foreground">{primaryAction(proposal)}</p>
      <p className="text-[13px] leading-relaxed text-muted-foreground">{proposal.whyItMatters}</p>
      {reason ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground">Strongest reason: {reason}</p>
      ) : null}
      <FactsLine proposal={proposal} extra={`${partsLabel} · backed by ${checks} check${checks === 1 ? "" : "s"}`} />
      <DangerousHold labels={held} />
      <WhyRanked proposal={proposal} />
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Link
          href={`/changes/${encodeURIComponent(proposal.id)}`}
          className="inline-flex rounded-md bg-accent-primary px-3 py-1.5 text-[13px] font-semibold text-white"
        >
          See the change
        </Link>
        <SetAsideChange proposalId={proposal.id} />
      </div>
    </li>
  );
}

function ProposalRow({ proposal, rank, canApply }: { proposal: ChangeProposal; rank: number; canApply: boolean }) {
  const [open, setOpen] = useState(rank === 1);
  const isNew = proposal.recommendedChange.kind === "new_page";
  return (
    <li className="rounded-2xl border border-border bg-surface-raised">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        <span className="mt-0.5 text-[12px] tabular-nums text-muted-foreground">{rank}</span>
        <span className="flex-1 space-y-1">
          <span className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                isNew ? "bg-accent-primary/15 text-accent-primary" : "bg-surface-inset text-muted-foreground"
              }`}
            >
              {isNew ? "New page" : "One edit"}
            </span>
            <span className="text-[14px] font-semibold text-foreground">{proposal.pageLabel}</span>
          </span>
          <span className="block text-[14px] font-semibold leading-relaxed text-foreground">{primaryAction(proposal)}</span>
          <span className="block text-[13px] leading-relaxed text-muted-foreground">{proposal.whyItMatters}</span>
        </span>
      </button>

      <div className="space-y-2 px-4 pb-3">
        <FactsLine proposal={proposal} extra={proposal.opportunityType} />
        <WhyRanked proposal={proposal} />
      </div>

      {open ? (
        <div className="space-y-4 border-t border-border px-4 pb-4 pt-3">
          <ChangeBody proposal={proposal} />
          {proposal.limitations.length > 0 ? (
            <div className="space-y-1">
              <p className="text-[12px] font-semibold text-foreground">What to keep in mind</p>
              <ul className="list-disc space-y-0.5 pl-4 text-[12px] leading-relaxed text-muted-foreground">
                {proposal.limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {canApply ? <MarkImplemented proposalId={proposal.id} /> : null}
          <SetAsideChange proposalId={proposal.id} />
        </div>
      ) : null}
    </li>
  );
}

function ChangeBody({ proposal }: { proposal: ChangeProposal }) {
  const c = proposal.recommendedChange;
  if (c.kind === "existing_edit") {
    const fieldLabel = c.field === "meta" ? "description" : c.field.replace(/_/g, " ");
    return (
      <div className="space-y-2">
        <p className="text-[12px] font-semibold text-foreground">Change the {fieldLabel}</p>
        {c.before ? (
          <p className="rounded-lg bg-surface-inset px-3 py-2 text-[13px] text-muted-foreground line-through">{c.before}</p>
        ) : (
          <p className="text-[12px] italic text-muted-foreground">No current value on the page.</p>
        )}
        <p className="rounded-lg border border-accent-primary/40 bg-accent-primary/5 px-3 py-2 text-[13px] text-foreground">
          {c.after}
        </p>
      </div>
    );
  }
  // FAQPage is not a win to recommend: Google restricts FAQ rich results to
  // authoritative government and health sites, so a normal page marking it up gets
  // nothing extra in search. It stays in the saved brief; it just never renders as
  // something I am telling the operator to add.
  const schemaToShow = c.schemaTypes.filter((s) => s.trim().toLowerCase() !== "faqpage");
  return (
    <div className="space-y-3">
      <Field label="Title" value={c.proposedTitle} />
      <Field label="Meta description" value={c.metaDescription} />
      <Field label="Opening answer" value={c.openingAnswer} />
      {c.outline.length > 0 ? (
        <div>
          <p className="text-[12px] font-semibold text-foreground">Outline</p>
          <ul className="list-disc space-y-0.5 pl-4 text-[13px] text-muted-foreground">
            {c.outline.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {c.faqQuestions.length > 0 ? (
        <div>
          <p className="text-[12px] font-semibold text-foreground">FAQ to answer</p>
          <ul className="list-disc space-y-0.5 pl-4 text-[13px] text-muted-foreground">
            {c.faqQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {schemaToShow.length > 0 ? (
        <p className="text-[12px] text-muted-foreground">Schema: {schemaToShow.join(", ")}</p>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[12px] font-semibold text-foreground">{label}</p>
      <p className="rounded-lg border border-border bg-surface-inset px-3 py-2 text-[13px] text-foreground">{value}</p>
    </div>
  );
}

/**
 * "Put this aside" is the operator's own dismissal, with the consequence stated before they press
 * it, not after. It writes the one terminal disposition that means exactly this, and the store
 * then refuses to re-draft the same change until the evidence itself moves.
 */
export function SetAsideChange({ proposalId }: { proposalId: string }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ done: boolean; asked: boolean; error: string | null }>({
    done: false, asked: false, error: null,
  });

  if (state.done) {
    return (
      <p className="text-[12px] text-muted-foreground" data-set-aside-done="true">
        Put aside. I will not suggest this again unless the evidence changes.
      </p>
    );
  }
  if (!state.asked) {
    return (
      <button
        type="button"
        onClick={() => setState((s) => ({ ...s, asked: true }))}
        className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        data-set-aside="true"
      >
        Put this aside
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-[12px] text-muted-foreground">
        I will not suggest this again unless the evidence changes. Put it aside?
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await dismissProposalAction({ proposalId });
            if (res.success) setState({ done: true, asked: true, error: null });
            else setState({ done: false, asked: true, error: res.error ?? "Something went wrong." });
          })
        }
        className="rounded-md border border-border px-3 py-1.5 text-[12px] font-semibold text-foreground disabled:opacity-60"
      >
        {pending ? "Saving…" : "Yes, put it aside"}
      </button>
      <button
        type="button"
        onClick={() => setState({ done: false, asked: false, error: null })}
        className="text-[12px] text-muted-foreground underline underline-offset-2"
      >
        Keep it
      </button>
      {state.error ? <span className="text-[12px] text-red-500">{state.error}</span> : null}
    </div>
  );
}

/**
 * "Mark implemented" records that the OPERATOR applied the change. Two controls ride with
 * it, and both were arguments the server action already accepted:
 *
 *   THE PARTIAL-BUNDLE PICKER. A bundle is several pieces, and an operator who applied three of
 *   five must not have all five recorded as live: the shipment would carry copy that is not on
 *   the page and the live check would fail for reasons nobody caused. Every piece starts ticked,
 *   because applying all of them is the normal case.
 *
 *   THE OVERRIDE. "I applied this differently" tells Beacon the change is live in the operator's
 *   own words and asks it not to go looking for the exact copy on the page. It is never a
 *   default: absent, Beacon reads the page itself before saying anything.
 */
export function MarkImplemented({
  proposalId,
  label: idle = "Mark implemented",
  components,
}: {
  proposalId: string;
  label?: string;
  /** The bundle's pieces, when there are several. Absent or single means nothing to pick. */
  components?: { kind: string; label: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ done: boolean; error: string | null }>({ done: false, error: null });
  const pickable = components && components.length > 1 ? components : null;
  const [applied, setApplied] = useState<Set<string>>(() => new Set((pickable ?? []).map((c) => c.kind)));
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const label = useMemo(() => (state.done ? "Marked implemented" : idle), [state.done, idle]);
  const nothingPicked = pickable != null && applied.size === 0;

  function onClick() {
    startTransition(async () => {
      const res = await markProposalImplementedAction({
        proposalId,
        ...(pickable && applied.size < pickable.length ? { componentKinds: [...applied] } : {}),
        ...(override ? { operatorConfirmed: true, overrideReason: reason.trim() || undefined } : {}),
      });
      if (res.success) setState({ done: true, error: null });
      else setState({ done: false, error: res.error ?? "Something went wrong." });
    });
  }

  return (
    <div className="space-y-3">
      {pickable ? (
        <div className="space-y-1.5" data-component-picker="true">
          <p className="text-[12px] font-semibold text-foreground">Which pieces did you apply?</p>
          {pickable.map((c) => (
            <label key={c.kind} className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <input
                type="checkbox"
                checked={applied.has(c.kind)}
                onChange={(e) =>
                  setApplied((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(c.kind);
                    else next.delete(c.kind);
                    return next;
                  })
                }
              />
              {c.label}
            </label>
          ))}
          <p className="text-[12px] text-muted-foreground">
            I only measure the pieces you tick, so leave the ones you skipped unticked.
          </p>
        </div>
      ) : null}

      <div className="space-y-1.5" data-override-control="true">
        <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
          I applied this differently, so do not check the page for my exact wording
        </label>
        {override ? (
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What did you do instead?"
            className="w-full rounded-md border border-border bg-surface-inset px-3 py-1.5 text-[12px] text-foreground"
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onClick}
          disabled={pending || state.done || nothingPicked}
          className="rounded-md bg-accent-primary px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : label}
        </button>
        <span className="text-[12px] text-muted-foreground">
          {nothingPicked
            ? "Tick at least one piece and I will start measuring it."
            : "You apply the change on your site; this only records that you did it."}
        </span>
        {state.error ? <span className="text-[12px] text-red-500">{state.error}</span> : null}
      </div>
    </div>
  );
}
