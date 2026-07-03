/**
 * worklist-row-helpers (2026-07-03, R23 P13) - PURE, deterministic presentation helpers for the
 * Changes list row (changes-list-client.tsx). Four highest-impact P13 sub-items, each derived
 * ONLY from fields the CanonicalChange / TodayMove already carry (no new persistence, no shared
 * read-model edits, no network, no dependency):
 *
 *   1. rankReason        - one plain sentence for WHY a row is ranked where it is.
 *   2. honestMinutes     - a truthful "about N minutes" per change + a session total.
 *   3. wordDiff          - before -> after as a word-level diff so the operator sees the EXACT change.
 *   4. snooze durations  - honest "remind me" framing for the not-now control.
 *
 * Every string obeys the Beacon voice: first person where it speaks, a concrete number when one
 * exists, no lab jargon, and NEVER an em or en dash (only hyphens/commas/periods). Pinned by
 * worklist-row-helpers.test.ts.
 */
import type { CanonicalChange } from "@/domains/changes/canonical-change";
import { formatMetricCompact } from "@/lib/format-metric";

// A minimal structural view of the worklist move fields these helpers read, so the helpers stay
// decoupled from the full TodayMove type (which lives in a file this pack does not own).
export type RowMoveLike = {
  rankWhy?: string | null;
  demand?: number | null;
  demandBasis?: "gsc" | "ai_attention" | "mixed" | null;
  draftTitle?: string | null;
  draftMeta?: string | null;
  preparedDraftText?: string | null;
  preparedDraftKind?: string | null;
};

/* -------------------------------------------------------------------------- */
/* 1. RANK EXPLANATION (v1 ~348/398)                                          */
/* -------------------------------------------------------------------------- */

/**
 * The rank-explanation builder. Takes the row's 1-based render rank explicitly (the list already
 * computes it per Row) so the sentence can honestly say "first" vs "near the top" vs "on the
 * list". Built from the components already on the change/move: the demand behind it (times shown
 * on Google, or AI attention) and whether it is winnable now (evidence + quality). Self-hides
 * (returns null) when there is no concrete number to justify a claim, so a row never shows an
 * empty or hand-wavy "ranked because reasons" line.
 *
 * Example rendered copy:
 *   "This is near the top because it has real demand (1,200 times shown on Google a month) and
 *    you can win it now."
 */
export function rankReasonAt(
  c: CanonicalChange,
  move: RowMoveLike | undefined,
  rank: number,
): string | null {
  const demandClause = ((): string | null => {
    const demand = move?.demand ?? null;
    if (demand != null && Number.isFinite(demand) && demand > 0) {
      const basis =
        move?.demandBasis === "ai_attention"
          ? `${formatMetricCompact(demand)} AI mentions a month`
          : `${formatMetricCompact(demand)} times shown on Google a month`;
      return `it has real demand (${basis})`;
    }
    if (c.upside != null && Number.isFinite(c.upside) && c.upside > 0) {
      return `it has real demand (${formatMetricCompact(c.upside)} times shown on Google a month)`;
    }
    return null;
  })();

  if (!demandClause) return null; // nothing concrete -> self-hide, never a hand-wavy reason

  const position = rank <= 1 ? "This is first" : rank <= 3 ? "This is near the top" : "This is on the list";
  const winnable =
    c.qualityDecision !== "flagged" &&
    (c.evidenceStrength === "strong" || c.evidenceStrength === "directional");
  const tail = winnable ? " and you can win it now" : "";
  return `${position} because ${demandClause}${tail}.`;
}

/* -------------------------------------------------------------------------- */
/* 2. HONEST MINUTE MATH (v1 ~592)                                            */
/* -------------------------------------------------------------------------- */

/**
 * A truthful "about N minutes" for one change, from its existing effort field. Coarse buckets, no
 * fake precision: a title tweak really is a couple of minutes, a new page really is closer to an
 * hour. Returns null when there is no honest effort figure to show.
 */
export function honestMinutesLabel(c: CanonicalChange): string | null {
  const mins = Number.isFinite(c.estimatedEffortMinutes) ? c.estimatedEffortMinutes : null;
  if (mins == null || mins <= 0) return null;
  // Round to a friendly bucket so we never imply "7 minutes" precision we do not have.
  if (mins <= 2) return "about 2 minutes";
  if (mins <= 5) return "about 5 minutes";
  if (mins <= 10) return "about 10 minutes";
  if (mins <= 20) return "about 20 minutes";
  if (mins <= 45) return "about 30 minutes";
  return "about an hour";
}

/**
 * The honest session total across the changes the operator is looking at, e.g.
 *   "Today's 3 changes: about 15 minutes."
 * Uses the SAME per-change effort fallback (5 min) the "Tonight's 30 minutes" budget already uses,
 * so the number never disagrees with that view. Returns null for an empty set.
 */
export function sessionMinutesLine(changes: readonly CanonicalChange[], noun = "changes"): string | null {
  if (!changes.length) return null;
  const total = changes.reduce(
    (t, c) => t + (Number.isFinite(c.estimatedEffortMinutes) ? c.estimatedEffortMinutes : 5),
    0,
  );
  if (total <= 0) return null;
  const count = changes.length;
  const label = total >= 60 ? formatHoursMinutes(total) : `about ${total} minutes`;
  return `Today's ${count} ${count === 1 ? singular(noun) : noun}: ${label}.`;
}

function singular(noun: string): string {
  return noun.endsWith("s") ? noun.slice(0, -1) : noun;
}

function formatHoursMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (mins === 0) return `about ${hours} hour${hours === 1 ? "" : "s"}`;
  return `about ${hours} hour${hours === 1 ? "" : "s"} ${mins} minutes`;
}

/* -------------------------------------------------------------------------- */
/* 3. WORD-LEVEL DIFF (v1 ~349/397)                                           */
/* -------------------------------------------------------------------------- */

export type DiffSegment = { type: "same" | "add" | "del"; text: string };

/**
 * A deterministic word-level diff of `before` -> `after`, so the operator sees EXACTLY what will
 * change before shipping. Splits on whitespace (keeping the words), runs a longest-common-
 * subsequence over the word arrays, and emits same/removed/added segments in reading order. No
 * dependency, no heuristics that can reorder text: the same inputs always produce the same diff.
 *
 * Returns null when there is nothing meaningful to diff (identical text, or no proposed value).
 */
export function wordDiff(before: string | null | undefined, after: string | null | undefined): DiffSegment[] | null {
  const a = (before ?? "").trim();
  const b = (after ?? "").trim();
  if (!b) return null; // no proposed text -> nothing to show
  if (a === b) return null; // identical -> no change to preview
  if (!a) return [{ type: "add", text: b }]; // brand-new value, all added

  const aw = a.split(/(\s+)/).filter((s) => s.length > 0);
  const bw = b.split(/(\s+)/).filter((s) => s.length > 0);

  // LCS table over words (whitespace tokens included so spacing is preserved).
  const n = aw.length;
  const m = bw.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = aw[i] === bw[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const raw: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aw[i] === bw[j]) {
      raw.push({ type: "same", text: aw[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      raw.push({ type: "del", text: aw[i]! });
      i++;
    } else {
      raw.push({ type: "add", text: bw[j]! });
      j++;
    }
  }
  while (i < n) raw.push({ type: "del", text: aw[i++]! });
  while (j < m) raw.push({ type: "add", text: bw[j++]! });

  // Merge adjacent segments of the same type (so "old words" render as one run, not word-by-word).
  const merged: DiffSegment[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.type === seg.type) last.text += seg.text;
    else merged.push({ ...seg });
  }
  return merged;
}

/**
 * True when a change is an edit whose before/after is worth previewing as a word-level diff
 * (title, meta/description, headline, or answer block). New pages, links, schema, and experience
 * fixes have no single before->after string to diff, so they self-hide.
 */
export function isDiffableFamily(family: string): boolean {
  return family === "title" || family === "title_meta" || family === "meta" || family === "h1" || family === "answer";
}

/**
 * Resolve the before/after strings to diff for a change, preferring the prepared draft text (the
 * actual thing that will ship) and falling back to the change's own before/after. Returns null
 * when there is nothing diffable.
 */
export function resolveDiffPair(
  c: CanonicalChange,
  move: RowMoveLike | undefined,
): { before: string; after: string } | null {
  if (!isDiffableFamily(c.changeFamily)) return null;
  // Prefer the prepared, paste-ready value (title draft or answer block) when it exists.
  const after =
    (move?.preparedDraftKind === "atomic_edit" ? move?.draftTitle : null) ??
    move?.preparedDraftText ??
    move?.draftTitle ??
    c.after ??
    "";
  const before = c.before ?? "";
  const seg = wordDiff(before, after);
  if (!seg) return null;
  return { before, after };
}

/* -------------------------------------------------------------------------- */
/* 4. NOT-NOW DURATIONS (v1 ~350/351)                                         */
/* -------------------------------------------------------------------------- */

/**
 * Honest snooze options for the "Not now" control. The DEFAULT (index 0) is byte-identical to the
 * old bare "Not now": the store defers for 7 days, so "in a week" is the true, honest label for
 * the unchanged action. The other durations are operator-facing framings of the same deferral;
 * persisting a custom remind date is a shared-store change tracked as a P13 follow-up, so today
 * every option routes through the SAME respondToRecommendation('deferred') call.
 */
export const SNOOZE_DURATIONS: { id: string; label: string; menuLabel: string }[] = [
  { id: "week", label: "Not now: remind me in a week", menuLabel: "In a week" },
  { id: "tomorrow", label: "Not now: remind me tomorrow", menuLabel: "Tomorrow" },
  { id: "month", label: "Not now: remind me in a month", menuLabel: "In a month" },
];

/** The default snooze label - what the plain "Not now" click means today (byte-identical). */
export const DEFAULT_SNOOZE_LABEL = SNOOZE_DURATIONS[0]!.label;
