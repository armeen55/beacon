"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { log } from "@/lib/logger";
import { currentTenantId } from "@/lib/tenant-context";
import { canPublishForCurrentTenant } from "@/lib/auth/can-publish";
import { actionableProposalFailures, answerReviewedProposal, componentIdOf, confirmedVersion, dangerousComponents, deliverableGaps, dismissChangeProposal, openHold, unsettledCause,
  implementationGuard, loadChangeProposal, nextObligation, resolveCurrentBasis, sameComponentId, treatmentSignatureOf,
  type ChangeProposal } from "@/domains/decision";
import { getTenant } from "@/domains/account";
import { captureChangeMeta, loadShippedChanges, objectiveOfStage, recordShipment, verifyShipmentNow, type MeasurementState } from "@/domains/measurement";
import { atomicProof } from "@/domains/runtime";
import { invalidateCoreSurfaces, isCustomerSurfaceStale, readCustomerSurface, refreshCustomerSurface } from "../surface-release";
import { readChangesPage, type ChangesPage } from "../changes-data";
import operatorUiPolicy from "./types";

type MarkProposalImplementedResponse = { success: boolean; error?: string; note?: string; retryable?: boolean; providerCalls?: number; costUsd?: number };

type Shipped = { ok: true; complete: boolean; recorded: number; remaining: number; shipmentId: string; shipmentVersion: string; measurement: MeasurementState; atomic?: boolean };

/** The exact version applied: its copy, its components, the basis it was drafted under AND THE PIECES THIS PRESS ACTUALLY APPLIED. Deliberately EXCLUDES status, so the flip that follows cannot change the id and a retry lands on the same record. Applying a different subset later is a DIFFERENT thing to measure, so it gets its own record instead of being silently swallowed by the first one. */
function shippedVersionOf(p: ChangeProposal, appliedIds: readonly string[], liveUrl?: string, appliedText?: string | null): string {
  return createHash("sha256").update(JSON.stringify({
    sourceVersion: confirmedVersion(p),
    change: p.recommendedChange,
    page: liveUrl ?? p.pageUrl ?? p.pagePath,
    appliedText: appliedText ?? null,
    components: (p.bundle?.components ?? []).map((c) => [c.kind, c.before, c.after, c.page ?? null, c.where ?? null, c.redirectTo ?? null, c.anchorAfter ?? null, ...(c.units ? [c.units] : []), ...(c.target ? [c.target] : [])]),
    basis: p.basis ?? null,
    applied: [...appliedIds].sort(),
  })).digest("hex").slice(0, 16);
}

/** THE WORDS THAT HAVE TO END UP ON THE LINK, carried the same way by whichever door records the press. The live check reads a link on BOTH its address and its words, and a shipment that hands it only the address is confirmed by any link to that page under any wording at all, which is not the change that was asked for. The piece's own typed words win; a link piece that carries none takes the ones typed on the change itself, and nothing is stamped on a kind the live check would not read it off. */
const LINK_KIND: ReadonlySet<string> = new Set(["internal_link_add", "internal_links", "anchor_text"]);
const anchorFor = (p: ChangeProposal, kind: string, own?: string | null): { anchorAfter?: string } => { const c = p.recommendedChange, words = (!LINK_KIND.has(kind) ? "" : (own ?? (c.kind === "existing_edit" ? c.anchorText : null)) ?? "").trim(); return words ? { anchorAfter: words } : {}; };
/** THE PIECE'S OWN NAME, off the change and never off the brief the writer was handed. Four applied descriptions were recorded on 2026-09-05 as "Write a real description on <address>: 5 pages share one templated line", an instruction carrying a raw address, standing where the name of the applied piece belongs on a record that outlives the card. A bundle piece already carries its own label; an atomic change is one piece, and that piece is the field it rewrites, named on the page the operator reads. */
const FIELD_WORD: Readonly<Record<string, string>> = { title: "Page title", meta: "Meta description", h1: "Page headline", answer_block: "Answer at the top of the page", section: "Section on the page", schema: "Structured data" };
const atomicLabel = (p: ChangeProposal, link = false): string => { const c = p.recommendedChange, page = (p.pageLabel ?? "").trim() || (p.pagePath ?? "").trim();
  if (c.kind === "new_page") return page ? `New page: ${page}` : "New page";
  const what = link ? "Internal link" : FIELD_WORD[c.field] ?? "Change to the page";
  return page ? `${what} on ${page}` : what; };

/** WHERE THE NEW PAGE ACTUALLY LIVES. A page that did not exist has no address until the operator publishes it, so a new-page change marked done with no address left verification fetching the page LABEL as if it were a website. The address is owed, and it has to be one I can keep reading: on their own site, secure, and one plain page address with no query, because a tracking link is not the page. */
function liveUrlFor(raw: string, domain: string): { url: string } | { error: string } {
  const site = domain.trim().toLowerCase().replace(/^www\./, "");
  const owed = `Add the address the new page is live at, on ${site}, so it can be read.`;
  const text = raw.trim();
  if (!text) return { error: owed };
  let parsed: URL;
  try { parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); } catch { return { error: owed }; }
  if (parsed.protocol !== "https:") return { error: `That address is not secure. Use the https address on ${site}.` };
  if (parsed.hostname.toLowerCase().replace(/^www\./, "") !== site) {
    return { error: `That address is on ${parsed.hostname}, not on ${site}. Only pages on your own site are recorded and read.` };
  }
  if (parsed.search || parsed.hash) return { error: "Use the plain page address, with nothing after a ? or a #, so the page itself is read." };
  return { url: `${parsed.origin}${parsed.pathname}` };
}

/** The address as one comparable key: a full URL is cut down to its path, a trailing slash is nothing, and case never separates two spellings of one page. */
const pageKeyOf = (raw: string): string => { const t = (raw ?? "").trim().toLowerCase(); let path = t;
  if (/^https?:\/\//.test(t)) { try { path = new URL(t).pathname; } catch { path = t; } }
  return path.replace(/\/+$/, "") || "/"; };

/** HOW MANY OTHER CHANGES OF THEIRS WERE ALREADY BEING MEASURED ON THIS PAGE at the moment of the press. PURE, and read off rows the caller
 *  already holds, so it costs nothing: a count per press, never a query per row. DISTINCT PROPOSALS, because one change applied over three
 *  presses is one change and not three; and only inside the 28 day window that is the longest reading Beacon takes, so a change shipped last
 *  spring never marks today's work as crowded. A page nothing can name counts zero rather than counting everything. */
function overlapAtShip(ledger: ReadonlyArray<{ id: string; proposalId: string | null; path: string; page: string; implementedAt: string | null }>, p: ChangeProposal, pageRef: string): number {
  const raw = (pageRef || p.pagePath || "").trim();
  if (!raw) return 0;
  const here = pageKeyOf(raw), since = Date.now() - 28 * 86_400_000, others = new Set<string>();
  for (const r of ledger) {
    if (r.proposalId === p.id || r.implementedAt == null || Date.parse(r.implementedAt) < since) continue;
    if (pageKeyOf(r.path) === here || pageKeyOf(r.page) === here) others.add(r.proposalId ?? r.id);
  }
  return others.size;
}

/** Write the Shipment for one proposal. Idempotent: the id is derived from the proposal and the version applied, so a retry keeps the stamp and the starting numbers already on file, and the caller flips nothing when it did not land. A SECOND PRESS DOES NOTHING AT ALL: rebuilding the record erased the live check back to null, moved the ship date to today and recomputed the starting numbers over a window that now included days AFTER the change, so pressing twice quietly flattered its own result. */
async function recordImplementation(tenantId: string, proposal: ChangeProposal,
  opts: { appliedIds: readonly string[]; appliedText?: string | null; liveUrl?: string; guard: { rowVersion: number; payload: unknown }; preloadedLedger?: Awaited<ReturnType<typeof loadShippedChanges>>; openPaths?: readonly string[]; invalidate?: boolean },
): Promise<Shipped | { ok: false; error: string; retryable: true }> {
  const bundleIds = (proposal.bundle?.components ?? []).map(componentIdOf);
  const pageRef = (opts.liveUrl ?? proposal.pageUrl ?? proposal.pagePath ?? "").trim();
  const change = proposal.recommendedChange;
  const all = proposal.bundle?.components.map((c, i) => ({ id: componentIdOf(c, i), kind: c.kind, label: c.label, after: c.after ?? null, units: c.units, target: c.target, before: c.before ?? null,
    page: c.page ?? pageRef, where: c.where ?? null, risk: c.risk ?? null, ...anchorFor(proposal, c.kind, c.anchorAfter),
    redirectTo: c.redirectTo ?? (LINK_KIND.has(c.kind) && change.kind === "existing_edit" ? change.linkTo : null) ?? null }))
    ?? [{ id: null, kind: change.kind === "existing_edit" && change.linkTo ? "internal_link_add" : change.kind === "existing_edit" && change.field === "schema" ? (change.before ? "schema_replace" : "schema_add") : proposal.changeFamily,
      label: atomicLabel(proposal, change.kind === "existing_edit" && !!change.linkTo), after: change.kind === "existing_edit" ? change.after : null, units: change.kind === "existing_edit" ? change.units : undefined, target: change.kind === "existing_edit" ? change.target : undefined, before: change.kind === "existing_edit" ? change.before : null,
      page: pageRef, where: change.kind === "existing_edit" ? change.where ?? null : null, risk: null, redirectTo: change.kind === "existing_edit" ? change.linkTo ?? null : null,
      ...anchorFor(proposal, change.kind === "existing_edit" && change.linkTo ? "internal_link_add" : proposal.changeFamily) }];
  const selected = all.filter((c) => c.id == null || opts.appliedIds.some((id) => sameComponentId(id, c.id!)));
  try {
    const ledger = opts.preloadedLedger ?? await loadShippedChanges();
    const already = new Set<string>();
    const mine = ledger.filter((r) => r.proposalId === proposal.id && r.proposalVersion === shippedVersionOf(proposal, (r.componentsApplied ?? []).flatMap((c) => c.id ? [c.id] : []), opts.liveUrl, r.componentsApplied?.length === 1 ? r.operatorNote ?? null : null));
    let previous: (typeof mine)[number] | undefined;
    for (const r of mine) for (const c of r.componentsApplied ?? []) for (const current of all)
      if (sameComponentId(c.id ?? "", current.id ?? "", [{ ...c, before: c.before === undefined && r.componentsApplied?.length === 1 ? r.before : c.before, page: c.page ?? r.page }, current])
        && (!opts.appliedText || selected.length !== 1 || !selected.includes(current) || (c.appliedAfter ?? c.after) === opts.appliedText)) { if (current.id) already.add(current.id); previous = r; }
    const fresh = selected.filter((c) => c.id && !already.has(c.id)).map((c) => c.id!);
    const state = (recorded: number, shipmentId: string | null, shipmentVersion: string | null, measurement: MeasurementState, atomic = false): Shipped | { ok: false; error: string; retryable: true } => {
      const left = bundleIds.filter((id) => !already.has(id) && !(recorded > 0 && fresh.includes(id)));
      if (!shipmentId || !shipmentVersion) {
        log.error("markProposalImplemented: no record could be named for this press, so nothing was flipped", { proposalId: proposal.id });
        return { ok: false, retryable: true, error: "Measuring this change could not start, so it is not recorded as done. Press it again in a moment." };
      }
      return { ok: true, complete: left.length === 0, recorded, remaining: left.length, shipmentId, shipmentVersion, measurement, atomic };
    };
    if (fresh.length === 0 && previous) {
      const landed = await recordShipment({ ...previous, tenantId, proposalId: proposal.id, proposalVersion: previous.proposalVersion!,
        basis: previous.basis ?? null, caseId: previous.caseId ?? null, bundleHypothesis: previous.bundleHypothesis ?? "",
        componentsApplied: previous.componentsApplied ?? [], targetQueries: previous.targetQueries ?? [],
        before: previous.before ?? null, after: previous.after ?? null, implementedAt: previous.implementedAt ?? undefined },
      { preloadedLedger: ledger, proposal: { ...opts.guard, complete: bundleIds.every((id) => already.has(id)),
        priorShipmentIds: mine.map((r) => r.id), componentIds: bundleIds }, invalidate: false });
      return state(0, landed.shipmentId, previous.proposalVersion, landed.measurement, landed.proposalImplemented === true);
    }
    const version = shippedVersionOf(proposal, fresh, opts.liveUrl, selected.length === 1 ? opts.appliedText : null);
    const picked = bundleIds.length > 0 ? all.filter((c) => c.id != null && fresh.includes(c.id)) : all;
    const componentsApplied = opts.appliedText && picked.length === 1 ? [{ ...picked[0]!, appliedAfter: opts.appliedText, appliedUnits: null, appliedTarget: null }] : picked;

    const meta = pageRef ? await captureChangeMeta(tenantId, pageRef).catch(() => null) : null;

    const landed = await recordShipment({
      tenantId, proposalId: proposal.id, proposalVersion: version,
      page: opts.liveUrl ?? meta?.canonPage ?? proposal.pageUrl ?? proposal.pageLabel,
      path: opts.liveUrl ? new URL(opts.liveUrl).pathname : meta?.path ?? proposal.pagePath ?? proposal.pageLabel,
      actionType: proposal.changeFamily,
      before: change.kind === "existing_edit" ? change.before : null,
      after: change.kind === "existing_edit" ? change.after : change.proposedTitle,
      targetQueries: [proposal.primaryQuery, ...(proposal.bundle?.scope.queries ?? []), ...(proposal.bundle?.scope.prompts ?? [])]
        .filter((q, i, xs) => q && xs.indexOf(q) === i).slice(0, 10),
      basis: proposal.basis ?? null,
      caseId: proposal.kind === "new_page" ? (proposal.id.split("::")[1]?.trim().toLowerCase() || null) : null,
      bundleHypothesis: proposal.bundle?.objective ?? proposal.whyItMatters,
      judgedMetric: proposal.aiScope ? objectiveOfStage(proposal.aiScope.stage) : "clicks",
      aiScope: proposal.aiScope ?? null,
      componentsApplied,
      treatmentStamp: { signature: treatmentSignatureOf(proposal), overlapAtShip: overlapAtShip(ledger, proposal, pageRef) },
      preChangeContentHash: meta?.contentHash ?? null,
      operatorNote: opts.appliedText ?? null,
    }, { preloadedLedger: opts.preloadedLedger, openPaths: opts.openPaths, invalidate: opts.invalidate,
      proposal: { ...opts.guard, complete: bundleIds.every(id => already.has(id) || fresh.includes(id)), priorShipmentIds: mine.map((r) => r.id), componentIds: bundleIds } });
    return state(bundleIds.length ? fresh.length : 1, landed.shipmentId, version, landed.measurement, landed.proposalImplemented === true);
  } catch (err) {
    log.error("markProposalImplemented: the shipment did not land, so nothing was flipped", {
      proposalId: proposal.id, error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, retryable: true, error: "Measuring this change could not start, so it is not recorded as done. Press it again in a moment." };
  }
}

/** Record that the operator applied a change. THE CLAIM STARTS THE CHECK AND NEVER ENDS IT: whatever arrives here, the Shipment is written with no verification on it, so Beacon still reads the live page itself. */
export async function markProposalImplementedAction(args: {
  proposalId: string;
  expectedVersion: string;
  /** WHICH PIECES THEY ACTUALLY APPLIED, by the stable id each piece carries inside its stored bundle. ABSENT means all of them; anything else is intersected against the bundle on file and refused when it selects nothing, so a hand-made list can no longer conjure an empty selection past the confirmation. */
  componentIds?: string[];
  /** THE EXACT WORDING THEY PUT ON THE PAGE, where it is not the prepared wording. The screen asks for exactly that and for nothing else, which is what makes it the version applied rather than a comment: the prepared wording stays on the record beside it and the page is read for this one. */
  appliedText?: string;
  /** THE ONE CONFIRMATION THAT IS REAL. Set only by an operator who ticked the box beside a piece that moves or hides a page. Enforced HERE, on the server: a stale screen or a hand-made request cannot merge or redirect a page merely because it reached this action. */
  destructiveConfirmed?: boolean;
  /** WHERE THE NEW PAGE IS LIVE. Required for a new page, which has no address until they publish it. */
  liveUrl?: string;
  /** Set only by the many-at-once path below, which rebuilds the surfaces ONCE after the whole batch instead of once per card. Harmless if a client sets it: that path always rebuilds afterwards. */
  deferSurfaces?: boolean;
}): Promise<MarkProposalImplementedResponse> {
  const action = "markProposalImplemented";
  const t0 = Date.now();
  log.info("Action started", { action, params: { proposalId: args.proposalId } });

  if (!(await canPublishForCurrentTenant())) {
    return { success: false, error: "You do not have permission to mark this change implemented." };
  }
  if (!args.proposalId || !args.expectedVersion) return { success: false, error: "Open this change again to record the exact version you applied." };

  const tenantId = await currentTenantId();
  try {
    const basis = await resolveCurrentBasis(tenantId).catch(() => null);
    const guard = await implementationGuard(tenantId, args.proposalId, args.expectedVersion);
    const stored = guard?.proposal ?? null;
    if (stored == null) {
      return { success: false, error: "That change could not be found or was rewritten since you saw it. Open Changes again before recording." };
    }
    if (confirmedVersion(stored) !== args.expectedVersion) return { success: false, error: "This change has been rewritten since you saw it. Open it again and record only the version you applied." };
    if (stored.recommendedChange.kind === "existing_edit" && stored.recommendedChange.linkMode === "in_place" && args.appliedText?.trim()) return { success: false, error: "This link changes only the exact existing words. Remove the different wording before recording it." };
    if (!operatorUiPolicy.isManualEditProofWork(stored)) return { success: false, error: "Whole-page work is outside the current manual-edit proof, so it cannot be recorded here." };
    if (stored.status !== "implemented_pending_verification"
      && actionableProposalFailures(stored, { tenantId, currentBasis: basis }).length > 0) {
      return { success: false, error: "This change was skipped, so it is not being recorded. Open Changes for the work that stands today." };
    }
    const gaps = deliverableGaps(stored);
    if (gaps.length > 0) return { success: false, error: `This one is not finished yet, so there is nothing to record as done: ${gaps[0]}. It lands in your list as a change once the exact work is written.` };
    const unfit = unsettledCause(stored); // the first defect of the ONE verdict, typed faults included (journey review, 2026-09-06: the second arm restated the first)
    if (unfit) return { success: false, error: unfit }; // the SAME one servability verdict the list lanes by and the detail renders: a read-time hold minted between saves refuses the press too, so a 28 day reading can never start on copy Beacon's own gate refuses. Review rows fall to the lane refusal below, which is their honest answer.
    if (stored.status !== "ready" && stored.status !== "implemented_pending_verification") {
      return { success: false, error: "This change is still being reviewed, so it cannot be marked done yet. Open Changes for the work that is ready to make today." };
    }
    const components = stored.bundle?.components ?? [];
    const ids = components.map(componentIdOf);
    if (stored.kind === "new_page" && args.componentIds && (new Set(args.componentIds).size !== ids.length || args.componentIds.length !== ids.length || ids.some(id => !args.componentIds!.includes(id)))) return { success: false, error: "A new page is one complete publication. Apply and record every component together." };
    let applied = components;
    let appliedIds = ids;
    if (args.componentIds !== undefined) {
      const wanted = new Set(args.componentIds);
      const picked = components.map((component, i) => ({ component, id: ids[i]! })).filter(({ id }) => wanted.has(id));
      applied = picked.map(({ component }) => component); appliedIds = picked.map(({ id }) => id);
      if (applied.length === 0 || applied.length !== wanted.size) {
        return { success: false, error: "The pieces you ticked are not recognized, so nothing was recorded. Open the change again and tick what you applied." };
      }
      const linked = components.map((component, i) => ({ id: ids[i]!, dependsOn: component.derivation?.dependsOn.map((dependency) => dependency.componentId) }));
      const chosen = new Set(appliedIds);
      if (appliedIds.some((id) => [...operatorUiPolicy.linkedComponentIds(linked, id)].some((linkedId) => !chosen.has(linkedId)))) {
        return { success: false, error: "The visible FAQ copy and its matching structured data are one linked change, so neither was recorded. Open the change again and tick either one to select both." };
      }
    }
    if (dangerousComponents(applied).length > 0 && args.destructiveConfirmed !== true) {
      return { success: false, error: "This one moves or hides a page, so it needs your confirmation before it is recorded. Open the change, tick the confirmation, and press it again." };
    }
    let liveUrl: string | undefined;
    if (stored.kind === "new_page") {
      const domain = (await getTenant(tenantId).catch(() => null))?.domain?.trim();
      if (!domain) return { success: false, retryable: true, error: "Your website address could not be read just now, so this is not recorded yet. Press it again in a moment." };
      const checked = liveUrlFor(args.liveUrl ?? "", domain);
      if ("error" in checked) return { success: false, error: checked.error };
      liveUrl = checked.url;
    }
    const shipment = await recordImplementation(tenantId, stored, { appliedIds, appliedText: args.appliedText, liveUrl, guard: guard! });
    if (!shipment.ok) return { success: false, retryable: true, error: shipment.error };
    const n = shipment.recorded, left = shipment.remaining;
    const one = (a: string, b: string) => (left === 1 ? a : b);
    if (!shipment.complete) {
      after(() => verifyShipmentNow(tenantId, shipment.shipmentId, { readSerp: async () => null }).catch(() => 0)); // immediate confirmation is the customer's owned page only; paid Google-display evidence belongs to the canonical leased drive
      await invalidateCoreSurfaces().catch(() => {});
      revalidatePath("/changes");
      const landed = n > 0
        ? `Recorded the ${n} piece${n === 1 ? "" : "s"} you applied. ${n === 1 ? "It is" : "They are"} being measured.`
        : "Those pieces were already on file and are being measured.";
      return { success: true, note: `${landed} The other ${left} ${one("is", "are")} still on your list: tick ${one("it", "them")} here when you apply ${one("it", "them")}.` };
    }
    if (!shipment.atomic) return { success: false, retryable: true, error: "The implementation record did not finish its proposal transition. Press it again in a moment." };
    if (!args.deferSurfaces) { await invalidateCoreSurfaces().catch(() => {}); revalidatePath("/changes"); revalidatePath("/", "layout"); }
    after(() => verifyShipmentNow(tenantId, shipment.shipmentId, { readSerp: async () => null }).catch(() => 0)); // ANSWERED IN MINUTES from the owned page; paid display evidence waits for the leased drive
    log.info("Action completed", { action, durationMs: Date.now() - t0, params: { proposalId: args.proposalId } });
    if (n === 0 && ids.length > 0) return { success: true, note: "Every piece of this change is already on file and being measured. There is nothing left for you to record here." };
    return { success: true, note: `${args.appliedText?.trim() ? "Your wording is recorded as what is on the page, and the prepared wording is kept beside it. " : ""}${operatorUiPolicy.measurementAcknowledgement(shipment.measurement)}` };
  } catch (err) {
    log.error("markProposalImplemented: failed", { proposalId: args.proposalId, error: err instanceof Error ? err.message : String(err) });
    return { success: false, retryable: true, error: "That could not be recorded just now. Press it again in a moment." };
  }
}

/** One trip for several version-bound presses; each Shipment remains atomic and idempotent. */
export async function markManyImplementedAction(args: { proposals: { id: string; expectedVersion: string }[] }): Promise<{ success: boolean; done: number; already: number; failed: { id: string; error: string }[]; note: string; results: { id: string; outcome: "recorded" | "already" | "failed"; shipmentId?: string; note?: string; error?: string }[] }> {
  const t0 = Date.now();
  const wanted = new Map((args.proposals ?? []).filter((x) => typeof x?.id === "string" && x.id.trim() && typeof x.expectedVersion === "string" && x.expectedVersion.trim()).map((x) => [x.id, x.expectedVersion]));
  const ids = [...wanted.keys()];
  if (ids.length === 0) return { success: false, done: 0, already: 0, failed: [], results: [], note: "No changes were selected." };
  if (!(await canPublishForCurrentTenant())) return { success: false, done: 0, already: 0, failed: [], results: [], note: "You do not have permission to mark these changes implemented." };
  const tenantId = await currentTenantId();
  const basis = await resolveCurrentBasis(tenantId).catch(() => null);
  const [stored, ledger] = await Promise.all([
    (await import("@/domains/decision")).loadChangeProposals(tenantId).catch(() => new Map<string, ChangeProposal>()),
    loadShippedChanges().catch(() => null)]);
  if (ledger == null) return { success: false, done: 0, already: 0, failed: ids.map((id) => ({ id, error: "the record book could not be read just now" })), results: ids.map((id) => ({ id, outcome: "failed" as const, error: "the record book could not be read just now" })), note: "Nothing was recorded: the record book could not be read just now. Press it again in a moment." };
  const results: { id: string; outcome: "recorded" | "already" | "failed"; shipmentId?: string; note?: string; error?: string }[] = [];
  const openPaths = [...stored.values()].filter((p) => p.status === "ready" || p.status === "implemented_pending_verification").map((p) => p.pagePath ?? "").filter((p) => p.length > 0);
  const recordOne = async (id: string): Promise<(typeof results)[number]> => {
    try {
      const guard = await implementationGuard(tenantId, id, wanted.get(id)!);
      const row = guard?.proposal ?? null;
      if (!row) return { id, outcome: "failed", error: "That change could not be found or was rewritten since you selected it." };
      if (confirmedVersion(row) !== wanted.get(id)) return { id, outcome: "failed", error: "This change has been rewritten since you selected it. Open it again before recording." };
      if (!operatorUiPolicy.isManualEditProofWork(row)) return { id, outcome: "failed", error: "Whole-page work is outside the current manual-edit proof." };
      if (!operatorUiPolicy.isBulkRecordable(row)) return { id, outcome: "failed", error: "This change has several pieces or needs confirmation, so record it from its own change page." };
      if (row.status !== "implemented_pending_verification" && actionableProposalFailures(row, { tenantId, currentBasis: basis }).length > 0)
        return { id, outcome: "failed", error: "This change was skipped, so it is not being recorded." };
      const gaps = deliverableGaps(row);
      if (gaps.length > 0) return { id, outcome: "failed", error: `This one is not finished yet: ${gaps[0]}` };
      const unfit = unsettledCause(row);
      if (unfit) return { id, outcome: "failed", error: unfit };
      if (row.status !== "ready" && row.status !== "implemented_pending_verification") return { id, outcome: "failed", error: "This change is still being reviewed." };
      if (dangerousComponents(row.bundle?.components ?? []).length > 0) return { id, outcome: "failed", error: "This one moves or hides a page, so it needs its own confirmed press on the change itself." };
      const appliedIds = (row.bundle?.components ?? []).map(componentIdOf);
      const shipment = await recordImplementation(tenantId, row, { appliedIds, guard: guard!, preloadedLedger: ledger, openPaths, invalidate: false }); // NO SHARED WORDING ON A BATCH: one line of the operator's own words cannot be the version applied to twenty different changes, so the batch records the prepared wording and a different version is recorded on the change itself
      if (!shipment.ok) return { id, outcome: "failed", error: shipment.error };
      const alreadyDone = row.status === "implemented_pending_verification" || (shipment.recorded === 0 && (row.bundle?.components ?? []).length > 0); // an atomic row records zero COMPONENT ids by construction; only a bundle with nothing fresh is genuinely already on file
      if (!shipment.atomic) return { id, outcome: "failed", error: "The change could not be marked done. Press it again in a moment." };
      return { id, outcome: alreadyDone ? "already" : "recorded", shipmentId: shipment.shipmentId, note: alreadyDone ? "Already recorded. Open Results for its current verification and measurement state." : operatorUiPolicy.measurementAcknowledgement(shipment.measurement) };
    } catch (err) {
      log.error("markManyImplemented: one row failed", { id, error: err instanceof Error ? err.message : String(err) });
      return { id, outcome: "failed", error: "That could not be recorded just now." };
    }
  };
  for (let i = 0; i < ids.length; i += 4) results.push(...await Promise.all(ids.slice(i, i + 4).map(recordOne)));
  const done = results.filter((r) => r.outcome === "recorded").length, already = results.filter((r) => r.outcome === "already").length;
  const failed = results.filter((r): r is { id: string; outcome: "failed"; error: string } => r.outcome === "failed").map((r) => ({ id: r.id, error: r.error }));
  if (done > 0 || already > 0) { await (await import("@/app/(shell)/results/results-surface-store")).invalidateResultsSurface().catch(() => {}); await invalidateCoreSurfaces().catch(() => {}); revalidatePath("/changes"); revalidatePath("/", "layout"); } // ONE invalidation of each saved surface for the whole batch
  const parts = [done > 0 ? `${done} recorded` : null, already > 0 ? `${already} already being measured` : null,
    failed.length > 0 ? `${failed.length} could not be recorded` : null].filter(Boolean);
  log.info("markManyImplemented: batch done", { count: ids.length, done, already, failed: failed.length, durationMs: Date.now() - t0 });
  return { success: failed.length < ids.length, done, already, failed, results, note: `${parts.join(", ")}.` };
}

/** STEP TWO OF THE TWO-STEP HOLD, AND THE ONLY WAY A CHANGE THAT MOVES OR HIDES A PAGE BECOMES WORK. Step one has always existed: a redirect, a merge, a canonical or a de-index is minted `needs_review` and the queue says so. Step two did not, so every one of them was held for a confirmation nobody could give and none could ever be pasted. The operator reads the pieces, the addresses, the destination, the copy, the risks and the evidence on the change's own detail page and confirms THAT version. NOTHING IS TRUSTED FROM THE SCREEN: the row is re-read here and every gate is asked again at the moment of the mutation, because the page could have been open since before the copy was redrafted, before the cause was re-judged or before the bar moved. Never automatic: this runs on a press and on nothing else. */
export async function confirmDangerousChangeAction(args: { proposalId: string; version: string }): Promise<MarkProposalImplementedResponse> {
  if (!(await canPublishForCurrentTenant())) return { success: false, error: "You do not have permission to confirm this change." };
  if (!args.proposalId || !args.version) return { success: false, error: "No change was specified." };
  const tenantId = await currentTenantId();
  try {
    const basis = await resolveCurrentBasis(tenantId).catch(() => null);
    const stored = await loadChangeProposal(tenantId, args.proposalId).catch(() => null);
    if (stored == null) return { success: false, error: "That change could not be found, so nothing was confirmed." };
    if (!operatorUiPolicy.isManualEditProofWork(stored)) return { success: false, error: "Whole-page work is outside the current manual-edit proof, so it cannot be confirmed here." };
    if (stored.status !== "needs_review") return { success: false, error: "This one is not waiting for your confirmation. Open Changes for the work that stands today." };
    if (dangerousComponents(stored.bundle?.components ?? []).length === 0) return { success: false, error: "This one does not move or hide a page, so there is nothing here to confirm. It is being reviewed for another reason." };
    const stale = "This change has been rewritten since that screen was drawn, so your confirmation is not being applied to it. Open it again, read the new version, and confirm that one.";
    if (confirmedVersion(stored) !== args.version) return { success: false, error: stale };
    const done = await answerReviewedProposal(tenantId, args.proposalId, args.version, basis, { kind: "promote", at: new Date().toISOString() });
    if (done.status === "stale") return { success: false, error: stale };
    if (done.status === "refused") return { success: false, error: done.refusal! };
    if (done.status !== "promoted") { log.error("confirmDangerousChange: the confirmation did not land", { proposalId: args.proposalId }); return { success: false, error: "That could not be confirmed just now. Press it again in a moment." }; }
    await invalidateCoreSurfaces().catch(() => {});
    revalidatePath("/changes"); revalidatePath("/", "layout");
    return { success: true, note: "Confirmed. This change is ready to make, and the copy is on the card." };
  } catch (err) {
    log.error("confirmDangerousChange: failed", { proposalId: args.proposalId, error: err instanceof Error ? err.message : String(err) });
    return { success: false, error: "That could not be confirmed just now. Press it again in a moment." };
  }
}

/** THE OPERATOR'S ANSWER TO A DRAFT THEY READ. TWO ANSWERS, ONE DOOR: `approve` says the words are good enough to make and `improve` asks the next funded pass to write better ones over them. THE BOUNDARY IS SERVER-ENFORCED AND NOT A UI RULE: a human yes may answer EDITORIAL judgement (how it reads, whether anybody would hand it to a customer) and may never answer a fact about the work, so the row is re-read here, its own stored reasons are split into hard and soft by the ONE pure rule the card renders from, and a hard hold refuses with that exact reason. A change that moves or hides a page keeps its own version-bound confirmation and is refused here. The promotion itself is the SAME compare-and-set the confirmation uses: the yes binds to the exact version that was read, and a rewrite landing in between changes nothing. */
export async function reviewDraftAction(args: { proposalId: string; version: string; decision: "approve" | "improve" }): Promise<MarkProposalImplementedResponse> {
  if (!(await canPublishForCurrentTenant())) return { success: false, error: "You do not have permission to answer this draft." };
  if (!args.proposalId || !args.version) return { success: false, error: "No draft was specified." };
  const tenantId = await currentTenantId();
  try {
    const basis = await resolveCurrentBasis(tenantId).catch(() => null);
    const stored = await loadChangeProposal(tenantId, args.proposalId).catch(() => null);
    if (stored == null) return { success: false, error: "That draft could not be found, so nothing was changed." };
    if (!operatorUiPolicy.isManualEditProofWork(stored)) return { success: false, error: "Whole-page work is outside the current manual-edit proof, so it cannot be reviewed here." };
    if (stored.status !== "needs_review") return { success: false, error: "This one is not waiting on your review. Open Changes for the work that stands today." };
    const hold = openHold(stored);
    if (hold.lane === "research") return { success: false, error: "Nothing exact is written for this one yet, so there is no draft to answer. It is being researched and lands in your list as a change once the work is written." };
    const stale = "This draft has been rewritten since that screen was drawn, so your answer is not being applied to it. Open it again, read the new version, and answer that one.";
    if (confirmedVersion(stored) !== args.version) return { success: false, error: stale };
    const at = new Date().toISOString();
    if (args.decision === "approve") {
      if (hold.defects[0]) return { success: false, error: `This one is not yours to wave through: ${hold.defects[0]} Ask for a better draft instead, or skip it.` }; // every defect, not the hard arms alone: the store refuses the promotion on a typed fault too, so the press may not offer what the save refuses
      const who = (await getTenant(tenantId).catch(() => null))?.domain?.trim() || tenantId;
      const done = await answerReviewedProposal(tenantId, args.proposalId, args.version, basis, { kind: "promote", by: who, at });
      if (done.status === "stale") return { success: false, error: stale };
      if (done.status === "refused") return { success: false, error: done.refusal! };
      if (done.status !== "promoted") return { success: false, error: "That could not be approved just now. Press it again in a moment." };
    } else {
      const done = await answerReviewedProposal(tenantId, args.proposalId, args.version, basis, { kind: "redraft", at });
      if (done.status === "stale") return { success: false, error: stale };
      if (done.status !== "promoted") return { success: false, error: "That could not be sent back just now. Press it again in a moment." };
    }
    await invalidateCoreSurfaces().catch(() => {});
    revalidatePath("/changes"); revalidatePath("/", "layout");
    return { success: true, note: args.decision === "approve"
      ? "Approved. It is ready to make, the copy is on the card, and your name is on the approval."
      : "Sent back for better words. The next drafting pass writes over this one, and the draft you read stays here until it does." };
  } catch (err) {
    log.error("reviewDraft: failed", { proposalId: args.proposalId, error: err instanceof Error ? err.message : String(err) });
    return { success: false, error: "That could not be saved just now. Press it again in a moment." };
  }
}

export async function finishOneProposalAction(args: { proposalId: string; prepare?: boolean; authorizationId?: string }): Promise<MarkProposalImplementedResponse> {
  if (!(await canPublishForCurrentTenant())) return { success: false, error: "You do not have permission to finish this change." };
  if (!args.proposalId) return { success: false, error: "No change was specified." };
  const tenantId = await currentTenantId();
  try {
    if (args.prepare === true) {
      const currentBasis = await resolveCurrentBasis(tenantId);
      const result = await atomicProof.finishPage({ tenantId, proposalId: args.proposalId, currentBasis, maxOpenAiCalls: 8, maxOpenAiUsd: 2, maxDataForSeoCalls: 3, maxDataForSeoUsd: 0.4, ...(args.authorizationId !== undefined ? { authorizationId: args.authorizationId } : {}) });
      const a = result.allowance, receipt = a ? ` Authorized request ceilings: OpenAI $${a.modelReservedUsd.toFixed(4)}, DataForSEO $${a.externalReservedUsd.toFixed(4)}. These are reservations, not invoices.` : " No paid request was authorized.";
      await invalidateCoreSurfaces().catch(() => {}); revalidatePath("/changes"); revalidatePath("/", "layout");
      if (result.success) return { success: true, note: `A finished edit on this page is ready in Changes. Nothing was published.${receipt}` };
      if (result.reason === "openai_not_configured_in_this_runtime") return { success: false, error: "The writing service is not configured in this runtime. No finishing attempt or paid request was used." };
      if (["proof_admission_replayed", "proof_admission_resumed"].includes(result.reason)) return { success: false, error: "This page version already used its finishing attempt. No new provider request was authorized. Its saved work and receipts remain intact; research stays paused." };
      const saved = result.preferredRetiredReason === "missing" ? await loadChangeProposal(tenantId, args.proposalId, { canonicalOnly: true }).catch(() => null) : null, savedStep = currentBasis && saved?.id === args.proposalId && saved.tenantId === tenantId && saved.basis === currentBasis && saved.status === "needs_review" ? nextObligation(saved) : null, owed = result.preferredRetiredReason === "missing" ? savedStep?.kind === "evidence" ? savedStep.need : null : result.evidenceOwed?.find((need) => need.proposalId === result.proposalId || need.unlocks?.proposalId === result.proposalId);
      const refusal = result.reason === "saved_evidence_unreadable" ? "The saved page evidence is incomplete or unavailable, so this edit was not written." : result.preferredRetiredReason === "missing" ? owed ? "The exact edit still needs its named evidence before writing can finish." : "The current page plan no longer includes this exact edit."
        : result.preferredRetiredReason === "blocked" ? "The exact edit is held by a current evidence or safety requirement."
        : result.preferredRetiredReason === "settled" ? "This exact work was already settled on unchanged evidence."
        : result.preferredRetiredReason === "out_of_scope" ? "This edit now needs whole-page delivery, which this focused action cannot finish."
        : result.preferredOutcome === "evidence_required" || owed ? "The exact edit still needs its named evidence before writing can finish."
        : result.preferredOutcome === "review_saved" ? "The exact edit was saved for review and is not yet copy-ready."
        : result.preferredOutcome === "not_reached" ? "This run ended before the exact edit began."
        : result.preferredOutcome === "deterministic_refusal" ? "The exact edit failed a current copy or safety check."
        : "This attempt did not produce a finished edit.";
      const detail = owed ? ` Still needs ${owed.kind.replaceAll("_", " ")} for “${owed.query}”.` : "";
      const capture = result.captured ? " A complete current page capture was confirmed." : result.reason.startsWith("owned_capture_owed:") ? " A complete current page capture is still needed." : "";
      const calls = a?.modelCalls === 0 && a.externalCalls === 0 ? " This focused run made 0 provider calls." : "";
      return { success: false, error: `${refusal} Any collected evidence and unfinished copy remain saved.${capture}${detail}${calls}${receipt} Research stays paused.` };
    }
    const result = await atomicProof.run({ tenantId, proposalId: args.proposalId, currentBasis: await resolveCurrentBasis(tenantId), maxOpenAiCalls: 1, maxOpenAiUsd: 0.05 });
    const receipt = { providerCalls: result.meter?.providerCalls ?? 0, costUsd: result.meter?.costUsd ?? 0 };
    if (!result.success) {
      const used = result.reason === "proof_admission_resumed" || result.reason === "proof_admission_replayed", capped = result.reason.startsWith("proof_admission_refused_") || result.reason === "proof_admission_cap_refused", preflight = result.reason.startsWith("candidate_preflight:") ? result.reason.slice("candidate_preflight:".length) : null;
      const error = preflight ? `${preflight} No provider call was made.` : used
        ? "This exact version already had its one finishing attempt. Nothing else was charged."
        : capped ? "Today's internal spend breaker is still closed. No provider call was made."
        : result.reason === "openai_not_configured_in_this_runtime" ? "OpenAI is not configured in the runtime handling this press. No admission or provider call was used."
          : result.reason.startsWith("research_") ? "Research must stay paused while this one change is finished."
          : "This change did not become finished, paste-ready work. Nothing broader was run.";
      return { success: false, ...receipt, error: `${error} Receipt: ${receipt.providerCalls} OpenAI call${receipt.providerCalls === 1 ? "" : "s"}, $${receipt.costUsd.toFixed(receipt.costUsd > 0 && receipt.costUsd < 0.01 ? 6 : 2)}; DataForSEO $0.` };
    }
    await invalidateCoreSurfaces().catch(() => {});
    revalidatePath("/changes"); revalidatePath("/", "layout");
    const warning = result.reason === "stored_ready_but_admission_receipt_missing" ? " The work landed, but its $0 admission receipt did not; it will not run again." : "";
    return { success: true, ...receipt, note: `Finished. This exact change is ready to copy. ${receipt.providerCalls} OpenAI call${receipt.providerCalls === 1 ? "" : "s"}, $${receipt.costUsd.toFixed(receipt.costUsd > 0 && receipt.costUsd < 0.01 ? 6 : 2)}; DataForSEO $0.${warning}` };
  } catch (err) {
    log.error("finishOneProposal: failed", { proposalId: args.proposalId, error: err instanceof Error ? err.message : String(err) });
    return { success: false, error: "This change could not be finished just now. Nothing broader was run." };
  }
}

/** THE NEXT PAGE OF THE RANKED QUEUE. Read-only, ONE page, cut at a rank offset inside the release the caller names. A release replaced since is answered with the fresh first page and the sentence saying so. */
export async function loadMoreChangesAction(args: {
  lane: "ready" | "todo" | "all"; cursor: number; releaseId?: string | null;
}): Promise<ChangesPage> {
  const page = await readChangesPage(await currentTenantId(), args.lane, args.cursor, args.releaseId ?? null);
  const rows = page.rows.filter(operatorUiPolicy.isManualEditProofWork);
  return { ...page, rows, dropped: page.dropped + page.rows.length - rows.length };
}

/** One $0 stored-only release completion for a stale list already painted; a claimed rebuild gets one fresh reread, never a loop. */
export async function refreshStaleChangesAction(expectedRelease: string): Promise<boolean> {
  const tenantId = await currentTenantId(); if (!expectedRelease.startsWith(`${tenantId}:`)) return false;
  const started = Date.now(), fresh = (s: Awaited<ReturnType<typeof readCustomerSurface>>) => !!s && !isCustomerSurfaceStale(s.computedAt, Date.now());
  try { const now = await readCustomerSurface(tenantId, { forceRefresh: true }); if (fresh(now)) return true; if (!now) return false;
    const built = await refreshCustomerSurface(tenantId, { maxDrafts: 0 }); if (fresh(built)) return true;
    const remaining = 2_500 - (Date.now() - started); if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining)); return fresh(await readCustomerSurface(tenantId, { forceRefresh: true }));
  } catch { return false; }
}

/** THE operator's "put this aside": the one terminal disposition that means exactly that, dismissed. Not a rejection by Beacon and not a lifecycle stage, so the change keeps its status, stops being the current answer, and the store refuses to re-draft that hypothesis until the evidence moves. ONLY WORK STILL WAITING ON THEM: a change already marked implemented is being measured, and is refused in their own words. */
export async function dismissProposalAction(args: {
  proposalId: string;
}): Promise<MarkProposalImplementedResponse> {
  const action = "dismissProposal";
  if (!(await canPublishForCurrentTenant())) {
    return { success: false, error: "You do not have permission to change this." };
  }
  if (!args.proposalId) return { success: false, error: "No change was specified." };
  const tenantId = await currentTenantId();
  try {
    const stored = await loadChangeProposal(tenantId, args.proposalId).catch(() => null);
    if (stored == null) return { success: false, error: "That change could not be found, so it was not skipped." };
    if (!operatorUiPolicy.isManualEditProofWork(stored)) return { success: false, error: "Whole-page work is outside the current manual-edit proof, so it was not changed." };
    if (stored.status === "implemented_pending_verification") {
      return { success: false, error: "You already marked this one done, so it is being measured. It cannot be skipped while a reading is running." };
    }
    if (!(await dismissChangeProposal(tenantId, args.proposalId))) {
      return { success: false, error: "That one could not be skipped just now. Press it again in a moment." };
    }
    await invalidateCoreSurfaces().catch(() => {});
    revalidatePath("/changes");
    revalidatePath("/", "layout");
    log.info("Action completed", { action, params: { proposalId: args.proposalId } });
    return { success: true };
  } catch (err) {
    log.error("dismissProposal: failed", { proposalId: args.proposalId, error: err instanceof Error ? err.message : String(err) });
    return { success: false, error: "That one could not be skipped just now. Press it again in a moment." };
  }
}
