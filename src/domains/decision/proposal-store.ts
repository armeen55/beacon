/** decision/proposal-store: the ONE durable home of a ChangeProposal, and ONE CURRENT ROW PER HYPOTHESIS.
 *  A hypothesis is (tenant, site, case, page, action family) and exactly one row for it is CURRENT
 *  (`terminal_disposition is null`), held by a partial unique index; a new draft SUPERSEDES the row that held
 *  it in ONE database operation (supersede_change_proposal) and an identical re-draft writes NOTHING. STATUS
 *  IS THE STAGE, DISPOSITION IS WHETHER ANYONE IS STILL BEING ASKED: needs_review / ready /
 *  implemented_pending_verification are the stages, and dismissed / withdrawn / superseded retire the row.
 *  THE LIVE RANKING IS STORED HERE TOO (queue_lane + queue_rank), so the queue pages in the database. HISTORY
 *  IS READABLE, NEVER RESURRECTED. FAIL CLOSED, LOUDLY. server-only. */

import "server-only";

import { createHash } from "node:crypto";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { assertRowsScopedToTenant, dualWriteUpsertScoped } from "@/lib/persistence/dual-write";
import { log } from "@/lib/logger";
import { serializeChangeProposal, deserializeChangeProposal, type BundleComponentKind, type ChangeProposal } from "./contracts";
import { actionableProposalFailures } from "./validate-proposal";

/** The canonical table (migrations/2026-07-31_change_proposals.sql). */
const TABLE = "change_proposals";
/** The append-only rows this store used to write. READ ONLY, history only. */
const LEGACY_TABLE = "move_drafts";
const LEGACY_KIND = "change_proposal";

/** Why this row is no longer the current answer. Never a status: the stages say where the change stands, this
 *  says whether anyone is still being asked. `withdrawn` is Beacon taking a draft back. */
type TerminalDisposition = "dismissed" | "withdrawn" | "superseded";

/** saved = a new version is durable. unchanged = the stored row already says this. refused = retired under
 *  this basis, evidence unmoved. blocked = it is being measured. failed = the write did not land. */
type SaveResult = "saved" | "unchanged" | "refused" | "blocked" | "failed";

// ── canonical identity ────────────────────────────────────────────────────────

/** THE CLOSED SET OF ACTION FAMILIES. One page holds one current change per family: rewriting the snippet and
 *  restructuring the body are two hypotheses, and two attempts at the snippet are one. */
type ActionFamily = "title-family" | "section-family" | "links-family" | "technical-family" | "consolidation" | "new_page";

/** Every kind maps to one family, once, here. Adding a kind without adding it here does not compile. */
const FAMILY_BY_KIND: Record<BundleComponentKind, ActionFamily> = {
  title: "title-family", meta: "title-family", h1: "title-family",
  opening_answer: "section-family", section: "section-family", source_pack: "section-family",
  paragraph_correction: "section-family", section_add: "section-family", section_remove: "section-family",
  section_rewrite: "section-family", restructure: "section-family", full_rewrite: "section-family",
  factual_correction: "section-family", source_update: "section-family", entity_expansion: "section-family",
  table_or_list_add: "section-family", internal_links: "links-family", internal_link_add: "links-family",
  internal_link_remove: "links-family", anchor_text: "links-family", schema: "technical-family",
  canonical: "technical-family", redirect: "technical-family", noindex: "technical-family",
  navigation: "technical-family", consolidation: "consolidation", new_page: "new_page",
};

/** BLAST RADIUS ORDER. A bundle touching several families is named by the biggest thing it does: moving the
 *  page outranks rewriting the body. Deterministic, so one bundle always lands on the same identity. */
const FAMILY_PRECEDENCE: readonly ActionFamily[] = ["new_page", "consolidation", "technical-family", "section-family", "links-family", "title-family"];

/** PURE: which family this change belongs to, off a bundle's components or an atomic edit's own field. THE ONE
 *  ANSWER: the id a producer mints, the `changeFamily` it stamps and the identity this store files it under
 *  all read it here, so a page can hold a snippet rewrite and a body rebuild at once without either wearing
 *  the other's name. Structural on purpose, so a producer can ask before it has a whole proposal to hand. */
export function actionFamilyOf(p: Pick<ChangeProposal, "kind" | "bundle" | "recommendedChange">): ActionFamily {
  if (p.kind === "new_page") return "new_page";
  const families = new Set((p.bundle?.components ?? []).map((c) => FAMILY_BY_KIND[c.kind]));
  for (const f of FAMILY_PRECEDENCE) if (families.has(f)) return f;
  const change = p.recommendedChange;
  if (change.kind === "new_page") return "new_page";
  return change.field === "title" || change.field === "meta" || change.field === "h1"
    ? "title-family" : "section-family";
}

/** The subject segment of the proposal's own id (`tenant::subject::kind::suffix`): the page for an edit, the
 *  research case for a new page. Derived FROM the id, so one id can never need two current rows. */
function anchorOf(p: ChangeProposal): string {
  const parts = p.id.split("::");
  const raw = parts.length >= 3 ? (parts[1] ?? "") : (p.pagePath ?? p.pageUrl ?? p.pageLabel ?? "");
  return raw.trim().toLowerCase();
}

/** The site this change lands on, from its own URL. Informational: the index is keyed on account, case,
 *  page and family. */
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

/** THE READINGS THEMSELVES, in the order the receipt carries them. ORDER IS KEPT HERE on purpose: this feeds
 *  `proposalFingerprint`, whose whole job is "did anything at all about this row change", and loosening it
 *  would rewrite every stored row once for no gain. The refusal below sorts its own copy instead. */
/** WHICH STORED ANSWERS a reading came out of is MATERIAL: the same sentence read off a different answer is different evidence, and leaving the id out let it change underneath a live proposal for free. A line SEVERAL
 *  answers stand behind is material in ALL of them, so swapping one member moves this and the whole proposal with it, while the sort here means merely reordering the same support moves neither. Both appends are
 *  CONDITIONAL and the plural is fixed first purely so the order never wobbles: a row carrying no id, or the singular id alone, computes byte for byte what it always did and is never churned. */
const evidenceMaterial = (p: ChangeProposal): unknown[] => (p.bundle?.receipt.items ?? []).map((i) => [i.key, i.kind, i.fact, i.observedAt, ...(i.observationIds?.length ? [[...i.observationIds].sort()] : []), ...(i.observationId ? [i.observationId] : [])]);

/** PURE: what this change STANDS ON, and nothing about how it reads. Two drafts off the same readings share it;
 *  one reading taken again, added or dropped moves it. SORTED, so a producer that merely reorders its receipt
 *  cannot quietly lift a refusal the operator meant to stand. AN ATOMIC CHANGE HAS NO RECEIPT, and hashing an
 *  empty list gave every one of them the same constant: they matched each other unconditionally and stayed
 *  shut for ever on an unchanged basis. What one of those stands on is the frozen evidence summary it carries
 *  and the exact edit it argues for, so that is what it is asked about. */
function evidenceFingerprint(p: ChangeProposal): string {
  const material = p.bundle ? evidenceMaterial(p) : [p.evidence, p.recommendedChange];
  return createHash("sha256").update(JSON.stringify(material.map((m) => JSON.stringify(m)).sort())).digest("hex").slice(0, 16);
}

/** PURE: the fingerprint of everything an operator would act on. EXCLUDES createdAt and anything else that
 *  moves on its own, so a pass re-deriving the same decision writes nothing. THE REASONING IS MATERIAL:
 *  leaving `causeFinding` out let a re-stamped cause short-circuit as "unchanged" and never persist. */
export function proposalFingerprint(p: ChangeProposal): string {
  const material = {
    id: p.id, status: p.status, confidence: p.confidence, basis: p.basis ?? null,
    change: p.recommendedChange, limitations: p.limitations, cause: p.causeFinding ?? null,
    components: (p.bundle?.components ?? []).map((c) => [c.kind, c.before, c.after, c.evidenceKeys, c.risk]),
    // THE WORDS ARE WHAT THE OPERATOR ACTS ON. A pass that sharpened the headline, the reason or the steps and
    // nothing else computed "unchanged" and wrote nothing, so every rewrite of the queue's language died inside
    // the producer and the stored row kept serving the sentence it was meant to replace.
    copy: [p.opportunityType, p.whyItMatters, ...(p.operatorSteps ?? []), p.bundle?.objective ?? "", ...(p.bundle?.confidenceReasons ?? [])],
    receipt: evidenceMaterial(p),
    missing: p.bundle?.receipt.missing ?? [],
  };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 16);
}

/** WHY this change exists, on its own column so the reasoning reads without unpacking the whole proposal.
 *  Never a second source of truth: every field here is copied off the payload below it. */
const decisionReceipt = (p: ChangeProposal): Record<string, unknown> => ({
  cause: p.diagnosisCause ?? null, why_it_matters: p.whyItMatters, confidence: p.confidence, limitations: p.limitations,
  receipt: p.bundle ? { items: p.bundle.receipt.items, missing: p.bundle.receipt.missing, freshest_observed_at: p.bundle.receipt.freshestObservedAt } : null,
});

// ── stored rows ───────────────────────────────────────────────────────────────

/** `status` is `unknown` on purpose: a pre-rename row carries an old word and the bridge below is the ONE
 *  place that word is understood. */
type CanonRow = {
  id: string; proposal_version: number; status: unknown; terminal_disposition: TerminalDisposition | null;
  superseded_by: string | null; basis: string | null; payload: unknown;
};

/** The columns every canonical read needs: identity, stage, disposition and pointer, and the payload. */
const CANON_COLUMNS = "id, proposal_version, status, terminal_disposition, superseded_by, basis, payload";

/** Parse one stored payload through the contract. The database speaks only the three lifecycle words (the
 *  contract migration closed the union), so nothing is normalized on the way in. */
function decode(payload: unknown): ChangeProposal | null {
  if (payload == null) return null;
  return deserializeChangeProposal(typeof payload === "string" ? payload : JSON.stringify(payload));
}

const rowFor = (p: ChangeProposal, ident: Identity, version: number): Record<string, unknown> => ({
  id: p.id, tenant_id: p.tenantId, ...ident, proposal_version: version, basis: p.basis ?? null,
  // A ROW THAT CHANGED IS NO LONGER WHERE THE LAST RANKING PUT IT, so its stamp clears here and the next release build gives it a fresh position. A paged lane can never serve a change that has moved on.
  status: p.status, terminal_disposition: null, superseded_by: null, queue_lane: null, queue_rank: null,
  payload: JSON.parse(serializeChangeProposal(p)) as unknown,
  decision_receipt: decisionReceipt(p), ranking_receipt: p.rankingReceipt ?? null, updated_at: new Date().toISOString(),
});

/** Set (or, on a rollback, clear) one row's disposition. Fail-closed: a write that changed no row fails.
 *  WHY IT WAS RETIRED IS WRITTEN WITH IT. A withdrawal is permanent in practice (the skip set feeds off it
 *  and a save under the same basis is refused), and every one of them looked identical afterwards, so the
 *  night a sweep took the operator's open cards there was nothing on the rows to tell them apart from the
 *  ones a safety gate had genuinely refused. Pre-migration the write retries without the column rather than
 *  failing the retirement itself. */
async function setDisposition(
  tenantId: string, id: string, disposition: TerminalDisposition | null, supersededBy: string | null,
  reason: string | null = null,
): Promise<boolean> {
  const base = { terminal_disposition: disposition, superseded_by: supersededBy, updated_at: new Date().toISOString() };
  const write = (row: Record<string, unknown>) => getSupabaseAdmin().from(TABLE)
    .update(row).eq("tenant_id", tenantId).eq("id", id).select("id");
  let { data, error } = await write({ ...base, withdrawn_reason: disposition == null ? null : reason });
  if (error && (error.code === "PGRST204" || /column/i.test(error.message ?? ""))) {
    ({ data, error } = await write(base));
  }
  if (!error && data && data.length > 0) return true;
  log.error("[proposal-store] disposition write did not land", { id, disposition, error: error?.message ?? "no row" });
  return false;
}

// ── writes ────────────────────────────────────────────────────────────────────

/** Persist one proposal as the CURRENT answer for its hypothesis, superseding whatever held that identity
 *  before. Writes nothing when the stored row already says exactly this. Never throws. */
export async function saveChangeProposal(proposal: ChangeProposal): Promise<SaveResult> {
  if (!proposal.tenantId || !proposal.id) return "failed";
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

    // A CHANGE PUT AWAY STAYS AWAY, and a draft I WITHDREW stays withdrawn, UNTIL THE EVIDENCE MOVES: same basis AND the same readings underneath. The basis fingerprints the ACCOUNT, so basis alone held a row
    // shut through a whole generation while the readings under it changed completely, and the redraft the moved evidence had earned was answered "refused" forever. A retired row whose evidence no longer
    // matches has been overtaken and no longer speaks for this one. ASK EVERY RETIRED ROW, not whichever came back first, or an older dismissal sorting first lets a dismissed page be re-drafted; a row that
    // will not decode keeps its refusal, because an unreadable answer is not a moved one.
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

/** Manually mark one proposal IMPLEMENTED, PENDING VERIFICATION (the operator's own press, never the kernel).
 *  Re-persists it at that stage so the pre-ship queue drops it and the reading lives in the proof ledger.
 *  This records their claim, and the claim is not the fact. A NEW PAGE OWES ITS ADDRESS. */
export async function markProposalImplemented(tenantId: string, id: string, liveUrl?: string): Promise<boolean> {
  const proposal = await loadChangeProposal(tenantId, id);
  if (!proposal) return false;
  if (proposal.kind === "new_page" && !liveUrl?.trim()) {
    log.info("[proposal-store] a new page has no address until you publish it, so I am not recording it", { tenantId, id });
    return false; }
  return (await saveChangeProposal({ ...proposal, status: "implemented_pending_verification" })) !== "failed";
}

/** BEACON'S OWN RETRACTION. A draft a safety gate refused is not queued work and not a rejection the operator
 *  has to read: it lands as history under the disposition that says I took it back. Fail-soft. */
export async function withdrawChangeProposal(proposal: ChangeProposal, reason?: string): Promise<boolean> {
  const saved = await saveChangeProposal(proposal);
  if (saved === "failed") return false;
  if (saved === "refused") return true; // already withdrawn or dismissed under this basis
  return setDisposition(proposal.tenantId, proposal.id, "withdrawn", null, reason ?? null);
}

/** The hypotheses I already took back under THIS basis. Bounded; empty on read trouble, which costs one
 *  redraft and never a wrong skip. */
export async function withdrawnProposalIds(tenantId: string, basis: string | null): Promise<Set<string>> {
  if (!tenantId || !basis) return new Set<string>();
  try {
    const { data, error } = await getSupabaseAdmin().from(TABLE)
      .select("id").eq("tenant_id", tenantId).eq("basis", basis).eq("terminal_disposition", "withdrawn").limit(500);
    if (error || !data) return new Set<string>();
    return new Set((data as Array<{ id: string }>).map((r) => r.id));
  } catch { return new Set<string>(); }
}

/** THE operator's own "put this aside": `terminal_disposition = 'dismissed'`, the exact disposition
 *  `saveChangeProposal` will not re-draft over. A change already marked implemented may not be dismissed. */
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

/** HISTORY ONLY: rows written before the canonical table existed. Nothing here is current work unless the
 *  canonical table has never heard of that id. */
async function readLegacy(tenantId: string, limit: number, id?: string): Promise<Array<{ id: string; content: string }>> {
  try {
    let q = getSupabaseAdmin().from(LEGACY_TABLE).select("rec_id, content, created_at").eq("tenant_id", tenantId).eq("kind", LEGACY_KIND);
    if (id) q = q.eq("rec_id", id);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
    if (error || !data) return [];
    return data.map((r) => ({ id: r.rec_id as string, content: r.content as string }));
  } catch { return []; }
}

/** Load one proposal by id. History is NOT served as current unless the caller asks for it: a change put
 *  aside a moment ago must read as history, never as a page that never existed. Fail-soft to null. */
export async function loadChangeProposal(
  tenantId: string, id: string, opts: { retired?: "include" } = {},
): Promise<ChangeProposal | null> {
  if (!tenantId || !id) return null;
  try {
    const row = await rowById(tenantId, id);
    if (row) return row.terminal_disposition == null || opts.retired === "include" ? decode(row.payload) : null;
    return decode((await readLegacy(tenantId, 1, id))[0]?.content ?? null);
  } catch (e) { log.error("[proposal-store] load threw", { id, error: e instanceof Error ? e.message : String(e) }); return null; }
}

/** STAMP THE RANKING THAT IS LIVE, in ONE statement per release: the unlimited queue's positions are written
 *  down, not carried in a blob, so page two is cut from the SAME database order page one was. Both lanes and
 *  the clearing of the old ranking commit together (never half an order); a stamp that cannot land leaves the
 *  ranking on file serving, which is why this is fail-soft. */
export async function stampQueueRanking(
  tenantId: string, release: string, ready: readonly string[], toDo: readonly string[],
): Promise<boolean> {
  try {
    const { error } = await getSupabaseAdmin()
      .rpc("stamp_change_queue", { p_tenant_id: tenantId, p_release: release, p_ready: ready, p_todo: toDo });
    if (!error) return true;
    log.error("[proposal-store] the new ranking did not stamp, so the list keeps paging the one on file", { tenantId, release, error: error.message });
  } catch (e) { log.error("[proposal-store] stamping the ranking threw", { tenantId, error: e instanceof Error ? e.message : String(e) }); }
  return false;
}

/** ONE BOUNDED PAGE of the live ranking, cut in the database and never in memory. `total` is a COUNT taken
 *  without loading the queue; `release` names the ranking these rows came from, so paging a replaced order is
 *  told rather than fed a different one. `nextRank` is the last rank actually READ, never a row count: a
 *  dismissal leaves a hole, and counting rows through it would serve the change after it twice. */
export async function readQueuePage(
  tenantId: string, lane: "ready" | "todo", basis: string, afterRank: number, limit: number,
): Promise<{ rows: ChangeProposal[]; total: number; dropped: number; release: string | null; nextRank: number; more: boolean }> {
  const at = Math.max(0, Math.floor(afterRank));
  const nothing = { rows: [], total: 0, dropped: 0, release: null, nextRank: at, more: false };
  try {
    const sb = getSupabaseAdmin();
    // Both lanes of one ranking share a release, so rank 1 of either names the ranking that is live.
    const { data: head } = await sb.from(TABLE).select("queue_lane").eq("tenant_id", tenantId).eq("queue_rank", 1).limit(2);
    const release = ((head ?? []) as Array<{ queue_lane: string | null }>)
      .map((r) => (r.queue_lane ?? "").split("::")[0] ?? "").find((s) => s.length > 0) ?? null;
    if (release == null) return nothing;
    // EVERY FILTER THE QUEUE OWES IS ASKED HERE: this account, the bar it holds right now, still waiting on the operator, and the lane of the ranking that is live. Nothing is filtered after the fact.
    const scoped = (cols: string, count?: { count: "exact"; head: true }) => sb.from(TABLE).select(cols, count)
      .eq("tenant_id", tenantId).eq("queue_lane", `${release}::${lane}`).eq("basis", basis).is("terminal_disposition", null);
    const [counted, page] = await Promise.all([
      scoped("id", { count: "exact", head: true }),
      scoped(`${CANON_COLUMNS}, queue_rank`).gt("queue_rank", at)
        .order("queue_rank", { ascending: true }).order("id", { ascending: true }).limit(limit),
    ]);
    if (page.error) throw new Error(page.error.message);
    const read = (page.data ?? []) as unknown as Array<CanonRow & { queue_rank: number }>;
    const rows: ChangeProposal[] = [];
    // THE SAME ANSWER THE FIRST SCREEN GIVES. Position, lane and basis are stamped once and read for weeks, so a change whose own receipt stopped resolving kept paging out of a ranking taken when it still did.
    for (const r of read) {
      if (r.terminal_disposition != null) continue;
      const p = decode(r.payload);
      if (p && actionableProposalFailures(p, { tenantId, currentBasis: basis }).length === 0) rows.push(p);
    }
    // `more` is what the DATABASE said, never count arithmetic: a short raw page means the lane is exhausted.
    // The count is what the lane holds LESS what this page just refused, never the raw stamp: offering to show
    // more of a number that includes changes I will not hand over is a promise the next press cannot keep. `dropped` carries this page.s refusals on, so the caller takes DEEPER ones off the same count as it
    // learns of them. No scan: I only ever subtract what I have actually read.
    return { rows, dropped: read.length - rows.length, release,
      total: Math.max(rows.length, (counted.count ?? rows.length) - (read.length - rows.length)),
      nextRank: read[read.length - 1]?.queue_rank ?? at, more: read.length === limit };
  } catch (e) {
    log.error("[proposal-store] the queue page did not read", { tenantId, lane, error: e instanceof Error ? e.message : String(e) });
    return nothing;
  }
}

/** ONE bounded page of the canonical current rows, and the ceiling on a whole account. */
const QUEUE_PAGE = 500, QUEUE_CEILING = 20_000;

/** Every proposal this account currently holds, keyed by id: the canonical current rows plus historical rows
 *  for ids the canonical table never held. THE CURRENT QUEUE IS NOT CAPPED. It used to stop at the first 500
 *  rows, so an account with more current work than that silently lost the rest on every read that decides
 *  what is current, ranking included; the rows are PAGED here until the account is exhausted. `historyLimit`
 *  bounds HISTORY only, because history is not work. Fail-soft: a missing table shows history rather than
 *  claiming this account has no changes at all. */
export async function loadChangeProposals(tenantId: string, historyLimit = 500): Promise<Map<string, ChangeProposal>> {
  const out = new Map<string, ChangeProposal>();
  if (!tenantId) return out;
  const sb = getSupabaseAdmin();
  let canonical = false;
  try {
    // THE QUEUE READ ASKS FOR THE QUEUE: filtering in memory let superseded versions push real work off the end. PAGES ADVANCE BY CURSOR, never offset, and the cursor rides the id ALONE because the id never
    // moves: a save rewrites updated_at, and a cursor on a moving column skips the row that jumped the fence.
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

/** REPAIR ON READ: a handover whose successor never landed leaves the hypothesis with no current answer. The
 *  in-process rollback still runs; this covers the crash it cannot, and the next save fixes it durably. */
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
