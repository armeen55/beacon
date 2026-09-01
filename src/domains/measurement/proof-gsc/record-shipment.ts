import "server-only";

/**
 * record-shipment - THE ONE DOOR THAT WRITES A SHIPMENT, and the seam every surface presses through.
 *
 * AN IMPLEMENTATION FACT IS A FACT. The recording path used to refuse a true implementation when it
 * could not find enough comparison pages, so a change the operator really made left no record at all
 * and the queue offered it back the next morning. Two different facts were fused into one decision:
 * WHAT WAS APPLIED (the operator's work, always true, always recorded) and WHETHER IT CAN BE FAIRLY
 * COMPARED (a fact about Search data, which arrives late, arrives partly, or never arrives). The
 * second one is now written down beside the first as `measurementState` and never blocks it.
 *
 * WHAT STILL STOPS A WRITE: not being able to read or write the ledger at all. That throws, because
 * the caller must not flip a proposal over a Shipment that did not land. Nothing else stops it.
 *
 * IDEMPOTENT. The row id is derived from the proposal and the exact version applied, so a second
 * press finds the row already on file and hands back the same id with nothing rewritten: the stamp,
 * the starting numbers and the live check all stand exactly as they were.
 *
 * ORDERING. This writes the Shipment. The caller flips the proposal AFTERWARDS, never before: a
 * crash between the two leaves a Shipment nobody flipped, which the next press heals, where the
 * reverse leaves a change marked done that nothing on earth is measuring.
 */

import { createHash } from "node:crypto";

import { log } from "@/lib/logger";
import { MIN_CONTROLS } from "./kernel";
import { readLastFinalizedDate } from "./gsc-window";
import { matchedControlsFor, recordShippedChange } from "./measure-pass";
import type { ControlReceipt } from "./contamination";
import { loadShippedChangesForTenant, upsertShippedChange, type ShippedChangeRecord } from "./shipped-change-store";
import type { ShipmentObjective } from "../shipment-ai-outcome";
import type { MeasurementState } from "./types";

/** What one applied piece carries: its kind, its label, and the EXACT copy the live check compares
 *  the page against. Structural on purpose, so Measurement never names a Decision type. */
type ShipmentComponent = NonNullable<ShippedChangeRecord["componentsApplied"]>[number];

/** THE FROZEN RETURN. The id of the row that now holds this implementation, and whether a fair
 *  comparison exists for it. `measurement` is never an error: the row is on file in every case. */
export type RecordedShipment = { shipmentId: string; measurement: MeasurementState };

/** The facts about one implementation, all of them from the caller. Measurement reads no proposal. */
type ShipmentFacts = {
  /** A batch row asks the store not to invalidate the saved surfaces; the batch does it once. */
  invalidate?: boolean;
  /** The batch's one read of the open changes, for the treatment stamp and the comparison set. */
  openPaths?: readonly string[];
  ledger?: readonly ShippedChangeRecord[];
  tenantId: string;
  proposalId: string;
  /** The exact version of the copy applied. Same proposal + same version = the same row, always. */
  proposalVersion: string;
  page: string;
  path: string;
  actionType: string;
  before: string | null;
  after: string | null;
  targetQueries: string[];
  basis: string | null;
  caseId: string | null;
  bundleHypothesis: string;
  componentsApplied: ShipmentComponent[];
  /** The ONE metric this change was made to move. Recorded, never re-derived. */
  judgedMetric?: ShipmentObjective | null;
  /** THE STAMP: when the change actually went live. Defaults to now for a press made as it happens. */
  implementedAt?: string;
  preChangeContentHash?: string | null;
  operatorNote?: string | null;
  /** THE EXACT AI SCOPE the proposal targeted, typed, never flattened into targetQueries: the case identity
   *  every surface joins on, the exact prompt ids and wordings, the assistants, the fan-out cluster and the
   *  answers the claim was minted from. Results remeasures exactly this, and the baseline is frozen over it.
   *  `models` and `modes` ride along RECORDED and never filter. */
  aiScope?: ShippedChangeRecord["aiScope"];
  /** WHAT KIND OF WORK THIS IS, and what else was already being measured on this page at the press. Handed in whole because the caller is the only place the proposal still exists; this door carries it to the row and never reads inside it. */
  treatmentStamp?: ShippedChangeRecord["treatmentStamp"];
  now?: Date;
};

/**
 * CAN THIS ONE BE FAIRLY COMPARED? Asked BEFORE the write and answered without ever refusing it.
 * Never throws: every read degrades to the honest state rather than to an exception, because the
 * only thing this answer may change is what Results says, not whether the work is recorded.
 */
async function comparisonFor(
  tenantId: string, treatedPage: string, stamp: string, now: Date, batch?: Parameters<typeof matchedControlsFor>[4],
): Promise<{ controlPages: string[]; controlsReceipt: ControlReceipt[] | null; measurement: MeasurementState }> {
  // NULL is a read that FAILED, which is a different sentence from a site that genuinely has too few
  // pages: telling a connected operator to connect Search Console asks for what they already did.
  const matched = await matchedControlsFor(tenantId, treatedPage, stamp.slice(0, 10), now, batch).catch(() => null);
  if (matched == null) return { controlPages: [], controlsReceipt: null, measurement: "measurement_unavailable" };
  const held = { controlPages: matched.controls, controlsReceipt: matched.receipts };
  // No finalized Search data at all means there is nothing to read this page against, whatever the
  // comparison set looks like, so it is named first.
  const finalized = await readLastFinalizedDate(tenantId).catch(() => null);
  if (finalized == null) return { ...held, measurement: "measurement_unavailable" };
  if (matched.controls.length < MIN_CONTROLS) return { ...held, measurement: "insufficient_comparison" };
  return { ...held, measurement: "measuring" };
}

/** The row already holding this exact implementation, or null. Fail-closed: a ledger that could not
 *  be read THROWS rather than answering "there is nothing there", because writing blind over a real
 *  record would reset its live check and move its ship date. */
async function heldShipment(f: Pick<ShipmentFacts, "tenantId" | "proposalId" | "proposalVersion">, preloaded?: readonly ShippedChangeRecord[]): Promise<ShippedChangeRecord | null> {
  const ledger = preloaded ?? await loadShippedChangesForTenant(f.tenantId);
  return ledger.find((r) => r.proposalId === f.proposalId && r.proposalVersion === f.proposalVersion) ?? null;
}

/** The write both doors share: capture the baseline, store the row, hand back what landed. */
async function write(
  f: ShipmentFacts,
  extra: { measurement: MeasurementState; controlPages: string[]; controlsReceipt: ControlReceipt[] | null; preChangeHashUnavailable: boolean },
): Promise<RecordedShipment> {
  const now = f.now ?? new Date();
  const stamp = f.implementedAt ?? now.toISOString();
  const record = await recordShippedChange({
    tenantId: f.tenantId, page: f.page, path: f.path, actionType: f.actionType,
    before: f.before, after: f.after, targetQueries: f.targetQueries,
    controlPages: extra.controlPages, controlsReceipt: extra.controlsReceipt,
    // THE WINDOW IS READ FROM THE STAMP, and so is the 28 days before it: a change recorded weeks
    // after it went live must compare against the days that really preceded it, not against today.
    shippedAt: stamp, notes: null, measurementState: extra.measurement, judgedMetric: f.judgedMetric ?? null, now, openPaths: f.openPaths, ledger: f.ledger,
    shipment: {
      proposalId: f.proposalId, proposalVersion: f.proposalVersion, basis: f.basis, caseId: f.caseId,
      bundleHypothesis: f.bundleHypothesis, componentsApplied: f.componentsApplied,
      implementedAt: stamp, preChangeContentHash: f.preChangeContentHash ?? null,
      preChangeHashUnavailable: extra.preChangeHashUnavailable,
      operatorNote: f.operatorNote?.trim() || null,
      aiScope: f.aiScope ?? null, treatmentStamp: f.treatmentStamp ?? null,
    },
  });
  // A baseline nobody could capture is a baseline gap, said out loud rather than left as a zero, and the
  // STORED row carries the same state the operator is told: writing "measuring" while reporting
  // "measurement_unavailable" left the ledger claiming a comparison it could never make.
  const measurement: MeasurementState = extra.measurement === "measuring" && record.shipmentBaseline == null
    ? "measurement_unavailable" : extra.measurement;
  record.measurementState = measurement;
  await upsertShippedChange(record, f.tenantId, { invalidate: f.invalidate !== false }); // a batch invalidates once, after its last row
  if (measurement !== extra.measurement || measurement !== "measuring") {
    log.info("[shipment] recorded, and the comparison it can carry", {
      tenant: f.tenantId, id: record.id, measurement });
  }
  return { shipmentId: record.id, measurement };
}

/**
 * RECORD ONE IMPLEMENTATION. Always writes, whatever the data situation is. Returns the row's id and
 * whether it can be fairly compared; a second press on the same proposal and version returns the row
 * already on file, unchanged.
 */
export async function recordShipment(facts: ShipmentFacts, opts?: { /** THE BATCH'S ONE LEDGER READ, handed through so a twenty-card press reads the ledger once instead of twenty-one times. The duplicate check stays exactly as strict: the preload IS the ledger, read by the same loader moments earlier. */ preloadedLedger?: readonly ShippedChangeRecord[];
  /** THE BATCH'S ONE READ OF THE OPEN CHANGES, for the comparison set's contamination rule; without it every row re-read the whole proposal store. */ openPaths?: readonly string[];
  /** FALSE = the caller invalidates the saved surfaces once for the whole batch. */ invalidate?: boolean }): Promise<RecordedShipment> {
  const held = await heldShipment(facts, opts?.preloadedLedger);
  if (held != null) {
    log.info("[shipment] this exact change is already recorded, so its record was left alone", {
      tenant: facts.tenantId, proposalId: facts.proposalId, shipment: held.id });
    return { shipmentId: held.id, measurement: held.measurementState ?? "measuring" };
  }
  const now = facts.now ?? new Date();
  const { controlPages, controlsReceipt, measurement } =
    await comparisonFor(facts.tenantId, facts.page, facts.implementedAt ?? now.toISOString(), now, { ledger: opts?.preloadedLedger, open: opts?.openPaths });
  return write({ ...facts, invalidate: opts?.invalidate, openPaths: opts?.openPaths, ledger: opts?.preloadedLedger }, { measurement, controlPages, controlsReceipt, preChangeHashUnavailable: false });
}

/** What the operator can tell Beacon about a change that was already live before it was ever recorded. */
type RepairFacts = {
  tenantId: string;
  proposalId: string;
  /** THE DAY IT ACTUALLY WENT LIVE, in the operator's own account of it. Every window counts from here. */
  implementedAt: string;
  /** The wording that is on the page now. The live check looks FORWARD for exactly this. */
  finalWording: string;
  /** Where on the page it went, in their words. */
  placement: string;
  /** How they applied it, in their words. */
  source: string;
  componentsApplied: ShipmentComponent[];
  /** The page identity, supplied by the caller: Measurement never reads a Decision record. */
  page: string;
  path: string;
  actionType: string;
  targetQueries?: string[];
  now?: Date;
};

/**
 * THE REPAIR DOOR. One narrow, tenant-scoped way to record a change that went live before anything
 * wrote it down, built ENTIRELY from what the operator supplies.
 *
 * NOTHING IS INVENTED. `before` is null and the row is marked `preChangeHashUnavailable`, because no
 * snapshot of the page as it stood beforehand exists and none will: the live check compares FORWARD
 * only, against the wording the operator says is there, and no before-state is ever claimed for it.
 * The 28-day baseline is recomputed from Search data ALREADY SYNCED over the days that really
 * preceded the stamp; when there is none, the starting point stays null and the measurement state
 * says so. Idempotent on (proposal, version) exactly like the ordinary door.
 */
export async function recordRepairShipment(facts: RepairFacts): Promise<RecordedShipment> {
  const wording = facts.finalWording.trim();
  // The version is derived from the operator's own account, so running the repair twice with the same
  // account of it lands on the same row instead of minting a second record of one change.
  const version = `repair-${createHash("sha256")
    .update(JSON.stringify([wording, facts.implementedAt, facts.componentsApplied.map((c) => c.kind)]))
    .digest("hex").slice(0, 12)}`;
  const base = { tenantId: facts.tenantId, proposalId: facts.proposalId, proposalVersion: version };
  const held = await heldShipment(base);
  if (held != null) return { shipmentId: held.id, measurement: held.measurementState ?? "verification_needed" };
  // A single piece with no wording of its own gets the wording the operator says is live, because the
  // check needs something concrete to look for. A list of several is passed through untouched.
  const components = facts.componentsApplied.length === 1 && !facts.componentsApplied[0]!.after
    ? [{ ...facts.componentsApplied[0]!, after: wording }] : facts.componentsApplied;
  const { controlPages, controlsReceipt, measurement } =
    await comparisonFor(facts.tenantId, facts.page, facts.implementedAt, facts.now ?? new Date());
  return write({
    ...base, page: facts.page, path: facts.path, actionType: facts.actionType,
    before: null, after: wording, targetQueries: facts.targetQueries ?? [],
    basis: null, caseId: null,
    bundleHypothesis: "Recorded after the change was already live, from what the operator applied.",
    componentsApplied: components, implementedAt: facts.implementedAt, preChangeContentHash: null,
    operatorNote: `Applied by the operator before this was recorded. Placement: ${facts.placement.trim()}. Source: ${facts.source.trim()}.`,
    now: facts.now,
  }, {
    // A repair holds no before-state and its page has not been read, so even a full comparison set
    // does not make it "measuring": the live check is owed first, and the row says which one it is.
    measurement: measurement === "measuring" ? "verification_needed" : measurement,
    controlPages, controlsReceipt, preChangeHashUnavailable: true,
  });
}
