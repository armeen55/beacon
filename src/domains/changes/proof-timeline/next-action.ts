/**
 * /changes/[id] proof-brief — Act 5 next-action resolver.
 *
 * Bundle (2026-05-11) — /changes/[id] 5-act narrative redesign per
 * the maximum-depth UI audit
 * (`~/.claude/plans/i-want-a-maximum-depth-curried-curry.md`).
 *
 * Decides which CTAs the brief's Act 5 ("What to do next") surfaces,
 * given the row's result-pill + linked-recommendation provenance +
 * available replicate-pattern context. Pure module so the CTA
 * decisions are pinnable by truth-table tests in Node.
 *
 * Customer-vocabulary contract:
 *   • Labels are plain English ("Open recommendation" / "Replicate
 *     this pattern" / "Investigate" / "Back to changes").
 *   • No internal subsystem names ("decision matrix", "pattern
 *     brain", etc.).
 *   • Result-pill drives the verb; rec provenance drives the
 *     destination.
 */
import type { ProofPillKind } from "@/domains/changes/proof-timeline/result-pill";

export type NextActionCta = {
  /** Stable kind for data-attrs + tests. */
  kind:
    | "open_recommendation"
    | "replicate_pattern"
    | "investigate"
    | "open_legacy_detail"
    | "back_to_changes";
  label: string;
  href: string;
  /** Visual emphasis — primary renders as a filled button, secondary
   *  as a text link. There is always exactly ONE primary CTA. */
  emphasis: "primary" | "secondary";
};

export type NextActionInput = {
  /** Result-pill resolved upstream (Act 3 verdict). */
  pillKind: ProofPillKind;
  /** Linked rec id from `changelog_entries.source_rec_id`. */
  sourceRecId: string | null;
  /** Number of replicate-rec candidates Beacon found for this change. */
  replicateRecCount: number;
  /** Force a legacy-detail escape hatch into Act 5. */
  includeLegacyEscape?: boolean;
};

/**
 * Build the ordered CTA list for Act 5. Always returns ≥ 1 item.
 * Order is the visual order on the page.
 *
 * Decision priority:
 *   1. `helping` + `replicateRecCount > 0` → primary = Replicate.
 *      Open Recommendation appears as secondary when sourceRecId is
 *      present.
 *   2. `helping` (no replicate) + sourceRecId → primary = Open
 *      Recommendation.
 *   3. `hurting` or `needs_review` → primary = Investigate
 *      (revert/diagnose), Open Recommendation as secondary when
 *      present.
 *   4. `too_early` / `watching` / `no_signal_yet` / `live` →
 *      primary = Open Recommendation when present, else just Back to
 *      changes.
 *   5. Always close with "Back to changes" as the last secondary.
 *      Legacy-detail escape is appended right before "Back to
 *      changes" when `includeLegacyEscape` is true.
 */
export function resolveNextActions(input: NextActionInput): NextActionCta[] {
  const {
    pillKind,
    sourceRecId,
    replicateRecCount,
    includeLegacyEscape,
  } = input;

  const ctas: NextActionCta[] = [];

  const openRecCta: NextActionCta | null = sourceRecId
    ? {
        kind: "open_recommendation",
        label: "Open recommendation",
        // The recommendation brief route — Bundle 2B's per-rec brief.
        // Encoding handled there; we just pass the id through.
        href: `/recommendations/${encodeURIComponent(sourceRecId)}`,
        emphasis: "secondary",
      }
    : null;

  switch (pillKind) {
    case "helping": {
      if (replicateRecCount > 0) {
        ctas.push({
          kind: "replicate_pattern",
          label: "Replicate this pattern",
          // /recommendations highlights replicate candidates;
          // anchored on the rec id when present.
          href: sourceRecId
            ? `/recommendations?source_rec=${encodeURIComponent(sourceRecId)}`
            : "/recommendations",
          emphasis: "primary",
        });
        if (openRecCta) ctas.push({ ...openRecCta, emphasis: "secondary" });
      } else if (openRecCta) {
        ctas.push({ ...openRecCta, emphasis: "primary" });
      }
      break;
    }
    case "hurting":
    case "needs_review": {
      ctas.push({
        kind: "investigate",
        label:
          pillKind === "hurting"
            ? "Investigate or revert"
            : "Review on the live page",
        href: openRecCta?.href ?? "/changes",
        emphasis: "primary",
      });
      if (openRecCta) ctas.push({ ...openRecCta, emphasis: "secondary" });
      break;
    }
    case "too_early":
    case "watching":
    case "no_signal_yet":
    case "live": {
      if (openRecCta) ctas.push({ ...openRecCta, emphasis: "primary" });
      break;
    }
  }

  if (includeLegacyEscape) {
    ctas.push({
      kind: "open_legacy_detail",
      label: "Open the full record",
      // The current location is /changes/[id]; the legacy-detail
      // route is the same path with ?legacy=1 appended at the
      // consumption boundary (the v2 client builds it from the
      // route's current id).
      href: "?legacy=1",
      emphasis: "secondary",
    });
  }

  // Always include Back to changes as the last secondary. Promote it
  // to primary when nothing else is in the list (calm default).
  ctas.push({
    kind: "back_to_changes",
    label: "Back to changes",
    href: "/changes",
    emphasis: ctas.length === 0 ? "primary" : "secondary",
  });

  return ctas;
}
