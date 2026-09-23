import { AEO_BAR } from "./accept-worthy";
/** decision/proposal-store: the ONE durable home of a ChangeProposal, and ONE CURRENT ROW PER HYPOTHESIS.  A hypothesis is (tenant, site, case, page, action family) and exactly one row for it is CURRENT  (`terminal_disposition is null`), held by a partial unique index; a new draft SUPERSEDES the row that held it in ONE database operation (supersede_change_proposal) and an identical re-draft writes NOTHING. STATUS  IS THE STAGE, DISPOSITION IS WHETHER ANYONE IS STILL BEING ASKED: needs_review / ready /  implemented_pending_verification are the stages, and dismissed / withdrawn / superseded retire the row. THE LIVE RANKING IS STORED HERE TOO (queue_lane + queue_rank), so the queue pages in the database. HISTORY  IS READABLE, NEVER RESURRECTED. FAIL CLOSED, LOUDLY. server-only. */
import "server-only";
import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { assertRowsScopedToTenant } from "@/lib/persistence/dual-write";
import { log } from "@/lib/logger";
import { serializeChangeProposal, deserializeChangeProposal, type ChangeProposal } from "./contracts";
import { QUEUE_PAGE, QUEUE_CEILING } from "./queue-paging";
import { confirmedVersion, deliverableGaps, GATE_WORDS, openHold, preferFinished } from "./completeness";
import { nextObligation } from "./obligation";
import { actionableProposalFailures, validateProposal, canonTextOf } from "./validate-proposal";
import { readFactChecks } from "@/domains/evidence/pages/fact-checks"; import { REVIEW_CONTRACT, reviewFits, unreviewed } from "./proof"; import { EDITOR_SHARED, staleCopyReasons } from "./drafted-copy"; import { loadOwnedPageBodies, type OwnedPageBody } from "@/domains/evidence/pages/owned-context"; import { canonicalUrlKey } from "@/domains/evidence/snapshot"; import { footprintCovers, footprintKey, footprintsOverlap } from "./mutation-footprint"; import { COPY_RULES } from "./copy-sanitize";
import proposalSeats from "./proposal-seats";
import proposalIdentity from "./proposal-identity";
const { identityOf, proposalFingerprint, retiredPolicyOf, terminalProposalFingerprint } = proposalIdentity;
type Identity = ReturnType<typeof identityOf>;
const PROPOSAL_TABLE = "change_proposals";
const TABLE = PROPOSAL_TABLE;
const LEGACY_TABLE = "move_drafts", LEGACY_KIND = "change_proposal";
/** Why this row is no longer the current answer. Never a status: the stages say where the change stands, this says whether anyone is still being asked. `withdrawn` is Beacon taking a draft back. */
type TerminalDisposition = "dismissed" | "withdrawn" | "superseded" | "settled";
/** saved = a new version is durable. unchanged = the stored row already says this. refused = retired under this basis, evidence unmoved. blocked = it is being measured. failed = the write did not land. */
type SaveResult = "saved" | "unchanged" | "refused" | "blocked" | "failed";
/** WHY this change exists, on its own column so the reasoning reads without unpacking the whole proposal. Never a second source of truth: every field here is copied off the payload below it. */
const decisionReceipt = (p: ChangeProposal): Record<string, unknown> => ({
  cause: p.diagnosisCause ?? null, why_it_matters: p.whyItMatters, confidence: p.confidence, limitations: p.limitations,
  receipt: p.bundle ? { items: p.bundle.receipt.items, missing: p.bundle.receipt.missing, freshest_observed_at: p.bundle.receipt.freshestObservedAt } : null,});
/** `status` is `unknown` on purpose: a pre-rename row carries an old word and the bridge below is the ONE  place that word is understood. */
type CanonRow = { id: string; proposal_version: number; status: unknown; terminal_disposition: TerminalDisposition | null;
  superseded_by: string | null; basis: string | null; mutation_key: string; withdrawn_reason?: string | null; payload: unknown;};
/** The exact page-generation set the writer inspected. The database re-reads this set after taking the page lock,
 * so two different absent seats with overlapping footprints cannot both pass an app-side overlap read. */
const expectedCurrentPage = (rows: readonly CanonRow[]): Array<{ id: string; mutation_key: string; proposal_version: number; status: string }> =>
  rows.map((r) => ({ id: r.id, mutation_key: r.mutation_key, proposal_version: r.proposal_version, status: String(r.status) }))
    .sort((a, b) => a.id.localeCompare(b.id));
const CANON_COLUMNS = "id, proposal_version, status, terminal_disposition, superseded_by, basis, mutation_key, withdrawn_reason, payload";
function decode(payload: unknown): ChangeProposal | null {
  if (payload == null) return null;
  return deserializeChangeProposal(typeof payload === "string" ? payload : JSON.stringify(payload));}
const rowFor = (p: ChangeProposal, ident: Identity, version: number): Record<string, unknown> => ({
  id: p.id, tenant_id: p.tenantId, ...ident, proposal_version: version, basis: p.basis ?? null,
  status: p.status, terminal_disposition: null, superseded_by: null, withdrawn_reason: null,
  payload: JSON.parse(serializeChangeProposal(p)) as unknown,
  decision_receipt: decisionReceipt(p), ranking_receipt: p.rankingReceipt ?? null, updated_at: new Date().toISOString(),});

/** Set (or, on a rollback, clear) one row's disposition. Fail-closed: a write that changed no row fails. WHY IT WAS RETIRED IS WRITTEN WITH IT. A withdrawal is permanent in practice (the skip set feeds off it and a save under the same basis is refused), and every one of them looked identical afterwards, so the night a sweep took the operator's open cards there was nothing on the rows to tell them apart from the ones a safety gate had genuinely refused. Pre-migration the write retries without the column rather than  failing the retirement itself. */
async function setDisposition(tenantId: string, id: string, disposition: TerminalDisposition, supersededBy: string | null,
  reason: string | null = null, expected?: CanonRow): Promise<boolean> {
  const held = expected ?? await rowById(tenantId, id).catch(() => null);
  if (!held || held.terminal_disposition != null || held.status === "implemented_pending_verification") return false;
  const { data, error } = await getSupabaseAdmin().rpc("retire_change_proposal", {
    p_tenant_id: tenantId, p_id: id, p_expected_version: held.proposal_version,
    p_expected_status: String(held.status), p_disposition: disposition,
    p_superseded_by: supersededBy, p_reason: reason,
  });
  if (error || data !== true) { log.error("[proposal-store] disposition write did not land", { id, disposition, error: error?.message ?? "stale row" }); return false; }
  return true;}

/** The one token that lets a save move a row INTO implemented. It is module-private and handed out only by transitionProposalToImplemented, so "done" is reachable through the orchestrated transaction alone: a direct save carrying the implemented status without it is refused. The incident repair that orphaned  three implementations was exactly such a save. */
const IMPLEMENTED_TRANSITION = Symbol("implemented-transition");
/** The token a RETIREMENT saves under. Taking a draft back may not take anything else with it: the save exists only so the row is ON FILE before it is retired, and left to run the supersession path a draft that covers a narrower live card would retire that card on its way out and leave nothing writing it. */
const NO_HANDOVER = Symbol("no-handover");

const sameWords = (a: ChangeProposal, b: ChangeProposal): boolean => { const words = (p: ChangeProposal): string => { const c = p.recommendedChange; return JSON.stringify([c.kind === "existing_edit" ? c.after.trim() : [c.proposedTitle.trim(), c.metaDescription.trim(), c.openingAnswer.trim(), c.outline.map((h) => h.trim())], (p.bundle?.components ?? []).map((x) => [x.kind, x.page ?? null, x.after.trim()])]); }; return words(a) === words(b); };
/** READY IS A FINISHED STATE, AND THIS IS WHERE IT IS MADE ONE (operator, 2026-09-04). Every door spread the stored row whole, so /persian-rugs/heriz-rug stood at `ready` still carrying the brief it outgrew ("The exact wording lands on this card once the next funded pass writes it"), the faults a gate raised before the words moved, the operator's stale ask for a redraft, and every refusal sentence the sweep had appended to its limitations since the day it was minted. A row demoted and re-promoted wore its old refusals for ever. The gate vocabulary is the SAME one the $0 replay strips (completeness's GATE_WORDS), so both doors agree by construction; a limitation that describes the accepted copy is not written by a gate and stays. */
const finished = (p: ChangeProposal): ChangeProposal => { const { research: _brief, redraftRequested: _asked, ...rest } = p;
  return { ...rest, faults: [], limitations: AEO_BAR.writerLimitations(p.limitations).filter((l) => !GATE_WORDS.test(l)) }; };
/** Persist one proposal as the CURRENT answer for its hypothesis, superseding whatever held that identity before. Writes nothing when the stored row already says exactly this. Never throws. `keep` is handed THE ROW THAT STANDS after the call (the merged row when one is written, the stored row when nothing is), so a caller's own map holds what the database holds rather than the draft it arrived with. */
export async function saveChangeProposal(proposal: ChangeProposal, transition?: symbol, keep?: (row: ChangeProposal) => void, exactExpected?: ChangeProposal, expectAbsent = false): Promise<SaveResult> {
  const retiredPolicy = retiredPolicyOf(proposal); if (retiredPolicy && transition !== NO_HANDOVER) { log.info("[proposal-store] a retired family cannot create current work", { tenantId: proposal.tenantId, id: proposal.id, family: retiredPolicy.family }); return "refused"; }
  if (proposal.status === "ready" && (unreviewed(proposal) != null || proposal.researchOnly === true)) proposal = { ...proposal, status: "needs_review" }; // THE STORE NEVER ISSUES AN AUTHORIZATION AND NO LONGER SIGNS ONE EITHER: it asks the one shared question and refuses to keep `ready` on a row whose sources have not been shown to support its claims. AND A ROW THAT SAYS IT HAS NO COPY IS NEVER STORED FINISHED (incident recovery, 2026-09-04): research-only work was refused by every door that reads it and still went on file wearing the word Ready, which is a stamp outranking its own row.
  /** ONE OBJECTION STANDS ON A ROW ONCE, WHICHEVER DOOR WROTE IT (live, 2026-09-05). A refusal reaches a row twice: raw from the gate that composed it, and again wrapped by the door that says which read it failed ("it did not pass the re-read of a stored change against the rules that stand today: " plus the same sentence). The writer's own guard is an EXACT-match test against what the row already holds, so the two forms never match each other, and one live answer row carries the identical objection twice in `faults` and twice in `limitations`; the card folds it for display and the row goes on holding both, so a reader of the row counts two defects where there is one. Folded HERE, at the one door every producer's row passes through on its way to being written down, so no future writer has to remember. THE TEST IS THE COMPOSER'S OWN SHAPE and nothing wider: an entry is dropped only when another entry in the same field ENDS with a colon, a space and exactly that entry, so a short limitation that merely reads like part of a longer one is untouched. Measured over the store: 1 of 171 rows folds, in both fields. */
  const once = (xs: readonly string[]): string[] => xs.filter((x) => !xs.some((y) => y !== x && y.endsWith(`: ${x}`))), kept = { faults: once(proposal.faults ?? []), limitations: once(proposal.limitations) };
  if (kept.faults.length !== (proposal.faults ?? []).length || kept.limitations.length !== proposal.limitations.length) proposal = { ...proposal, ...(proposal.faults ? { faults: kept.faults } : {}), limitations: kept.limitations };
  if (!proposal.tenantId || !proposal.id) return "failed";
  if (proposal.status === "implemented_pending_verification" && transition !== IMPLEMENTED_TRANSITION) {
    const held = await loadChangeProposal(proposal.tenantId, proposal.id).catch(() => null);
    if (held?.status !== "implemented_pending_verification") {
      log.error("[proposal-store] a save may not move a row into implemented; use the mark-implemented transaction", { tenantId: proposal.tenantId, id: proposal.id });
      return "failed";}
  }
  if (!proposal.id.startsWith(`${proposal.tenantId}::`)) { // Every real id is minted `${tenantId}::...` by this kernel. An id wearing another account's prefix is a crafted call an id-keyed upsert would land on that account's row, so it is refused before any read.
    log.error("[proposal-store] the id does not belong to this account, so nothing is saved", { tenantId: proposal.tenantId, id: proposal.id }); return "failed"; }
  if (!decode(JSON.parse(serializeChangeProposal(proposal)) as unknown)) { // A ROW NOTHING CAN READ BACK IS WORSE THAN NO ROW: an empty `after` passes every gate above and fails the contract's own schema, so it landed, `loadChangeProposal` answered null for ever, the surface served nothing, and the overlap rule below counted it as an unreadable neighbour and BLOCKED the two real changes queued behind it on the same page.
    log.error("[proposal-store] this proposal does not survive its own contract, so nothing is saved", { tenantId: proposal.tenantId, id: proposal.id }); return "failed"; }
  try {
    const sb = getSupabaseAdmin(); const ident0 = identityOf(proposal);
    const data: CanonRow[] = [], history: CanonRow[] = [];
    for (const disposition of [null, "withdrawn", "dismissed", "superseded", "settled"] as const) {
      for (let offset = 0; ; offset += 200) {
        const query = sb.from(TABLE).select(CANON_COLUMNS).eq("tenant_id", proposal.tenantId)
          .eq("case_id", ident0.case_id).eq("page_key", ident0.page_key);
        const { data: page, error } = await (disposition == null ? query.is("terminal_disposition", null) : query.eq("terminal_disposition", disposition))
          .order("id", { ascending: true }).range(offset, offset + 199);
        if (error) { log.error("[proposal-store] canonical read failed, nothing was written", { tenantId: proposal.tenantId, id: proposal.id, error: error.message }); return "failed"; }
        (disposition == null ? data : history).push(...(page ?? []) as CanonRow[]);
        if ((page ?? []).length < 200) break;
      }
    }
    const onPage = ((data ?? []) as CanonRow[]).map((r) => ({ row: r, stored: r.id === proposal.id ? null : decode(r.payload) })); // WHAT THIS CHANGE COLLIDES WITH, never everything that merely shares its page: a table row and a heading both stand, while a bundle rewriting a title takes over the plain title rewrite. A row that will not decode is KEPT, because an unreadable neighbour is not proof of no conflict. The id is looked up separately too, since it may have been filed under a DIFFERENT family last time.
    const rows = onPage.filter((e) => e.row.id === proposal.id || !e.stored || footprintsOverlap(e.stored, proposal)).map((e) => e.row);
    const mine = rows.find((r) => r.id === proposal.id) ?? history.find((r) => r.id === proposal.id) ?? (await rowById(proposal.tenantId, proposal.id));
    if (expectAbsent && mine) return "blocked";
    const mineDecoded = mine ? decode(mine.payload) : null;
    if (exactExpected && (!mine || mine.terminal_disposition != null || !mineDecoded || serializeChangeProposal(mineDecoded) !== serializeChangeProposal(exactExpected))) return "blocked";
    const sameLegacyMutation = mineDecoded != null && footprintKey(mineDecoded) === ident0.mutation_key;
    if (mine && mine.mutation_key !== ident0.mutation_key && !sameLegacyMutation) { log.error("[proposal-store] this proposal id is permanently bound to another mutation, so nothing is saved",
      { tenantId: proposal.tenantId, id: proposal.id, held: mine.mutation_key, proposed: ident0.mutation_key }); return "blocked"; }
    if (mine?.terminal_disposition != null) {
      if (!mineDecoded || terminalProposalFingerprint(mineDecoded) === terminalProposalFingerprint(proposal)) return "refused";
      const revisedId = proposalSeats.seatFor(proposal.id, ident0.mutation_key, [...data, ...history, mine].map((r) => ({
        id: r.id, mutationKey: r.mutation_key, status: typeof r.status === "string" ? r.status : null, terminalDisposition: r.terminal_disposition,
        withdrawnReason: r.withdrawn_reason ?? null,
      })));
      if (revisedId === proposal.id) return "blocked";
      log.info("[proposal-store] terminal history stays permanent; revised work is evaluated in a new seat", {
        tenantId: proposal.tenantId, retired: proposal.id, revised: revisedId, disposition: mine.terminal_disposition });
      return saveChangeProposal({ ...proposal, id: revisedId }, transition, keep);
    }
    const stored = mine && mine.terminal_disposition == null ? decode(mine.payload) : null;
    if (mine?.status === "implemented_pending_verification" && transition !== IMPLEMENTED_TRANSITION) { log.info("[proposal-store] you already marked this change done, so a new draft is not written over it", { tenantId: proposal.tenantId, id: proposal.id }); return "blocked"; }
    if (stored && transition !== NO_HANDOVER && !exactExpected) proposal = preferFinished(proposal, stored, sameWords(proposal, stored) && proposal.researchOnly !== true);
    if (proposal.status === "ready" && openHold(proposal).defects.length > 0) proposal = { ...proposal, status: "needs_review" };
    if (proposal.status === "ready") proposal = finished(proposal); // AFTER the merge, because the merge can hand back the prior's own limitations and status, and BEFORE the obligation below, so what a finished row owes is computed from the row it actually is
    const owes0 = nextObligation(proposal); const owes = owes0?.kind === "evidence" && owes0.need.kind === "serp" && owes0.need.reasonCode !== "no_winner_to_read" && proposal.obligation && proposal.obligation.kind !== "evidence" ? proposal.obligation : owes0; // A CALLER HOLDING THE RESULTS PAGE MAY ANSWER THE QUESTION THE PURE LADDER ASKS (falsifier, 2026-09-02): `nextObligation` cannot see the snapshot, so it asks for the reading; a producer that has it in hand and finds the shape refused answers with the redraft that would earn it, and the store keeps that answer rather than resetting it to the wait. // THE TYPED NEXT STEP IS STAMPED AT EVERY DOOR, not only the producer's: the release loop and the caveat sweep save straight through here, so a row written by either would otherwise carry an obligation computed for words it no longer has. // AND A SETTLEMENT IS NOT AN ANSWER TO "NOBODY HAS READ THIS SEARCH'S WINNERS" (reviewer two, 2026-09-06): the caller guard above kept the stored `terminal: no substantive gap named` on every re-save of a settled row, so the reading the ladder owes was re-stamped away at the one door that writes the row and no caller outside the producer ever saw it. This one reasonCode is exempt: it is decided from the row's own typed `winnersOnFile`, which no caller holds a better answer for.
    proposal = owes ? { ...proposal, obligation: owes } : proposal.obligation ? { ...proposal, obligation: undefined } : proposal;
    const computedIdent = identityOf(proposal); // recomputed AFTER the merge: what a row writes is derived from the copy that stands, and the merge can hand back the stored copy
    const ident = mine && mine.mutation_key !== computedIdent.mutation_key && mineDecoded
      && footprintKey(mineDecoded) === computedIdent.mutation_key
      ? { ...computedIdent, mutation_key: mine.mutation_key }
      : computedIdent; // Existing seats keep their historical key after the collision-resistant v2 cutover; only their decoded mutation may authorize that compatibility path.
    const live = transition === NO_HANDOVER ? [] : onPage.filter((e) => e.row.terminal_disposition == null && e.row.id !== proposal.id && (!e.stored || footprintsOverlap(e.stored, proposal))); // A NEIGHBOUR IS ONLY TAKEN OVER WHEN THIS CHANGE WRITES EVERYTHING IT WROTE. Retiring on a bare intersection let a title-only rewrite consume a bundle that also moved the canonical and added a link, throwing the rest of that bundle's work away with no receipt; PARTIAL overlap is refused below instead, so two live rows can never both claim one edit and nothing is ever silently dropped. An unreadable neighbour counts as partial: it may be carrying anything.
    if (exactExpected && live.length > 0) return "blocked";
    const partial = live.find((e) => !e.stored || !footprintCovers(proposal, e.stored));
    if (partial) { log.info("[proposal-store] this change writes part of what another live change writes, so it is not saved beside it",
      { tenantId: proposal.tenantId, holding: partial.row.id, draft: proposal.id }); return "blocked"; }
    const overtaken = live.map((e) => e.row);
    const current = (live.find((e) => e.stored && footprintKey(e.stored) === ident.mutation_key) ?? live[0])?.row ?? null; // THE PREDECESSOR IS THE ROW HOLDING THE INDEX KEY THIS ONE IS ABOUT TO CLAIM, not whichever id sorted first: superseding any other leaves that key held, the insert violates the current-row index, and the function answers "failed" on every future pass in the same order, for ever.

    if ([mine, ...history].some((r) => {
      if (r?.terminal_disposition == null) return false;
      const prior = decode(r.payload);
      return prior ? terminalProposalFingerprint(prior) === terminalProposalFingerprint(proposal) : r.id === proposal.id;
    })) return "refused";

    // Nothing material changed: no write, no new timestamp, so a refreshed surface never reads yesterday's thinking as today's work. The row that STANDS is handed back, so a caller whose draft lost the merge stops publishing it. A MOVED RANK IS A COLUMN, NEVER A VERSION: the receipt is refreshed where it lives, so the order stays inspectable and the $0 producers keep their receipts, while `proposal_version`, `payload` and `updated_at` go on saying the one thing they mean, which is that this row's work has not changed. The stamped position and lane travel the same way, written whole by the release below.
    if (stored && proposalFingerprint(stored) === proposalFingerprint(proposal)) {
      if (JSON.stringify(stored.rankingReceipt ?? null) !== JSON.stringify(proposal.rankingReceipt ?? null)) {
        const { data: ranked, error: rankError } = await sb.rpc("refresh_change_proposal_ranking_receipt", {
          p_tenant_id: proposal.tenantId, p_id: proposal.id,
          p_expected_version: mine!.proposal_version, p_expected_status: String(mine!.status),
          p_expected_payload: mine!.payload, p_ranking_receipt: proposal.rankingReceipt ?? null,
        });
        if (rankError || ranked !== true) log.warn("[proposal-store] the ranking explanation could not be refreshed; the proposal itself is unchanged", { tenantId: proposal.tenantId, id: proposal.id, error: rankError?.message ?? "stale row" });
      }
      keep?.(stored); return "unchanged"; }

    const version = (mine?.proposal_version ?? current?.proposal_version ?? 0) + 1;
    // One mutation, one current row: the predecessor steps aside BEFORE the successor lands, because the index will not hold both at once.
    const handover = current;
    const measuring = overtaken.find((r) => r.status !== "ready" && r.status !== "needs_review");
    if (measuring) { log.info("[proposal-store] this edit is already carried by a change I am measuring, so the new draft is not saved",
      { tenantId: proposal.tenantId, holding: measuring.id, status: measuring.status, draft: proposal.id }); return "blocked"; }
    if (handover) {
      if (expectAbsent) return "blocked";
      // ONE database operation: guard, step-aside and landing commit together or not at all, so a crash mid-handover never leaves this hypothesis with no current answer. The scoping proof is made first.
      log.info("[proposal-store] superseding", { id: handover.id, by: proposal.id, version });
      const row = rowFor(proposal, ident, version);
      assertRowsScopedToTenant([row as { tenant_id?: string | null }], proposal.tenantId, TABLE);
      const { data: handoverResult, error } = await getSupabaseAdmin()
        .rpc("supersede_change_proposal", { p_tenant_id: proposal.tenantId,
          p_predecessors: overtaken.map((r) => ({ id: r.id, proposal_version: r.proposal_version, status: String(r.status) })),
          p_expected_current: expectedCurrentPage(data), p_row: row });
      if (error && (error.code === "PGRST202" || error.code === "42883")) {
        log.error("[proposal-store] the supersession function is not installed; the draft was not saved", { tenantId: proposal.tenantId, id: proposal.id, code: error.code, error: error.message }); return "failed"; }
      if (error || handoverResult !== "saved") {
        log.error("[proposal-store] atomic supersession did not land, the stored change is unchanged", { tenantId: proposal.tenantId, id: proposal.id, answer: handoverResult ?? null, error: error?.message ?? null });
        return handoverResult === "blocked" || handoverResult === "seat_taken" || handoverResult === "stale_page" ? "blocked" : "failed"; }
      keep?.(proposal); return "saved";
    }
    const row = rowFor(proposal, ident, version);
    assertRowsScopedToTenant([row as { tenant_id?: string | null }], proposal.tenantId, TABLE);
    const exactArgs = { p_tenant_id: proposal.tenantId, p_row: row, p_expected_version: mine?.proposal_version ?? null,
      p_expected_status: mine ? String(mine.status) : null, p_expected_payload: JSON.parse(serializeChangeProposal(exactExpected ?? proposal)) as unknown,
      p_expected_current: expectedCurrentPage(data) };
    const { data: saved, error: saveError } = exactExpected
      ? await sb.rpc("save_change_proposal_proof_cas", exactArgs)
      : await sb.rpc("save_change_proposal_cas", { p_tenant_id: proposal.tenantId, p_row: row, p_expect_absent: mine == null,
        p_expected_version: mine?.proposal_version ?? null, p_expected_status: mine ? String(mine.status) : null,
        p_expected_disposition: mine?.terminal_disposition ?? null, p_expected_current: expectedCurrentPage(data) });
    if (saveError || saved !== "saved") {
      log.error("[proposal-store] compare-and-set save did not land; a newer lifecycle decision stands", {
        tenantId: proposal.tenantId, id: proposal.id, answer: saved ?? null, error: saveError?.message ?? null });
      return saved === "blocked" || saved === "stale_page" || saved === "research_resumed" ? "blocked" : "failed"; }
    keep?.(proposal); return "saved";
  } catch (e) { log.error("[proposal-store] save threw", { id: proposal.id, error: e instanceof Error ? e.message : String(e) }); return "failed"; }
}

/** THE LAST STEP OF THE MARK-IMPLEMENTED TRANSACTION, and the ONLY way a change reaches IMPLEMENTED, PENDING VERIFICATION. It may only be walked with a Shipment ALREADY ON FILE: the id of the record measuring this change is required, so there is no bare status flip left to call from anywhere. A bare flip was exported once, was called on its own during an incident repair, and left changes marked done that nothing on earth was measuring. ORDER IS DELIBERATE: the press writes the Shipment first and reaches this second, so a crash between the two leaves a record the next press heals, where the reverse leaves the operator waiting forever for a reading nobody is taking. This records their claim, and the claim is not the fact. A NEW PAGE OWES ITS ADDRESS. */
export async function transitionProposalToImplemented(tenantId: string, id: string, shipmentId: string, shipmentVersion: string, expectedVersion: string, liveUrl?: string): Promise<boolean> {
  if (!shipmentId.trim() || !shipmentVersion.trim() || !expectedVersion.trim()) { log.error("[proposal-store] nothing is marked done without the exact record and proposal version", { tenantId, id }); return false; }
  const held = await rowById(tenantId, id).catch(() => null); const disp = held?.terminal_disposition ?? null; if (disp != null) return false;
  const proposal = held ? decode(held.payload) : await loadChangeProposal(tenantId, id); if (!proposal || confirmedVersion(proposal) !== expectedVersion) return false;
  // THE SHIP DOOR RE-ASKS THE ONE COMPLETENESS QUESTION. It used to trust the stored `ready` stamp, so a row stamped by an older pass shipped unexamined: "Shiraz has a population of NUMBER as of YEAR (SOURCE)." went live, was verified on the page, and was banked as a WIN that then taught the ranker. A deliverable with a gap is not implementable, whatever the stamp says.
  const gaps = deliverableGaps(proposal); if (gaps.length > 0) { log.error("[proposal-store] this change is not finished enough to mark done", { tenantId, id, gap: gaps[0] }); return false; }
  if (proposal.kind === "new_page" && !liveUrl?.trim()) { log.info("[proposal-store] a new page has no address until you publish it, so I am not recording it", { tenantId, id }); return false; }
  // A STATUS FLIP IS NOT A NEW DRAFT (operator, 2026-09-01). The old path went through the whole canonical save: a 200-row page-neighborhood read, footprint overlap, supersession, a version bump, none of which a flip can ever need, because the row's words and footprint are byte-identical before and after. That scan was 16 to 23 seconds PER CARD of the operator's bulk press. One single-row conditional update instead: same row, same version, same words, new status; zero matched rows answers false rather than inventing a row.
  const flipped = { ...proposal, status: "implemented_pending_verification" as const };
  if (!decode(JSON.parse(serializeChangeProposal(flipped)) as unknown)) { log.error("[proposal-store] the flipped row does not survive its own contract, so nothing is saved", { tenantId, id }); return false; }
  const { data, error } = await getSupabaseAdmin().rpc("transition_change_proposal_implemented", {
    p_tenant_id: tenantId, p_proposal_id: id, p_expected_version: held!.proposal_version,
    p_expected_status: String(held!.status), p_expected_disposition: disp,
    p_shipment_id: shipmentId, p_shipment_version: shipmentVersion,
    p_expected_payload: held!.payload,
    p_payload: JSON.parse(serializeChangeProposal(flipped)) as unknown,
  });
  if (error || data !== "implemented") { log.error("[proposal-store] the implemented flip did not land behind its exact shipment", { tenantId, id, answer: data ?? null, error: error?.message ?? null }); return false; }
  return true; }
const publicationUrls = (p: ChangeProposal): string[] => p.recommendedChange.kind === "new_page" ? [] : [...new Set([p.pageUrl ?? "", ...(COPY_RULES.reviewParts(p).length ? COPY_RULES.reviewSubjects(p, false).subjects.map(({ one }) => one.pageUrl!) : [])].filter(Boolean))], publicationCanon = async (tenantId: string, p: ChangeProposal, at: Date, urls = publicationUrls(p)) => { const bodies = await loadOwnedPageBodies(tenantId, urls).catch(() => new Map<string, OwnedPageBody>()), body = p.pageUrl ? bodies.get(canonicalUrlKey(p.pageUrl)) ?? null : null, canon = validateProposal(p, { now: at, ...canonTextOf(null, body, [(p.bundle?.receipt.items ?? []).map((i) => i.fact).join(" "), (p.supportFacts ?? []).map((f) => f.fact).join(" ")].filter(Boolean)) }); return { bodies, body, canon }; }, canonFindings = (canon: ReturnType<typeof validateProposal>): string[] => canon.verdict === "rejected" ? canon.reasons : canon.qualityStatus !== "ready" ? [canon.qualityStatus === "missing_source" ? "This change states a fact with no source behind it. It is held until a source is added." : canon.qualityStatus === "useful_but_needs_review" ? "This change introduces a number that has not been confirmed yet. It is held until that number is checked." : (canon.reasons[0] ?? "This change is not finished enough to promote yet.")] : [];
type PromotionCapture = { page_id: string; latest_capture_id: string; states: Record<string, unknown>[] }; type PromotionCheck = { reason: string | null; reviewRefresh: boolean; captures: PromotionCapture[] };
const promotionRejection = async (tenantId: string, p: ChangeProposal, basis: string | null, at: Date, ignoreReviewDebt = false): Promise<PromotionCheck> => { const urls = publicationUrls(p), [checked, current] = await Promise.all([readFactChecks(tenantId).catch(() => null), publicationCanon(tenantId, p, at, urls)]), { bodies, body, canon } = current, page = body && { title: body.title, h1: body.h1, metaDescription: body.metaDescription, outline: body.headings }, canRefresh = ignoreReviewDebt && p.bundle == null, normal = staleCopyReasons(p, bodies, [], page, true, [], [], undefined, { checked, basis }), refreshed = staleCopyReasons(p, bodies, [], page, true, [], [], undefined, { checked, basis }, canRefresh), reviewRefresh = canRefresh && normal.includes(COPY_RULES.pageState.whole) && !refreshed.includes(COPY_RULES.pageState.capture), ignorable = (reason: string): boolean => ignoreReviewDebt && (COPY_RULES.reviewHold(reason) || canRefresh && reason === COPY_RULES.pageState.whole), found = [...refreshed, ...actionableProposalFailures(p, { tenantId, currentBasis: basis, now: at }), ...canonFindings(canon)].filter((reason) => !ignorable(reason)), refusal = openHold(p, { found }).defects.find((reason) => !ignorable(reason)), units = body ? [body.title ?? "", body.h1 ?? "", ...body.headings, ...body.passages].filter(Boolean) : [], held = COPY_RULES.flat(units.join(" ")), evidence = Object.fromEntries((p.supportFacts ?? []).filter((f) => EDITOR_SHARED.OWN_PAGE_ID.test(f.id) && held.includes(COPY_RULES.flat(f.fact))).map((f) => [f.id, f.fact])), diagnosedNoGain = ignoreReviewDebt && body?.version === "current" && body.completeness === "complete" && EDITOR_SHARED.diagnosedMissingAnswerPresent(p, units) ? EDITOR_SHARED.NO_CHANGE_SAYS : null, noGain = ignoreReviewDebt && body && EDITOR_SHARED.ownPageOnlyMissing(p, evidence) ? EDITOR_SHARED.NO_CHANGE_SAYS : diagnosedNoGain, unread = ignoreReviewDebt && p.recommendedChange.kind === "existing_edit" && p.pageUrl && !body ? "the current page capture is unavailable, so this copy cannot be checked before review" : null, captures = [...bodies.values()].flatMap((b): PromotionCapture[] => {
    if (!b.captureStates?.length) return b.pageId && b.latestCaptureId ? [{ page_id: b.pageId, latest_capture_id: b.latestCaptureId, states: [] }] : [];
    const groups = new Map<string, Record<string, unknown>[]>(); for (const state of b.captureStates) { if (typeof state.page_id !== "string" || !state.page_id.trim() || typeof state.id !== "string" || !state.id.trim() || typeof state.fetched_at !== "string") throw new Error("The page capture identity is incomplete"); groups.set(state.page_id, [...(groups.get(state.page_id) ?? []), state]); }
    return [...groups].map(([page_id, states]) => ({ page_id, latest_capture_id: [...states].sort((a, z) => String(z.fetched_at).localeCompare(String(a.fetched_at)) || String(z.id).localeCompare(String(a.id)))[0]!.id as string, states }));
  }); return { reason: canon.need ? canon.reasons[0] ?? "current evidence is still owed" : refusal ?? unread ?? noGain, reviewRefresh, captures }; };
async function preflightReviewedProposal(tenantId: string, p: ChangeProposal, basis: string | null, at: Date): Promise<PromotionCheck> { try { return await promotionRejection(tenantId, { ...p, status: "ready", obligation: undefined, faults: p.faults?.filter((f) => !COPY_RULES.reviewHold(f)), limitations: p.limitations.filter((f) => !COPY_RULES.reviewHold(f)) }, basis, at, true); } catch { return { reason: "the current publication context is ambiguous or unreadable, so this copy cannot be checked before review", reviewRefresh: false, captures: [] }; } } export { preflightReviewedProposal };
/** THE OPERATOR'S YES, APPLIED TO THE EXACT ROW THEY READ AND TO NO OTHER. Step two of the two-step hold used to be a read, a check and then an ordinary save, and the save takes its OWN read afterwards: a rewrite that landed in between was simply overwritten by the version the operator had been looking at, which is the one thing a hold on a page-mover exists to stop. ONE COMPARE-AND-SET instead. The row must still be this account's, still non-terminal, still in review, still at the stored version that was read, still under the basis it was drafted for, and still fingerprint for fingerprint the version that was confirmed; the promoted row is then put through the ONE servability verdict before anything is written. The write itself carries the version it read, so a save landing between this read and this write matches NO row, changes nothing, and answers `stale`. TWO ANSWERS RIDE THIS ONE DOOR, because both are a person answering one exact version of one reviewed change: `promote` makes it ready (the page-mover's confirmation, and a draft only judgement was holding, which stamps who and when), and `redraft` leaves it exactly where it is and asks the next funded pass to write better words over it. The refusal check runs on the PROMOTED row only: nothing about asking for better words has to pass the bar for handing work over. */
export async function answerReviewedProposal(tenantId: string, id: string, version: string, basis: string | null, answer: { kind: "promote" | "redraft"; by?: string; at: string }, reviewed?: ChangeProposal): Promise<{ status: "promoted" | "stale" | "refused" | "failed"; refusal?: string }> {
  if (!tenantId || !id || !version) return { status: "failed" };
  try {
    const row = await rowById(tenantId, id), stored = row ? decode(row.payload) : null;
    if (!row || !stored) return { status: "failed" };
    // THE ACCOUNT HALF OF THE BASIS IS THE IDENTITY; the ::dN half is the kernel's clock: refusing a re-admitted row "stale" stranded it one confirmation short of ready forever. Two nulls still match.
    const strip = (s: string): string => s.replace(/::d\d+$/, "");
    const sameAccount = (row.basis ?? null) == null && basis == null
      ? true : row.basis != null && basis != null && strip(row.basis) === strip(basis);
    if (row.terminal_disposition != null || row.status !== "needs_review" || !sameAccount || confirmedVersion(stored) !== version || reviewed && (reviewed.id !== id || reviewed.tenantId !== tenantId || reviewed.status !== "needs_review" || !sameWords(reviewed, stored))) return { status: "stale" };
    // PROMOTION RESTAMPS THE GENERATION: the door's own checks are the current bar, so a row that clears them under the operator's yes is current work by demonstration, and the ready lane may serve it as such.
    const source: ChangeProposal = reviewed ? { ...stored, semanticReview: reviewed.semanticReview, faults: reviewed.faults, limitations: reviewed.limitations, obligation: reviewed.obligation, claims: reviewed.claims, supportFacts: reviewed.supportFacts, informationGain: reviewed.informationGain, ...(stored.newPageDraft ? { newPageDraft: { ...stored.newPageDraft, repair: reviewed.newPageDraft?.repair } } : {}) } : stored, accepted = source.semanticReview?.version === REVIEW_CONTRACT && COPY_RULES.accepted(source.semanticReview.editor) && reviewFits(source, source.semanticReview.of) && unreviewed(source) == null, settled = answer.kind === "promote" && accepted ? { ...source, faults: source.faults?.filter((f) => !COPY_RULES.reviewHold(f) && f !== COPY_RULES.pageState.whole), limitations: source.limitations.filter((f) => !COPY_RULES.reviewHold(f) && f !== COPY_RULES.pageState.whole) } : source, redraftWorkKey = answer.kind === "redraft" ? `operator-redraft:${createHash("sha256").update(JSON.stringify([settled.workKey ?? id, version, answer.at])).digest("hex").slice(0, 24)}` : null;
    const promoted: ChangeProposal = answer.kind === "redraft" ? { ...settled, redraftRequested: answer.at, workKey: redraftWorkKey! }
      : { ...settled, status: "ready", obligation: undefined, confirmedVersion: version, ...(basis != null ? { basis } : {}), ...(answer.by ? { approval: { by: answer.by, at: answer.at } } : {}) };
    // Promotion reads the exact existing publication pages from saved tenant-scoped captures. Unread components hold; unpublished pages need no invented live target. No crawl or paid research runs here.
    try { if (answer.kind === "promote") publicationUrls(promoted); } catch { return { status: "refused", refusal: "it lacks an unambiguous publication component claim or page owner, so current source support is still owed; all banked copy is preserved" }; }
    const checked = answer.kind !== "promote" ? undefined : await promotionRejection(tenantId, promoted, basis, new Date(answer.at)), rejected = checked?.reason; /** ONE VERDICT AT THE ONE DOOR THAT WRITES `ready`, shared with paid preflight: deterministic/source/current-page failure is known before review money, while only review debt is left for the reviewer to answer. */
    if (rejected) { const fresh = await rowById(tenantId, id); if (!fresh || fresh.proposal_version !== row.proposal_version) return { status: "stale" }; if (!reviewed || COPY_RULES.pageStateReason(rejected)) return { status: "refused", refusal: rejected }; const refused: ChangeProposal = { ...source, status: "needs_review", obligation: undefined, faults: [...new Set([...(source.faults ?? []), rejected])], limitations: [...new Set([...source.limitations, rejected])] }, owed = nextObligation(refused), banked = owed ? { ...refused, obligation: owed } : refused, payload = JSON.parse(serializeChangeProposal(banked)) as unknown, { data, error } = await getSupabaseAdmin().rpc("answer_change_proposal_review", { p_tenant_id: tenantId, p_id: id, p_expected_version: row.proposal_version, p_expected_payload: row.payload, p_payload: payload, p_status: banked.status }); if (error) { log.error("[proposal-store] the rejected review did not land", { tenantId, id, error: error.message }); return { status: "failed" }; } return data === "answered" ? { status: "refused", refusal: rejected } : { status: "stale" }; }
    const payload = JSON.parse(serializeChangeProposal(promoted.status === "ready" ? finished(promoted) : promoted)) as unknown;
    const { data, error } = await getSupabaseAdmin().rpc(promoted.status === "ready" ? "answer_change_proposal_review_guarded" : "answer_change_proposal_review", {
      p_tenant_id: tenantId, p_id: id, p_expected_version: row.proposal_version,
      p_expected_payload: row.payload, p_payload: payload, p_status: promoted.status, ...(promoted.status === "ready" ? { p_expected_captures: checked?.captures ?? [] } : {}),
    });
    if (error) { log.error("[proposal-store] the operator's answer did not land", { tenantId, id, error: error.message }); return { status: "failed" }; }
    return data === "page_changed" ? { status: "refused", refusal: COPY_RULES.pageState.whole } : { status: data === "answered" ? "promoted" : "stale" };
  } catch (e) { log.error("[proposal-store] answering a reviewed change threw", { id, error: e instanceof Error ? e.message : String(e) }); return { status: "failed" }; }
}

/** BEACON'S OWN RETRACTION. A draft a safety gate refused is not queued work and not a rejection the operator has to read: it lands as history under the disposition that says I took it back. Fail-soft. */
export async function withdrawChangeProposal(proposal: ChangeProposal, reason?: string): Promise<"retired" | "blocked" | "failed"> { if (proposal.status === "implemented_pending_verification") { log.warn("[proposal-store] a change the operator applied is never withdrawn by a producer; the shipment stands and measurement continues", { tenantId: proposal.tenantId, id: proposal.id }); return "blocked"; } // THE OPERATOR'S APPLIED CHANGE STANDS (operator, 2026-09-02): the factual-defects producer withdrew the Hamid correction, one of the six changes applied on September 1, because its fact evidence moved
  let held: CanonRow | null; try { held = await rowById(proposal.tenantId, proposal.id, true); } catch { return "failed"; }
  if (held) { const exact = decode(held.payload); if (held.terminal_disposition != null || held.status === "implemented_pending_verification" || !exact || serializeChangeProposal(exact) !== serializeChangeProposal(proposal)) return "blocked"; }
  else { let savedRow: ChangeProposal | null = null; const saved = await saveChangeProposal(proposal, NO_HANDOVER, row => { savedRow = row; }, undefined, true); if (saved === "failed" || saved === "blocked") return saved; if (saved === "refused" || !savedRow) return "blocked"; try { held = await rowById(proposal.tenantId, proposal.id, true); } catch { return "failed"; } const exact = held && decode(held.payload), normalized = decode(JSON.parse(serializeChangeProposal(savedRow)) as unknown); if (!held || held.terminal_disposition != null || !exact || !normalized || serializeChangeProposal(exact) !== serializeChangeProposal(normalized)) return "blocked"; }
  if (await setDisposition(proposal.tenantId, proposal.id, "withdrawn", null, reason ?? null, held)) return "retired";
  try { const current = await rowById(proposal.tenantId, proposal.id, true); return !current || current.terminal_disposition != null || current.status === "implemented_pending_verification" || current.proposal_version !== held.proposal_version ? "blocked" : "failed"; }
  catch { return "failed"; }
}

/** Exact paid-work identities already retired for any reason. A work key binds
 * the writer contract, basis and evidence hash, so it skips only a byte-for-byte
 * generation; moved evidence earns a different key and a fresh immutable seat. */
export async function terminalWorkKeys(tenantId: string): Promise<Set<string>> {
  if (!tenantId) return new Set<string>();
  const keys = new Set<string>();
  let after: string | null = null;
  for (;;) {
    let q = getSupabaseAdmin().from("proposal_work_tombstones").select("work_key").eq("tenant_id", tenantId);
    if (after) q = q.gt("work_key", after);
    const { data, error } = await q.order("work_key", { ascending: true }).limit(500);
    if (error || !data) throw new Error(`terminal proposal history could not be read${error?.message ? `: ${error.message}` : ""}`);
    for (const row of data as Array<{ work_key: string }>) keys.add(row.work_key);
    if (data.length < 500) break;
    after = String((data[data.length - 1] as { work_key: string }).work_key);
  }
  return keys;
}

/** Preserve exact terminal content; the authoritative generation ledger can identify an otherwise unkeyed payload. */
export async function terminalProposalHistory(tenantId: string): Promise<{ fingerprints: Set<string>; legacyMutationKeys: Set<string> }> {
  const fingerprints = new Set<string>(), legacyMutationKeys = new Set<string>(), identified = new Set<string>(); if (!tenantId) return { fingerprints, legacyMutationKeys };
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await getSupabaseAdmin().from("proposal_work_tombstones").select("proposal_id, work_key").eq("tenant_id", tenantId).order("work_key", { ascending: true }).order("proposal_id", { ascending: true }).range(offset, offset + 499);
    if (error || !data) throw new Error(`terminal generation associations could not be read${error?.message ? `: ${error.message}` : ""}`);
    for (const row of data as Array<{ proposal_id: string; work_key: string }>) if (row.work_key?.trim() && !row.work_key.startsWith("__legacy_unkeyed__:")) identified.add(row.proposal_id);
    if (data.length < 500) break;
  }
  let after: string | null = null; for (;;) {
    let q = getSupabaseAdmin().from(TABLE).select("id, mutation_key, payload").eq("tenant_id", tenantId).not("terminal_disposition", "is", null);
    if (after) q = q.gt("id", after);
    const { data, error } = await q.order("id", { ascending: true }).limit(500);
    if (error || !data) throw new Error(`terminal proposal payload history could not be read${error?.message ? `: ${error.message}` : ""}`);
    for (const row of data as Array<{ id: string; mutation_key: string; payload: unknown }>) {
      const proposal = decode(row.payload); if (proposal) fingerprints.add(terminalProposalFingerprint(proposal));
      if ((!proposal || (!proposal.workKey && !identified.has(row.id))) && row.mutation_key) legacyMutationKeys.add(row.mutation_key);
    }
    if (data.length < 500) break; after = String((data[data.length - 1] as { id: string }).id);
  }
  return { fingerprints, legacyMutationKeys };
}

/** THE operator's own "put this aside": `terminal_disposition = 'dismissed'`, the exact disposition `saveChangeProposal` will not re-draft over. A change already marked implemented may not be dismissed. */
export async function dismissChangeProposal(tenantId: string, id: string): Promise<boolean> {
  if (!tenantId || !id) return false;
  try {
    const row = await rowById(tenantId, id);
    if (!row || row.terminal_disposition != null) return false;
    if (row.status === "implemented_pending_verification") {
      log.info("[proposal-store] you already marked this done, so it is not mine to put away", { tenantId, id });
      return false; }
    return setDisposition(tenantId, id, "dismissed", null, null, row);
  } catch (e) { log.error("[proposal-store] dismiss threw", { id, error: e instanceof Error ? e.message : String(e) }); return false; }
}

// ── reads ─────────────────────────────────────────────────────────────────────

/** One canonical row by id, whatever its disposition. Null when there is none. */
async function rowById(tenantId: string, id: string, failClosed = false): Promise<CanonRow | null> {
  const { data, error } = await getSupabaseAdmin().from(TABLE).select(CANON_COLUMNS).eq("tenant_id", tenantId).eq("id", id).limit(1);
  if (error || !data) { if (failClosed) throw new Error(error?.message ?? "proposal row unreadable"); return null; }
  return data.length === 0 ? null : (data[0] as CanonRow); }

/** HISTORY ONLY: rows written before the canonical table existed. Nothing here is current work unless the  canonical table has never heard of that id. */
async function readLegacy(tenantId: string, limit: number, id?: string): Promise<Array<{ id: string; content: string }>> {
  try {
    let q = getSupabaseAdmin().from(LEGACY_TABLE).select("rec_id, content, created_at").eq("tenant_id", tenantId).eq("kind", LEGACY_KIND);
    if (id) q = q.eq("rec_id", id);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
    if (error || !data) return [];
    return data.map((r) => ({ id: r.rec_id as string, content: r.content as string }));
  } catch { return []; }
}

/** Load one proposal by id. History is NOT served as current unless the caller asks for it: a change put aside a moment ago must read as history, never as a page that never existed. Fail-soft to null. */
/** WHETHER THIS ROW IS RETIRED AND HOW, asked on its own so the mark-done press decides BEFORE a shipment is written whether a retirement was reconciliation's (the operator may finish it) or the operator's own. */
export const proposalDisposition = async (tenantId: string, id: string): Promise<TerminalDisposition | null> => !tenantId || !id ? null : (await rowById(tenantId, id).catch(() => null))?.terminal_disposition ?? null;

export async function loadChangeProposal(tenantId: string, id: string, opts: { retired?: "include"; canonicalOnly?: true } = {}): Promise<ChangeProposal | null> {
  if (!tenantId || !id) return null;
  try {
    const row = await rowById(tenantId, id);
    if (row) return row.terminal_disposition == null || opts.retired === "include" ? decode(row.payload) : null;
    return opts.canonicalOnly ? null : decode((await readLegacy(tenantId, 1, id))[0]?.content ?? null);
  } catch (e) { log.error("[proposal-store] load threw", { id, error: e instanceof Error ? e.message : String(e) }); return null; }
}

/** STAMP THE LIVE RANKING in ONE statement per release: ONE GLOBAL RANK across every nonterminal opportunity, the id list IS the order, and the lane rides beside it as a control fact, never a second order (v1 numbered lanes separately and never stamped research; Codex, 2026-08-21). A stamp that cannot land leaves the ranking on file serving, which is why this is fail-soft. */
/** THE ATOMIC CUSTOMER RELEASE (Codex, 2026-08-23): ranking stamp and surface blob commit in ONE database transaction, or neither lands. The old shape stamped first and wrote the blob second, with a rollback that never fired because the blob writer suppressed its own failures: a failed build could un-rank live rows and keep the old surface. An expected-prior mismatch aborts before either write. Throws on failure; the previous release and its ranking are untouched by construction. */
export async function publishCustomerRelease(args: { tenantId: string; expectedPrior: string | null; release: string;
  scopeKey: string; storeName: string; content: unknown }): Promise<string> {
  const manifest = (args.content as { manifest?: unknown } | null)?.manifest;
  if (!Array.isArray(manifest) || manifest.some((r) => !r || typeof r !== "object" || typeof (r as { id?: unknown }).id !== "string" || !["ready", "todo", "research"].includes(String((r as { lane?: unknown }).lane))) || new Set(manifest.map((r) => (r as { id: string }).id)).size !== manifest.length) throw new Error("the release manifest is invalid, so no ranking was stamped");
  const { data, error } = await getSupabaseAdmin().rpc("publish_customer_release", {
    p_tenant_id: args.tenantId, p_expected_prior: args.expectedPrior, p_release: args.release,
    p_scope_key: args.scopeKey, p_store_name: args.storeName, p_content: [args.content] });
  if (error) throw new Error(`the release could not commit: ${error.message}`);
  return String(data ?? args.release);
}

export { readQueuePage, queueLaneCounts } from "./queue-paging";

/** Every proposal this account currently holds, keyed by id: the canonical current rows plus historical rows for ids the canonical table never held. THE CURRENT QUEUE IS NOT CAPPED. It used to stop at the first 500 rows, so an account with more current work than that silently lost the rest on every read that decides what is current, ranking included; the rows are PAGED here until the account is exhausted. `historyLimit` bounds HISTORY only, because history is not work. Fail-soft: a missing table shows history rather than  claiming this account has no changes at all. */
export async function loadChangeProposals(tenantId: string, opts: { failClosed?: boolean; canonicalOnly?: true } = {}): Promise<Map<string, ChangeProposal>> {
  const out = new Map<string, ChangeProposal>(); if (!tenantId) return out;
  const sb = getSupabaseAdmin(); let canonical = false;
  try {
    // THE QUEUE READ ASKS FOR THE QUEUE: filtering in memory let superseded versions push real work off the end. PAGES ADVANCE BY CURSOR, never offset, and the cursor rides the id ALONE because the id never moves: a save rewrites updated_at, and a cursor on a moving column skips the row that jumped the fence.
    let after: string | null = null;
    while (out.size < QUEUE_CEILING) {
      let q = sb.from(TABLE).select("id, status, terminal_disposition, payload")
        .eq("tenant_id", tenantId).is("terminal_disposition", null);
      if (after) q = q.gt("id", after);
      const { data, error } = await q.order("id", { ascending: true }).limit(QUEUE_PAGE);
      if (error) { log.error("[proposal-store] canonical read failed", { tenantId, error: error.message }); if (opts.failClosed) throw new Error(`current proposals could not be read: ${error.message}`); break; }
      canonical = true;
      const page = (data ?? []) as CanonRow[];
      // A pre-rename `rejected` row has no stored disposition, so the database filter above still hands it over; the bridge is what knows that word meant Beacon took the draft back.
      for (const r of page) { if (r.terminal_disposition != null) continue; const proposal = decode(r.payload); if (proposal) out.set(r.id, proposal); }
      const last = page[page.length - 1];
      if (!last || page.length < QUEUE_PAGE) break; // a short page is the end of this account's current work
      after = last.id;
    }
    if (canonical && !opts.canonicalOnly) for (const [id, proposal] of await strandedHandovers(tenantId, out, opts.failClosed === true)) out.set(id, proposal);
  } catch (e) { log.error("[proposal-store] canonical read threw", { tenantId, error: e instanceof Error ? e.message : String(e) }); if (opts.failClosed) throw e; }
  // THE CURRENT QUEUE IS THE CANONICAL TABLE AND NOTHING ELSE (falsifier, 2026-09-02). The pre-canonical table was read here for ids the canonical table never held, and six July new_page rows with no basis lived only there: no surface could ever reach them, every door withheld them, and they still inflated this account's counts by six. History is history, and `loadChangeProposal` still answers for one named legacy id, which is a lookup rather than a queue.
  return out;
}

/** Which of these ids the canonical table holds in ANY state. One bounded lookup. */
async function idsOnFile(tenantId: string, ids: string[], failClosed = false): Promise<Set<string>> {
  try {
    const { data, error } = await getSupabaseAdmin().from(TABLE).select("id").eq("tenant_id", tenantId).in("id", ids.slice(0, 500));
    if (error || !data) { if (failClosed) throw new Error(error?.message ?? "proposal ids could not be read"); return new Set<string>(); }
    return new Set((data as Array<{ id: string }>).map((r) => r.id));
  } catch (e) { if (failClosed) throw e; return new Set<string>(); }
}

/** REPAIR ON READ: a handover whose successor never landed leaves the hypothesis with no current answer. The in-process rollback still runs; this covers the crash it cannot, and the next save fixes it durably. */
async function strandedHandovers(tenantId: string, current: Map<string, ChangeProposal>, failClosed = false): Promise<Array<[string, ChangeProposal]>> {
  try {
    const { data, error } = await getSupabaseAdmin().from(TABLE).select("id, status, superseded_by, payload")
      .eq("tenant_id", tenantId).eq("terminal_disposition", "superseded")
      .order("updated_at", { ascending: false }).limit(25);
    if (error || !data) { if (failClosed) throw new Error(error?.message ?? "proposal handovers could not be read"); return []; }
    const rows = (data as CanonRow[]).filter((r) => !!r.superseded_by && !current.has(r.superseded_by));
    if (rows.length === 0) return [];
    const landed = await idsOnFile(tenantId, rows.map((r) => r.superseded_by as string), failClosed);
    const out: Array<[string, ChangeProposal]> = [];
    for (const r of rows) {
      if (landed.has(r.superseded_by as string)) continue;
      const proposal = decode(r.payload);
      if (!proposal) continue;
      log.warn("[proposal-store] a superseded change points at a successor that never landed; reading it as current again",
        { tenantId, id: r.id, missing: r.superseded_by });
      out.push([r.id, proposal]);
    }
    return out;
  } catch (e) { if (failClosed) throw e; return []; }
}
