/**
 * Recommendation Execution Layer v1 — Phase A (2026-05-13).
 *
 * Renders Act 4 ("Suggested copy") on /recommendations/[id]. Pure
 * presentation. Reads exclusively from `row.detail.proposedText`,
 * `row.detail.faqAnswerText`, `row.detail.currentText`, `row.title`,
 * `row.targetUrl`, `row.targetLabel`, `row.actionType`, plus the
 * already-loaded `evidenceSummary` / `detail.why` for the "why this
 * copy" hint.
 *
 * Hard rules (operator-locked, pinned by architecture tests):
 *   - NO server actions.
 *   - NO LLM provider imports (deterministic, openai, anthropic).
 *   - NO fetch / no network call.
 *   - NO persistence call.
 *   - NO `?legacy=1` mutation.
 *   - Display-safety guard runs INSIDE the adapter; if it fails, the
 *     act renders the calm fallback message instead of any copy.
 *
 * Pair with `recommendation-detail-client.tsx` which inserts the act
 * between Act 3 (Evidence) and Act 4 (existing label was "Measurement
 * plan" → now Act 5).
 */

"use client";

import { useCallback, useState } from "react";

import type { RecommendationActionRow } from "@/domains/recommendations/recommendation-action-rows";
import {
  buildCopyTile,
  countChars,
  TITLE_TAG_MAX_CHARS,
  META_DESCRIPTION_MAX_CHARS,
  type CopyTile,
} from "@/domains/recommendations/suggested-copy-adapters";
import { cn } from "@/lib/utils";

const FALLBACK_MESSAGE =
  "Beacon has a draft for this recommendation, but it needs review before showing here.";

const DISCLAIMER =
  "Review before publishing. Beacon's draft is grounded in your evidence, but always read it once in your brand voice before it goes live.";

const SUBHEADER =
  "What to publish. Beacon drafted this from the evidence above.";

export type SuggestedCopyActProps = {
  row: RecommendationActionRow;
  /** 1-based act index — driven by the parent so the sequential
   *  numbering stays sane when other acts are conditional. Defaults to
   *  4 if not provided (the documented position when this act renders). */
  index?: number;
};

export function SuggestedCopyAct({
  row,
  index = 4,
}: SuggestedCopyActProps) {
  const tile = buildCopyTile(row);
  if (tile === null) return null;

  const why =
    firstSentence(row.evidenceSummary?.trim() || row.detail.why?.trim() || "") ||
    "Beacon weighed this against the evidence above.";

  return (
    <section
      className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5"
      data-recommendation-detail-act="act-suggested-copy"
      data-recommendation-detail-act-index={index}
      data-suggested-copy-tile-kind={tile.kind}
    >
      <header className="flex items-baseline gap-2 mb-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
          Act {index}
        </span>
        <h2 className="text-[14px] font-semibold text-foreground">
          Suggested copy
        </h2>
      </header>
      <p className="text-[12px] text-muted-foreground/85 leading-snug mb-4">
        {SUBHEADER}
      </p>

      {tile.kind === "fallback" ? (
        <FallbackTile />
      ) : (
        <CopyTileBody tile={tile} targetLabel={row.targetLabel} />
      )}

      <p
        className="mt-4 text-[12px] text-foreground/85 leading-relaxed"
        data-suggested-copy-why="true"
      >
        <span className="text-muted-foreground">Why this copy: </span>
        {why}
      </p>

      <p
        className="mt-2 text-[11px] italic text-muted-foreground/80 leading-relaxed"
        data-suggested-copy-disclaimer="true"
      >
        {DISCLAIMER}
      </p>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tile bodies
// ─────────────────────────────────────────────────────────────────────

function CopyTileBody({
  tile,
  targetLabel,
}: {
  tile: Exclude<CopyTile, { kind: "fallback" }>;
  targetLabel: string;
}) {
  switch (tile.kind) {
    case "faq":
      return <FaqTile tile={tile} targetLabel={targetLabel} />;
    case "h2":
      return <H2Tile tile={tile} targetLabel={targetLabel} />;
    case "h1":
      return <H1Tile tile={tile} targetLabel={targetLabel} />;
    case "title_meta":
      return <TitleMetaTile tile={tile} targetLabel={targetLabel} />;
    case "internal_link":
      return <InternalLinkTile tile={tile} targetLabel={targetLabel} />;
    case "table":
      return <TableTile tile={tile} targetLabel={targetLabel} />;
    case "section":
      return <SectionTile tile={tile} targetLabel={targetLabel} />;
    case "plain":
      return <PlainTile tile={tile} targetLabel={targetLabel} />;
  }
}

function FallbackTile() {
  return (
    <div
      className="rounded-md border border-border/40 bg-background/60 px-4 py-3"
      data-suggested-copy-fallback="true"
    >
      <p className="text-[13px] text-foreground/80 leading-relaxed">
        {FALLBACK_MESSAGE}
      </p>
    </div>
  );
}

function FaqTile({
  tile,
  targetLabel,
}: {
  tile: Extract<CopyTile, { kind: "faq" }>;
  targetLabel: string;
}) {
  return (
    <div className="space-y-3" data-suggested-copy-tile="faq">
      <FieldBlock
        label="FAQ question"
        value={tile.question}
        copyTextOverride={tile.question}
      />
      {tile.answer && tile.answer.length > 0 && (
        <FieldBlock label="FAQ answer" value={tile.answer} />
      )}
      <Whereline targetLabel={targetLabel} kind="this FAQ" />
    </div>
  );
}

function H2Tile({
  tile,
  targetLabel,
}: {
  tile: Extract<CopyTile, { kind: "h2" }>;
  targetLabel: string;
}) {
  const combined = `${tile.heading}\n\n${tile.paragraph}`;
  return (
    <div className="space-y-3" data-suggested-copy-tile="h2">
      <FieldBlock label="Heading" value={tile.heading} />
      <FieldBlock
        label="Paragraph"
        value={tile.paragraph}
        copyTextOverride={combined}
      />
      <Whereline targetLabel={targetLabel} kind="this section" />
    </div>
  );
}

function H1Tile({
  tile,
  targetLabel,
}: {
  tile: Extract<CopyTile, { kind: "h1" }>;
  targetLabel: string;
}) {
  return (
    <div className="space-y-3" data-suggested-copy-tile="h1">
      <FieldBlock label="H1 heading" value={tile.heading} />
      <Whereline targetLabel={targetLabel} kind="this H1" />
    </div>
  );
}

function TitleMetaTile({
  tile,
  targetLabel,
}: {
  tile: Extract<CopyTile, { kind: "title_meta" }>;
  targetLabel: string;
}) {
  const titleLen = countChars(tile.title);
  const metaLen = countChars(tile.meta);
  const hasTitle = tile.title.length > 0;
  const hasMeta = tile.meta !== null && tile.meta.length > 0;

  return (
    <div className="space-y-3" data-suggested-copy-tile="title_meta">
      {hasTitle && (
        <FieldBlock
          label={`Title tag · ${titleLen} / ${TITLE_TAG_MAX_CHARS}`}
          value={tile.title}
        />
      )}
      {hasMeta && (
        <FieldBlock
          label={`Meta description · ${metaLen} / ${META_DESCRIPTION_MAX_CHARS}`}
          value={tile.meta as string}
        />
      )}
      <Whereline
        targetLabel={targetLabel}
        kind={hasTitle ? "this title tag" : "this meta description"}
      />
    </div>
  );
}

function InternalLinkTile({
  tile,
  targetLabel,
}: {
  tile: Extract<CopyTile, { kind: "internal_link" }>;
  targetLabel: string;
}) {
  return (
    <div className="space-y-3" data-suggested-copy-tile="internal_link">
      <FieldBlock label="Anchor text" value={tile.anchor} />
      {tile.targetUrl && (
        <div
          className="rounded-md border border-border/40 bg-background/60 px-3 py-2.5"
          data-suggested-copy-field="links_to"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            Links to
          </p>
          <p className="mt-1 text-[12px] font-mono tabular-nums text-foreground/90 break-all">
            {tile.targetUrl}
          </p>
        </div>
      )}
      <Whereline targetLabel={targetLabel} kind="this internal link" />
    </div>
  );
}

function TableTile({
  tile,
  targetLabel,
}: {
  tile: Extract<CopyTile, { kind: "table" }>;
  targetLabel: string;
}) {
  return (
    <div className="space-y-3" data-suggested-copy-tile="table">
      <FieldBlock
        label="Table rows (markdown)"
        value={tile.markdown}
        valueClassName="font-mono text-[12px] whitespace-pre-wrap"
      />
      <Whereline targetLabel={targetLabel} kind="this table" />
    </div>
  );
}

function SectionTile({
  tile,
  targetLabel,
}: {
  tile: Extract<CopyTile, { kind: "section" }>;
  targetLabel: string;
}) {
  const combined = tile.heading
    ? `${tile.heading}\n\n${tile.body}`
    : tile.body;
  return (
    <div className="space-y-3" data-suggested-copy-tile="section">
      {tile.heading && (
        <FieldBlock label="Heading" value={tile.heading} />
      )}
      <FieldBlock
        label="Suggested text"
        value={tile.body}
        copyTextOverride={combined}
      />
      <Whereline targetLabel={targetLabel} kind="this section" />
    </div>
  );
}

function PlainTile({
  tile,
  targetLabel,
}: {
  tile: Extract<CopyTile, { kind: "plain" }>;
  targetLabel: string;
}) {
  return (
    <div className="space-y-3" data-suggested-copy-tile="plain">
      <FieldBlock label="Suggested text" value={tile.text} />
      <Whereline targetLabel={targetLabel} kind="this copy" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Field block + copy-to-clipboard
// ─────────────────────────────────────────────────────────────────────

function FieldBlock({
  label,
  value,
  copyTextOverride,
  valueClassName,
}: {
  label: string;
  value: string;
  /** When set, the Copy button writes THIS string to the clipboard
   *  instead of `value` (useful for combined H2 heading+paragraph or
   *  section heading+body where the operator wants one copy action). */
  copyTextOverride?: string;
  valueClassName?: string;
}) {
  return (
    <div
      className="rounded-md border border-border/40 bg-background/60 px-3 py-2.5"
      data-suggested-copy-field="true"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          {label}
        </p>
        <CopyButton text={copyTextOverride ?? value} label={label} />
      </div>
      <p
        className={cn(
          "mt-1 text-[13px] text-foreground/90 leading-relaxed whitespace-pre-wrap",
          valueClassName,
        )}
      >
        {value}
      </p>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const onClick = useCallback(async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Clipboard rejection (insecure context, permission denied) —
      // surface silently; the operator can still select + copy by hand.
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Copy ${label.toLowerCase()} to clipboard`}
      className={cn(
        "text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded transition-colors",
        copied
          ? "bg-status-success/10 text-status-success"
          : "bg-muted-foreground/10 text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground",
      )}
      data-suggested-copy-copy-button="true"
      data-suggested-copy-copied={copied ? "true" : "false"}
    >
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function Whereline({
  targetLabel,
  kind,
}: {
  targetLabel: string;
  kind: string;
}) {
  return (
    <p
      className="text-[11px] text-muted-foreground/90 italic"
      data-suggested-copy-where="true"
    >
      Add {kind} to {targetLabel}.
    </p>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function firstSentence(s: string): string {
  if (!s) return "";
  const m = s.match(/^([^.!?\n]{8,}[.!?])(?:\s|$)/);
  if (m) return m[1].trim();
  // Hard cap so the why hint never wraps multiple lines.
  return s.slice(0, 180).trim();
}
