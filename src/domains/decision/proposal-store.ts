/** decision/proposal-store: the ONE durable home of a ChangeProposal, and ONE CURRENT ROW PER HYPOTHESIS.  A hypothesis is (tenant, site, case, page, action family) and exactly one row for it is CURRENT  (`terminal_disposition is null`), held by a partial unique index; a new draft SUPERSEDES the row that held it in ONE database operation (supersede_change_proposal) and an identical re-draft writes NOTHING. STATUS  IS THE STAGE, DISPOSITION IS WHETHER ANYONE IS STILL BEING ASKED: needs_review / ready /  implemented_pending_verification are the stages, and dismissed / withdrawn / superseded retire the row. THE LIVE RANKING IS STORED HERE TOO (queue_lane + queue_rank), so the queue pages in the database. HISTORY  IS READABLE, NEVER RESURRECTED. FAIL CLOSED, LOUDLY. server-only. */

import "server-only";

import { createHash } from "node:crypto";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { assertRowsScopedToTenant, dualWriteUpsertScoped } from "@/lib/persistence/dual-write";
import { log } from "@/lib/logger";
import { serializeChangeProposal, deserializeChangeProposal, type BundleComponentKind, type ChangeProposal } from "./contracts";
import { confirmedVersion, deliverableGaps, openHold } from "./completeness";
import { actionableProposalFailures, validateProposal } from "./validate-proposal";
import { unsettledCause } from "./authorization"; import { staleCopyReasons } from "./drafted-copy";
/** The canonical table (migrations/2026-07-31_change_proposals.sql). Exported for the sibling that repairs the impossible state, so the name lives in ONE place. */
export const PROPOSAL_TABLE = "change_proposals";
const TABLE = PROPOSAL_TABLE;
/** The append-only rows this store used to write. READ ONLY, history only. */
const LEGACY_TABLE = "move_drafts";
const LEGACY_KIND = "change_proposal";

/** Why this row is no longer the current answer. Never a status: the stages say where the change stands, this says whether anyone is still being asked. `withdrawn` is Beacon taking a draft back. */
type TerminalDisposition = "dismissed" | "withdrawn" | "superseded";

/** saved = a new version is durable. unchanged = the stored row already says this. refused = retired under this basis, evidence unmoved. blocked = it is being measured. failed = the write did not land. */
type SaveResult = "saved" | "unchanged" | "refused" | "blocked" | "failed";
// ── canonical identity ────────────────────────────────────────────────────────

/** THE CLOSED SET OF ACTION FAMILIES. One page holds one current change per family: rewriting the snippet and restructuring the body are two hypotheses, and two attempts at the snippet are one. */
type ActionFamily = "title-family" | "section-family" | "links-family" | "technical-family" | "consolidation" | "accuracy-family" | "new_page";

/** Every kind maps to one family, once, here. Adding a kind without adding it here does not compile. */
const FAMILY_BY_KIND: Record<BundleComponentKind, ActionFamily> = {
  title: "title-family", meta: "title-family", h1: "title-family",
  opening_answer: "section-family", section: "section-family", source_pack: "section-family",
  paragraph_correction: "section-family", section_add: "section-family", section_remove: "section-family",
  section_rewrite: "section-family", restructure: "section-family", full_rewrite: "section-family",
  // REPLACING UNTRUE WORDS IS ITS OWN HYPOTHESIS ABOUT A PAGE, never the same one as adding a section. Filed under section-family, the accuracy card and the ranking-loss card for one page superseded each other, so the page could hold only one of two true findings at a time (operator, 2026-08-17: they are separate).
  factual_correction: "accuracy-family", source_update: "accuracy-family", entity_expansion: "section-family",
  table_or_list_add: "section-family", internal_links: "links-family", internal_link_add: "links-family",
  internal_link_remove: "links-family", anchor_text: "links-family", schema: "technical-family",
  canonical: "technical-family", redirect: "technical-family", noindex: "technical-family",
  navigation: "technical-family", consolidation: "consolidation", new_page: "new_page",
};

/** BLAST RADIUS ORDER. A bundle touching several families is named by the biggest thing it does: moving the page outranks rewriting the body. Deterministic, so one bundle always lands on the same identity. */
const FAMILY_PRECEDENCE: readonly ActionFamily[] = ["new_page", "consolidation", "technical-family", "accuracy-family", "section-family", "links-family", "title-family"];

/** PURE: which family this change belongs to, off a bundle's components or an atomic edit's own field. THE ONE ANSWER: the id a producer mints, the `changeFamily` it stamps and the identity this store files it under all read it here, so a page can hold a snippet rewrite and a body rebuild at once without either wearing the other's name. Structural on purpose, so a producer can ask before it has a whole proposal to hand. */
export function actionFamilyOf(p: Pick<ChangeProposal, "kind" | "bundle" | "recommendedChange">): ActionFamily {
  if (p.kind === "new_page") return "new_page";
  const families = new Set((p.bundle?.components ?? []).map((c) => FAMILY_BY_KIND[c.kind]));
  for (const f of FAMILY_PRECEDENCE) if (families.has(f)) return f;
  const change = p.recommendedChange;
  if (change.kind === "new_page") return "new_page";
  return change.field === "title" || change.field === "meta" || change.field === "h1"
    ? "title-family" : "section-family";
}

/** The subject segment of the proposal's own id (`tenant::subject::kind::suffix`): the page for an edit, the research case for a new page. Derived FROM the id, so one id can never need two current rows. */
function anchorOf(p: ChangeProposal): string {
  const parts = p.id.split("::");
  const raw = parts.length >= 3 ? (parts[1] ?? "") : (p.pagePath ?? p.pageUrl ?? p.pageLabel ?? "");
  return raw.trim().toLowerCase();
}

/** The site this change lands on, from its own URL. Informational: the index is keyed on account, case,  page and family. */
function siteOf(p: ChangeProposal): string {
  const url = (p.pageUrl ?? "").trim();
  if (!url) return "";
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return url.toLowerCase(); }
}

type Identity = { site: string; case_id: string; page_key: string; action_family: ActionFamily };

/** PURE: the hypothesis this proposal is an answer to. */
function identityOf(p: ChangeProposal): Identity {
  const anchor = anchorOf(p);
  return { site: siteOf(p), case_id: p.kind === "new_page" ? anchor : "",
    page_key: p.kind === "new_page" ? "" : anchor, action_family: actionFamilyOf(p) };
}

/** THE READINGS THEMSELVES, in the order the receipt carries them. ORDER IS KEPT HERE on purpose: this feeds `proposalFingerprint`, whose whole job is "did anything at all about this row change", and loosening it would rewrite every stored row once for no gain. The refusal below sorts its own copy instead. */
/** WHICH STORED ANSWERS a reading came out of is MATERIAL: the same sentence read off a different answer is different evidence, and leaving the id out let it change underneath a live proposal for free. A line SEVERAL answers stand behind is material in ALL of them, so swapping one member moves this and the whole proposal with it, while the sort here means merely reordering the same support moves neither. Both appends are CONDITIONAL and the plural is fixed first purely so the order never wobbles: a row carrying no id, or the singular id alone, computes byte for byte what it always did and is never churned. */
const evidenceMaterial = (p: ChangeProposal): unknown[] => (p.bundle?.receipt.items ?? []).map((i) => [i.key, i.kind, i.fact, i.observedAt, ...(i.observationIds?.length ? [[...i.observationIds].sort()] : []), ...(i.observationId ? [i.observationId] : [])]);

/** PURE: what this change STANDS ON, and nothing about how it reads. Two drafts off the same readings share it; one reading taken again, added or dropped moves it. SORTED, so a producer that merely reorders its receipt cannot quietly lift a refusal the operator meant to stand. AN ATOMIC CHANGE HAS NO RECEIPT, and hashing an empty list gave every one of them the same constant: they matched each other unconditionally and stayed shut for ever on an unchanged basis. What one of those stands on is the frozen evidence summary it carries  and the exact edit it argues for, so that is what it is asked about. */
function evidenceFingerprint(p: ChangeProposal): string {
  const material = p.bundle ? evidenceMaterial(p) : [p.evidence, p.recommendedChange];
  return createHash("sha256").update(JSON.stringify(material.map((m) => JSON.stringify(m)).sort())).digest("hex").slice(0, 16);
}

/** PURE: the fingerprint of everything an operator would act on. EXCLUDES createdAt and anything else that moves on its own, so a pass re-deriving the same decision writes nothing. THE REASONING IS MATERIAL: leaving `causeFinding` out let a re-stamped cause short-circuit as "unchanged" and never persist. */
export function proposalFingerprint(p: ChangeProposal): string {
  const material = {
    id: p.id, status: p.status, confidence: p.confidence, basis: p.basis ?? null,
    // THE IDENTITY OF THE WORK IS MATERIAL (Codex, 2026-08-23): without it here, a row that gained or changed its
    // workKey hashed identically to the one on file and the store answered "unchanged", so the key never persisted
    // and reuse could never match anything. Conditional, so a row minted before the key existed is never churned.
    ...(p.workKey ? { workKey: p.workKey } : {}),
    change: p.recommendedChange, limitations: p.limitations, cause: p.causeFinding ?? null,
    // EVERY MATERIAL FIELD OF A PIECE, so a piece cannot change what it MEANS without a new identity. Kind, words, evidence and risk alone left the page it lands on, the place on that page, what it is for and why it works out of the hash: a four-address differentiation could drop an address, move a component from one page to another, or re-aim the whole change, and compute "unchanged" against the row it replaced.
    components: (p.bundle?.components ?? []).map((c) => [c.kind, c.page ?? null, c.where ?? null, c.before, c.after,
      c.evidenceKeys, c.risk, c.objective ?? null, c.mechanism ?? null, c.anchorAfter ?? null, c.redirectTo ?? null]),
    dispositions: p.bundle?.dispositions ?? null,
    // THE PAGE THE WORDS WERE WRITTEN FOR. Conditional, like the ids below: a row minted before the stamp existed hashes byte for byte what it always did and is never churned to say the identical thing.
    ...(p.copyStamp ? { stamp: p.copyStamp } : {}),
    // WHAT THE COPY ASSERTS AND WHAT STANDS BEHIND EACH ASSERTION. Left out, a claim could be reworded, dropped or re-pointed at different evidence and the row computed "unchanged" against the version it replaced: the one thing a re-check reads was the one thing identity did not cover. Support SORTED, so reordering the same ids moves nothing, and CONDITIONAL, so a row carrying no claim hashes byte for byte what it always did.
    ...(p.claims?.length ? { claims: p.claims.map((c) => [c.text, [...c.supportedBy].sort()]) } : {}),
    // THE WORDS ARE WHAT THE OPERATOR ACTS ON. A pass that sharpened the headline, the reason or the steps and nothing else computed "unchanged" and wrote nothing, so every rewrite of the queue's language died inside the producer and the stored row kept serving the sentence it was meant to replace.
    copy: [p.opportunityType, p.whyItMatters, ...(p.operatorSteps ?? []), p.bundle?.objective ?? "", ...(p.bundle?.confidenceReasons ?? []), ...(p.research ? [p.research.missing, p.research.next] : [])],
    receipt: evidenceMaterial(p),
    missing: p.bundle?.receipt.missing ?? [],
    // WHERE THE RANKING PUT IT IS MATERIAL. Leaving the receipt out meant a row written before its pass had ranked anything computed "unchanged" against the ranked version of itself, so every card the $0 producers mint sat on file for ever with no receipt and nothing could say why it ranked where it did. CONDITIONAL, exactly like the answer ids above: an unranked row hashes byte for byte what it always did, so nothing on file is rewritten once just to say the identical thing.
    ...(p.rankingReceipt ? { rank: [p.rankingReceipt.score, p.whyRankedAboveNext ?? null, p.demandImpressions90d ?? null] } : {}),
  };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 16);
}

/** WHY this change exists, on its own column so the reasoning reads without unpacking the whole proposal. Never a second source of truth: every field here is copied off the payload below it. */
const decisionReceipt = (p: ChangeProposal): Record<string, unknown> => ({
  cause: p.diagnosisCause ?? null, why_it_matters: p.whyItMatters, confidence: p.confidence, limitations: p.limitations,
  receipt: p.bundle ? { items: p.bundle.receipt.items, missing: p.bundle.receipt.missing, freshest_observed_at: p.bundle.receipt.freshestObservedAt } : null,
});
// ── stored rows ───────────────────────────────────────────────────────────────

/** `status` is `unknown` on purpose: a pre-rename row carries an old word and the bridge below is the ONE  place that word is understood. */
type CanonRow = {
  id: string; proposal_version: number; status: unknown; terminal_disposition: TerminalDisposition | null;
  superseded_by: string | null; basis: string | null; payload: unknown;
};

/** The columns every canonical read needs: identity, stage, disposition and pointer, and the payload. */
const CANON_COLUMNS = "id, proposal_version, status, terminal_disposition, superseded_by, basis, payload";

/** Parse one stored payload through the contract. The database speaks only the three lifecycle words (the  contract migration closed the union), so nothing is normalized on the way in. */
function decode(payload: unknown): ChangeProposal | null {
  if (payload == null) return null;
  return deserializeChangeProposal(typeof payload === "string" ? payload : JSON.stringify(payload));
}

const rowFor = (p: ChangeProposal, ident: Identity, version: number): Record<string, unknown> => ({
  id: p.id, tenant_id: p.tenantId, ...ident, proposal_version: version, basis: p.basis ?? null,
  // A DRAFT SAVE NEVER TOUCHES THE LIVE RANKING (Codex, 2026-08-23). Clearing the stamp on every save meant a regeneration pass un-ranked nine live rows and THEN failed to publish, so the database's own paging and the surviving customer release disagreed about order: a split brain manufactured by a failed build. The rank a row holds stays exactly as the last COMMITTED release stamped it (stampQueueRanking is the only writer), and a row whose position is stale is re-stamped when the next whole release commits, never un-ranked in between. A row that lives again is still no longer retired: the reason clears with the disposition, or a live row wears two states at once (operator, 2026-08-17). The objection survives on the answering draft's limitations.
  status: p.status, terminal_disposition: null, superseded_by: null, withdrawn_reason: null,
  payload: JSON.parse(serializeChangeProposal(p)) as unknown,
  decision_receipt: decisionReceipt(p), ranking_receipt: p.rankingReceipt ?? null, updated_at: new Date().toISOString(),
});

/** Set (or, on a rollback, clear) one row's disposition. Fail-closed: a write that changed no row fails. WHY IT WAS RETIRED IS WRITTEN WITH IT. A withdrawal is permanent in practice (the skip set feeds off it and a save under the same basis is refused), and every one of them looked identical afterwards, so the night a sweep took the operator's open cards there was nothing on the rows to tell them apart from the ones a safety gate had genuinely refused. Pre-migration the write retries without the column rather than  failing the retirement itself. */
async function setDisposition(tenantId: string, id: string, disposition: TerminalDisposition | null, supersededBy: string | null, reason: string | null = null): Promise<boolean> {
  const base = { terminal_disposition: disposition, superseded_by: supersededBy, updated_at: new Date().toISOString() };
  const write = (row: Record<string, unknown>) => getSupabaseAdmin().from(TABLE).update(row).eq("tenant_id", tenantId).eq("id", id).select("id");
  let { data, error } = await write({ ...base, withdrawn_reason: disposition == null ? null : reason });
  if (error && (error.code === "PGRST204" || /column/i.test(error.message ?? ""))) ({ data, error } = await write(base));
  if (!error && data && data.length > 0) return true;
  log.error("[proposal-store] disposition write did not land", { id, disposition, error: error?.message ?? "no row" });
  return false;
}
// ── writes ────────────────────────────────────────────────────────────────────

/** The one token that lets a save move a row INTO implemented. It is module-private and handed out only by transitionProposalToImplemented, so "done" is reachable through the orchestrated transaction alone: a direct save carrying the implemented status without it is refused. The incident repair that orphaned  three implementations was exactly such a save. */
const IMPLEMENTED_TRANSITION = Symbol("implemented-transition");

/** Persist one proposal as the CURRENT answer for its hypothesis, superseding whatever held that identity before. Writes nothing when the stored row already says exactly this. Never throws. */
export async function saveChangeProposal(proposal: ChangeProposal, transition?: symbol): Promise<SaveResult> {
  if (!proposal.tenantId || !proposal.id) return "failed";
  if (proposal.status === "implemented_pending_verification" && transition !== IMPLEMENTED_TRANSITION) {
    const held = await loadChangeProposal(proposal.tenantId, proposal.id).catch(() => null);
    if (held?.status !== "implemented_pending_verification") {
      log.error("[proposal-store] a save may not move a row into implemented; use the mark-implemented transaction", { tenantId: proposal.tenantId, id: proposal.id });
      return "failed";
    }
  }
  // Every real id is minted `${tenantId}::...` by this kernel. An id wearing another account's prefix is a crafted call an id-keyed upsert would land on that account's row, so it is refused before any read.
  if (!proposal.id.startsWith(`${proposal.tenantId}::`)) {
    log.error("[proposal-store] the id does not belong to this account, so nothing is saved", { tenantId: proposal.tenantId, id: proposal.id });
    return "failed";
  }
  const ident = identityOf(proposal);
  try {
    const sb = getSupabaseAdmin();
    // Everything already filed under this hypothesis, in one read.
    const { data, error } = await sb.from(TABLE).select(CANON_COLUMNS).eq("tenant_id", proposal.tenantId)
      .eq("case_id", ident.case_id).eq("page_key", ident.page_key).eq("action_family", ident.action_family).limit(50);
    if (error) {
      log.error("[proposal-store] canonical read failed, nothing was written", {
        tenantId: proposal.tenantId, id: proposal.id, error: error.message });
      return "failed";
    }
    const rows = (data ?? []) as CanonRow[];
    // This id may have been filed under a DIFFERENT family last time (a bundle whose components changed), so it is looked up by id as well before anything is written.
    const mine = rows.find((r) => r.id === proposal.id) ?? (await rowById(proposal.tenantId, proposal.id));
    const current = rows.find((r) => r.terminal_disposition == null) ?? null;

    // A CHANGE PUT AWAY STAYS AWAY, and a draft I WITHDREW stays withdrawn, UNTIL THE EVIDENCE MOVES: same basis AND the same readings underneath. The basis fingerprints the ACCOUNT, so basis alone held a row shut through a whole generation while the readings under it changed completely, and the redraft the moved evidence had earned was answered "refused" forever. A retired row whose evidence no longer matches has been overtaken and no longer speaks for this one. ASK EVERY RETIRED ROW, not whichever came back first, or an older dismissal sorting first lets a dismissed page be re-drafted; a row that will not decode keeps its refusal, because an unreadable answer is not a moved one.
    if ([mine, ...rows].some((r) => { const d = r?.terminal_disposition ?? null;
      if ((d !== "dismissed" && d !== "withdrawn") || (r!.basis ?? null) !== (proposal.basis ?? null)) return false;
      const stored = decode(r!.payload);
      return !stored || evidenceFingerprint(stored) === evidenceFingerprint(proposal); })) return "refused";

    // Nothing material changed: no write, no new timestamp, so a refreshed surface never reads yesterday's thinking as today's work.
    if (mine && mine.terminal_disposition == null) {
      const stored = decode(mine.payload);
      if (stored && proposalFingerprint(stored) === proposalFingerprint(proposal)) return "unchanged";
    }

    const version = (mine?.proposal_version ?? current?.proposal_version ?? 0) + 1;
    // One identity, one current row: the predecessor steps aside BEFORE the successor lands, because the index will not hold both at once.
    const handover = current && current.id !== proposal.id ? current : null;
    // A CHANGE THE OPERATOR ALREADY MADE IS NOT MINE TO RETIRE: pushing an implemented row into history mid-measurement orphans the proof. Only a row still waiting on them may step aside.
    const holdingStatus = handover?.status ?? null;
    if (handover && holdingStatus !== "ready" && holdingStatus !== "needs_review") {
      log.info("[proposal-store] this page already carries a change I am measuring, so the new draft is not saved", {
        tenantId: proposal.tenantId, holding: handover.id, status: holdingStatus, draft: proposal.id });
      return "blocked";
    }
    if (handover) {
      // ONE database operation: guard, step-aside and landing commit together or not at all, so a crash mid-handover never leaves this hypothesis with no current answer. The scoping proof is made first.
      log.info("[proposal-store] superseding", { id: handover.id, by: proposal.id, version });
      const row = rowFor(proposal, ident, version);
      assertRowsScopedToTenant([row as { tenant_id?: string | null }], proposal.tenantId, TABLE);
      const { data, error } = await getSupabaseAdmin()
        .rpc("supersede_change_proposal", { p_tenant_id: proposal.tenantId, p_predecessor_id: handover.id, p_row: row });
      if (error && (error.code === "PGRST202" || error.code === "42883")) {
        log.error("[proposal-store] the supersession function is not installed; the draft was not saved",
          { tenantId: proposal.tenantId, id: proposal.id, code: error.code, error: error.message });
        return "failed"; }
      if (error || data !== "saved") {
        log.error("[proposal-store] atomic supersession did not land, the stored change is unchanged", {
          tenantId: proposal.tenantId, id: proposal.id, answer: data ?? null, error: error?.message ?? null });
        return data === "blocked" ? "blocked" : "failed";
      }
      return "saved";
    }
    try { await dualWriteUpsertScoped(TABLE, [rowFor(proposal, ident, version)], "id", proposal.tenantId); }
    catch (e) {
      log.error("[proposal-store] save failed, the stored change is unchanged", {
        tenantId: proposal.tenantId, id: proposal.id, error: e instanceof Error ? e.message : String(e) });
      return "failed";
    }
    return "saved";
  } catch (e) { log.error("[proposal-store] save threw", { id: proposal.id, error: e instanceof Error ? e.message : String(e) }); return "failed"; }
}

/** THE LAST STEP OF THE MARK-IMPLEMENTED TRANSACTION, and the ONLY way a change reaches IMPLEMENTED, PENDING VERIFICATION. It may only be walked with a Shipment ALREADY ON FILE: the id of the record measuring this change is required, so there is no bare status flip left to call from anywhere. A bare flip was exported once, was called on its own during an incident repair, and left changes marked done that nothing on earth was measuring. ORDER IS DELIBERATE: the press writes the Shipment first and reaches this second, so a crash between the two leaves a record the next press heals, where the reverse leaves the operator waiting forever for a reading nobody is taking. This records their claim, and the claim is not the fact. A NEW PAGE OWES ITS ADDRESS. */
export async function transitionProposalToImplemented(tenantId: string, id: string, shipmentId: string, liveUrl?: string): Promise<boolean> {
  if (!shipmentId.trim()) { log.error("[proposal-store] nothing is marked done without the record that is measuring it", { tenantId, id }); return false; }
  const proposal = await loadChangeProposal(tenantId, id);
  if (!proposal) return false;
  if (proposal.kind === "new_page" && !liveUrl?.trim()) {
    log.info("[proposal-store] a new page has no address until you publish it, so I am not recording it", { tenantId, id }); return false; }
  return (await saveChangeProposal({ ...proposal, status: "implemented_pending_verification" }, IMPLEMENTED_TRANSITION)) !== "failed";
}

/** THE OPERATOR'S YES, APPLIED TO THE EXACT ROW THEY READ AND TO NO OTHER. Step two of the two-step hold used to be a read, a check and then an ordinary save, and the save takes its OWN read afterwards: a rewrite that landed in between was simply overwritten by the version the operator had been looking at, which is the one thing a hold on a page-mover exists to stop. ONE COMPARE-AND-SET instead. The row must still be this account's, still non-terminal, still in review, still at the stored version that was read, still under the basis it was drafted for, and still fingerprint for fingerprint the version that was confirmed; the promoted row is then put through the ONE servability verdict before anything is written. The write itself carries the version it read, so a save landing between this read and this write matches NO row, changes nothing, and answers `stale`. TWO ANSWERS RIDE THIS ONE DOOR, because both are a person answering one exact version of one reviewed change: `promote` makes it ready (the page-mover's confirmation, and a draft only judgement was holding, which stamps who and when), and `redraft` leaves it exactly where it is and asks the next funded pass to write better words over it. The refusal check runs on the PROMOTED row only: nothing about asking for better words has to pass the bar for handing work over. */
export async function answerReviewedProposal(tenantId: string, id: string, version: string, basis: string | null,
  answer: { kind: "promote" | "redraft"; by?: string; at: string }): Promise<{ status: "promoted" | "stale" | "refused" | "failed"; refusal?: string }> {
  if (!tenantId || !id || !version) return { status: "failed" };
  try {
    const row = await rowById(tenantId, id), stored = row ? decode(row.payload) : null;
    if (!row || !stored) return { status: "failed" };
    // THE ACCOUNT HALF OF THE BASIS IS THE IDENTITY; the ::dN half is the kernel's clock: refusing a re-admitted row "stale" stranded it one confirmation short of ready forever. Two nulls still match.
    const strip = (s: string): string => s.replace(/::d\d+$/, "");
    const sameAccount = (row.basis ?? null) == null && basis == null
      ? true : row.basis != null && basis != null && strip(row.basis) === strip(basis);
    if (row.terminal_disposition != null || row.status !== "needs_review" || !sameAccount || confirmedVersion(stored) !== version) return { status: "stale" };
    // PROMOTION RESTAMPS THE GENERATION: the door's own checks are the current bar, so a row that clears them under the operator's yes is current work by demonstration, and the ready lane may serve it as such.
    const promoted: ChangeProposal = answer.kind === "redraft" ? { ...stored, redraftRequested: answer.at }
      : { ...stored, status: "ready", confirmedVersion: version, ...(basis != null ? { basis } : {}), ...(answer.by ? { approval: { by: answer.by, at: answer.at } } : {}) };
    // THE STORE REFUSES WHAT THE LABEL SAYS NOTHING ABOUT, never by classifying a stored limitation's wording: unfinished work, a lever that misses the diagnosed cause, and banked copy whose claims no longer resolve are asked HERE, on the row itself. STRICT: this door holds no fresh page body and no producer is standing by to fill one in, so provenance nobody can check is a refusal here rather than the skip an ordinary re-validation pass is owed. THE CANON RUNS LAST, on the words the row itself carries: the same validator a fresh draft passes through, asked again of the exact version being promoted, on the evidence banked beside it and nothing fetched new.
    const canon = answer.kind !== "promote" ? null : validateProposal(promoted, { now: new Date(answer.at), evidenceText: [promoted.evidence.hints.join(" "), promoted.causeFinding?.explanation ?? "", (promoted.bundle?.receipt.items ?? []).map((i) => i.fact).join(" "), (promoted.supportFacts ?? []).map((f) => f.fact).join(" ")].filter(Boolean).join(" ") }),
      refusal = answer.kind !== "promote" ? undefined : deliverableGaps(promoted)[0] ?? ((h) => h.safetyHold ? null : h.blocking)(openHold(promoted)) ?? unsettledCause(promoted) ?? staleCopyReasons(promoted, new Map(), [], null, true)[0] ?? actionableProposalFailures(promoted, { tenantId, currentBasis: basis, now: new Date(answer.at) })[0] ?? (canon!.verdict === "rejected" ? canon!.reasons[0] : canon!.qualityStatus !== "ready" ? (canon!.qualityStatus === "missing_source" ? "This change states a fact with no source behind it. It is held until a source is added." : canon!.qualityStatus === "needs_source_check" ? "The source behind this change could not be checked. It is held until that source is confirmed." : canon!.qualityStatus === "stale_data_changed" ? "The numbers behind this change moved since it was drafted. It is held until it is refreshed." : canon!.qualityStatus === "not_quotable" ? "This change is not trimmed to one liftable answer yet. It is held until it is." : canon!.qualityStatus === "useful_but_needs_review" ? "This change introduces a number that has not been confirmed yet. It is held until that number is checked." : (canon!.reasons[0] ?? "This change is not finished enough to promote yet.")) : undefined); // openHold joins the chain: the ONE servability verdict every screen reads now also guards the ONE door that writes `ready`, so a hold the queue would render cannot be promoted past. The SAFETY hold alone is excluded, because this door IS the deliberate confirmation that hold asks for: refusing it here would make a page-mover unpromotable by construction.
    if (refusal) return { status: "refused", refusal };
    const { data, error } = await getSupabaseAdmin().from(TABLE)
      .update({ status: promoted.status, payload: JSON.parse(serializeChangeProposal(promoted)) as unknown, proposal_version: row.proposal_version + 1,
        ...(answer.kind === "promote" ? { queue_lane: null, queue_rank: null } : {}), updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId).eq("id", id).eq("proposal_version", row.proposal_version).eq("status", "needs_review").is("terminal_disposition", null).select("id");
    if (error) { log.error("[proposal-store] the operator's answer did not land", { tenantId, id, error: error.message }); return { status: "failed" }; }
    return { status: data && data.length > 0 ? "promoted" : "stale" };
  } catch (e) { log.error("[proposal-store] answering a reviewed change threw", { id, error: e instanceof Error ? e.message : String(e) }); return { status: "failed" }; }
}

/** BEACON'S OWN RETRACTION. A draft a safety gate refused is not queued work and not a rejection the operator has to read: it lands as history under the disposition that says I took it back. Fail-soft. */
export async function withdrawChangeProposal(proposal: ChangeProposal, reason?: string): Promise<boolean> {
  const saved = await saveChangeProposal(proposal);
  if (saved === "failed") return false;
  if (saved === "refused") return true; // already withdrawn or dismissed under this basis
  return setDisposition(proposal.tenantId, proposal.id, "withdrawn", null, reason ?? null);
}

/** The hypotheses I already took back under THIS basis. Bounded; empty on read trouble, which costs one  redraft and never a wrong skip. */
export async function withdrawnProposalIds(tenantId: string, basis: string | null): Promise<Set<string>> {
  if (!tenantId || !basis) return new Set<string>();
  try {
    const { data, error } = await getSupabaseAdmin().from(TABLE)
      .select("id").eq("tenant_id", tenantId).eq("basis", basis).eq("terminal_disposition", "withdrawn").limit(500);
    if (error || !data) return new Set<string>();
    return new Set((data as Array<{ id: string }>).map((r) => r.id));
  } catch { return new Set<string>(); }
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
    return setDisposition(tenantId, id, "dismissed", null);
  } catch (e) { log.error("[proposal-store] dismiss threw", { id, error: e instanceof Error ? e.message : String(e) }); return false; }
}

// ── reads ─────────────────────────────────────────────────────────────────────

/** One canonical row by id, whatever its disposition. Null when there is none. */
async function rowById(tenantId: string, id: string): Promise<CanonRow | null> {
  const { data, error } = await getSupabaseAdmin().from(TABLE).select(CANON_COLUMNS).eq("tenant_id", tenantId).eq("id", id).limit(1);
  return error || !data || data.length === 0 ? null : (data[0] as CanonRow);
}

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
export async function loadChangeProposal(tenantId: string, id: string, opts: { retired?: "include" } = {}): Promise<ChangeProposal | null> {
  if (!tenantId || !id) return null;
  try {
    const row = await rowById(tenantId, id);
    if (row) return row.terminal_disposition == null || opts.retired === "include" ? decode(row.payload) : null;
    return decode((await readLegacy(tenantId, 1, id))[0]?.content ?? null);
  } catch (e) { log.error("[proposal-store] load threw", { id, error: e instanceof Error ? e.message : String(e) }); return null; }
}

/** STAMP THE LIVE RANKING in ONE statement per release: ONE GLOBAL RANK across every nonterminal opportunity, the id list IS the order, and the lane rides beside it as a control fact, never a second order (v1 numbered lanes separately and never stamped research; Codex, 2026-08-21). A stamp that cannot land leaves the ranking on file serving, which is why this is fail-soft. */
/** THE ATOMIC CUSTOMER RELEASE (Codex, 2026-08-23): ranking stamp and surface blob commit in ONE database transaction, or neither lands. The old shape stamped first and wrote the blob second, with a rollback that never fired because the blob writer suppressed its own failures: a failed build could un-rank live rows and keep the old surface. An expected-prior mismatch aborts before either write. Throws on failure; the previous release and its ranking are untouched by construction. */
export async function publishCustomerRelease(args: { tenantId: string; expectedPrior: string | null; release: string;
  rows: ReadonlyArray<{ id: string; lane: "ready" | "todo" | "research" }>; scopeKey: string; storeName: string; content: unknown }): Promise<string> {
  const { data, error } = await getSupabaseAdmin().rpc("publish_customer_release", {
    p_tenant_id: args.tenantId, p_expected_prior: args.expectedPrior, p_release: args.release,
    p_ids: args.rows.map((r) => r.id), p_lanes: args.rows.map((r) => r.lane),
    p_scope_key: args.scopeKey, p_store_name: args.storeName, p_content: [args.content] });
  if (error) throw new Error(`the release could not commit: ${error.message}`);
  return String(data ?? args.release);
}

/** ONE BOUNDED PAGE of the live ranking, cut in the database and never in memory. `total` is a COUNT taken without loading the queue; `release` names the ranking these rows came from, so paging a replaced order is told rather than fed a different one. `nextRank` is the last rank actually READ, never a row count: a dismissal leaves a hole, and counting rows through it would serve the change after it twice. */
export async function readQueuePage(
  tenantId: string, lane: "ready" | "todo" | "research" | "all", basis: string, afterRank: number, limit: number,
): Promise<{ rows: ChangeProposal[]; laneById: Record<string, "ready" | "todo" | "research">; total: number; dropped: number; release: string | null; nextRank: number; more: boolean }> {
  const at = Math.max(0, Math.floor(afterRank));
  const nothing = { rows: [], laneById: {}, total: 0, dropped: 0, release: null, nextRank: at, more: false };
  try {
    const sb = getSupabaseAdmin();
    // Both lanes of one ranking share a release, so rank 1 of either names the ranking that is live.
    const { data: head } = await sb.from(TABLE).select("queue_lane").eq("tenant_id", tenantId).eq("queue_rank", 1).limit(2);
    const release = ((head ?? []) as Array<{ queue_lane: string | null }>)
      .map((r) => (r.queue_lane ?? "").split("::")[0] ?? "").find((s) => s.length > 0) ?? null;
    if (release == null) return nothing;
    // EVERY FILTER THE QUEUE OWES IS ASKED HERE; nothing is filtered after the fact. The ACCOUNT half of the basis gates in the database, the ::dN half belongs to the checks below, and LIKE wildcards are escaped.
    const accountBasis = basis.replace(/::d\d+$/, "").replace(/[\\%_]/g, "\\$&");
    const scoped = (cols: string, count?: { count: "exact"; head: true }) => {
      const q = sb.from(TABLE).select(cols, count).eq("tenant_id", tenantId).like("basis", `${accountBasis}%`).is("terminal_disposition", null);
      return lane === "all" ? q.like("queue_lane", `${release.replace(/[\%_]/g, "\$&")}::%`) : q.eq("queue_lane", `${release}::${lane}`);
    };
    const [counted, page] = await Promise.all([
      scoped("id", { count: "exact", head: true }),
      scoped(`${CANON_COLUMNS}, queue_rank, queue_lane`).gt("queue_rank", at)
        .order("queue_rank", { ascending: true }).order("id", { ascending: true }).limit(limit),
    ]);
    if (page.error) throw new Error(page.error.message);
    const read = (page.data ?? []) as unknown as Array<CanonRow & { queue_rank: number; queue_lane: string | null }>;
    const rows: ChangeProposal[] = [];
    // THE STAMPED LANE IS THE ONE SOURCE of what controls a row carries.
    const laneById: Record<string, "ready" | "todo" | "research"> = {};
    // THE SAME ANSWER THE FIRST SCREEN GIVES. Position, lane and basis are stamped once and read for weeks, so a change whose own receipt stopped resolving kept paging out of a ranking taken when it still did.
    for (const r of read) {
      if (r.terminal_disposition != null) continue;
      const p = decode(r.payload);
      if (p && actionableProposalFailures(p, { tenantId, currentBasis: basis }).length === 0) {
        rows.push(p);
        const stamped = (r.queue_lane ?? "").split("::")[1];
        laneById[p.id] = stamped === "ready" || stamped === "research" ? stamped : "todo";
      }
    }
    // `more` is what the DATABASE said, never count arithmetic: a short raw page means the lane is exhausted. The count is what the lane holds LESS what this page just refused, never the raw stamp: offering to show more of a number that includes changes I will not hand over is a promise the next press cannot keep. `dropped` carries this page.s refusals on, so the caller takes DEEPER ones off the same count as it learns of them. No scan: I only ever subtract what I have actually read.
    return { rows, laneById, dropped: read.length - rows.length, release,
      total: Math.max(rows.length, (counted.count ?? rows.length) - (read.length - rows.length)),
      nextRank: read[read.length - 1]?.queue_rank ?? at, more: read.length === limit };
  } catch (e) {
    log.error("[proposal-store] the queue page did not read", { tenantId, lane, error: e instanceof Error ? e.message : String(e) });
    return nothing;
  }
}

/** THE LANE COUNTS OF THE LIVE RANKING, counted in the database, beside the one global order. */
export async function queueLaneCounts(tenantId: string, release: string, basis: string): Promise<{ ready: number; todo: number; research: number }> {
  const accountBasis = basis.replace(/::d\d+$/, "").replace(/[\\%_]/g, "\\$&");
  const count = async (lane: "ready" | "todo" | "research"): Promise<number> => (await getSupabaseAdmin().from(TABLE).select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("queue_lane", `${release}::${lane}`).like("basis", `${accountBasis}%`).is("terminal_disposition", null)).count ?? 0;
  try { const [ready, todo, research] = await Promise.all([count("ready"), count("todo"), count("research")]); return { ready, todo, research }; }
  catch { return { ready: 0, todo: 0, research: 0 }; }
}

/** ONE bounded page of the canonical current rows, and the ceiling on a whole account. */
const QUEUE_PAGE = 500, QUEUE_CEILING = 20_000;

/** Every proposal this account currently holds, keyed by id: the canonical current rows plus historical rows for ids the canonical table never held. THE CURRENT QUEUE IS NOT CAPPED. It used to stop at the first 500 rows, so an account with more current work than that silently lost the rest on every read that decides what is current, ranking included; the rows are PAGED here until the account is exhausted. `historyLimit` bounds HISTORY only, because history is not work. Fail-soft: a missing table shows history rather than  claiming this account has no changes at all. */
export async function loadChangeProposals(tenantId: string, historyLimit = 500): Promise<Map<string, ChangeProposal>> {
  const out = new Map<string, ChangeProposal>();
  if (!tenantId) return out;
  const sb = getSupabaseAdmin();
  let canonical = false;
  try {
    // THE QUEUE READ ASKS FOR THE QUEUE: filtering in memory let superseded versions push real work off the end. PAGES ADVANCE BY CURSOR, never offset, and the cursor rides the id ALONE because the id never moves: a save rewrites updated_at, and a cursor on a moving column skips the row that jumped the fence.
    let after: string | null = null;
    while (out.size < QUEUE_CEILING) {
      let q = sb.from(TABLE).select("id, status, terminal_disposition, payload")
        .eq("tenant_id", tenantId).is("terminal_disposition", null);
      if (after) q = q.gt("id", after);
      const { data, error } = await q.order("id", { ascending: true }).limit(QUEUE_PAGE);
      if (error) {
        log.error("[proposal-store] canonical read failed, showing history only", { tenantId, error: error.message });
        break; }
      canonical = true;
      const page = (data ?? []) as CanonRow[];
      // A pre-rename `rejected` row has no stored disposition, so the database filter above still hands it over; the bridge is what knows that word meant Beacon took the draft back.
      for (const r of page) {
        if (r.terminal_disposition != null) continue;
        const proposal = decode(r.payload);
        if (proposal) out.set(r.id, proposal);
      }
      const last = page[page.length - 1];
      if (!last || page.length < QUEUE_PAGE) break; // a short page is the end of this account's current work
      after = last.id;
    }
    if (canonical) for (const [id, proposal] of await strandedHandovers(tenantId, out)) out.set(id, proposal);
  } catch (e) {
    log.error("[proposal-store] canonical read threw, showing history only", {
      tenantId, error: e instanceof Error ? e.message : String(e) });
  }
  // HISTORY IS NEVER RESURRECTED. A legacy row may only fill an id the canonical table never heard of, so a row it holds as retired cannot come back. A failed canonical read has nothing to check against.
  const legacy = (await readLegacy(tenantId, historyLimit)).filter((r) => !out.has(r.id));
  const retired = canonical && legacy.length > 0 ? await idsOnFile(tenantId, legacy.map((r) => r.id)) : new Set<string>();
  for (const row of legacy) {
    if (out.has(row.id) || retired.has(row.id)) continue; // first seen = newest
    const proposal = decode(row.content);
    if (proposal) out.set(row.id, proposal);
  }
  return out;
}

/** Which of these ids the canonical table holds in ANY state. One bounded lookup. */
async function idsOnFile(tenantId: string, ids: string[]): Promise<Set<string>> {
  try {
    const { data, error } = await getSupabaseAdmin().from(TABLE).select("id").eq("tenant_id", tenantId).in("id", ids.slice(0, 500));
    return error || !data ? new Set<string>() : new Set((data as Array<{ id: string }>).map((r) => r.id));
  } catch { return new Set<string>(); }
}

/** REPAIR ON READ: a handover whose successor never landed leaves the hypothesis with no current answer. The in-process rollback still runs; this covers the crash it cannot, and the next save fixes it durably. */
async function strandedHandovers(tenantId: string, current: Map<string, ChangeProposal>): Promise<Array<[string, ChangeProposal]>> {
  try {
    const { data, error } = await getSupabaseAdmin().from(TABLE).select("id, status, superseded_by, payload")
      .eq("tenant_id", tenantId).eq("terminal_disposition", "superseded")
      .order("updated_at", { ascending: false }).limit(25);
    if (error || !data) return [];
    const rows = (data as CanonRow[]).filter((r) => !!r.superseded_by && !current.has(r.superseded_by));
    if (rows.length === 0) return [];
    const landed = await idsOnFile(tenantId, rows.map((r) => r.superseded_by as string));
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
  } catch { return []; }
}
