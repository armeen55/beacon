/**
 * alternatives-panel (2026-07-11, Wave 4, G9) - PURE render-model for the /changes
 * detail view's "What else I considered" block.
 *
 * THE GAP this closes: the move router (move-router.ts's `routeMove`) already
 * debates a Move's alternatives and records the outcome on `MoveRouterDecision` -
 * which actions it VETOED outright (`appliedObjections`, severity "veto") and
 * which specialists backed a DIFFERENT action (`dissenting`) - and that decision
 * is persisted on every PreparedMovePack (via move_drafts, prepared_pack). But no
 * surface ever rendered WHY the chosen action beat the alternatives; an operator
 * had to reconstruct the argument by hand.
 *
 * This module performs NO new computation and NO new I/O: it only PROJECTS the
 * already-decided fields into a capped, plain-language list.
 *   - "Rejected alternative" means a VETO, not a downgrade. A downgrade only
 *     dampens the winning action's score; it never rules an alternative out, so
 *     claiming a downgraded action was "rejected" would overstate what actually
 *     happened. Only `appliedObjections` entries with `severity: "veto"` name a
 *     genuinely rejected alternative (via their `against` list).
 *   - The action name is routed through move-router's own `ACTION_PLAIN_FOR_DEBATE`
 *     map (never a raw `MoveRouterAction` key) and the reason through
 *     debate-summary's own `OBJECTION_LABELS` map, so this never invents new
 *     wording for a fact those two modules already phrase in Beacon voice.
 *   - The dissent line names the specialist via the existing `teammateOf` team
 *     identity and states their own stored `claim`, humanized the SAME way the
 *     "Your team on this move" panel already humanizes every voice.
 *
 * Honest absence: returns null when there is no vetoed alternative AND no
 * dissenting voice - the caller renders no panel at all rather than an empty
 * shell (this is supplementary reasoning, not a primary field).
 *
 * Pinned by alternatives-panel.test.ts.
 */

import { ACTION_PLAIN_FOR_DEBATE, type MoveRouterDecision } from "./move-router";
import { OBJECTION_LABELS, humanizeDebateLine } from "./debate-summary";
import type { MoveRouterAction } from "./specialist-opinions";
import { teammateOf } from "@/domains/team/identity";
import { stripBannedDashes } from "@/lib/copy/strip-dashes";

/** Never show more than 3 alternatives - this is a supplementary aside, not a
 *  second debate. */
const MAX_ALTERNATIVES = 3;

export type AlternativesPanelData = {
  /** Up to 3 rendered lines, one per rejected alternative, decision order (the
   *  order the router's own vetoes fired in), each already in plain words with
   *  no raw action key and no dash. */
  alternatives: string[];
  /** "The <teammate> disagreed: <their take>", or null when no specialist
   *  backed a different action / raised a real objection against the winner. */
  dissentLine: string | null;
};

function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function actionPlain(action: MoveRouterAction): string {
  return ACTION_PLAIN_FOR_DEBATE[action] ?? action.replace(/_/g, " ");
}

/**
 * Build the "What else I considered" panel from an already-routed decision. PURE.
 * Only the three fields it actually reads are required, so a caller can pass the
 * full `MoveRouterDecision` or a narrower fixture.
 */
export function buildAlternativesPanel(
  decision: Pick<MoveRouterDecision, "action" | "appliedObjections" | "dissenting">,
): AlternativesPanelData | null {
  const seen = new Set<MoveRouterAction>();
  const alternatives: string[] = [];

  for (const obj of decision.appliedObjections) {
    if (alternatives.length >= MAX_ALTERNATIVES) break;
    if (obj.severity !== "veto") continue; // a downgrade never REJECTS an alternative
    for (const alt of obj.against) {
      if (alternatives.length >= MAX_ALTERNATIVES) break;
      if (alt === decision.action || seen.has(alt)) continue;
      seen.add(alt);
      const reason =
        OBJECTION_LABELS[obj.kind] ?? (humanizeDebateLine(obj.detail) || "it did not clear the bar this move needed");
      alternatives.push(
        stripBannedDashes(`${capitalize(actionPlain(alt))} instead: rejected. ${reason}.`),
      );
    }
  }

  // The dissent line: prefer a dissenting voice that raised a real objection (the
  // concrete worry) over one that merely preferred a different action, matching
  // debate-summary.ts's own "odd one out" preference (computeAgreement).
  const objector = decision.dissenting.find((o) => o.objections.length > 0);
  const dissenter = objector ?? decision.dissenting[0] ?? null;
  const dissentLine = dissenter
    ? stripBannedDashes(
        `The ${teammateOf(dissenter.specialist).name} disagreed: ${humanizeDebateLine(dissenter.claim)}`,
      )
    : null;

  if (alternatives.length === 0 && !dissentLine) return null;
  return { alternatives, dissentLine };
}
