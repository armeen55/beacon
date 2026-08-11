import "server-only";

/**
 * decision/case-synthesis (V1 Truth Convergence Phase 2, 2026-07-31) - the ONE semantic read over a grouping that is already decided. Evidence groups research deterministically, on lineage the provider
 * recorded, the owned page Google serves, an engine's own fan-out, the account's specific tokens and pages
 * two exact looks share. Token overlap may CREATE a candidate; it may not be the last word on whether two
 * searches are one subject. "persian male names" and "iranian names" are one case that no token rule joins; "iran leader" and this week's news about Iran share every token and are not one case at all.
 *
 * SO THIS LAYER IS ADVISORY, DELIBERATELY. It refines the registry and is never load-bearing: a gateway that is off, over budget, slow, refused or lying leaves the deterministic answer exactly as it was, and
 * every money path (which comparison is bought, which proposal belongs to which case) keeps reading the registry the same way it did before this file existed.
 *
 * ONE call per reconcile pass, bounded and cached: the same candidate set produces a byte-identical prompt,
 * so the gateway's own per-account call cache serves it at $0 and no second reading is ever bought for a registry that did not move. Fewer than two cases is not a question worth asking, so it costs nothing.
 *
 * FAIL-CLOSED ON INVENTION: every id, address and search that comes back is checked against exactly what was supplied, and ONE stranger throws the WHOLE reading away rather than applying the half of it that
 * happens to check out. The deterministic refusals (a merge of two strangers, a split that empties a case) live in evidence/case-identity beside the identity rules they protect.
 */

import { createHash } from "node:crypto";

import { log } from "@/lib/logger";
import { callStructuredLLM, type StructuredDraftRequest } from "./llm/structured-drafter";
import type { CaseSynthesis } from "./llm/schemas";

/** ONE deterministic candidate: the case id Evidence already minted, what the evidence calls it, and the
 *  bounded facts a reader needs to tell it apart from its neighbours. No metric, no verdict, no draft. */
export type SynthesisCandidate = {
  id: string;
  label: string;
  queries: readonly string[];
  prompts: readonly string[];
  /** Addresses of MY OWN pages the evidence connects to this case: the only addresses the reading may name. */
  ownedUrls: readonly string[];
  /** How the deterministic pass grouped this one, in the order the rules fired. */
  groupedBy: readonly string[];
  /** Named by the run's own frozen research plan: the cases the run is actually stuck on. */
  inPlan?: boolean;
  /** The largest monthly search volume on file across this case's searches; null when nothing is priced. */
  demand?: number | null;
};

/** Bounded so one account's registry can never grow the prompt without limit. */
const MAX_CANDIDATES = 14;
const MAX_QUERIES = 8;
const MAX_PROMPTS = 4;
const MAX_URLS = 6;
const SYNTHESIS_COST_USD = 0.01;

const SYSTEM = [
  "You read the research cases one website owner has on file and say which of them are really one subject, which one is really two, which of the owner's own pages answers which case, and which case sits under a broader one.",
  "You are refining an answer already reached from evidence. Changing nothing is a correct and common answer.",
  "Rules you may not break.",
  "1. Use ONLY the case ids, addresses and searches written below. Never invent an id, an address, a search, a number or a fact, and never add knowledge of your own about these subjects.",
  "2. Merge two cases only when their own searches show one subject. Two subjects that merely share a word, a place, a category or a moment in the news are two cases.",
  "3. Split a case only when its searches carry two different intents, and move only the searches that belong to the new one. Never move all of them. At most one split per case.",
  "4. In pageLinks, relation says what that address actually answers for that case: covers, partially_covers or does_not_cover. One page may answer several cases, and one case may be answered by several pages.",
  "5. parentOf is for a narrower case sitting under a broader one. It is never a merge and never a split.",
  "6. Where the facts you were given disagree, say so plainly in the reason and leave those cases alone. Never settle a disagreement by quietly picking a side.",
  "7. Every reason is one plain sentence about the evidence in front of you. Name a case by its id, and never quote a page title or a marketing phrase.",
  "8. Return every field. An empty list is the right answer whenever you have no honest change to propose.",
  "9. No em dash and no en dash anywhere.",
].join("\n");

const norm = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

/** The candidate set, written the same way every time so the same registry asks the same question. */
function candidateFacts(candidates: readonly SynthesisCandidate[]): string[] {
  return candidates.map((c) => [
    `${c.id} "${c.label}"`,
    `    searches: ${c.queries.slice(0, MAX_QUERIES).map((q) => `"${q}"`).join(", ") || "none on file"}`,
    `    questions I track: ${c.prompts.slice(0, MAX_PROMPTS).map((p) => `"${p}"`).join(", ") || "none"}`,
    `    my pages: ${c.ownedUrls.slice(0, MAX_URLS).join(", ") || "none"}`,
    `    grouped by: ${c.groupedBy.join(", ") || "nothing but its own searches"}`,
  ].join("\n"));
}

/**
 * ONE strict reading of this account's own case registry, or null. Null is a complete answer: it means the
 * deterministic grouping stands, which is what ships whenever this call is off, blocked, unusable, or names anything nobody gave it.
 */
export async function synthesizeCases(
  candidates: readonly SynthesisCandidate[],
  tenantId: string,
  opts: Pick<StructuredDraftRequest<"case_synthesis">, "complete" | "cacheImpl" | "now"> = {},
): Promise<CaseSynthesis | null> {
  // WHICH FOURTEEN, ON PURPOSE. Sorting by id and slicing selected on a hash: the cases worth regrouping were reviewed only if their minted id happened to sort early. The run's own frozen plan comes first,
  // then the largest demand on file, and the id decides nothing but a genuine tie, so the same registry still asks a byte-identical question however the caller listed it.
  const ordered = [...candidates].filter((c) => !!c.id)
    .sort((a, b) => Number(!!b.inPlan) - Number(!!a.inPlan) || (b.demand ?? -1) - (a.demand ?? -1) || a.id.localeCompare(b.id))
    .slice(0, MAX_CANDIDATES);
  if (ordered.length < 2) return null; // one case cannot be regrouped against anything: no call, no cent

  const facts = candidateFacts(ordered);
  // The fingerprint IS the candidate set: identical cases produce an identical prompt, which the gateway's
  // own per-account cache answers at $0, and it is printed so a stored reading names the set it was taken on.
  const fingerprint = createHash("sha256").update(facts.join("\n")).digest("hex").slice(0, 16);
  const user = [
    "MY CASES ON FILE (use these ids and addresses and no others)",
    ...facts,
    `SET: ${fingerprint}`,
    "Say which of these are one case, which one is two, which of my pages answers which, and which sits under which.",
  ].join("\n");

  const call = await callStructuredLLM({
    kind: "case_synthesis", tenantId, system: SYSTEM, user, grounded: facts.join(" "),
    projectedCostUsd: SYNTHESIS_COST_USD, maxTokens: 2000,
    complete: opts.complete, cacheImpl: opts.cacheImpl, now: opts.now,
  });
  if (call.status !== "drafted") {
    log.info("[case-synthesis] no reading this pass; the grouping I worked out myself stands", { tenantId, status: call.status });
    return null;
  }
  const v = call.value as CaseSynthesis;

  // ── every id, address and search back against what was supplied ──
  const ids = new Set(ordered.map((c) => c.id));
  const urls = new Set(ordered.flatMap((c) => c.ownedUrls.slice(0, MAX_URLS)).map(norm));
  const queriesOf = new Map(ordered.map((c) => [c.id, new Set(c.queries.slice(0, MAX_QUERIES).map(norm))]));
  const strayId = [
    ...v.merges.flatMap((m) => [m.keepId, ...m.absorbIds]), ...v.splits.map((s) => s.fromId),
    ...v.pageLinks.map((p) => p.caseId), ...v.parentOf.flatMap((p) => [p.parentId, p.childId]),
  ].find((id) => !ids.has(id));
  const strayUrl = v.pageLinks.map((p) => p.url).find((u) => !urls.has(norm(u)));
  const strayQuery = v.splits.flatMap((s) => s.moveQueries.map((q) => ({ id: s.fromId, q })))
    .find((x) => !queriesOf.get(x.id)?.has(norm(x.q)))?.q;
  const stray = strayId ?? strayUrl ?? strayQuery;
  if (stray) {
    // ONE stranger throws away the whole reading. Applying the part that checks out would file real cases under an answer half of which was invented, and nothing here is worth that.
    log.warn("[case-synthesis] the reading named something I never gave it, so I kept my own grouping", { tenantId, stray: stray.slice(0, 120) });
    return null;
  }
  return v;
}
