/**
 * decision/proposal-store (V1 Truth Convergence Phase 5, 2026-07-31): the ONE
 * durable home of a ChangeProposal, and ONE CURRENT ROW PER HYPOTHESIS.
 *
 * CANONICAL IDENTITY. A hypothesis is (tenant, site, case, page, action family). Exactly one row
 * for that identity is CURRENT (`terminal_disposition is null`), enforced by a partial unique
 * index in Postgres. A new draft SUPERSEDES the row that held it in ONE database operation
 * (supersede_change_proposal): the predecessor steps aside pointing at its successor, which
 * lands with the next `proposal_version`. An identical re-draft writes NOTHING.
 *
 * THE STATUS VOCABULARY DOES NOT MOVE. proposed / needs_review / rejected / applied are the
 * lifecycle; a DISPOSITION (dismissed, withdrawn, superseded) is whether the row is still the
 * current answer. A DISMISSED CHANGE STAYS DISMISSED under the same basis; a NEW basis is a
 * different reading of a different world.
 *
 * A CHANGE THE OPERATOR APPLIED IS NEVER RETIRED FOR A NEWER IDEA. Only a row still waiting on
 * them (proposed / needs_review) may be superseded; anything else refuses the new draft.
 *
 * HISTORY IS READABLE, NEVER RESURRECTED. Nothing writes `move_drafts` anymore; its rows are
 * read only for ids the canonical table has never heard of, and never revive a known row.
 *
 * FAIL CLOSED, LOUDLY. The table is created by migration BEFORE this code deploys; if missing, a
 * write fails and says so, and reads fall back to history. server-only.
 */

import "server-only";

import { createHash } from "node:crypto";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { dualWriteUpsertScoped } from "@/lib/persistence/dual-write";
import { log } from "@/lib/logger";
import {
  type BundleComponentKind,
  type ChangeProposal,
  serializeChangeProposal,
  deserializeChangeProposal,
} from "./contracts";

/** The canonical table (migrations/2026-07-31_change_proposals.sql). */
const TABLE = "change_proposals";
/** The append-only rows this store used to write. READ ONLY, history only. */
const LEGACY_TABLE = "move_drafts";
const LEGACY_KIND = "change_proposal";

/** Why this row is no longer the current answer. Never a status: the four statuses
 *  on the proposal itself say what Beacon thinks of the change, and these say
 *  whether anyone is still being asked to look at it. */
type TerminalDisposition = "dismissed" | "withdrawn" | "superseded";

/** saved = a new version is durable. unchanged = the stored row already says exactly
 *  this, so nothing was written. refused = this hypothesis was dismissed and the
 *  evidence has not moved since. blocked = the row holding this hypothesis is one the
 *  operator already acted on, so it is being measured and may not be retired for a
 *  fresh idea. failed = the write did not land. Internal: the four calling surfaces
 *  branch on the literals, and nothing outside this file names the type. */
type SaveResult = "saved" | "unchanged" | "refused" | "blocked" | "failed";

// ── canonical identity ────────────────────────────────────────────────────────

/** THE CLOSED SET OF ACTION FAMILIES. One page can hold one current change per
 *  family: rewriting the snippet and restructuring the body are two hypotheses,
 *  and two attempts at the snippet are one. */
type ActionFamily =
  | "title-family" | "section-family" | "links-family" | "technical-family"
  | "consolidation" | "new_page";

/** Every component kind maps to exactly one family, once, here. Adding a kind to
 *  the contract without adding it here does not compile. */
const FAMILY_BY_KIND: Record<BundleComponentKind, ActionFamily> = {
  title: "title-family", meta: "title-family", h1: "title-family",
  opening_answer: "section-family", section: "section-family", source_pack: "section-family",
  paragraph_correction: "section-family", section_add: "section-family", section_remove: "section-family",
  section_rewrite: "section-family", restructure: "section-family", full_rewrite: "section-family",
  factual_correction: "section-family", source_update: "section-family", entity_expansion: "section-family",
  table_or_list_add: "section-family",
  internal_links: "links-family", internal_link_add: "links-family",
  internal_link_remove: "links-family", anchor_text: "links-family",
  schema: "technical-family", canonical: "technical-family", redirect: "technical-family",
  noindex: "technical-family", navigation: "technical-family",
  consolidation: "consolidation",
  new_page: "new_page",
};

/** BLAST RADIUS ORDER. A bundle touching several families is named by the biggest
 *  thing it does: moving the page outranks rewriting the body, which outranks
 *  rewording the line Google displays. Deterministic, so the same bundle always
 *  lands on the same identity. */
const FAMILY_PRECEDENCE: readonly ActionFamily[] = [
  "new_page", "consolidation", "technical-family", "section-family", "links-family", "title-family",
];

/** PURE: which family this change belongs to. A bundle is read off its components;
 *  an atomic edit names its own field. */
function actionFamilyOf(p: ChangeProposal): ActionFamily {
  if (p.kind === "new_page") return "new_page";
  const families = new Set((p.bundle?.components ?? []).map((c) => FAMILY_BY_KIND[c.kind]));
  for (const f of FAMILY_PRECEDENCE) if (families.has(f)) return f;
  const change = p.recommendedChange;
  if (change.kind === "new_page") return "new_page";
  return change.field === "title" || change.field === "meta" || change.field === "h1"
    ? "title-family" : "section-family";
}

/** The subject segment of the proposal's own id (`tenant::subject::kind::suffix`):
 *  the page for an edit, the research case for a new page. Identity is derived FROM
 *  the id and is never finer than it, so one id can never need two current rows. */
function anchorOf(p: ChangeProposal): string {
  const parts = p.id.split("::");
  const raw = parts.length >= 3 ? (parts[1] ?? "") : (p.pagePath ?? p.pageUrl ?? p.pageLabel ?? "");
  return raw.trim().toLowerCase();
}

/** The site this change lands on, from the proposal's own URL. Informational: the
 *  one-current-row index is keyed on the account, the case, the page and the family. */
function siteOf(p: ChangeProposal): string {
  const url = (p.pageUrl ?? "").trim();
  if (!url) return "";
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

type Identity = { site: string; case_id: string; page_key: string; action_family: ActionFamily };

/** PURE: the hypothesis this proposal is an answer to. */
function identityOf(p: ChangeProposal): Identity {
  const anchor = anchorOf(p);
  return {
    site: siteOf(p),
    case_id: p.kind === "new_page" ? anchor : "",
    page_key: p.kind === "new_page" ? "" : anchor,
    action_family: actionFamilyOf(p),
  };
}

/**
 * PURE: the fingerprint of everything an operator would act on. Deliberately
 * EXCLUDES createdAt and anything else that moves on its own, so a pass that
 * re-derives the same decision from the same evidence produces the same
 * fingerprint and writes nothing.
 *
 * THE REASONING IS MATERIAL. `causeFinding` was left out, so a pass that stamped a cause onto a
 * row it otherwise carried forward hashed identically, the write short-circuited as "unchanged",
 * and the whole investigation lived in memory for one render instead of reaching the stored row.
 */
export function proposalFingerprint(p: ChangeProposal): string {
  const material = {
    id: p.id,
    status: p.status,
    confidence: p.confidence,
    basis: p.basis ?? null,
    change: p.recommendedChange,
    limitations: p.limitations,
    cause: p.causeFinding ?? null,
    components: (p.bundle?.components ?? []).map((c) => [c.kind, c.before, c.after, c.evidenceKeys, c.risk]),
    receipt: (p.bundle?.receipt.items ?? []).map((i) => [i.key, i.kind, i.fact, i.observedAt]),
    missing: p.bundle?.receipt.missing ?? [],
  };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 16);
}

/** WHY this change exists, lifted onto its own column so the reasoning can be read
 *  without unpacking the whole proposal. Never a second source of truth: every
 *  field here is copied off the payload below it. */
function decisionReceipt(p: ChangeProposal): Record<string, unknown> {
  return {
    cause: p.diagnosisCause ?? null,
    why_it_matters: p.whyItMatters,
    confidence: p.confidence,
    limitations: p.limitations,
    receipt: p.bundle
      ? { items: p.bundle.receipt.items, missing: p.bundle.receipt.missing, freshest_observed_at: p.bundle.receipt.freshestObservedAt }
      : null,
  };
}

// ── stored rows ───────────────────────────────────────────────────────────────

type CanonRow = {
  id: string;
  proposal_version: number;
  status: ChangeProposal["status"];
  terminal_disposition: TerminalDisposition | null;
  superseded_by: string | null;
  basis: string | null;
  payload: unknown;
};

/** The columns every canonical read needs: the identity, the lifecycle status the
 *  handover rule leans on, the disposition and its pointer, and the payload itself. */
const CANON_COLUMNS = "id, proposal_version, status, terminal_disposition, superseded_by, basis, payload";

/** Re-validate a stored payload on EVERY load: a hand-edited row can never be
 *  served as a trusted proposal. */
function decode(payload: unknown): ChangeProposal | null {
  if (payload == null) return null;
  return deserializeChangeProposal(typeof payload === "string" ? payload : JSON.stringify(payload));
}

function rowFor(p: ChangeProposal, ident: Identity, version: number): Record<string, unknown> {
  return {
    id: p.id,
    tenant_id: p.tenantId,
    ...ident,
    proposal_version: version,
    basis: p.basis ?? null,
    status: p.status,
    terminal_disposition: null,
    superseded_by: null,
    payload: JSON.parse(serializeChangeProposal(p)) as unknown,
    decision_receipt: decisionReceipt(p),
    ranking_receipt: p.rankingReceipt ?? null,
    updated_at: new Date().toISOString(),
  };
}

/** Set (or, on a rollback, clear) one row's disposition. Fail-closed: a write that
 *  changed no row is a failure, never a quiet success. */
async function setDisposition(
  tenantId: string, id: string, disposition: TerminalDisposition | null, supersededBy: string | null,
): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .update({ terminal_disposition: disposition, superseded_by: supersededBy, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .select("id");
  if (error || !data || data.length === 0) {
    log.error("[proposal-store] disposition write did not land", { id, disposition, error: error?.message ?? "no row" });
    return false;
  }
  return true;
}

// ── writes ────────────────────────────────────────────────────────────────────

/**
 * Persist one proposal as the CURRENT answer for its hypothesis, superseding
 * whatever held that identity before. Writes nothing when the stored row already
 * says exactly this. Never throws.
 */
export async function saveChangeProposal(proposal: ChangeProposal): Promise<SaveResult> {
  if (!proposal.tenantId || !proposal.id) return "failed";
  const ident = identityOf(proposal);
  try {
    const sb = getSupabaseAdmin();
    // Everything already filed under this hypothesis, in one read.
    const { data, error } = await sb
      .from(TABLE)
      .select(CANON_COLUMNS)
      .eq("tenant_id", proposal.tenantId)
      .eq("case_id", ident.case_id)
      .eq("page_key", ident.page_key)
      .eq("action_family", ident.action_family)
      .limit(50);
    if (error) {
      log.error("[proposal-store] canonical read failed, nothing was written", {
        tenantId: proposal.tenantId, id: proposal.id, error: error.message });
      return "failed";
    }
    const rows = (data ?? []) as CanonRow[];
    // This id may have been filed under a DIFFERENT family last time (a bundle whose
    // components changed), so it is looked up by id as well before anything is written.
    const mine = rows.find((r) => r.id === proposal.id) ?? (await rowById(proposal.tenantId, proposal.id));
    const current = rows.find((r) => r.terminal_disposition == null) ?? null;

    // A CHANGE THE OPERATOR PUT AWAY STAYS AWAY until the evidence itself moves. Same basis, same
    // dismissal; a new basis is a genuinely different reading, so it may try again. ASK EVERY
    // DISMISSAL, NOT WHICHEVER ONE THE DATABASE RETURNED FIRST: these rows come back unordered, so
    // comparing one row's basis let a dismissed page be re-drafted whenever an older dismissal
    // sorted ahead of it. dismissChangeProposal below is the writer this gate answers to.
    if ([mine, ...rows].some((r) => r?.terminal_disposition === "dismissed" && (r.basis ?? null) === (proposal.basis ?? null))) return "refused";

    // Nothing material changed: no write, no new timestamp, so a refreshed surface never
    // reads yesterday's thinking as today's work.
    if (mine && mine.terminal_disposition == null) {
      const stored = decode(mine.payload);
      if (stored && proposalFingerprint(stored) === proposalFingerprint(proposal)) return "unchanged";
    }

    const version = (mine?.proposal_version ?? current?.proposal_version ?? 0) + 1;
    // One identity, one current row: the predecessor steps aside BEFORE the successor
    // lands, because the index will not hold both at once.
    const handover = current && current.id !== proposal.id ? current : null;
    // A CHANGE THE OPERATOR ALREADY MADE IS NOT MINE TO RETIRE. Supersession had no status guard,
    // so a fresh idea about the same page could push an APPLIED row into history mid-measurement
    // and the proof it was collecting lost the row it belonged to. Only a row still waiting on the
    // operator (proposed / needs_review) may step aside; everything else refuses the new draft.
    if (handover && handover.status !== "proposed" && handover.status !== "needs_review") {
      log.info("[proposal-store] this page already carries a change I am measuring, so the new draft is not saved", {
        tenantId: proposal.tenantId, holding: handover.id, status: handover.status, draft: proposal.id });
      return "blocked";
    }
    if (handover) {
      // ONE database operation: the status guard, the predecessor's step-aside, and the
      // successor's landing commit together or not at all, so a crash mid-handover can
      // never leave this hypothesis with no current answer.
      log.info("[proposal-store] superseding", { id: handover.id, by: proposal.id, version });
      const { data, error } = await getSupabaseAdmin().rpc("supersede_change_proposal", {
        p_tenant_id: proposal.tenantId, p_predecessor_id: handover.id, p_row: rowFor(proposal, ident, version),
      });
      if (error || data !== "saved") {
        log.error("[proposal-store] atomic supersession did not land, the stored change is unchanged", {
          tenantId: proposal.tenantId, id: proposal.id, answer: data ?? null, error: error?.message ?? null });
        return data === "blocked" ? "blocked" : "failed";
      }
      return "saved";
    }
    try {
      await dualWriteUpsertScoped(TABLE, [rowFor(proposal, ident, version)], "id", proposal.tenantId);
    } catch (e) {
      log.error("[proposal-store] save failed, the stored change is unchanged", {
        tenantId: proposal.tenantId, id: proposal.id, error: e instanceof Error ? e.message : String(e) });
      return "failed";
    }
    return "saved";
  } catch (e) {
    log.error("[proposal-store] save threw", { id: proposal.id, error: e instanceof Error ? e.message : String(e) });
    return "failed";
  }
}

/**
 * Manually mark one proposal APPLIED (the operator's own "Mark implemented"
 * action, never the kernel). Re-persists the proposal with status "applied" so the
 * pre-ship queue drops it and its measurement lives in the proof ledger.
 * Fail-soft to false. Publishing stays manual: this records the operator's claim,
 * it does not write a live page.
 */
export async function markProposalApplied(tenantId: string, id: string): Promise<boolean> {
  const proposal = await loadChangeProposal(tenantId, id);
  if (!proposal) return false;
  return (await saveChangeProposal({ ...proposal, status: "applied" })) !== "failed";
}

/**
 * THE operator's own "put this aside". Writes `terminal_disposition = 'dismissed'` on the current
 * row, which is the exact disposition `saveChangeProposal` already refuses to re-draft over under
 * the same basis. The gate has existed since Phase 5; this is the writer it was waiting for.
 *
 * A CHANGE ALREADY APPLIED MAY NOT BE DISMISSED: it is being measured, and retiring it would
 * orphan the proof it is collecting. Fail-closed to false.
 */
export async function dismissChangeProposal(tenantId: string, id: string): Promise<boolean> {
  if (!tenantId || !id) return false;
  try {
    const row = await rowById(tenantId, id);
    if (!row || row.terminal_disposition != null) return false;
    if (row.status === "applied") {
      log.info("[proposal-store] already applied and measuring, so it is not mine to put away", { tenantId, id });
      return false;
    }
    return setDisposition(tenantId, id, "dismissed", null);
  } catch (e) {
    log.error("[proposal-store] dismiss threw", { id, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

// ── reads ─────────────────────────────────────────────────────────────────────

/** One canonical row by id, whatever its disposition. Null when there is none. */
async function rowById(tenantId: string, id: string): Promise<CanonRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE).select(CANON_COLUMNS).eq("tenant_id", tenantId).eq("id", id).limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0] as CanonRow;
}

/** HISTORY ONLY: the append-only rows this store wrote before the canonical table existed.
 *  Nothing writes them now and nothing here is current work unless the canonical table has
 *  never heard of that id. */
async function readLegacy(tenantId: string, limit: number, id?: string): Promise<Array<{ id: string; content: string }>> {
  try {
    let q = getSupabaseAdmin()
      .from(LEGACY_TABLE).select("rec_id, content, created_at").eq("tenant_id", tenantId).eq("kind", LEGACY_KIND);
    if (id) q = q.eq("rec_id", id);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
    if (error || !data) return [];
    return data.map((r) => ({ id: r.rec_id as string, content: r.content as string }));
  } catch { return []; }
}

/** Load one proposal by id. A row the canonical table holds as history (dismissed,
 *  withdrawn, superseded) is NOT served as a current proposal. Fail-soft to null. */
export async function loadChangeProposal(tenantId: string, id: string): Promise<ChangeProposal | null> {
  if (!tenantId || !id) return null;
  try {
    const row = await rowById(tenantId, id);
    if (row) return row.terminal_disposition == null ? decode(row.payload) : null;
    return decode((await readLegacy(tenantId, 1, id))[0]?.content ?? null);
  } catch (e) {
    log.error("[proposal-store] load threw", { id, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/**
 * Every proposal this account currently holds, keyed by id: the canonical current
 * rows, plus historical rows for ids the canonical table has never held. Fail-soft
 * to what could be read, which is the honest degrade: a missing canonical table
 * shows the history rather than claiming this account has no changes at all.
 */
export async function loadChangeProposals(tenantId: string, limit = 500): Promise<Map<string, ChangeProposal>> {
  const out = new Map<string, ChangeProposal>();
  if (!tenantId) return out;
  const sb = getSupabaseAdmin();
  let canonical = false;
  try {
    // THE QUEUE READ ASKS FOR THE QUEUE. It used to ask for everything and filter in memory, so a
    // few hundred superseded versions could fill the row budget and push the account's actual
    // current work off the end: history is not competing for this read any more.
    const { data, error } = await sb
      .from(TABLE)
      .select("id, terminal_disposition, payload")
      .eq("tenant_id", tenantId)
      .is("terminal_disposition", null)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) {
      log.error("[proposal-store] canonical read failed, showing history only", { tenantId, error: error.message });
    } else {
      canonical = true;
      for (const r of (data ?? []) as CanonRow[]) {
        const proposal = decode(r.payload);
        if (proposal) out.set(r.id, proposal);
      }
      for (const [id, proposal] of await strandedHandovers(tenantId, out)) out.set(id, proposal);
    }
  } catch (e) {
    log.error("[proposal-store] canonical read threw, showing history only", {
      tenantId, error: e instanceof Error ? e.message : String(e) });
  }
  // HISTORY IS NEVER RESURRECTED. A legacy row may only fill an id the canonical table has never
  // heard of AT ALL, so a row it holds as superseded, dismissed or withdrawn cannot come back
  // through the old store. When the canonical read itself failed there is nothing to check against,
  // and showing the history is the honest degrade.
  const legacy = (await readLegacy(tenantId, limit)).filter((r) => !out.has(r.id));
  const retired = canonical && legacy.length > 0 ? await idsOnFile(tenantId, legacy.map((r) => r.id)) : new Set<string>();
  for (const row of legacy) {
    if (out.has(row.id) || retired.has(row.id)) continue; // first seen = newest
    const proposal = decode(row.content);
    if (proposal) out.set(row.id, proposal);
  }
  return out;
}

/** Which of these ids the canonical table holds in ANY state. One bounded lookup, asked only about
 *  ids a legacy row wants to fill. */
async function idsOnFile(tenantId: string, ids: string[]): Promise<Set<string>> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from(TABLE).select("id").eq("tenant_id", tenantId).in("id", ids.slice(0, 500));
    if (error || !data) return new Set<string>();
    return new Set((data as Array<{ id: string }>).map((r) => r.id));
  } catch {
    return new Set<string>();
  }
}

/**
 * REPAIR ON READ: a handover whose successor never landed. Superseding is two writes (the
 * predecessor steps aside, then the successor lands), and a crash between them leaves a row
 * pointing at a proposal that does not exist, so the hypothesis has no current answer at all and
 * the operator silently loses the change. The in-process rollback still runs; this covers the
 * crash it cannot. A superseded row whose successor is not on file is treated as current again,
 * and the next successful save fixes the disposition durably. Bounded to the newest handovers,
 * which is where a stranded one always is: stepping aside stamps updated_at.
 */
async function strandedHandovers(tenantId: string, current: Map<string, ChangeProposal>): Promise<Array<[string, ChangeProposal]>> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from(TABLE)
      .select("id, superseded_by, payload")
      .eq("tenant_id", tenantId)
      .eq("terminal_disposition", "superseded")
      .order("updated_at", { ascending: false })
      .limit(25);
    if (error || !data) return [];
    const rows = (data as CanonRow[]).filter((r) => !!r.superseded_by && !current.has(r.superseded_by));
    if (rows.length === 0) return [];
    const landed = await idsOnFile(tenantId, rows.map((r) => r.superseded_by as string));
    const out: Array<[string, ChangeProposal]> = [];
    for (const r of rows) {
      if (landed.has(r.superseded_by as string)) continue;
      const proposal = decode(r.payload);
      if (!proposal) continue;
      log.warn("[proposal-store] a superseded change points at a successor that never landed; reading it as current again", {
        tenantId, id: r.id, missing: r.superseded_by });
      out.push([r.id, proposal]);
    }
    return out;
  } catch {
    return [];
  }
}
