import "server-only";

/** Historical losses open investigations, never authorize an edit. The canonical current-page diagnosis
 * owns treatments; a saved SERP or a fall in average position cannot establish why past clicks disappeared. */

import { log } from "@/lib/logger";
import { loadCanonicalDemandUnits } from "@/domains/evidence/demand-unit-loader";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate"; import { canonicalUrlKey, type EvidenceSnapshot } from "@/domains/evidence/snapshot";
import type { TenantCtrCurve } from "@/domains/evidence/forecast/tenant-ctr-curve";
import type { ChangeProposal } from "@/domains/decision/contracts";
import { noProblemFinding, winnersRead } from "@/domains/decision/diagnosis";
import { diagnoseCandidate } from "@/domains/decision/diagnose";
import { mutationKeyOf } from "@/domains/decision/mutation-footprint";
import proposalSeats from "@/domains/decision/proposal-seats";

/** Lost clicks per month before a unit is worth a card, and how many cards one pass mints. */
const MIN_LOST_PER_MONTH = 20; // no count meter (operator, 2026-08-30): every unit above the loss floor gets its card
const MAX_BODY_CARDS = 2;

const pathOf = (url: string): string => {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).pathname.replace(/\/+$/, "") || "/"; } catch { return url; } };
const n = (x: number): string => Math.round(x).toLocaleString("en-US");

type DemandRecoveryRun = { cards: ChangeProposal[]; complete: boolean;
  window: { earlyDays: number; earlyFrom: string | null; earlyTo: string | null };
  /** The largest losses this pass measured, card or not: the collapse explanation, on the receipt. */
  losses: { unit: string; lostPerMonth: number; priorPage: string | null; currentPage: string | null; swapped: boolean }[] };

const monthOf = (d: string | null): string => d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : "the earlier window";
const pageLabelOf = (snapshot: EvidenceSnapshot, url: string): string => { const p = snapshot.ownedPages.find((o) => canonicalUrlKey(o.url) === canonicalUrlKey(url)); return (p?.content?.h1 ?? p?.content?.title ?? "").replace(/\s+/g, " ").trim() || pathOf(url); };

/** Missing exact-search results are research debt. Landing that evidence enables comparison, not a
 * promised diagnosis or a preselected title/section edit. Reuse the result when already held. */
export async function recoveryAcquisitions(tenantId: string, snapshot: EvidenceSnapshot, max: number): Promise<{ topicKey: string; query: string }[]> {
  if (max <= 0) return [];
  try {
    const { units, historyWindow } = await loadCanonicalDemandUnits(tenantId, snapshot);
    if (historyWindow.earlyDays < 30) return [];
    const out: { topicKey: string; query: string }[] = [];
    for (const u of units.filter((x) => (x.history?.lostClicksPerMonth ?? 0) >= MIN_LOST_PER_MONTH)) {
      if (u.serp != null || out.length >= max) continue;
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
    const owned = new Set(snapshot.ownedPages.map((p) => canonicalUrlKey(p.url))); /* HAS ANYBODY READ WHAT WINS THIS ROW'S OWN SEARCH, stamped on the card here because the obligation ladder is pure and holds no snapshot (production 09:03:46Z, 2026-09-06), and READ FROM THE ONE DEFINITION rather than from a second copy of it (campaign, 2026-09-06): decision/diagnosis `winnersRead` is the same reading the opportunity ladder asks, so what this stamp says and what that ladder owes can never disagree. Refreshed on every re-mint, so the day a reading lands the stamp moves with it. */
    const lost = units.filter((u) => (u.history?.lostClicksPerMonth ?? 0) >= MIN_LOST_PER_MONTH);
    const losses = lost.slice(0, 20).map((u) => ({ unit: u.label, lostPerMonth: u.history!.lostClicksPerMonth,
      priorPage: u.history!.priorTopPage, currentPage: u.history!.currentTopPage, swapped: u.history!.pageSwapped }));
    const cards: ChangeProposal[] = [], durableSeats = await proposalSeats.loadProposalSeats(tenantId, lost.flatMap((u) => { const home = u.history!.currentTopPage ?? u.history!.priorTopPage; return home ? [pathOf(home)] : []; }));
    /* Each historical audience retains its own durable seat. These section-shaped records hold research,
     * not authority to add a section; independently diagnosed edits come from the canonical opportunity path. */
    const seats = new Map<string, string>(); { const bindings = [...durableSeats], per = new Map<string, number>();
      for (const u of [...lost].sort((a, b) => b.recoverableClicks - a.recoverableClicks || a.label.localeCompare(b.label))) { const at = u.history!.currentTopPage ?? u.history!.priorTopPage; if (!at || !owned.has(canonicalUrlKey(at))) continue;
        const page = pathOf(at).toLowerCase(), key = canonicalQueryKey(u.label), seat = `${page}::${key}`, held = per.get(page) ?? 0;
        if (seats.has(seat) || held >= MAX_BODY_CARDS) continue;
        const base = `${tenantId}::${page}::existing_edit::demand_recovery`, mutationKey = mutationKeyOf({ pagePath: page, primaryQuery: u.label, mutationScope: "topic", recommendedChange: { kind: "existing_edit", field: "section" } }), id = proposalSeats.seatFor(base, mutationKey, bindings);
        seats.set(seat, id); bindings.push({ id, mutationKey }); per.set(page, held + 1); } }
    for (const u of lost) {
      const h = u.history!;
      const home = h.currentTopPage ?? h.priorTopPage;
      if (!home || !owned.has(canonicalUrlKey(home))) continue;
      const path = pathOf(home); const id = seats.get(`${path.toLowerCase()}::${canonicalQueryKey(u.label)}`); if (!id) continue; // the page's seats are decided above, in one order, so no ordering of the source rows can flip which audience holds which row
      const serp = snapshot.research?.serpEvidence.find((e) => canonicalQueryKey(e.query) === canonicalQueryKey(u.label));
      const comparison = diagnoseCandidate({ query: u.label, ownedUrl: home, organic: serp?.organic ?? null,
        body: false, gscPosition: h.pageRecentPosition });
      const line = `${comparison.explanation} This current comparison does not establish why historical clicks fell; demand, results-page changes and page composition remain separate questions.`;
      const reading = winnersRead(snapshot.research, u.label);
      const phrasings = u.vocabulary.slice(0, 6).map((v) => `"${v}"`).join(", ");
      const windowLine = `${monthOf(historyWindow.earlyFrom)} to ${monthOf(historyWindow.earlyTo)}`, label = pageLabelOf(snapshot, home); /* THE CARD READS AS A PERSON WOULD SAY IT (operator voice; production 2026-09-18): "37 clicks a month were LOST", "about 0 supported as recoverable today" and a raw slug were the headline the moment the history read came back */
      const story = `Searches for ${u.label} brought this site about ${n(h.earlyClicksPerDay * 30)} clicks a month from ${windowLine} and bring about ${n(h.recentClicksPerDay * 30)} now, down ${n(h.lostClicksPerMonth)} a month.`;
      const moved = h.pageSwapped ? ` Google moved the audience: ${pathOf(h.priorTopPage!)} earned it then, ${pathOf(h.currentTopPage ?? home)} is shown now.` : "";
      const recoverable = Math.max(0, Math.round(u.recoverableClicks));
      const hints = [story.trim() + moved, line,
        recoverable > 0 ? `About ${n(recoverable)} clicks over 28 days is the measured shortfall against this account's own click curve at today's positions. None of it is claimed as recoverable until the cause is diagnosed.` : "Against this account's own click curve at today's positions there is no measured shortfall yet, so nothing is claimed as recoverable until the cause is diagnosed.",
        `People search this as: ${phrasings}`,
        ...(u.volume?.searchVolume ? [`"${u.label}" carries ${n(u.volume.searchVolume)} searches a month${u.volume.intent ? ` (${u.volume.intent})` : ""}`] : []),
        ...(u.serp ? [`The pages winning it now: ${u.serp.winners.slice(0, 3).map((w) => w.domain).join(", ")}`] : []),
        ...u.tensions];
      cards.push({
        id, tenantId, kind: "existing_edit", winnersOnFile: reading,
        pagePath: path, pageUrl: home, pageLabel: label, primaryQuery: u.label,
        // THE HEADLINE NEVER SELLS THE HISTORICAL LOSS AS WIN-BACK (operator, 2026-08-17): the lost figure is
        // labeled lost, and the only number offered as recoverable is the current window's own shortfall.
        opportunityType: `Explain the "${u.label}" decline on ${label}: down ${n(h.lostClicksPerMonth)} clicks a month and the cause is not yet separable`,
        changeFamily: "section", mutationScope: "topic", status: "needs_review",
        // THE ASSIGNMENT LIVES IN THE TYPED BRIEF, NEVER IN THE COPY FIELD (incident recovery, 2026-09-04): `after` means the exact words to paste, and an instruction sitting there is indistinguishable from finished work to anything that reads the words alone.
        recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "The exact wording has not been written yet." },
        obligation: reading === "read" ? { kind: "terminal", reason: "no substantive gap named" }
          : { kind: "evidence", need: { kind: reading === "unread" ? "competitor_page" : "serp", query: u.label, reasonCode: "no_winner_to_read" } },
        researchOnly: true, research: {
          missing: line,
          next: reading === "read" ? "Keep the historical loss as evidence. Only the current-page diagnosis can authorize an independently supported change; no draft is owed by this loss."
            : `Read ${reading === "unread" ? "the saved winning pages" : "the exact search results"} for "${u.label}" before judging what, if anything, this page needs.` },
        diagnosisCause: "no_problem", causeFinding: { ...noProblemFinding(line, "Historical losses do not establish a title or content defect."), evidenceKeys: comparison.evidenceKeys,
          notConsidered: [{ cause: "demand_decline", missing: "Comparable demand and results-page observations across the historical windows are not established." }, { cause: "competitor_content_gap", missing: "This historical measurement does not independently establish a current missing proposition." }],
          falsifier: "An independent current-page diagnosis names a specific defect supported by current evidence; that diagnosis, not this historical loss, authorizes its treatment." },
        whyItMatters: `${story}${moved} ${line}`, operatorSteps: [], estimatedEffortMinutes: 0,
        riskLevel: "low", confidence: historyWindow.earlyDays >= 120 ? "medium" : "low",
        limitations: ["The historical loss and current modeled shortfall are measurements, not promised recovery or authority to change copy."],
        evidence: { query: u.label, hints, evidenceRefCount: Math.max(1, Math.min(u.queries.length + 2, hints.length)) },
        impactScore: recoverable > 0 ? recoverable : null, upsidePerMonth: null,
        demandImpressions90d: u.audience.impressions90d || null,
        publish: "manual", createdAt: now.toISOString(),
      });
    }
    log.info("[demand-recovery] historical losses measured", { tenantId, earlyDays: historyWindow.earlyDays,
      lostUnits: lost.length, cards: cards.length, top: losses[0] ?? null });
    return { cards, complete: true, window: historyWindow, losses };
  } catch (e) {
    log.warn("[demand-recovery] pass could not read the units; nothing minted and nothing swept", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return none;
  }
}
