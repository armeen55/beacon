/**
 * treatment-learning - WHAT EACH KIND OF WORK HAS ACTUALLY RETURNED ON THIS ACCOUNT, off its own ledger and nothing else. PURE: no I/O, no clock, deterministic from the rows handed in; the ONE eligibility verdict it reads is the measurement kernel's own rule over the stored window (proof-gsc/types), which is a leaf with no imports of its own.
 * THE QUESTION NOBODY COULD ASK BEFORE. Two files computed a track record, both keyed on the coarse action family alone, and a family is not a bet: an answer block added because assistants never read the page and an answer block added because the opening buried the answer counted as the same kind of change, so a treatment that has never worked here was ranked on the record of one that has. The SIGNATURE is the finer identity, stamped at the press where the family, the treatment, the field and the diagnosed cause are all still in hand.
 * WHOSE READING MAY COUNT. A Shipment is a claim until the live check finds the change on the page, so an unverified one is work SHIPPED and never work that moved anything. A row carrying no stamp at all predates that check entirely: nothing was ever owed one, and refusing those would delete this account's whole track record, because all twenty five settled readings on file today are pre-stamp rows. The one eligibility rule for POLICY numbers (operator, 2026-08-30): only a live-confirmed reading may teach, and a legacy row (no recorded implementation moment) is honestly labelled history and never verified. Verified-only means verified.
 * THIS RETURNS NUMBERS AND NOT SENTENCES. Whether three finished readings may be called evidence is the surface's sentence to write, and `early` plus `overlapping` are the two facts it needs to write it honestly. Nothing here is observational language.
 */

import { actionFamilyOf } from "./proof-gsc/change-family";
import type { ShippedChangeRecord } from "./proof-gsc/shipped-change-store";
import { learningEligibility, type TreatmentSignature } from "./proof-gsc/types";

/** WHAT THIS READS OFF A SHIPMENT, and nothing else, so the live ledger, a replay and a test all present the same handful of fields. Type only, which is why importing the store here pulls no server module into this pure file. `baseline` is what the page was already earning, the only thing that turns a reading of plus ten clicks into a percentage anybody can compare, and it is optional because a caller who only wants the family off a row has no page in hand at all. */
type LearningRow = Pick<ShippedChangeRecord, "actionType" | "after" | "windows" | "implementedAt" | "verification" | "operatorVerdictOverride" | "pinnedRead" | "treatmentStamp" | "componentsApplied"> & Partial<Pick<ShippedChangeRecord, "baseline" | "measurementState" | "controlsReceipt">>;

/** ONE GROUP: every shipment sharing a family and a treatment, and what became of them. `family` is null on the one group that exists only when a row names no kind of work at all; those are reported as unsigned rather than filed under a family somebody guessed. */
export type TreatmentGroup = {
  /** `family::treatment`, or `unsigned`. Stable, so a surface can key rows on it across renders. */
  key: string;
  family: string | null;
  treatment: string | null;
  /** Every change of this kind the operator marked done, whatever happened next. */
  shipped: number;
  /** Of those, the ones whose reading may count at all: the change was found on the page, or the row predates the live check. */
  verified: number;
  /** Finished readings that moved the page up, down, and neither. `inconclusive` counts every reading that names NO DIRECTION: an operator's pin, a reading whose credit is shared with a later change on the same page, and a clean no-movement. The first two claim nothing and are also kept out of the numbers below; the third is a measured answer and is one of the readings `sampleSize` counts. */
  ahead: number; behind: number; inconclusive: number;
  /** Rows from before live verification existed: shown as history, never counted as verified and never taught from. */ legacy: number;
  /** How many finished readings are behind the two numbers below. Never the number shipped. A window closed at 14 days is one of them, and so is one that measured no movement at all. */
  sampleSize: number;
  /** The measured clicks these readings moved against comparable pages, summed and at the middle. Null with no finished reading at all: an average of nothing is not zero. */
  netEffect: number; medianEffect: number | null;
  /** Under five readings that have run the full 28 days this is a story and not a measurement, and the consumer has to say so. A reading closed at 14 days moves the numbers above and never clears this: an early lean is not a result. */
  early: boolean;
  /** Of the finished readings, how many landed on a page that was already carrying other changes of theirs. The number still stands; what it cannot claim is that one edit caused all of it. */
  overlapping: number;
  /** THE ONE CREDIBLE STATEMENT THIS KIND OF WORK HAS EARNED, in percent against what these pages were already earning, with how far either way it could honestly sit. Null under three usable readings: an average of almost nothing is not a measurement. */ estimate: { percent: number; low: number; high: number } | null;
};

/** The one group for rows whose own record does not say what kind of work they were. */
const UNSIGNED = "unsigned";
/** A READING COUNTS ONCE ITS WINDOW HAS CLOSED AT THE FIRST REAL CHECKPOINT, AND A WIN IS STILL ONLY CALLED AT THE LAST (operator, 2026-09-03): waiting for 28 days meant this engine learned nothing from one month's shipments in time to aim the next month's, so a wave of edits could never inform the wave behind it. Fourteen days of closed, comparison-backed data is a reading and enters the numbers; it is not a verdict, which is why the group stays early until five readings have run the full 28. */
const FIRST_READING_DAYS = 14, MATURE_WINDOW_DAYS = 28;
/** A SHIPMENT WHOSE RECORDED WORDING STILL CARRIES BLANKS IS NOT WHAT WENT LIVE: two pages hold "population of NUMBER as of YEAR (SOURCE)" on the ledger while the live pages hold real figures the operator typed, so the stored copy is a template and it votes on nothing. */
const TEMPLATE_BLANKS = /\[[^\]]*\]|_{3,}|\b(?:NUMBER|YEAR|SOURCE|TBD|XXX+)\b/;
/** The only two answers that mean the change was really found on the page. A claim, a note and a legacy override row are all "not read yet". */
const CONFIRMED: ReadonlySet<string> = new Set(["verified", "partially_verified"]);
/** Readings that have run the full 28 days before a group stops being early. Five is the smallest sample at which a median is not simply the loudest reading, and a 14 day reading is not one of the five. */
const EARLY_UNDER = 5;
/** HOW HARD A SMALL SAMPLE IS PULLED TOWARDS NOTHING before it may order anything, which is what the ranking's own comment demands of this input: n/(n+5) hands over a sixth of the record at one reading, half of it at five, and converges on the whole of it as readings pile up. So a thin record can never decide the queue and a real one is never erased. */
const SHRINK = 5;
/** THREE READINGS BEFORE ONE NUMBER IS SAID OUT LOUD, ten clicks of standing before a reading is one of the three, and a reading never moved further than one of its own standard errors however far out it sits. The exposure floor is the honest half of a percentage: a page that was earning two clicks cannot report a percent, only noise wearing one. */
const POOL_MIN = 3, MIN_EXPOSURE = 10, PULL_LIMIT = 1;

/**
 * ONE NUMBER FOR ONE KIND OF WORK, out of readings that disagree with each other. Each reading is read as a rate: the clicks the page ended up with against the clicks it was already earning, so 100 to 110 and 10 to 11 both read as plus ten percent and the second is worth far less. Closed form, moment estimators only, no optimizer.
 * `mu` is the pooled rate over every click involved. `spread` is how much these pages genuinely differ once the noise inherent in counting clicks is taken back out, and a negative answer means they do not differ at all and clamps to zero, which pools every reading into the one rate. `w` then hands each reading exactly as much of its own extremity back as its exposure has earned. THE CAP IS THE GUARD: no reading is pulled further than one of its own standard errors, so a page that really did triple is quieted and never erased, which is the whole difference between an estimate and an average.
 * THE ANSWER IS THE PLAIN MEAN of the corrected readings and never a click-weighted one. The question is what the next edit of this kind returns, not what the biggest page did; exposure is already inside `w`, and weighting by it a second time makes `w` a no-op and hands the answer to whichever page is largest. Measured on the fixture below: click-weighted, the guard moved the number by a tenth of a point and was decoration.
 */
function pooledRate(reads: readonly { lift: number; base: number }[]): TreatmentGroup["estimate"] {
  const r = reads.filter((x) => x.base >= MIN_EXPOSURE);
  if (r.length < POOL_MIN) return null;
  const n = r.length, exposure = r.reduce((s, x) => s + x.base, 0), earned = r.map((x) => Math.max(0, x.base + x.lift));
  const mu = earned.reduce((s, y) => s + y, 0) / exposure, rate = r.map((x, i) => earned[i]! / x.base);
  const spread = Math.max(0, (r.reduce((s, x, i) => s + x.base * (rate[i]! - mu) ** 2, 0) - n * mu) / exposure);
  let est = 0, own = 0, pooled = 0;
  r.forEach((x, i) => {
    const noise = mu / x.base, w = spread + noise > 0 ? spread / (spread + noise) : 0, cap = PULL_LIMIT * Math.sqrt(noise);
    est += rate[i]! + Math.max(-cap, Math.min(cap, (rate[i]! - mu) * (w - 1))); own += w ** 2 / x.base; pooled += 1 - w;
  });
  est /= n;
  const half = 2 * Math.sqrt((mu * own) / n ** 2 + (pooled / n) ** 2 * (mu / exposure)), percentOf = (v: number) => Math.round((v - 1) * 100);
  return { percent: percentOf(est), low: percentOf(est - half), high: percentOf(est + half) };
}

/** The middle of a set of readings, or null when there are none. Even counts take the midpoint of the two middle readings. */
function medianOf(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

/** THE ONE FINISHED READING on a row, in clicks against comparable pages, with the day it closed on, or null. Longest window wins, so a row whose 28 day window has since closed is read at 28 and never counted twice, and it still has to have actually run, have had real comparison pages behind it, and have closed at or past the first checkpoint. A READING TAKEN AGAINST THE SITE'S OWN MOVEMENT IS REFUSED HERE whatever day it closed on (reviewer, 2026-09-03): too few untouched pages matched, so on the very day a whole family ships at once that comparison subtracts the shared gain from itself and reports that nothing moved. Learning from it would teach this engine that the work does nothing, when what happened is that the comparison went blind. It still renders on its own row. The DAY rides out too: one reading owes the caller two answers, whether it may move the numbers and whether it may end the early standing. */
function settledLift(r: LearningRow): { lift: number; day: number } | null {
  if (TEMPLATE_BLANKS.test(r.after ?? "")) return null;
  // ONE ELIGIBILITY VERDICT, THE MEASUREMENT KERNEL'S OWN (proof-gsc/types, learningEligibility). "Any comparison page at all" stood here, and the kernel filed the identical window insufficient below MIN_CONTROLS: five live 14 day readings the screen called unreadable were teaching the ranking their comparison's own 75 click fall. Unknown, unavailable and confounded are all refused here and stay three different facts on the row.
  const w = [...(r.windows ?? [])].filter((x) => x.adjustedLift != null && x.day >= FIRST_READING_DAYS && learningEligibility(x, r) === "eligible").sort((a, b) => b.day - a.day)[0];
  return w ? { lift: Math.round(w.adjustedLift), day: w.day } : null;
}

/**
 * THE SIGNATURE OF ONE SHIPMENT: the stamp if it carries one, otherwise as much of it as the row's own stored fields can honestly carry. BACKFILL HAPPENS HERE, ON READ, and never in a script: a pre-stamp row still records what family of change it was, and a row that applied exactly one piece still records which field that piece wrote.
 * The treatment and the diagnosed cause were never stored on those rows and are returned as null rather than inferred from the copy. A row that does not even name a family returns null and is reported as unsigned.
 */
export function signatureOfShipment(r: LearningRow): TreatmentSignature | null {
  if (r.treatmentStamp) return r.treatmentStamp.signature;
  const family = (r.actionType ?? "").trim();
  if (!family) return null;
  const kinds = (r.componentsApplied ?? []).map((c) => (c.kind ?? "").trim()).filter(Boolean);
  return { family, treatment: null, field: kinds.length === 1 ? kinds[0]! : null, cause: null };
}

/**
 * WHAT EACH KIND OF WORK HAS DONE HERE, grouped by family and treatment. Every row counts towards `shipped`; only a countable row with a finished reading reaches the effect numbers. Groups come back in the order their first row appeared, so the caller decides the ordering.
 */
export function treatmentLearning(rows: readonly LearningRow[]): TreatmentGroup[] {
  type Acc = Omit<TreatmentGroup, "key" | "sampleSize" | "netEffect" | "medianEffect" | "early" | "estimate"> & { reads: { lift: number; base: number }[]; mature: number };
  const acc = new Map<string, Acc>();
  for (const r of rows) {
    const sig = signatureOfShipment(r);
    // GROUPED ON THE COARSE FAMILY, never on the raw action word: `edit_title`, `title` and `title_meta_rewrite` are one bet spelled three
    // ways, and grouping on the spelling would scatter a real record across single-row groups that can never leave `early`.
    const family = sig ? actionFamilyOf(sig.family) : null;
    const key = family == null ? UNSIGNED : `${family}::${sig!.treatment ?? ""}`;
    const g = acc.get(key)
      ?? { family, treatment: sig?.treatment ?? null, shipped: 0, verified: 0, legacy: 0, ahead: 0, behind: 0, inconclusive: 0, overlapping: 0, reads: [], mature: 0 };
    g.shipped += 1;
    // A LEGACY ROW IS HISTORY, NEVER A TEACHER (operator, 2026-08-30): rows from before live verification existed were counting as verified and training rank. They keep their own honestly labelled count and touch nothing else.
    if (r.implementedAt == null) { g.legacy += 1; acc.set(key, g); continue; }
    if (!CONFIRMED.has(r.verification?.status ?? "")) { acc.set(key, g); continue; }
    g.verified += 1;
    const read = settledLift(r);
    if (read != null) {
      if ((r.treatmentStamp?.overlapAtShip ?? 0) > 0) g.overlapping += 1;
      // MUTED AND ZERO READINGS ARE HISTORY, NEVER SAMPLES (operator, 2026-08-30): an operator's inconclusive pin, a confounded frozen reading, and a clean no-movement each increment the visible count and enter NO effect, sample, median, or family history. They used to be pushed into effects first and excluded only from the direction tally, so three confounded readings could still swing a treatment's net. A KEPT READING CARRIES ITS OWN STANDING OUT WITH IT: what the page was already earning over exactly the span this window covers, which is what makes plus ten clicks on a big page and plus ten on a small one two different facts rather than one fact said twice.
      const muted = r.operatorVerdictOverride === "inconclusive" || r.pinnedRead?.verdict === "confounded";
      // A MEASURED ZERO IS EVIDENCE ABOUT A TREATMENT (operator, 2026-09-04), and it was thrown out with the mutes: a clean no-movement reading was counted as though nothing had been read, so the one answer that most deserves to pull an estimate towards nothing pulled it nowhere. It enters the sample and the estimate; it still names no direction, which is what `inconclusive` counts, so the three direction counts still add back to the finished readings.
      if (muted || read.lift === 0) g.inconclusive += 1;
      if (!muted) { g.reads.push({ lift: read.lift, base: r.baseline != null && r.baseline.windowDays > 0 ? (r.baseline.clicks * read.day) / r.baseline.windowDays : 0 }); if (read.day >= MATURE_WINDOW_DAYS) g.mature += 1; if (read.lift > 0) g.ahead += 1; else if (read.lift < 0) g.behind += 1; }
    }
    acc.set(key, g);
  }
  return [...acc].map(([key, g]) => ({
    key, family: g.family, treatment: g.treatment, shipped: g.shipped, verified: g.verified, legacy: g.legacy,
    ahead: g.ahead, behind: g.behind, inconclusive: g.inconclusive, overlapping: g.overlapping,
    sampleSize: g.reads.length, netEffect: g.reads.reduce((a, b) => a + b.lift, 0), medianEffect: medianOf(g.reads.map((x) => x.lift)),
    early: g.mature < EARLY_UNDER, estimate: pooledRate(g.reads),
  }));
}

/**
 * THE ONE RECORD THE QUEUE AND RESULTS BOTH EAT, KEYED BOTH WAYS (2026-09-05). It summed every treatment of a family back into one entry, so nine internal links that finished behind discounted every internal link this account will ever ship, whatever its anchor, its page or the cause it was raised against, and one batch of descriptions would have discounted a description somebody wrote by hand. A family is not a bet. The map now carries the SIGNATURE key (`family::treatment`, exactly as the groups above are keyed) AND the coarse family beside it, so a consumer asks the finer record first and reaches the family only where the finer one holds nothing at all. Both are shrunk towards nothing HERE rather than left for a consumer to remember, so the queue and the page can never apply two different shrinks to one ledger.
 * THE NAME IS NARROWER THAN THE MAP and stays until the one caller outside this lane can be moved with it (decision/produce-proposals): it is read by the queue's ranking, by that producing pass and by Results, and all three ask the signature first.
 * Verified readings only, by construction: nothing without a finished reading reaches `sampleSize` above. THE RANKING STAYS ON CLICKS AND NOT ON THE POOLED PERCENT (2026-09-03): the two are different units, one family's 300 clicks would start competing against another family's 9 percent, and re-ranking the whole queue on a changed unit is the operator's call to make and not this adapter's.
 */
export function familyHistoryFromShipments(rows: readonly LearningRow[]): Map<string, { readings: number; netLift: number }> {
  const out = new Map<string, { readings: number; netLift: number }>();
  const add = (key: string, readings: number, netLift: number): void => { const cur = out.get(key) ?? { readings: 0, netLift: 0 }; out.set(key, { readings: cur.readings + readings, netLift: cur.netLift + netLift }); };
  for (const g of treatmentLearning(rows)) {
    if (g.family == null || g.sampleSize === 0) continue;
    add(g.key, g.sampleSize, g.netEffect); add(g.family, g.sampleSize, g.netEffect);
  }
  for (const [key, v] of out) out.set(key, { readings: v.readings, netLift: Math.round(v.netLift * v.readings / (v.readings + SHRINK)) });
  return out;
}
