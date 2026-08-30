/**
 * treatment-learning - WHAT EACH KIND OF WORK HAS ACTUALLY RETURNED ON THIS ACCOUNT, off its own ledger and nothing else. PURE: no I/O, no
 * kernel, no clock, deterministic from the rows handed in.
 *
 * THE QUESTION NOBODY COULD ASK BEFORE. Two files computed a track record, both keyed on the coarse action family alone, and a family is not
 * a bet: an answer block added because assistants never read the page and an answer block added because the opening buried the answer counted
 * as the same kind of change, so a treatment that has never worked here was ranked on the record of one that has. The SIGNATURE is the finer
 * identity, stamped at the press where the family, the treatment, the field and the diagnosed cause are all still in hand.
 *
 * WHOSE READING MAY COUNT. A Shipment is a claim until the live check finds the change on the page, so an unverified one is work SHIPPED and
 * never work that moved anything. A row carrying no stamp at all predates that check entirely: nothing was ever owed one, and refusing those
 * would delete this account's whole track record, because all twenty five settled readings on file today are pre-stamp rows.
 *
 * THIS RETURNS NUMBERS AND NOT SENTENCES. Whether three finished readings may be called evidence is the surface's sentence to write, and
 * `early` plus `overlapping` are the two facts it needs to write it honestly. Nothing here is observational language.
 */

import { actionFamilyOf } from "./proof-gsc/change-family";
import type { ShippedChangeRecord } from "./proof-gsc/shipped-change-store";
import type { TreatmentSignature } from "./proof-gsc/types";

/** WHAT THIS READS OFF A SHIPMENT, and nothing else, so the live ledger, a replay and a test all present the same handful of fields. Type
 *  only, which is why importing the store here pulls no server module into this pure file. */
type LearningRow = Pick<ShippedChangeRecord,
  "actionType" | "after" | "windows" | "implementedAt" | "verification" | "operatorVerdictOverride" | "pinnedRead" | "treatmentStamp" | "componentsApplied">;

/** ONE GROUP: every shipment sharing a family and a treatment, and what became of them. `family` is null on the one group that exists only
 *  when a row names no kind of work at all; those are reported as unsigned rather than filed under a family somebody guessed. */
export type TreatmentGroup = {
  /** `family::treatment`, or `unsigned`. Stable, so a surface can key rows on it across renders. */
  key: string;
  family: string | null;
  treatment: string | null;
  /** Every change of this kind the operator marked done, whatever happened next. */
  shipped: number;
  /** Of those, the ones whose reading may count at all: the change was found on the page, or the row predates the live check. */
  verified: number;
  /** Finished readings that moved the page up, down, and neither. An operator who pinned a row out of learning, and a reading whose credit is
   *  shared with a later change on the same page, are both inconclusive: neither is a result this kind of work may claim. */
  ahead: number; behind: number; inconclusive: number;
  /** Rows from before live verification existed: shown as history, never counted as verified and never taught from. */ legacy: number;
  /** How many finished readings are behind the two numbers below. Never the number shipped. */
  sampleSize: number;
  /** The measured clicks these readings moved against comparable pages, summed and at the middle. Null with no finished reading at all: an
   *  average of nothing is not zero. */
  netEffect: number; medianEffect: number | null;
  /** Under five finished readings this is a story and not a measurement, and the consumer has to say so. */
  early: boolean;
  /** Of the finished readings, how many landed on a page that was already carrying other changes of theirs. The number still stands; what it
   *  cannot claim is that one edit caused all of it. */
  overlapping: number;
};

/** The one group for rows whose own record does not say what kind of work they were. */
const UNSIGNED = "unsigned";
/** A reading only counts once its window has closed at or past the longest reading Beacon takes. */
const SETTLED_WINDOW_DAYS = 28;
/** A SHIPMENT WHOSE RECORDED WORDING STILL CARRIES BLANKS IS NOT WHAT WENT LIVE: two pages hold "population of NUMBER as of YEAR (SOURCE)" on
 *  the ledger while the live pages hold real figures the operator typed, so the stored copy is a template and it votes on nothing. */
const TEMPLATE_BLANKS = /\[[^\]]*\]|_{3,}|\b(?:NUMBER|YEAR|SOURCE|TBD|XXX+)\b/;
/** The only two answers that mean the change was really found on the page. A claim, a note and a legacy override row are all "not read yet". */
const CONFIRMED: ReadonlySet<string> = new Set(["verified", "partially_verified"]);
/** Finished readings before a group stops being early. Five is the smallest sample at which a median is not simply the loudest reading. */
const EARLY_UNDER = 5;
/** HOW HARD A SMALL SAMPLE IS PULLED TOWARDS NOTHING before it may order anything, which is what the ranking's own comment demands of this
 *  input: n/(n+5) hands over a sixth of the record at one reading, half of it at five, and converges on the whole of it as readings pile up.
 *  So a thin record can never decide the queue and a real one is never erased. */
const SHRINK = 5;

/** The middle of a set of readings, or null when there are none. Even counts take the midpoint of the two middle readings. */
function medianOf(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

/** THE ONE FINISHED READING on a row, in clicks against comparable pages, or null. Longest window wins, and it has to have actually run, have
 *  had real comparison pages behind it, and have closed at or past the horizon. Same rule the ranking has always read, kept identical on
 *  purpose: this file changes WHAT is grouped, never what counts as a reading. */
function settledLift(r: LearningRow): number | null {
  if (TEMPLATE_BLANKS.test(r.after ?? "")) return null;
  const w = [...(r.windows ?? [])]
    .filter((x) => x.ran && (x.controlsUsed ?? 0) > 0 && x.adjustedLift != null && x.day >= SETTLED_WINDOW_DAYS)
    .sort((a, b) => b.day - a.day)[0];
  return w ? Math.round(w.adjustedLift) : null;
}

/** Whether this row's reading may count at all. See the header: an unverified Shipment is a claim, and a row with no stamp was never owed a
 *  check, so refusing it would throw away the only track record this account has. */
/** The one eligibility rule for POLICY numbers (operator, 2026-08-30): only a live-confirmed reading may teach. A legacy row (no recorded implementation moment) is honestly labelled history and never verified; verified-only means verified. */

/**
 * THE SIGNATURE OF ONE SHIPMENT: the stamp if it carries one, otherwise as much of it as the row's own stored fields can honestly carry.
 * BACKFILL HAPPENS HERE, ON READ, and never in a script: a pre-stamp row still records what family of change it was, and a row that applied
 * exactly one piece still records which field that piece wrote. The treatment and the diagnosed cause were never stored on those rows and are
 * returned as null rather than inferred from the copy. A row that does not even name a family returns null and is reported as unsigned.
 */
export function signatureOfShipment(r: LearningRow): TreatmentSignature | null {
  if (r.treatmentStamp) return r.treatmentStamp.signature;
  const family = (r.actionType ?? "").trim();
  if (!family) return null;
  const kinds = (r.componentsApplied ?? []).map((c) => (c.kind ?? "").trim()).filter(Boolean);
  return { family, treatment: null, field: kinds.length === 1 ? kinds[0]! : null, cause: null };
}

/**
 * WHAT EACH KIND OF WORK HAS DONE HERE, grouped by family and treatment. Every row counts towards `shipped`; only a countable row with a
 * finished reading reaches the effect numbers. Groups come back in the order their first row appeared, so the caller decides the ordering.
 */
export function treatmentLearning(rows: readonly LearningRow[]): TreatmentGroup[] {
  type Acc = Omit<TreatmentGroup, "key" | "sampleSize" | "netEffect" | "medianEffect" | "early"> & { effects: number[] };
  const acc = new Map<string, Acc>();
  for (const r of rows) {
    const sig = signatureOfShipment(r);
    // GROUPED ON THE COARSE FAMILY, never on the raw action word: `edit_title`, `title` and `title_meta_rewrite` are one bet spelled three
    // ways, and grouping on the spelling would scatter a real record across single-row groups that can never leave `early`.
    const family = sig ? actionFamilyOf(sig.family) : null;
    const key = family == null ? UNSIGNED : `${family}::${sig!.treatment ?? ""}`;
    const g = acc.get(key)
      ?? { family, treatment: sig?.treatment ?? null, shipped: 0, verified: 0, legacy: 0, ahead: 0, behind: 0, inconclusive: 0, overlapping: 0, effects: [] };
    g.shipped += 1;
    // A LEGACY ROW IS HISTORY, NEVER A TEACHER (operator, 2026-08-30): rows from before live verification existed were counting as verified and training rank. They keep their own honestly labelled count and touch nothing else.
    if (r.implementedAt == null) { g.legacy += 1; acc.set(key, g); continue; }
    if (!CONFIRMED.has(r.verification?.status ?? "")) { acc.set(key, g); continue; }
    g.verified += 1;
    const lift = settledLift(r);
    if (lift != null) {
      if ((r.treatmentStamp?.overlapAtShip ?? 0) > 0) g.overlapping += 1;
      // MUTED AND ZERO READINGS ARE HISTORY, NEVER SAMPLES (operator, 2026-08-30): an operator's inconclusive pin, a confounded frozen reading, and a clean no-movement each increment the visible count and enter NO effect, sample, median, or family history. They used to be pushed into effects first and excluded only from the direction tally, so three confounded readings could still swing a treatment's net.
      const muted = r.operatorVerdictOverride === "inconclusive" || r.pinnedRead?.verdict === "confounded";
      if (muted || lift === 0) g.inconclusive += 1;
      else { g.effects.push(lift); if (lift > 0) g.ahead += 1; else g.behind += 1; }
    }
    acc.set(key, g);
  }
  return [...acc].map(([key, g]) => ({
    key, family: g.family, treatment: g.treatment, shipped: g.shipped, verified: g.verified, legacy: g.legacy,
    ahead: g.ahead, behind: g.behind, inconclusive: g.inconclusive, overlapping: g.overlapping,
    sampleSize: g.effects.length, netEffect: g.effects.reduce((a, b) => a + b, 0), medianEffect: medianOf(g.effects),
    early: g.effects.length < EARLY_UNDER,
  }));
}

/**
 * THE ADAPTER THE RANKING EATS. Its input is a map of coarse family to finished readings and the net clicks they moved, and its own comment
 * says that record must be shrunk hard towards nothing, so the shrink is applied HERE rather than left for the ranking to remember: the
 * treatments inside a family are summed back together, because the ranking has no place to put a treatment and adapting to it is the whole
 * job. Verified readings only, by construction: nothing without a finished reading reaches `sampleSize` above.
 */
export function familyHistoryFromShipments(rows: readonly LearningRow[]): Map<string, { readings: number; netLift: number }> {
  const out = new Map<string, { readings: number; netLift: number }>();
  for (const g of treatmentLearning(rows)) {
    if (g.family == null || g.sampleSize === 0) continue;
    const cur = out.get(g.family) ?? { readings: 0, netLift: 0 };
    out.set(g.family, { readings: cur.readings + g.sampleSize, netLift: cur.netLift + g.netEffect });
  }
  for (const [family, v] of out) out.set(family, { readings: v.readings, netLift: Math.round(v.netLift * v.readings / (v.readings + SHRINK)) });
  return out;
}
