import "server-only";

/** decision/producers/demand-recovery - THE COLLAPSE, DIAGNOSED, then turned into work. The first version of
 *  this producer measured the losses and minted findings; the operator's ruling stands over it now: a
 *  measurable gap is not a cause, historical decline is not a treatment, and a card may exist only when the
 *  system can say WHY the audience left and propose the one action that addresses exactly that. So each lost
 *  unit is DECOMPOSED off its own two-window history: position slipped materially = ranking loss, which the
 *  lever table treats with content (a restoring section, never a sharper line); position held while the click
 *  rate collapsed = the line a searcher reads, treated with the title; anything the two windows cannot
 *  separate claims NO cause and lands as the investigation that names the acquisition which would decide it.
 *  IMPACT LANGUAGE IS SPLIT IN TWO: the historical loss is reported as LOST, and only the current window's
 *  own shortfall under the account's curve is carried as recoverable, because history proves what left, not
 *  what a rewrite brings back. Every number traces to the archive aggregate; nothing here is a guess. */

import { log } from "@/lib/logger";
import { loadCanonicalDemandUnits } from "@/domains/evidence/demand-unit-loader";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate"; import { canonicalUrlKey, type EvidenceSnapshot } from "@/domains/evidence/snapshot";
import type { TenantCtrCurve } from "@/domains/evidence/forecast/tenant-ctr-curve";
import type { ChangeProposal } from "@/domains/decision/contracts";
import type { CauseFinding } from "@/domains/decision/diagnosis";

/** Lost clicks per month before a unit is worth a card, and how many cards one pass mints. */
const MIN_LOST_PER_MONTH = 20, MAX_CARDS = Number.MAX_SAFE_INTEGER; // the count meter is DELETED (operator, 2026-08-30): every unit above the loss floor gets its card
/** Positions slipped before the decline is a ranking loss, the CTR fall that names the snippet, and how many sections one page may be asked for in one pass. */
const POSITION_SLIP = 2, CTR_FALL = 0.4, MAX_BODY_CARDS = 2;

const pathOf = (url: string): string => {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).pathname.replace(/\/+$/, "") || "/"; } catch { return url; } };
const n = (x: number): string => Math.round(x).toLocaleString("en-US");

type DemandRecoveryRun = { cards: ChangeProposal[]; complete: boolean;
  window: { earlyDays: number; earlyFrom: string | null; earlyTo: string | null };
  /** The largest losses this pass measured, card or not: the collapse explanation, on the receipt. */
  losses: { unit: string; lostPerMonth: number; priorPage: string | null; currentPage: string | null; swapped: boolean }[] };

type Decomposed = { cause: "ranking_loss" | "ctr_snippet" | null; field: "section" | "title"; line: string };

/** WHY the audience left. A slid position is its own evidence and owes content. A held position with a
 *  collapsed click rate names the snippet ONLY when the current results page for this audience is on file,
 *  because arithmetic alone cannot tell a weak line from a results page that changed shape around it
 *  (operator, 2026-08-17: a query in a title is not automatically the remedy for low CTR); without that
 *  read the fall is the TRIGGER for buying it, and the card claims research, never a treatment. */
function decompose(h: NonNullable<Awaited<ReturnType<typeof loadCanonicalDemandUnits>>["units"][number]["history"]>,
  hasSerp: boolean): Decomposed {
  // ONLY THE TREATED PAGE'S OWN HISTORY MAY NAME A PAGE-SPECIFIC CAUSE (operator, 2026-08-17): the unit's
  // blended position averages every page the site ranks with, and a second owned page entering the results
  // manufactures an apparent slide with no page having moved. A swapped page or a material share shift is
  // COMPOSITION, its own story, and claims no cause until the page split is decided.
  if (h.pageSwapped) return { cause: null, field: "section",
    line: `Google changed which of this site's pages it shows for these searches, so no single page's two-window history exists to compare: the page split is decided before any cause is claimed.` };
  const shareShift = h.pageShareEarly != null && h.pageShareRecent != null ? h.pageShareEarly - h.pageShareRecent : null;
  const dPos = h.pageEarlyPosition != null && h.pageRecentPosition != null ? h.pageRecentPosition - h.pageEarlyPosition : null;
  const ctrEarly = h.earlyImpressions > 0 ? (h.earlyClicksPerDay * 30) / (h.earlyImpressions / Math.max(1, 13)) : null;
  const ctrNow = h.recentImpressions > 0 ? (h.recentClicksPerDay * 30) / (h.recentImpressions / 3) : null;
  if (dPos != null && dPos >= POSITION_SLIP) return { cause: "ranking_loss", field: "section",
    line: `The page itself slid from position ${h.pageEarlyPosition!.toFixed(1)} to ${h.pageRecentPosition!.toFixed(1)} on its own results for this audience's searches, so something better took its ground: the treatment is content, not a sharper line.` };
  if (dPos == null && h.earlyPosition != null && h.recentPosition != null && h.recentPosition - h.earlyPosition >= POSITION_SLIP)
    return { cause: null, field: "section",
      line: `The blended position across this site's pages slid, but the page now shown lacks its own two-window history, so the slide cannot be pinned on any one page: nothing is treated on an average across pages.` };
  const ctrFell = dPos != null && Math.abs(dPos) < POSITION_SLIP && ctrEarly != null && ctrNow != null && ctrNow < ctrEarly * (1 - CTR_FALL);
  if (ctrFell && shareShift != null && shareShift >= 0.2)
    return { cause: null, field: "section",
      line: `The click rate fell while another of this site's own pages absorbed part of these impressions, so the fall is at least partly composition between owned pages, not the line one page shows: the page split is decided before any wording is blamed.` };
  if (ctrFell && hasSerp)
    return { cause: "ctr_snippet", field: "title",
      line: `The page holds its own position (${h.pageEarlyPosition!.toFixed(1)} then, ${h.pageRecentPosition!.toFixed(1)} now) while the share of searchers clicking it fell by more than ${Math.round(CTR_FALL * 100)} percent, and the stored results page shows what searchers now read, so the line is the diagnosed cause.` };
  if (ctrFell)
    return { cause: null, field: "section",
      line: `The page holds its own position (${h.pageEarlyPosition!.toFixed(1)} then, ${h.pageRecentPosition!.toFixed(1)} now) while the share of searchers clicking it fell by more than ${Math.round(CTR_FALL * 100)} percent, and no current results page for this audience is on file: what searchers see there today decides whether the line, the results page shape or the demand itself changed, so nothing is treated until that read lands.` };
  return { cause: null, field: "section",
    line: "The two windows cannot separate a ranking slide from a snippet change on their own numbers, so the cause is not named until the current results page is read." };
}

/** THE COLLAPSE'S OWN ACQUISITIONS: each lost unit whose two windows cannot name a cause, or whose click
 *  rate fell at a held position with NO current results page on file, names that read as the one purchase
 *  that decides it. Handed to the research plan as exact searches, so the card's "the results page is read
 *  on the next pass" is a wire into the agenda rather than a hope. */
export async function recoveryAcquisitions(tenantId: string, snapshot: EvidenceSnapshot, max: number): Promise<{ topicKey: string; query: string }[]> {
  if (max <= 0) return [];
  try {
    const { units, historyWindow } = await loadCanonicalDemandUnits(tenantId, snapshot);
    if (historyWindow.earlyDays < 30) return [];
    const out: { topicKey: string; query: string }[] = [];
    for (const u of units.filter((x) => (x.history?.lostClicksPerMonth ?? 0) >= MIN_LOST_PER_MONTH)) {
      if (u.serp != null || out.length >= max) continue;
      if (decompose(u.history!, false).cause != null) continue;
      out.push({ topicKey: `recovery::${u.label.toLowerCase()}`, query: u.label });
    }
    return out;
  } catch { return []; }
}

export async function demandRecoveryCards(input: { tenantId: string; snapshot: EvidenceSnapshot; now: Date;
  curve?: Pick<TenantCtrCurve, "expectedCtrAt">;
  /** The pass's one load of the canonical units, so every producer joins the SAME audiences. */
  preloaded?: Awaited<ReturnType<typeof loadCanonicalDemandUnits>> }): Promise<DemandRecoveryRun> {
  const { tenantId, snapshot, now } = input;
  const none: DemandRecoveryRun = { cards: [], complete: false, window: { earlyDays: 0, earlyFrom: null, earlyTo: null }, losses: [] };
  try {
    const { units, historyWindow } = input.preloaded ?? await loadCanonicalDemandUnits(tenantId, snapshot, input.curve, now);
    // UNDER A MONTH OF PRE-WINDOW HISTORY, THIS PRODUCER SAYS SO AND MINTS NOTHING: a loss needs a before.
    if (historyWindow.earlyDays < 30) return { ...none, complete: true, window: historyWindow };
    const owned = new Set(snapshot.ownedPages.map((p) => canonicalUrlKey(p.url)));
    const lost = units.filter((u) => (u.history?.lostClicksPerMonth ?? 0) >= MIN_LOST_PER_MONTH);
    const losses = lost.slice(0, 20).map((u) => ({ unit: u.label, lostPerMonth: u.history!.lostClicksPerMonth,
      priorPage: u.history!.priorTopPage, currentPage: u.history!.currentTopPage, swapped: u.history!.pageSwapped }));
    const cards: ChangeProposal[] = [];
    /* ONE PAGE IS A CONTAINER OF ATOMIC OPPORTUNITIES (Product Truth, one page is never one opportunity; campaign, 2026-09-05). Every card here was named after its PAGE alone, so two audiences losing clicks on one page wore ONE row id: the dedupe behind this producer kept the larger and dropped the rest, and while that loss stood unimplemented every smaller one on the page was invisible. The page's largest recoverable loss KEEPS THE ID IT ALWAYS HAD, which is the row already on file, and each one behind it carries its own canonical search key after "@", the way a link card carries its destination. Two sections a page a pass, because a third writes a slot the store already holds; the line searchers read is ONE mutation however many audiences ask for it, so a page is asked for one of those and no more. */
    const seats = new Map<string, string>(); { const per = new Map<string, { taken: boolean; bodies: number; title: boolean }>();
      for (const u of [...lost].sort((a, b) => b.recoverableClicks - a.recoverableClicks || a.label.localeCompare(b.label))) { const at = u.history!.currentTopPage ?? u.history!.priorTopPage; if (!at || !owned.has(canonicalUrlKey(at))) continue;
        const page = pathOf(at).toLowerCase(), key = canonicalQueryKey(u.label), seat = `${page}::${key}`, held = per.get(page) ?? { taken: false, bodies: 0, title: false }, title = decompose(u.history!, u.serp != null).field === "title";
        if (seats.has(seat) || (title ? held.title : held.bodies >= MAX_BODY_CARDS)) continue; // one mutation, one card: a second audience whose search names the same words is the same section, and the page's line is written once
        seats.set(seat, `${tenantId}::${page}::existing_edit::demand_recovery${held.taken ? `@${key}` : ""}`); per.set(page, { taken: true, bodies: held.bodies + (title ? 0 : 1), title: held.title || title }); } }
    for (const u of lost.slice(0, MAX_CARDS)) {
      const h = u.history!;
      const home = h.currentTopPage ?? h.priorTopPage;
      if (!home || !owned.has(canonicalUrlKey(home))) continue;
      const path = pathOf(home); const id = seats.get(`${path.toLowerCase()}::${canonicalQueryKey(u.label)}`); if (!id) continue; // the page's seats are decided above, in one order, so no ordering of the source rows can flip which audience holds which row
      const d = decompose(h, u.serp != null);
      const phrasings = u.vocabulary.slice(0, 6).map((v) => `"${v}"`).join(", ");
      const windowLine = `${historyWindow.earlyFrom} to ${historyWindow.earlyTo}`;
      const story = `Searches for ${u.label} earned this site about ${n(h.earlyClicksPerDay * 30)} clicks a month over ${windowLine} and earn about ${n(h.recentClicksPerDay * 30)} now: ${n(h.lostClicksPerMonth)} clicks a month were LOST.`;
      const moved = h.pageSwapped ? ` Google moved the audience: ${pathOf(h.priorTopPage!)} earned it then, ${pathOf(h.currentTopPage ?? home)} is shown now.` : "";
      const recoverable = Math.max(0, Math.round(u.recoverableClicks));
      const hints = [story.trim() + moved, d.line,
        d.cause != null
          ? `At today's own demand and positions, about ${n(recoverable)} clicks over 28 days of that are supported as recoverable under the diagnosed cause; the rest depends on winning back ground and is not promised.`
          : `About ${n(recoverable)} clicks over 28 days is the measured shortfall against this account's own click curve at today's positions. None of it is claimed as recoverable until the cause is diagnosed.`,
        `People search this as: ${phrasings}`,
        ...(u.volume?.searchVolume ? [`"${u.label}" carries ${n(u.volume.searchVolume)} searches a month${u.volume.intent ? ` (${u.volume.intent})` : ""}`] : []),
        ...(u.serp ? [`The pages winning it now: ${u.serp.winners.slice(0, 3).map((w) => w.domain).join(", ")}`] : []),
        ...u.tensions];
      const finding: CauseFinding | null = d.cause == null ? null : {
        cause: d.cause, action: d.field === "title" ? "title" : "section", evidenceKeys: [],
        explanation: `${story} ${d.line}`, competingExplanations: [], notConsidered: [],
        falsifier: d.cause === "ranking_loss"
          ? "If the page returns to its old position and the clicks do not follow, the ground was not the cause."
          : "If Google shows the new line and the click rate does not move, the wording was not the cause.",
      };
      cards.push({
        id, tenantId, kind: "existing_edit",
        pagePath: path, pageUrl: home, pageLabel: path, primaryQuery: u.label,
        // THE HEADLINE NEVER SELLS THE HISTORICAL LOSS AS WIN-BACK (operator, 2026-08-17): the lost figure is
        // labeled lost, and the only number offered as recoverable is the current window's own shortfall.
        opportunityType: d.cause === "ranking_loss"
          ? `Rebuild the ground "${u.label}" lost on ${path}: this page's own position ${h.pageEarlyPosition!.toFixed(1)} to ${h.pageRecentPosition!.toFixed(1)}, ${n(h.lostClicksPerMonth)} clicks a month LOST, about ${n(recoverable)} supported as recoverable today`
          : d.cause === "ctr_snippet"
            ? `Rewrite the line searchers read for "${u.label}" on ${path}: position held while the click rate collapsed, ${n(h.lostClicksPerMonth)} clicks a month LOST, about ${n(recoverable)} supported as recoverable today`
            : `Explain the "${u.label}" decline on ${path}: ${n(h.lostClicksPerMonth)} clicks a month LOST and the cause is not yet separable`,
        changeFamily: d.field, status: "needs_review",
        // THE ASSIGNMENT LIVES IN THE TYPED BRIEF, NEVER IN THE COPY FIELD (incident recovery, 2026-09-04): `after` means the exact words to paste, and an instruction sitting there is indistinguishable from finished work to anything that reads the words alone.
        recommendedChange: { kind: "existing_edit", field: d.field, before: null, after: "The exact wording has not been written yet." },
        researchOnly: true, research: {
          missing: d.cause === "ranking_loss"
            ? `Strengthen this page's coverage of ${u.label} with a section that answers, in the searchers' own words (${phrasings}), what the pages now above it answer.`
            : d.cause === "ctr_snippet"
              ? `Rewrite the line searchers read for "${u.label}" so it says what earned the clicks when the click rate was whole, keeping every word the page still earns on.`
              : `The current results page for "${u.label}" has not been read, so the cause is not named and no wording may change yet.`,
          next: d.cause == null ? "The results page for this search is read on the next pass, and the cause lands here with the work it authorizes."
            : "The exact wording lands here once the editor writes it from the page's own stored copy under this diagnosis." },
        whyItMatters: `${story}${moved} ${d.line}`, operatorSteps: [], estimatedEffortMinutes: d.field === "title" ? 2 : 30,
        riskLevel: "low", confidence: historyWindow.earlyDays >= 120 ? "medium" : "low",
        limitations: ["The loss is measured from this account's own Search Console history over the two windows named above; only the current window's shortfall is claimed as recoverable."],
        evidence: { query: u.label, hints, evidenceRefCount: Math.max(1, Math.min(u.queries.length + 2, hints.length)) },
        ...(finding ? { causeFinding: finding, diagnosisCause: finding.cause } : {}),
        impactScore: recoverable > 0 ? recoverable : null, upsidePerMonth: null,
        demandImpressions90d: u.audience.impressions90d || null,
        publish: "manual", createdAt: now.toISOString(),
      });
    }
    log.info("[demand-recovery] the collapse, diagnosed", { tenantId, earlyDays: historyWindow.earlyDays,
      lostUnits: lost.length, cards: cards.length, top: losses[0] ?? null });
    return { cards, complete: true, window: historyWindow, losses };
  } catch (e) {
    log.warn("[demand-recovery] pass could not read the units; nothing minted and nothing swept", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return none;
  }
}
