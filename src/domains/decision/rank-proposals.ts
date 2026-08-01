/**
 * decision/rank-proposals: THE ONE ranking, across every kind of change this kernel
 * can propose (Phase 4, the unified ranking).
 *
 * What it replaced: a single-metric sort. The old order was recoverable clicks with
 * three tiebreaks, which was honest about size and blind about everything else. On one
 * page it happily put a bigger lever the evidence never accused above the small one it
 * did, and it had no idea a change was already being measured on that page, so it
 * offered the operator a second edit that would make the first unreadable.
 *
 * So the order is now ONE inspectable score built from bounded factors, each naming the
 * input it read:
 *
 *   actionability  the proposal lifecycle. A validated-safe change outranks one still
 *                  waiting on your eyes, which outranks one a safety gate refused. The
 *                  band is wider than every other factor put together, so no amount of
 *                  size can lift a refused draft over a safe one.
 *   visibility     the clicks the diagnosis proved are recoverable. Gross traffic never
 *                  ranks anything: a small page with a real gap beats a huge healthy one.
 *   evidence       how much of a receipt I can actually show you.
 *   causeFit       does the lever address the cause the evidence NAMED. A title rewrite
 *                  where the results page accused the title scores full marks; the same
 *                  rewrite where the cause is a missing section is discounted the same
 *                  amount, so a mismatched lever can never win on size alone.
 *   strategic      how many of the questions customers actually ask are in scope.
 *   effort         a one minute paste beats an hour of writing, all else equal.
 *   risk           a change that moves or hides a page is discounted, never promoted.
 *   overlap        a page that already has a change under measurement is discounted
 *                  hard: a second edit there makes the first one unreadable.
 *   confounding    several changes landing on the same page in one batch discount each
 *                  other for the same reason.
 *
 * NO INVENTED NUMBERS. When no proven figure backs the value factor the receipt is
 * marked directional and says out loud that the order is a direction, not a size.
 *
 * Every ranked proposal carries `rankingReceipt` (the bounded factor list with inputs)
 * and, except for the last, `whyRankedAboveNext` (one plain sentence naming the factor
 * that actually separated it from the change below it).
 *
 * PURE, no I/O. Deterministic + stable (equal scores keep input order).
 */

import type { BundleComponentKind, ChangeProposal, ProposalStatus } from "./contracts";
import { dangerousComponents } from "./contracts";
import type { CauseFinding } from "./diagnosis";

/** The cause ladder's own vocabulary. Read from there, never re-declared here. */
type Cause = CauseFinding["cause"];

type Receipt = NonNullable<ChangeProposal["rankingReceipt"]>;
type Factor = Receipt["factors"][number];

/** The lifecycle band. Wider than the full swing of every other factor combined
 *  (max +100, min -83), so the tiers can never cross on content. */
const TIER: Record<ProposalStatus, number> = { proposed: 500, applied: 500, needs_review: 250, rejected: 0 };

/** Bounded ceilings, one per factor. A factor may never contribute more than its max. */
const MAX = { actionability: 500, visibility: 40, evidence: 15, causeFit: 25, strategic: 10, effort: 10, risk: 18, overlap: 30, confounding: 10 } as const;

/**
 * WHICH LEVERS ADDRESS WHICH CAUSE. Keyed on the cause ladder's OWN union and deliberately
 * TOTAL: adding a cause over there breaks the build here until somebody says what fixes it,
 * which is the only way this table can never quietly fall behind the diagnosis.
 *
 * An EMPTY set is a real answer, not an omission: nothing you can write on the page fixes a
 * search fewer people run, or a change that is already being measured. A cause with no lever
 * matches nothing and discounts nothing, so those proposals rank on their other factors.
 */
const CAUSE_LEVERS: Record<Cause, ReadonlySet<BundleComponentKind>> = {
  cannibalization: new Set(["consolidation", "canonical", "redirect", "noindex", "internal_link_remove"]),
  ctr_snippet: new Set(["title", "meta", "h1", "anchor_text"]),
  competitor_content_gap: new Set(["section_add", "entity_expansion", "full_rewrite", "table_or_list_add", "new_page"]),
  incomplete_coverage: new Set(["section_add", "entity_expansion", "table_or_list_add", "full_rewrite", "new_page"]),
  weak_opening: new Set(["opening_answer", "h1", "paragraph_correction", "restructure"]),
  serp_shape_shift: new Set(["restructure", "table_or_list_add", "schema", "section_rewrite", "opening_answer"]),
  intent_shift: new Set(["full_rewrite", "restructure", "section_rewrite", "title", "new_page"]),
  internal_link_weakness: new Set(["internal_link_add", "anchor_text", "navigation", "internal_link_remove"]),
  ai_citation_gap: new Set(["source_update", "factual_correction", "entity_expansion", "schema", "opening_answer"]),
  retrieved_not_cited: new Set(["opening_answer", "table_or_list_add", "schema", "source_update", "entity_expansion"]),
  technical_indexability: new Set(["noindex", "canonical", "redirect", "navigation"]),
  demand_decline: new Set([]),
  ranking_loss: new Set([]),
  measuring_change: new Set([]),
  no_problem: new Set([]),
};

/** Plain-English names for what each cause is about, for the sentence that explains the order. */
const LEVER_WORD: Partial<Record<Cause, string>> = {
  cannibalization: "two of your own pages splitting one search",
  ctr_snippet: "the line a searcher reads",
  competitor_content_gap: "a subject the winning pages cover and this page does not",
  incomplete_coverage: "what this page leaves out",
  weak_opening: "what the page answers up front",
  serp_shape_shift: "the shape of answer this search now rewards",
  intent_shift: "what people now mean by this search",
  internal_link_weakness: "how your own pages point at this one",
  ai_citation_gap: "why assistants hand this question to somebody else",
  retrieved_not_cited: "why assistants read this page and quote somebody else",
  technical_indexability: "whether this page can be found at all",
};

const round2 = (n: number): number => Math.round(n * 100) / 100;
const num = (n: number): string => Math.round(n).toLocaleString();

/** The component kinds this proposal actually touches. A bundled change says so
 *  directly; a pre-bundle row is read off its one exact edit. */
function leversOf(p: ChangeProposal): BundleComponentKind[] {
  const bundled = p.bundle?.components.map((c) => c.kind) ?? [];
  if (bundled.length > 0) return bundled;
  const c = p.recommendedChange;
  if (c.kind === "new_page") return ["new_page"];
  return [c.field === "answer_block" ? "opening_answer" : c.field];
}

/** Every factor for ONE proposal, in reading order. `peers` is how many OTHER proposals
 *  in the same batch land on the same page; `measuring` is true when that page already
 *  has a change under measurement. */
function factorsFor(p: ChangeProposal, peers: number, measuring: boolean): { factors: Factor[]; directional: boolean } {
  const f: Factor[] = [];
  const add = (name: string, input: string, contribution: number, max: number): void =>
    void f.push({ name, input, contribution: round2(contribution), max });

  const tier = TIER[p.status] ?? 0;
  add("actionability", p.status === "rejected" ? "this draft did not pass my safety checks"
    : p.status === "needs_review" ? "this draft is waiting on your review"
      : "this draft passed every safety check", tier, MAX.actionability);

  const clicks = Number.isFinite(p.impactScore) && p.impactScore != null ? Math.max(0, p.impactScore) : null;
  const upside = Number.isFinite(p.upsidePerMonth) && p.upsidePerMonth != null ? Math.max(0, p.upsidePerMonth) : null;
  let directional = true;
  if (clicks != null && clicks > 0) {
    directional = false;
    add("visibility", `about ${num(clicks)} clicks I can show are recoverable`, Math.min(MAX.visibility, clicks / 25), MAX.visibility);
  } else if (upside != null && upside > 0) {
    add("visibility", `about ${num(upside)} a month of opportunity, which is a midpoint and not a measured figure`, Math.min(MAX.visibility / 2, upside / 25), MAX.visibility);
  } else {
    add("visibility", "no proven figure for what this wins back", 0, MAX.visibility);
  }

  const items = p.bundle?.receipt.items.length ?? p.evidence.evidenceRefCount;
  add("evidence", `${num(items)} ${items === 1 ? "piece" : "pieces"} of evidence on the receipt`, Math.min(MAX.evidence, items * 1.5), MAX.evidence);

  const cause = p.diagnosisCause;
  // A cause I do not recognise (a hand-edited row, or one written under an older ladder) is
  // treated exactly like no cause at all: it matches nothing and it punishes nothing.
  const levers = cause ? CAUSE_LEVERS[cause] : undefined;
  if (!cause) add("causeFit", "no cause named for this change yet", 0, MAX.causeFit);
  else if (!levers || levers.size === 0) add("causeFit", "nothing you can write on the page fixes the cause I named", 0, MAX.causeFit);
  else {
    const hit = leversOf(p).some((k) => levers.has(k));
    add("causeFit", hit ? `this change works on ${LEVER_WORD[cause] ?? "the cause I named"}`
      : `this change does not touch ${LEVER_WORD[cause] ?? "the cause I named"}`, hit ? MAX.causeFit : -MAX.causeFit, MAX.causeFit);
  }

  const prompts = p.bundle?.scope.prompts.length ?? 0;
  add("strategic", `${num(prompts)} ${prompts === 1 ? "question" : "questions"} your customers actually ask are in scope`, Math.min(MAX.strategic, prompts * 5), MAX.strategic);

  const minutes = Math.max(0, p.estimatedEffortMinutes);
  add("effort", `about ${num(minutes)} ${minutes === 1 ? "minute" : "minutes"} of your time`, Math.max(0, MAX.effort - minutes / 6), MAX.effort);

  const danger = dangerousComponents(p.bundle?.components ?? []);
  const risky = danger.length > 0 || p.riskLevel === "high";
  add("risk", risky ? "this one moves or hides a page, so I hold it for your confirmation"
    : p.riskLevel === "medium" ? "this one touches claims worth reading twice" : "this one is safe to paste",
  risky ? -MAX.risk : p.riskLevel === "medium" ? -8 : 0, MAX.risk);

  add("overlap", measuring ? "this page already has a change I am measuring" : "nothing is being measured on this page",
    measuring ? -MAX.overlap : 0, MAX.overlap);

  add("confounding", `${num(peers)} other ${peers === 1 ? "change" : "changes"} in this batch land on the same page`,
    -Math.min(MAX.confounding, peers * 5), MAX.confounding);

  return { factors: f, directional };
}

function receiptFor(p: ChangeProposal, peers: number, measuring: boolean): Receipt {
  const { factors, directional } = factorsFor(p, peers, measuring);
  const score = round2(factors.reduce((a, x) => a + x.contribution, 0));
  const items = p.bundle?.receipt.items.length ?? p.evidence.evidenceRefCount;
  const basis = directional
    ? `I have no proven click figure for this one, so this is the order I would work in, not a promise about size. I ranked it on ${num(items)} ${items === 1 ? "piece" : "pieces"} of evidence and what it takes you to do.`
    : `I ranked this on about ${num(Math.max(0, p.impactScore ?? 0))} clicks I can show are recoverable, ${num(items)} ${items === 1 ? "piece" : "pieces"} of evidence, and what it takes you to do.`;
  return { score, factors, directional, basis };
}

/** The scalar the order is built from, for ONE proposal read on its own (no batch, so
 *  nothing overlaps and nothing confounds). Exposed so a caller can inspect exactly why
 *  the order came out as it did. */
export function proposalValueScore(p: ChangeProposal): number {
  return receiptFor(p, 0, false).score;
}

/** The factor that actually separated two neighbours: the biggest contribution gap. */
function separator(a: Receipt, b: Receipt): { name: string; a: Factor; b: Factor } | null {
  let best: { name: string; a: Factor; b: Factor; delta: number } | null = null;
  for (const fa of a.factors) {
    const fb = b.factors.find((x) => x.name === fa.name);
    if (!fb) continue;
    const delta = fa.contribution - fb.contribution;
    if (delta > 0.01 && (!best || delta > best.delta)) best = { name: fa.name, a: fa, b: fb, delta };
  }
  return best ? { name: best.name, a: best.a, b: best.b } : null;
}

/** One plain sentence comparing a proposal to the one directly below it. */
function whyAbove(next: ChangeProposal, a: Receipt, b: Receipt): string {
  const other = `the change for "${next.primaryQuery}"`;
  const sep = separator(a, b);
  if (!sep) return `I ranked this level with ${other}, so start with whichever suits your day.`;
  const lead = `I put this ahead of ${other} because`;
  switch (sep.name) {
    case "actionability":
      return `${lead} it passed every safety check and that one still needs your eyes first.`;
    case "visibility":
      return `${lead} it wins back more of what you are losing: ${sep.a.input} against ${sep.b.input}.`;
    case "evidence":
      return `${lead} I can show you more for it: ${sep.a.input} against ${sep.b.input}.`;
    case "causeFit":
      return `${lead} ${sep.a.input}, and ${other} does not.`;
    case "strategic":
      return `${lead} it covers more of what people ask you: ${sep.a.input} against ${sep.b.input}.`;
    case "effort":
      return `${lead} it is quicker for you: ${sep.a.input} against ${sep.b.input}.`;
    case "risk":
      return `${lead} ${sep.a.input}, while ${sep.b.input}.`;
    case "overlap":
      return `${lead} ${next.pagePath ? `${next.pagePath} ` : "that page "}already has a change I am measuring, and a second one there would muddy the reading.`;
    default:
      return `${lead} fewer other changes of yours land on the same page.`;
  }
}

/**
 * Rank proposals, most valuable first, and stamp each one with the receipt that explains
 * where it landed. `measuringPagePaths` are the pages that already carry a change under
 * measurement; a proposal touching one of them is discounted hard. Stable + deterministic.
 */
export function rankProposals(
  proposals: readonly ChangeProposal[],
  ctx: { measuringPagePaths?: readonly (string | null)[] } = {},
): ChangeProposal[] {
  const measuring = new Set((ctx.measuringPagePaths ?? []).filter((x): x is string => !!x));
  const perPage = new Map<string, number>();
  for (const p of proposals) {
    const key = p.pagePath ?? `new::${p.primaryQuery.trim().toLowerCase()}`;
    perPage.set(key, (perPage.get(key) ?? 0) + 1);
  }
  const scored = proposals.map((p, i) => {
    const key = p.pagePath ?? `new::${p.primaryQuery.trim().toLowerCase()}`;
    return { p, i, receipt: receiptFor(p, Math.max(0, (perPage.get(key) ?? 1) - 1), !!p.pagePath && measuring.has(p.pagePath)) };
  });
  scored.sort((a, b) => (b.receipt.score - a.receipt.score) || (a.i - b.i));
  return scored.map((row, idx) => {
    const next = scored[idx + 1];
    const ranked: ChangeProposal = { ...row.p, rankingReceipt: row.receipt };
    if (next) ranked.whyRankedAboveNext = whyAbove(next.p, row.receipt, next.receipt);
    else delete ranked.whyRankedAboveNext;
    return ranked;
  });
}
