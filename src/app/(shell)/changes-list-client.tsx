"use client";

/** changes-list-client: the ranked ChangeProposal queue, with the receipts the kernel computes actually reaching the operator. EVERY CARD
 *  SAYS, WITHOUT BEING OPENED: whether it is one edit or a bundle that has to land together, the exact primary action, how long it takes,
 *  its risk, how much evidence stands behind it, and WHY IT SITS ABOVE THE ONE BELOW IT. A DANGEROUS CHANGE CARRIES ITS HOLD (the
 *  `needs_review` stage, never a second flag) and, where it moves or hides a page, one confirmation the server asks for again. Publishing
 *  is MANUAL; the mutating controls are "Mark implemented" and "Put this aside". */

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { ChangesView } from "./changes-data";
import type { ChangeProposal, ChangeBundle } from "@/domains/decision";
// A client bundle cannot import the server-only kernel facade, so the ONE pure rule for what is dangerous comes from the contract module
// itself rather than a copy of it living here.
import { dangerousComponents } from "@/domains/decision/contracts";
import { dismissProposalAction, loadMoreChangesAction, markProposalImplementedAction } from "./changes/actions";
import { CHANGES_PAGE_SIZE } from "./changes/types";

type Tab = "ready" | "todo";

const RISK_LABEL: Record<ChangeProposal["riskLevel"], string> = { low: "Low risk", medium: "Medium risk", high: "High risk" };

/** How much comparison evidence stands behind the change, in the same words Today uses for the field. */
const EVIDENCE_LABEL: Record<ChangeProposal["confidence"], string> = { high: "Strong evidence", medium: "Early evidence", low: "Still building evidence" };

/** THE TWO-STEP HOLD, in the operator's words, off the ONE canonical rule: the grade, the kind, or a correction to a high-stakes fact. A
 *  copy of it here read the grade alone and missed the other two. */
const dangerousParts = (bundle: ChangeBundle | undefined): string[] =>
  dangerousComponents(bundle?.components ?? []).map((c) => c.label);

/** The exact primary action in one line: a bundle's objective, or the field an atomic edit rewrites. */
function primaryAction(p: ChangeProposal): string {
  if (p.bundle) return p.bundle.objective;
  const c = p.recommendedChange;
  if (c.kind === "new_page") return `Build a new page that answers "${p.primaryQuery}"`;
  const field = c.field === "meta" ? "description" : c.field.replace(/_/g, " ");
  return `Update the ${field} on ${p.pageLabel} to sharpen it for "${p.primaryQuery}"`;
}

export function ChangesListClient({ view }: { view: ChangesView }) {
  const [tab, setTab] = useState<Tab>(view.ready.length > 0 ? "ready" : "todo");
  // THE QUEUE IS UNLIMITED AND THE SCREEN IS NOT: the server cuts one page per lane in the database and counts the rest there too, so what
  // is behind this screen is a fact rather than a length.
  const [more, setMore] = useState<Record<Tab, ChangeProposal[]>>({ ready: [], todo: [] });
  // THE CURSOR IS A POSITION IN A RANKING, so the ranking it was taken against travels with every press. When the background rebuild has
  // replaced it, the server says so and this lane restarts from the top.
  const [at, setAt] = useState<Record<Tab, number>>(view.queueCursor ?? { ready: view.ready.length, todo: view.toDo.length });
  const [release, setRelease] = useState<string | null>(view.surfaceVersion ?? null);
  // THE BUTTON DIES ON WHAT THE DATABASE READ: a short raw page means the lane is exhausted however many rows a count still names. A view
  // with no page verdict yet defaults open; the first press settles it.
  const [canMore, setCanMore] = useState<Record<Tab, boolean>>(view.queueMore ?? { ready: true, todo: true });
  const [moved, setMoved] = useState<{ tab: Tab; note: string; total: number } | null>(null);
  const [lost, setLost] = useState<Record<Tab, number>>({ ready: 0, todo: 0 }); // refusals a deeper page found
  const [loadingMore, startLoadMore] = useTransition();
  // A RESTARTED LANE SHOWS THE FRESH PAGE AND NOTHING ELSE: rows from the ranking that went away are dropped rather than stacked under the
  // new ones, which is the only way "each change once" survives.
  const restarted = moved?.tab === tab;
  const rows = useMemo(() => (restarted ? more[tab] : [...(tab === "ready" ? view.ready : view.toDo), ...more[tab]]), [restarted, tab, view, more]);
  // THE COUNT ON THE TAB IS THE COUNT OF THE LIST UNDER IT: a replaced ranking restarts the lane (the old total said 35 above a list
  // holding 12), and `lost` takes off what a DEEPER page refused, so it only ever falls.
  const countOf = (t: Tab) => (moved?.tab === t ? moved.total : t === "ready" ? view.summary.ready : view.summary.todo) - lost[t];
  const remaining = Math.max(0, countOf(tab) - rows.length);

  return (
    <div className="space-y-4">
      {view.receiptLine ? (
        <p className="text-[12px] text-muted-foreground tabular-nums">{view.receiptLine}</p>
      ) : null}
      {restarted ? <p data-list-moved="true" className="text-[12px] text-amber-800">{moved!.note}</p> : null}

      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <TabButton active={tab === "ready"} onClick={() => setTab("ready")}>
          Ready {countOf("ready")}
        </TabButton>
        <TabButton active={tab === "todo"} onClick={() => setTab("todo")}>
          Needs review {countOf("todo")}
        </TabButton>
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

      {canMore[tab] && remaining > 0 ? (
        <button type="button" disabled={loadingMore} data-show-more="true"
          onClick={() => startLoadMore(async () => {
            const res = await loadMoreChangesAction({ lane: tab, cursor: at[tab], releaseId: release });
            // A LIST THAT MOVED IS NOT PAGED ON. The ranking I was reading is gone, so the server sent the fresh first page and the
            // sentence saying why, and this lane starts again from it.
            setRelease(res.releaseId);
            setAt((prev) => ({ ...prev, [tab]: res.cursor }));
            setCanMore((prev) => ({ ...prev, [tab]: res.more }));
            // A fresh first page's refusals are already out of its own total; only DEEPER pages accumulate.
            setLost((prev) => ({ ...prev, [tab]: res.refreshed ? 0 : prev[tab] + res.dropped }));
            setMoved((prev) => (res.refreshed ? { tab, note: res.refreshed, total: res.total }
              : prev?.tab === tab ? { ...prev, total: res.total } : prev));
            setMore((prev) => ({ ...prev, [tab]: res.refreshed ? res.rows : [...prev[tab], ...res.rows] }));
          })}
          className="w-full rounded-xl border border-border px-3 py-2 text-[13px] font-semibold text-muted-foreground tabular-nums hover:text-foreground disabled:opacity-60"
        >
          {loadingMore ? "Loading…" : `Show ${Math.min(CHANGES_PAGE_SIZE, remaining)} more of ${remaining}`}
        </button>
      ) : null}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-md border px-3 py-1.5 tabular-nums transition-colors ${active
        ? "border-accent-primary/50 bg-accent-primary/10 text-foreground"
        : "border-border text-muted-foreground hover:text-foreground"}`}
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

/** WHY THIS SITS WHERE IT SITS. Rendered, never recomputed: the ranker stamped this sentence. */
function WhyRanked({ proposal }: { proposal: ChangeProposal }) {
  if (!proposal.whyRankedAboveNext) return null;
  return (
    <p className="text-[12px] leading-relaxed text-muted-foreground" data-why-ranked="true">
      {proposal.whyRankedAboveNext}
    </p>
  );
}

/** The two-step hold, said on the card so it cannot be missed. */ function DangerousHold({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <p data-dangerous-hold="true" className="rounded-md border border-status-warning/40 bg-status-warning/5 px-3 py-2 text-[12px] leading-relaxed text-foreground">
      {labels.join(" and ")}: this changes where the page lives or whether people can find it, so I am holding
      it for you to read once and confirm before you make the change.
    </p>
  );
}

/** A proposal carrying a Change Bundle is the flagship row: the primary action, the strongest reason, the four facts, the hold when there
 *  is one, the ranker's sentence, and two controls. The exact copy lives on the detail page. A new-page bundle uses the same row with a
 *  different badge and parts wording. */
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
          {/* An ATOMIC change: it has no pieces to pick apart, so the picker and the tick live on the detail
              page beside the bundle they belong to, and the server asks for the tick again either way. */}
          {canApply ? <MarkImplemented proposalId={proposal.id} newPage={proposal.kind === "new_page"} /> : null}
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
  // FAQPage is not a win to recommend: Google restricts FAQ rich results to authoritative government and health sites, so a normal page
  // marking it up gets nothing extra in search. It stays in the saved brief; it just never renders as something I am telling the operator
  // to add.
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

/** "Put this aside" is the operator's own dismissal, with the consequence stated before they press it. The store then refuses to re-draft
 *  the same change until the evidence itself moves. */
export function SetAsideChange({ proposalId }: { proposalId: string }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ done: boolean; asked: boolean; error: string | null }>({ done: false, asked: false, error: null });

  if (state.done) {
    return (
      <p className="text-[12px] text-muted-foreground" data-set-aside-done="true">
        Put aside. I will not suggest this again unless the evidence changes.
      </p>
    );
  }
  if (!state.asked) {
    return (
      <button type="button" data-set-aside="true" onClick={() => setState((s) => ({ ...s, asked: true }))}
        className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
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

/** "Mark implemented" records that the OPERATOR applied the change. THE PARTIAL-BUNDLE PICKER: three of five pieces applied must not record
 *  five, and the two they skipped stay theirs to do; every piece starts ticked. THE NOTE carries their own words beside my reading. THE
 *  ADDRESS, for a new page only. THE CONFIRMATION, for a piece that moves or hides a page, which the server asks for again and refuses
 *  without. */
export function MarkImplemented({ proposalId, label: idle = "Mark implemented", components, newPage = false }: {
  proposalId: string;
  label?: string;
  /** The bundle's pieces (several = a picker), each with the STABLE id it carries inside the stored bundle so two pieces of one kind are
   *  ticked apart. `moves` marks one that changes where the page lives; `recorded` marks one already on file. */
  components?: { id: string; kind: string; label: string; moves?: boolean; recorded?: boolean }[];
  /** A page that did not exist has no address until they publish it, so I have to be told where it is. */
  newPage?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ done: boolean; error: string | null; note: string | null }>({ done: false, error: null, note: null });
  const pickable = components && components.length > 1 ? components : null;
  // OPEN ON WHAT IS GENUINELY STILL THEIRS TO DO. Pre-ticking every piece with no memory of what is already recorded offered to record a
  // component I am already measuring; the server refuses to write it twice anyway, and the screen should not ask.
  const [applied, setApplied] = useState<Set<string>>(() => {
    const all = pickable ?? components ?? [], open = all.filter((c) => !c.recorded);
    return new Set((open.length > 0 ? open : all).map((c) => c.id));
  });
  const [note, setNote] = useState(""), [liveUrl, setLiveUrl] = useState(""), [confirmed, setConfirmed] = useState(false);
  const label = useMemo(() => (state.done ? "Marked implemented" : idle), [state.done, idle]);
  const nothingPicked = pickable != null && applied.size === 0, addressOwed = newPage && liveUrl.trim().length === 0;
  // THE DELIBERATE YES, asked only about the pieces they say they applied. The server asks again and refuses without it, so this box is the
  // operator's act and never the gate.
  const movesPage = (components ?? []).some((c) => c.moves && applied.has(c.id));

  function onClick() {
    startTransition(async () => {
      const res = await markProposalImplementedAction({
        proposalId,
        ...(newPage ? { liveUrl: liveUrl.trim() } : {}),
        ...(pickable && applied.size < pickable.length ? { componentIds: [...applied] } : {}),
        ...(note.trim() ? { operatorNote: note.trim() } : {}),
        ...(movesPage ? { destructiveConfirmed: confirmed } : {}),
      });
      if (res.success) setState({ done: true, error: null, note: res.note ?? null });
      else setState({ done: false, error: res.error ?? "Something went wrong.", note: null });
    });
  }

  return (
    <div className="space-y-3">
      {pickable ? (
        <div className="space-y-1.5" data-component-picker="true">
          <p className="text-[12px] font-semibold text-foreground">Which pieces did you apply?</p>
          {/* KEYED BY THE PIECE'S OWN ID: two sections sharing one key ticked and untickd as one. */}
          {pickable.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <input type="checkbox" checked={applied.has(c.id)}
                onChange={(e) => setApplied((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(c.id); else next.delete(c.id);
                  return next;
                })} />
              {c.label}
            </label>
          ))}
          <p className="text-[12px] text-muted-foreground">
            I only measure the pieces you tick, so leave the ones you skipped unticked.
          </p>
        </div>
      ) : null}

      {newPage ? (
        <div className="space-y-1.5" data-live-url="true">
          <label className="block text-[12px] font-semibold text-foreground" htmlFor={`live-url-${proposalId}`}>
            What address is the new page live at?
          </label>
          <input id={`live-url-${proposalId}`} type="text" value={liveUrl} onChange={(e) => setLiveUrl(e.target.value)}
            placeholder="https://yoursite.com/the-new-page"
            className="w-full rounded-md border border-border bg-surface-inset px-3 py-1.5 text-[12px] text-foreground" />
          <p className="text-[12px] text-muted-foreground">I go and read that page myself, so I need the exact address on your own site.</p>
        </div>
      ) : null}

      {movesPage ? (
        <label data-destructive-confirm="true" className="flex items-start gap-2 rounded-md border border-status-warning/40 bg-status-warning/5 px-3 py-2 text-[12px] leading-relaxed text-foreground">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          I understand this moves or hides a page, and I have read what it does to my site above.
        </label>) : null}
      <div className="space-y-1.5" data-operator-note="true">
        <label className="block text-[12px] text-muted-foreground" htmlFor={`note-${proposalId}`}>
          Wrote it your own way? Tell me what you put there and I will keep your words beside my reading.
        </label>
        <input id={`note-${proposalId}`} type="text" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Optional: what you actually put on the page"
          className="w-full rounded-md border border-border bg-surface-inset px-3 py-1.5 text-[12px] text-foreground" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onClick} disabled={pending || state.done || nothingPicked || addressOwed || (movesPage && !confirmed)}
          className="rounded-md bg-accent-primary px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-60">
          {pending ? "Saving…" : label}
        </button>
        <span className="text-[12px] text-muted-foreground">
          {addressOwed ? "Give me the address it is live at and I will go and read it."
            : nothingPicked ? "Tick at least one piece and I will start measuring it."
              : movesPage && !confirmed ? "Confirm you meant to move or hide the page and I will record it."
                : "You apply the change on your site; I read the page myself and tell you what I found."}
        </span>
        {state.error ? <span className="text-[12px] text-red-500">{state.error}</span> : null}
      </div>
      {/* WHAT IS STILL THEIRS TO DO after a partial apply: the change stays open carrying the rest. */}
      {state.note ? <p className="text-[12px] leading-relaxed text-muted-foreground">{state.note}</p> : null}
    </div>
  );
}
