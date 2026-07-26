"use client";

/**
 * changes-list-client (CORE 100K cutover, 2026-07-22) — renders the ranked
 * ChangeProposal queue. One object (a proposal) across one lifecycle:
 *   Ready (validated safe, exact copy) → operator applies → Measuring (Results).
 * Existing-page edits show the exact before → after; new-page briefs render their
 * full build brief, kept visually distinct. Every row carries why-it-matters,
 * effort, risk, honest confidence, and its limitations. Publishing is MANUAL:
 * the only mutating control is "Mark implemented", which records the operator's
 * own confirmation (it never writes a live page).
 */

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { ChangesClientView } from "./changes-data";
import type { ChangeProposal, ChangeBundle } from "@/domains/decision";
import { markProposalImplementedAction } from "./changes/actions";

type Tab = "ready" | "todo";

const RISK_LABEL: Record<ChangeProposal["riskLevel"], string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
};
const CONFIDENCE_LABEL: Record<ChangeProposal["confidence"], string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

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

/**
 * Slice 7: a proposal carrying a Change Bundle is the flagship row: one plain
 * recommendation, the strongest reason, the honest evidence count, and ONE
 * action (open the full change). The exact copy lives on the detail page.
 * Slice 8: the same row also carries a new-page bundle. Only the badge and the
 * parts wording change: a page that does not exist yet has no edits to make,
 * it has pieces to paste.
 */
function BundleRow({ proposal, bundle, rank, inReadyLane }: { proposal: ChangeProposal; bundle: ChangeBundle; rank: number; inReadyLane: boolean }) {
  const checks = bundle.receipt.items.length;
  const parts = bundle.components.length;
  const isNew = proposal.kind === "new_page";
  const partsLabel = isNew
    ? `${parts} ${inReadyLane ? "ready-to-paste" : "drafted"} piece${parts === 1 ? "" : "s"}`
    : `${parts} exact edit${parts === 1 ? "" : "s"}${inReadyLane ? ", copy ready" : ""}`;
  const reason = bundle.confidenceReasons[0] ?? bundle.receipt.items[0]?.fact ?? null;
  return (
    <li className="space-y-2 rounded-2xl border border-accent-primary/50 bg-surface-raised p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] tabular-nums text-muted-foreground">{rank}</span>
        <span className="rounded bg-accent-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-accent-primary">
          {isNew ? "New page" : "Bundled change"}
        </span>
        <span className="text-[14px] font-semibold text-foreground">{proposal.pageLabel}</span>
      </div>
      <p className="text-[14px] leading-relaxed text-foreground">{proposal.whyItMatters}</p>
      {reason ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground">Strongest reason: {reason}</p>
      ) : null}
      <p className="text-[12px] text-muted-foreground tabular-nums">
        {partsLabel} · about {proposal.estimatedEffortMinutes} min · Backed by{" "}
        {checks} check{checks === 1 ? "" : "s"} · {CONFIDENCE_LABEL[proposal.confidence]}
      </p>
      <Link
        href={`/changes/${encodeURIComponent(proposal.id)}`}
        className="inline-flex rounded-md bg-accent-primary px-3 py-1.5 text-[13px] font-semibold text-white"
      >
        See the change
      </Link>
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
              {isNew ? "New page" : "Edit"}
            </span>
            <span className="text-[14px] font-semibold text-foreground">{proposal.pageLabel}</span>
          </span>
          <span className="block text-[13px] leading-relaxed text-muted-foreground">{proposal.whyItMatters}</span>
          <span className="block text-[12px] text-muted-foreground tabular-nums">
            {proposal.opportunityType} · about {proposal.estimatedEffortMinutes} min · {RISK_LABEL[proposal.riskLevel]} ·{" "}
            {CONFIDENCE_LABEL[proposal.confidence]}
          </span>
        </span>
      </button>

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

export function MarkImplemented({ proposalId, label: idle = "Mark implemented" }: { proposalId: string; label?: string }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ done: boolean; error: string | null }>({ done: false, error: null });
  const label = useMemo(() => (state.done ? "Marked implemented" : idle), [state.done, idle]);

  function onClick() {
    startTransition(async () => {
      const res = await markProposalImplementedAction({ proposalId });
      if (res.success) setState({ done: true, error: null });
      else setState({ done: false, error: res.error ?? "Something went wrong." });
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={pending || state.done}
        className="rounded-md bg-accent-primary px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : label}
      </button>
      <span className="text-[12px] text-muted-foreground">
        You apply the change on your site; this only records that you did it.
      </span>
      {state.error ? <span className="text-[12px] text-red-500">{state.error}</span> : null}
    </div>
  );
}
