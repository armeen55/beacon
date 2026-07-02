"use client";

import { useEffect, useState, useTransition } from "react";

import type { AssembledRewrite } from "@/domains/llm/rewrite-page";
import {
  generateRewriteAction,
  loadSavedRewriteAction,
  stageAcceptedRewriteSectionsAction,
} from "./page-rewrite-actions";

/**
 * DossierRewrite (BEACON 500 item 61) - the page dossier's "Rewrite this page"
 * review: generate an agentic, section-by-section rewrite grounded on the
 * page's real headings + demand, show OLD vs NEW side by side per section with
 * an accept/reject toggle, and publish ONLY the accepted sections through the
 * existing armed-publish rails (one click, snapshot-protected, revertible).
 *
 * Client-only interaction; every write goes through page-rewrite-actions.ts
 * server actions, which are themselves composition over existing rails
 * (executePush, autoRecordShippedChangeForRec). This component never writes
 * anything directly.
 */
export function DossierRewrite({ path }: { path: string }) {
  const [rewrite, setRewrite] = useState<AssembledRewrite | null>(null);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "generating" | "ok" | "off" | "budget" | "error">("idle");
  const [receipt, setReceipt] = useState<string | null>(null);
  const [stagePending, startStage] = useTransition();
  const [genPending, startGen] = useTransition();

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    loadSavedRewriteAction(path)
      .then((saved) => {
        if (cancelled) return;
        if (saved) {
          setRewrite(saved);
          // Default every CHANGED section to accepted; kept-original sections
          // have nothing to accept (old === new already).
          const init: Record<string, boolean> = {};
          for (const s of saved.sections) if (s.changed) init[s.heading] = true;
          setAccepted(init);
          setStatus("ok");
        } else {
          setStatus("idle");
        }
      })
      .catch(() => setStatus("idle"));
    return () => {
      cancelled = true;
    };
  }, [path]);

  const generate = () => {
    setStatus("generating");
    setReceipt(null);
    startGen(async () => {
      try {
        const r = await generateRewriteAction(path);
        if (r.ok) {
          setRewrite(r.rewrite);
          const init: Record<string, boolean> = {};
          for (const s of r.rewrite.sections) if (s.changed) init[s.heading] = true;
          setAccepted(init);
          setStatus("ok");
        } else {
          setStatus(r.reason.toLowerCase().includes("budget") ? "budget" : r.reason.toLowerCase().includes("off") ? "off" : "error");
        }
      } catch {
        setStatus("error");
      }
    });
  };

  const toggle = (heading: string) => setAccepted((a) => ({ ...a, [heading]: !a[heading] }));

  const acceptedCount = Object.values(accepted).filter(Boolean).length;

  const stage = () => {
    if (!rewrite) return;
    const chosen = rewrite.sections.filter((s) => s.changed && accepted[s.heading]).map((s) => ({ heading: s.heading, newBody: s.newBody }));
    if (chosen.length === 0) return;
    startStage(async () => {
      const r = await stageAcceptedRewriteSectionsAction({ path, accepted: chosen });
      setReceipt(r.receiptLine);
    });
  };

  if (status === "idle") {
    return (
      <div className="rounded-lg border border-border/60 bg-background p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Rewrite this page</div>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          I can rewrite this page section by section, grounded in its real headings and search demand. You approve each
          section before anything goes live.
        </p>
        <button
          type="button"
          onClick={generate}
          className="mt-3 rounded-md border border-border/60 bg-surface-inset/60 px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-surface-inset"
        >
          Draft a rewrite
        </button>
      </div>
    );
  }

  if (status === "loading" || status === "generating") {
    return (
      <div className="rounded-lg border border-border/60 bg-background p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Rewrite this page</div>
        <p className="mt-2 text-[13px] text-muted-foreground">
          {status === "generating" ? "Drafting a grounded rewrite, section by section..." : "Checking for a saved rewrite..."}
        </p>
      </div>
    );
  }

  if (status === "off" || status === "budget" || status === "error") {
    return (
      <div className="rounded-lg border border-border/60 bg-background p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Rewrite this page</div>
        <p className="mt-2 text-[13px] text-muted-foreground">
          {status === "off"
            ? "AI drafting is off right now."
            : status === "budget"
              ? "I have reached this month's AI budget, so I could not draft a rewrite."
              : "I could not draft a rewrite for this page. It may not have a crawled snapshot yet."}
        </p>
        <button
          type="button"
          onClick={generate}
          className="mt-3 rounded-md border border-border/60 bg-surface-inset/60 px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-surface-inset"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!rewrite || rewrite.sections.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-background p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Rewrite this page</div>
        <p className="mt-2 text-[13px] text-muted-foreground">This page has no sections I can rewrite yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-background p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Rewrite this page</div>
        <span className="text-[11px] text-muted-foreground">
          {rewrite.stats.sectionsRewritten} rewritten, {rewrite.stats.sectionsKeptOriginal} kept as is
          {rewrite.stats.totalCostUsd > 0 ? ` · $${rewrite.stats.totalCostUsd.toFixed(3)}` : ""}
        </span>
      </div>

      <div className="mt-3 space-y-3">
        {rewrite.sections.map((s) => (
          <div key={s.heading} className="rounded-md border border-border/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-foreground">{s.heading}</span>
              {s.changed ? (
                <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <input type="checkbox" checked={!!accepted[s.heading]} onChange={() => toggle(s.heading)} />
                  Accept this section
                </label>
              ) : (
                <span className="rounded border border-border/40 px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                  Kept original{s.keptReason ? `: ${s.keptReason}` : ""}
                </span>
              )}
            </div>
            {s.changed ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div>
                  <div className="text-[10px] font-medium uppercase text-muted-foreground">Old</div>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{s.oldBody || "No body text on file for this section."}</p>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase text-muted-foreground">New</div>
                  <p className="mt-1 text-[12px] leading-relaxed text-foreground">{s.newBody}</p>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{s.oldBody || "No body text on file for this section."}</p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={stage}
          disabled={acceptedCount === 0 || stagePending}
          className="rounded-md bg-accent-primary px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
        >
          {stagePending ? "Publishing..." : `Publish ${acceptedCount} accepted section${acceptedCount === 1 ? "" : "s"}`}
        </button>
        <button
          type="button"
          onClick={generate}
          disabled={genPending}
          className="rounded-md border border-border/60 bg-surface-inset/60 px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-surface-inset disabled:opacity-50"
        >
          Draft again
        </button>
        {receipt ? <span className="text-[12px] text-muted-foreground">{receipt}</span> : null}
      </div>
    </div>
  );
}
