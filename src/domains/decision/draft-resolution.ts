import "server-only";

/** decision/draft-resolution: THE INFORMATION-GAIN REFUSAL CLASS AND ITS DETERMINISTIC LADDER, beside the editor
 *  rather than inside it so the 701-line editor file stays within its ceiling. Two things live here and they are
 *  one contract. `GAIN` names the gate lines whose refusal means the copy failed for what it does not ADD, the one
 *  failure class evidence acquisition or restructuring can fix: their class is an IDENTITY check on these exact
 *  constants, never an inference from prose, because notes explain a decision and must never control the runtime.
 *  `gainResolution` is the cheapest-defensible-first ladder that turns such a refusal into the smallest correct
 *  typed next step (producers/contract's DraftResolution). */

import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { canonicalUrlKey, type EvidenceSnapshot, type OwnedPageEvidence } from "@/domains/evidence/snapshot";
import type { OwnedPageBody } from "@/domains/evidence/pages/owned-context";
import type { ChangeProposal } from "./contracts";
import type { DraftResolution, EvidenceRequirement } from "./producers/contract";

export const GAIN = {
  ADDS_NOTHING: "every claim stands only on this page's own words, so a reader already on the page learns nothing: add a checked fact (a fact- id) or relate this page to another the account owns (an owned-page id)",
  REPEATS_BELOW: "it repeats what stays on the page below it, so a reader gets the same thing twice",
  TOO_THIN: "this rearranges the page into one more paragraph: a synthesis owes a direct answer and then the items, meanings or comparison the reader came for, each on its own line",
  NOT_IMPROVING: "it repeats the search instead of improving the page",
  /** Membership = the refusal is the gain class. TOO_THIN is deliberately NOT a member: it fires only once the
   *  synthesis path was already chosen, which means the material exists and the defect is SHAPE, exactly what the
   *  corrective retry fixes; no acquisition can make one paragraph into three lines. */
  LINES: new Set<string>(),
} as const;
GAIN.LINES.add(GAIN.ADDS_NOTHING); GAIN.LINES.add(GAIN.REPEATS_BELOW); GAIN.LINES.add(GAIN.NOT_IMPROVING);

/** THE DETERMINISTIC RESOLUTION LADDER for an information-gain refusal, cheapest defensible first. By the time
 *  this runs the two $0 rungs are spent: a real replace target already became a structural synthesis upstream,
 *  and every authorized stored fact was already in the packet the refused rounds drafted from. What remains is
 *  what to GO AND GET: the page's own body when no read is in hand, the exact-query results page when none is on
 *  file, a winner those results name whose content is unread, and authoritative support when nothing external is
 *  banked. All present and still refused is `no_valid_treatment`, typed debt, never a loop. The evaluator's typed
 *  step is honored only where the ladder's own rungs are all present, because the ladder can prove its gaps and
 *  the judge cannot. PURE. */
export function gainResolution(judge: DraftResolution, snapshot: EvidenceSnapshot, card: ChangeProposal, page: OwnedPageEvidence, body: OwnedPageBody | null, factsBanked: number): { resolution: DraftResolution; need?: EvidenceRequirement } {
  const q = card.primaryQuery, qk = canonicalQueryKey(q);
  if (judge === "no_valid_treatment") return { resolution: "no_valid_treatment" };
  if ((body?.passages ?? []).length === 0) return { resolution: "acquire_page_source", need: { kind: "page_source", query: q, url: page.url, reasonCode: "page_unread" } };
  const serpRow = (snapshot.research?.serpEvidence ?? []).find((s) => canonicalQueryKey(s.query) === qk) ?? null;
  if (!serpRow) return { resolution: "acquire_serp", need: { kind: "serp", query: q, reasonCode: "no_exact_serp" } };
  const extracts = new Set((snapshot.research?.winningPages ?? []).filter((w) => w.extract).map((w) => canonicalUrlKey(w.url)));
  const unread = serpRow.organic.filter((o) => canonicalUrlKey(o.url) !== canonicalUrlKey(page.url)).slice(0, 5).find((o) => !extracts.has(canonicalUrlKey(o.url))) ?? null;
  if (unread) return { resolution: "acquire_competitor_page", need: { kind: "competitor_page", query: q, url: unread.url, reasonCode: "winner_unread" } };
  if (factsBanked === 0 || judge === "acquire_factual_source") return { resolution: "acquire_factual_source", need: { kind: "factual_source", query: q, url: page.url, reasonCode: "facts_owed" } };
  return { resolution: "no_valid_treatment" };
}
