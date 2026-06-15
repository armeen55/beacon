"use client";

import { useState, useTransition, useEffect } from "react";
import Link from "next/link";
import {
  archiveDuplicate,
  dismissAllRemainingDedupe,
  markPairNotDuplicate,
} from "./actions";

export type SerializedPair = {
  keeper: {
    id: string;
    timestamp: string;
    source: string | undefined;
    url: string | null;
    assetName: string;
    description: string;
  };
  archiveCandidate: {
    id: string;
    timestamp: string;
    source: string | undefined;
    url: string | null;
    assetName: string;
    description: string;
  };
  sharedTokens: string[];
  keeperOnlyTokens: string[];
  daysApart: number;
};

const TOKEN_LABELS: Record<string, string> = {
  page_created: "New page",
  page_removed: "Page removed",
  title_change: "Title",
  meta_description: "Meta description",
  h1_change: "H1",
  faq_added: "FAQ",
  schema_added: "Schema",
  canonical_change: "Canonical",
  hero_change: "Hero",
  section_added: "Section",
  internal_links: "Internal links",
  images_added: "Images",
  sitemap_robots: "Sitemap/Robots",
  navigation_change: "Navigation",
};

function label(token: string): string {
  return TOKEN_LABELS[token] ?? token;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function DedupeReview({ pairs }: { pairs: SerializedPair[] }) {
  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState<
    Record<string, "archived" | "kept" | "skipped">
  >({});
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // #146 (keyboard half) — let the operator clear the queue from the
  // keyboard: a = archive the CSV summary, k = keep both, s = decide
  // later. Active only while there's a pair on screen and nothing is in
  // flight; ignored while typing in an input/textarea. Mirrors the three
  // button handlers below (kept inline here to stay above the early
  // returns so the hook order is stable).
  useEffect(() => {
    if (index >= pairs.length || pending) return;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      const active = pairs[index];
      if (!active) return;
      if (e.key === "a") {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await archiveDuplicate(
            active.archiveCandidate.id,
            active.keeper.id,
          );
          if (!r.success) {
            setError(r.error ?? "Failed to archive. Try again.");
            return;
          }
          setDecisions((d) => ({ ...d, [active.archiveCandidate.id]: "archived" }));
          setIndex((i) => i + 1);
        });
      } else if (e.key === "k") {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await markPairNotDuplicate(active.archiveCandidate.id);
          if (!r.success) {
            setError(r.error ?? "Failed to save decision. Try again.");
            return;
          }
          setDecisions((d) => ({ ...d, [active.archiveCandidate.id]: "kept" }));
          setIndex((i) => i + 1);
        });
      } else if (e.key === "s") {
        e.preventDefault();
        setDecisions((d) => ({ ...d, [active.archiveCandidate.id]: "skipped" }));
        setError(null);
        setIndex((i) => i + 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, pairs, pending]);

  if (pairs.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5">
        <p className="text-[13px] font-semibold text-foreground">
          No possible duplicates to review.
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Your changelog is clean.
        </p>
        <Link
          href="/changes"
          className="mt-3 inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
        >
          Back to Changes →
        </Link>
      </div>
    );
  }

  if (index >= pairs.length) {
    const archived = Object.values(decisions).filter((d) => d === "archived").length;
    const kept = Object.values(decisions).filter((d) => d === "kept").length;
    const skipped = Object.values(decisions).filter((d) => d === "skipped").length;
    return (
      <div className="rounded-lg border border-status-success/30 bg-status-success/5 px-5 py-5">
        <p className="text-[13px] font-semibold text-foreground">
          Review complete.
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {archived} archived · {kept} kept · {skipped} skipped
        </p>
        <Link
          href="/changes"
          className="mt-4 inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
        >
          Back to Changes →
        </Link>
      </div>
    );
  }

  const pair = pairs[index];

  function advance() {
    setError(null);
    setIndex((i) => i + 1);
  }

  function handleArchive() {
    setError(null);
    startTransition(async () => {
      const r = await archiveDuplicate(pair.archiveCandidate.id, pair.keeper.id);
      if (!r.success) {
        setError(r.error ?? "Failed to archive. Try again.");
        return;
      }
      setDecisions((d) => ({ ...d, [pair.archiveCandidate.id]: "archived" }));
      advance();
    });
  }

  // Phase B (2026-04-24): "Different edits — keep both" means the operator
  // has reviewed this pair and confirms they are NOT duplicates. Persist
  // via markDedupeReviewedBulk so the pair stops re-surfacing on future
  // /changes/dedupe visits.
  function handleKeep() {
    setError(null);
    startTransition(async () => {
      const r = await markPairNotDuplicate(pair.archiveCandidate.id);
      if (!r.success) {
        setError(
          r.error ?? "Failed to save decision. Try again.",
        );
        return;
      }
      setDecisions((d) => ({ ...d, [pair.archiveCandidate.id]: "kept" }));
      advance();
    });
  }

  // "Decide later" is intentionally local-only — the pair will re-surface on
  // the next visit so the operator can come back to it. Renamed from "Skip"
  // in Phase B so the semantic difference from "keep both" is clear.
  function handleSkip() {
    setDecisions((d) => ({ ...d, [pair.archiveCandidate.id]: "skipped" }));
    advance();
  }

  const remainingIds = pairs
    .slice(index)
    .map((p) => p.archiveCandidate.id);

  function handleDismissAll() {
    if (remainingIds.length === 0) return;
    const confirmed = window.confirm(
      `Dismiss the remaining ${remainingIds.length} possible duplicate${
        remainingIds.length === 1 ? "" : "s"
      } as distinct? Beacon will stop asking about them.`,
    );
    if (!confirmed) return;
    setError(null);
    startTransition(async () => {
      const r = await dismissAllRemainingDedupe(remainingIds);
      if (!r.success) {
        setError(r.error ?? "Failed to dismiss. Try again.");
        return;
      }
      // Mark every remaining pair as dismissed in local state and jump to end.
      setDecisions((d) => {
        const next = { ...d };
        for (const id of remainingIds) next[id] = "kept";
        return next;
      });
      setIndex(pairs.length);
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 text-[11px] text-muted-foreground">
        <span className="tabular-nums">
          Pair {index + 1} of {pairs.length}
        </span>
        <div className="flex items-center gap-3">
          <span>{Math.round(pair.daysApart)}d apart</span>
          {pairs.length - index > 1 && (
            <button
              type="button"
              onClick={handleDismissAll}
              disabled={pending}
              className="text-[11px] font-medium text-muted-foreground/70 hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Dismiss all remaining as distinct →
            </button>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3 mb-4">
        <PairCard
          label="Keeper (granular, PDF)"
          source={pair.keeper.source}
          assetName={pair.keeper.assetName}
          description={pair.keeper.description}
          url={pair.keeper.url}
          timestamp={pair.keeper.timestamp}
          tone="keep"
        />
        <PairCard
          label="Summary (CSV) — archive?"
          source={pair.archiveCandidate.source}
          assetName={pair.archiveCandidate.assetName}
          description={pair.archiveCandidate.description}
          url={pair.archiveCandidate.url}
          timestamp={pair.archiveCandidate.timestamp}
          tone="archive"
        />
      </div>

      {(pair.sharedTokens.length > 0 || pair.keeperOnlyTokens.length > 0) && (
        <div className="mb-4 rounded-md border border-border/60 bg-surface-inset/20 px-3 py-2 text-[11px]">
          {pair.sharedTokens.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">Shared:</span>
              {pair.sharedTokens.map((t) => (
                <span
                  key={t}
                  className="rounded bg-status-success/10 text-status-success px-1.5 py-0.5"
                >
                  {label(t)}
                </span>
              ))}
            </div>
          )}
          {pair.keeperOnlyTokens.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <span className="text-muted-foreground">Extra detail in keeper:</span>
              {pair.keeperOnlyTokens.map((t) => (
                <span
                  key={t}
                  className="rounded bg-surface-raised/60 text-foreground px-1.5 py-0.5"
                >
                  {label(t)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="mb-3 text-[11px] text-status-danger">{error}</p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={handleArchive}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-md bg-foreground text-background px-4 py-2 text-[12px] font-semibold hover:opacity-90 transition-opacity"
          title="Archive the CSV summary (shortcut: a)"
        >
          Same edit — archive CSV summary
        </button>
        <button
          type="button"
          onClick={handleKeep}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-md border border-foreground/20 px-4 py-2 text-[12px] font-semibold hover:bg-surface-inset/40 transition-colors"
          title="Keep both as distinct edits (shortcut: k)"
        >
          Different edits — keep both
        </button>
        <button
          type="button"
          onClick={handleSkip}
          disabled={pending}
          className="text-[11px] font-medium text-muted-foreground/70 hover:text-muted-foreground transition-colors ml-1"
          title="Come back to this pair later — won't be saved (shortcut: s)"
        >
          Decide later
        </button>
      </div>
    </div>
  );
}

function PairCard({
  label,
  source,
  assetName,
  description,
  url,
  timestamp,
  tone,
}: {
  label: string;
  source: string | undefined;
  assetName: string;
  description: string;
  url: string | null;
  timestamp: string;
  tone: "keep" | "archive";
}) {
  const toneClass =
    tone === "keep"
      ? "border-status-success/30 bg-status-success/[0.03]"
      : "border-border/60 bg-surface-inset/20";
  return (
    <div className={`rounded-md border ${toneClass} px-3 py-2.5`}>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
        {label}
      </p>
      <p className="text-[12px] font-medium mt-1 line-clamp-2">{assetName}</p>
      <p className="text-[12px] text-muted-foreground mt-1 leading-snug line-clamp-4">
        {description}
      </p>
      <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground/80">
        <span className="tabular-nums">{formatDate(timestamp)}</span>
        {source && <span className="font-mono">{source}</span>}
        {url && <span className="font-mono truncate max-w-[160px]">{url}</span>}
      </div>
    </div>
  );
}
