/**
 * control-contamination (BEACON_500 N13, 2026-07-02) - detects a comparison
 * page (control) that CHANGED during a ship's measurement window and can no
 * longer anchor an honest diff-in-diff.
 *
 * A ship's controlPages are picked ONCE at selection time (control-matching.ts,
 * run inside auto-record-on-ship.ts) from that day's top-demand pages. Nothing
 * since has watched whether those pages stay untouched for the whole 7/14/28-day
 * measurement window. Two ways a control goes bad:
 *
 *   1. TREATED BY US - the page becomes a treated page itself (a later ship
 *      recorded it as `page`). Its own CTR/clicks then moved for a reason that
 *      has nothing to do with natural drift, so subtracting its delta no longer
 *      isolates the treated page's effect. auto-record-on-ship.ts already keeps a
 *      NEW ship from picking an already-treated page as a control (`isUntreated`),
 *      and run-measurement.ts already excludes a CURRENTLY-MEASURING treatment
 *      from the diff-in-diff math (experiment-eligibility.ts's
 *      activeTreatmentPaths/cleanControlPaths). What neither catches: a control
 *      that was treated AFTER this ship recorded it, or one whose own measurement
 *      has since SETTLED (activeTreatmentPaths only tracks "measuring" - a settled
 *      row silently stops being flagged even though it was still treated content
 *      during part of this ship's window). This module looks at the FULL ledger,
 *      not just the currently-active slice, and asks one honest question: did this
 *      control's OWN ship date fall inside my measurement window?
 *
 *   2. CONTENT CHANGED - the page's content_hash moved between two page_snapshots
 *      rows taken inside the window, for a reason the ledger has no record of (a
 *      manual CMS edit, an editor on the team, a template-wide change). Detected
 *      from ordinary weekly rescans; HONEST about coverage - a control with fewer
 *      than 2 scans inside the window cannot be judged either way and is `unknown`,
 *      never assumed clean.
 *
 * PURE. No I/O - the caller (attach-control-contamination.ts) reads the ledger and
 * snapshot history and hands in plain data. Mirrors the shape of
 * measurement-maturity.ts / seasonal-inflection.ts: a small deterministic
 * classifier, a separate read-time attach step, nothing persisted, nothing here
 * ever mutates a stored ship row.
 */

export type ContaminationStatus =
  | "clean"
  | "treated_by_us"
  | "content_changed"
  | "unknown";

export type ContaminationWindow = {
  /** Measurement window start (ship date), YYYY-MM-DD or ISO. */
  start: string;
  /** Measurement window end (the basis/next checkpoint date), YYYY-MM-DD or ISO. */
  end: string;
};

/** One ledger ship, reduced to what contamination detection needs. */
export type LedgerShipRecord = {
  /** Canonical path (host-stripped), matches ShippedChangeRecord.path. */
  path: string;
  /** ISO ship timestamp. */
  shippedAt: string;
};

/** One page_snapshots row, reduced to what change-detection needs. */
export type SnapshotPoint = {
  /** ISO fetched_at timestamp. */
  fetchedAt: string;
  /** Content hash at this scan (schema/heading hashes are ignored here - a
   *  wording/body edit is what actually moves clicks/CTR; a schema-only change
   *  is a different concern the schema triggers already own). */
  contentHash: string;
};

export type ControlContaminationResult = {
  /** The control page's canonical path (host-stripped), same shape as controlPages. */
  path: string;
  status: ContaminationStatus;
  /** Present for treated_by_us: the ISO date the control itself shipped. */
  treatedAt?: string;
  /** Present for content_changed: the two scan timestamps that bracket the change. */
  changedBetweenScans?: { before: string; after: string };
  /** Plain first-person sentence naming why. No dashes. Empty for "clean". */
  reason: string;
};

const dateOnly = (iso: string): string => (iso || "").slice(0, 10);

function withinWindow(iso: string, window: ContaminationWindow): boolean {
  const d = dateOnly(iso);
  return d >= dateOnly(window.start) && d < dateOnly(window.end);
}

/** Minimum in-window scans required to call a control "clean" on content -
 *  fewer than this and coverage is too sparse to say either way (unknown, not
 *  clean). Two scans is the floor: one to anchor a hash, one to compare it to. */
export const MIN_SCANS_FOR_CONTENT_JUDGMENT = 2;

/**
 * Classify ONE control page for ONE ship's measurement window. PURE.
 *
 * Precedence: treated_by_us first (the strongest, most legible signal - we KNOW
 * we touched this page, no inference needed), then content_changed (a real hash
 * diff observed inside the window), then unknown (fewer than
 * MIN_SCANS_FOR_CONTENT_JUDGMENT snapshots fell inside the window - honest
 * silence, never assumed clean), then clean.
 */
export function classifyControl(args: {
  controlPath: string;
  window: ContaminationWindow;
  /** Every OTHER ship in the ledger (the caller excludes this ship's own row). */
  ledger: ReadonlyArray<LedgerShipRecord>;
  /** This control page's own snapshot history, any order, any range - the
   *  classifier filters to the window itself. */
  snapshots: ReadonlyArray<SnapshotPoint>;
}): ControlContaminationResult {
  const { controlPath, window, ledger, snapshots } = args;

  // 1. Treated by us: does ANY ledger ship (other than this one) treat this exact
  // path, with a ship date that falls inside this window? A control treated
  // AFTER the window closes never touched this measurement and stays eligible;
  // one treated before the window opened is a pre-existing state the pre-period
  // baseline already reflects (not a contamination of THIS window). Only a ship
  // date landing inside [start, end) corrupts the natural-drift assumption.
  const treatment = ledger.find(
    (r) => r.path === controlPath && withinWindow(r.shippedAt, window),
  );
  if (treatment) {
    return {
      path: controlPath,
      status: "treated_by_us",
      treatedAt: dateOnly(treatment.shippedAt),
      reason: `I shipped a change to this comparison page myself on ${dateOnly(treatment.shippedAt)}, inside this measurement window.`,
    };
  }

  // 2. Content changed: sort in-window scans by time, compare consecutive
  // content_hash values. The FIRST differing pair is the receipt (earliest
  // detectable change, not the latest - an operator restoring the earlier
  // wording later doesn't undo the fact that the window saw a real edit).
  const inWindow = [...snapshots]
    .filter((s) => withinWindow(s.fetchedAt, window))
    .sort((a, b) => (a.fetchedAt < b.fetchedAt ? -1 : a.fetchedAt > b.fetchedAt ? 1 : 0));

  if (inWindow.length < MIN_SCANS_FOR_CONTENT_JUDGMENT) {
    return {
      path: controlPath,
      status: "unknown",
      reason: `I only have ${inWindow.length} scan${inWindow.length === 1 ? "" : "s"} of this comparison page inside the measurement window, not enough to know if it changed.`,
    };
  }

  for (let i = 1; i < inWindow.length; i++) {
    const prev = inWindow[i - 1]!;
    const cur = inWindow[i]!;
    if (prev.contentHash && cur.contentHash && prev.contentHash !== cur.contentHash) {
      return {
        path: controlPath,
        status: "content_changed",
        changedBetweenScans: { before: dateOnly(prev.fetchedAt), after: dateOnly(cur.fetchedAt) },
        reason: `This comparison page's content changed between ${dateOnly(prev.fetchedAt)} and ${dateOnly(cur.fetchedAt)}, inside this measurement window.`,
      };
    }
  }

  return { path: controlPath, status: "clean", reason: "" };
}

/** Classify every control for one ship. PURE. Order preserved from `controlPaths`. */
export function classifyControls(args: {
  controlPaths: ReadonlyArray<string>;
  window: ContaminationWindow;
  ledger: ReadonlyArray<LedgerShipRecord>;
  /** Keyed by control path (already host-stripped, same shape as controlPaths). */
  snapshotsByPath: ReadonlyMap<string, ReadonlyArray<SnapshotPoint>>;
}): ControlContaminationResult[] {
  return args.controlPaths.map((controlPath) =>
    classifyControl({
      controlPath,
      window: args.window,
      ledger: args.ledger,
      snapshots: args.snapshotsByPath.get(controlPath) ?? [],
    }),
  );
}

export type ContaminationVerdict = {
  results: ControlContaminationResult[];
  /** Any control that is not "clean" (treated_by_us, content_changed, or unknown). */
  contaminated: ControlContaminationResult[];
  hasContamination: boolean;
};

/** Roll up per-control classifications into one verdict. PURE. */
export function summarizeContamination(results: ReadonlyArray<ControlContaminationResult>): ContaminationVerdict {
  const contaminated = results.filter((r) => r.status !== "clean");
  return { results: [...results], contaminated, hasContamination: contaminated.length > 0 };
}

// ---------------------------------------------------------------------------
// Promotion from the FROZEN donor pool (computed-only; never mutates the
// stored ship row; NEVER re-ranks with post-ship data)
// ---------------------------------------------------------------------------

/** One entry from the ship's frozen donor pool (control-matching.ts's
 *  RankedControl, narrowed to what promotion needs). Mirrored locally rather
 *  than imported so this module stays dependency-free of control-matching.ts -
 *  the shape is pinned by control-matching.test.ts on the source of truth. */
export type FrozenDonor = {
  url: string;
  verdict: "kept" | "excluded";
};

export type SubstitutionOutcome = {
  /** Original control path this substitute replaces. */
  originalPath: string;
  /** The path substituted in, or null when no clean substitute was available. */
  substitutePath: string | null;
};

/**
 * For each contaminated control, promote the NEXT eligible donor from the
 * ship's FROZEN pre-ranked pool, in the pool's OWN original order. PURE. This
 * is promotion, not re-selection: no re-ranking, no outcome-aware choice, no
 * fresh candidate computation - the pool was fixed at ship time (before any
 * post-ship outcome existed to bias a choice toward), and this function only
 * walks it in order, skipping:
 *   - any donor the matcher itself excluded at ship time (verdict "excluded")
 *   - the treated page
 *   - any path already an active control on this ship (clean or contaminated)
 *   - a donor already promoted for a different contaminated control in this
 *     same call (never reused twice)
 * Returns substitutePath: null (never throws, never widens the search) when
 * the frozen pool is absent, empty, or exhausted - the caller falls back to
 * the honest caution path.
 */
export function promoteFromFrozenPool(args: {
  contaminated: ReadonlyArray<{ path: string }>;
  /** Every control currently on this ship (clean AND contaminated) - all
   *  excluded from being promoted as someone else's substitute. */
  allControlPaths: ReadonlyArray<string>;
  treatedPath: string;
  /** This ship's frozen donor pool (ShippedChangeRecord.controlDonorPool),
   *  in its ORIGINAL ranked order. Null/empty -> every substitutePath is null. */
  frozenPool: ReadonlyArray<FrozenDonor> | null | undefined;
}): SubstitutionOutcome[] {
  const used = new Set<string>([args.treatedPath, ...args.allControlPaths]);
  const pool = (args.frozenPool ?? []).filter((d) => d.verdict === "kept");
  const out: SubstitutionOutcome[] = [];
  for (const c of args.contaminated) {
    const pick = pool.find((d) => !used.has(d.url));
    if (pick) {
      used.add(pick.url);
      out.push({ originalPath: c.path, substitutePath: pick.url });
    } else {
      out.push({ originalPath: c.path, substitutePath: null });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plain-language receipt lines (no "control" jargon on operator surfaces)
// ---------------------------------------------------------------------------

/** One line per successfully-promoted control. Names WHERE the substitute came
 *  from (the pre-ship list), not a fresh re-pick - honest about the promotion
 *  design. No dashes. */
export function swapSentence(): string {
  return "One comparison page changed mid-measurement, so I swapped in the next one from the list I chose before shipping, and re-read the numbers.";
}

/** The caution line when a contaminated control has NO clean substitute
 *  available - the verdict still runs, but reads cautiously. No dashes. */
export function cautionSentence(): string {
  return "A comparison page changed during measurement, so I am reading this result with caution.";
}

/**
 * Build the operator-facing note set for one ship's contamination verdict +
 * promotion outcome. PURE. Empty array when nothing was contaminated.
 */
export function buildContaminationNotes(
  verdict: ContaminationVerdict,
  substitutions: ReadonlyArray<SubstitutionOutcome> = [],
): string[] {
  if (!verdict.hasContamination) return [];
  const subByOriginal = new Map(substitutions.map((s) => [s.originalPath, s.substitutePath] as const));
  const notes: string[] = [];
  const anySwapped = substitutions.some((s) => s.substitutePath != null);
  const anyUnswapped = verdict.contaminated.some((c) => (subByOriginal.get(c.path) ?? null) == null);

  for (const c of verdict.contaminated) {
    const sub = subByOriginal.get(c.path) ?? null;
    if (sub) {
      notes.push(`${c.reason} I swapped in ${sub} from the list I chose before shipping.`);
    } else {
      notes.push(c.reason);
    }
  }
  if (anySwapped) notes.push(swapSentence());
  if (anyUnswapped) notes.push(cautionSentence());
  return notes;
}

// ---------------------------------------------------------------------------
// N16 (R5, 2026-07-03) - SUSTAINABLE CONTROL POOL. Two additions, both PURE:
//   1. computePoolHealth - how many comparison pages an open measurement still
//      has clean, plus its spare bench from the FROZEN pool, and whether one
//      single page is the LAST clean comparison basis (the planner hold).
//   2. medianBandRead - the honest fallback read when the frozen pool is
//      exhausted: compare the treated page against the TYPICAL untouched page
//      in its own template family, labeled plainly as a weaker comparison.
// Frozen-pool ordering rules from N13 stay inviolable: nothing here re-ranks
// or re-selects a donor, and nothing here ever mutates measurement history.
// ---------------------------------------------------------------------------

/** First path segment = the template family (mirrors daily-experiment-planner's
 *  pageFamilyOf and interference-graph's same_template_family notion). PURE. */
export function templateFamilyOf(urlOrPath: string): string {
  const p = ((urlOrPath || "/").replace(/^https?:\/\/[^/]+/, "") || "/").replace(/[?#].*$/, "");
  const segs = p.split("/").filter(Boolean);
  return (segs[0] ?? "root").toLowerCase();
}

/** Minimum same-family untouched pages before a median-band read is honest.
 *  Below this the fallback stays silent (the plain caution line already
 *  renders), never a "typical page" claim built on one or two pages. */
export const MIN_MEDIAN_BAND_PAGES = 3;

export type MedianBandRead = {
  /** Median clicks delta of the untouched same-family pages over the window. */
  medianDelta: number;
  /** The treated page's own basis-window clicks delta, when a window closed. */
  treatedDelta: number | null;
  pagesUsed: number;
  /** Plain first-person weaker-comparison line. No dashes, no lab words. */
  sentence: string;
};

function describeClicksDelta(delta: number): string {
  const n = Math.abs(Math.round(delta));
  const unit = n === 1 ? "click" : "clicks";
  if (Math.round(delta) > 0) return `gained ${n} ${unit}`;
  if (Math.round(delta) < 0) return `lost ${n} ${unit}`;
  return "held steady";
}

/**
 * The median-band fallback read: when EVERY donor is contaminated (the frozen
 * pool exhausted or absent), compare the treated page's own basis-window
 * clicks delta against the MEDIAN delta of untouched pages in the same
 * template family, over the identical window. This is deliberately labeled a
 * WEAKER comparison in the sentence itself - it feeds N10's grade as "shaky"
 * through the same controlContaminationFlagged path the caution line already
 * uses (verdict-reliability.ts). PURE - the caller supplies the deltas.
 * Returns null below MIN_MEDIAN_BAND_PAGES (honest silence).
 */
export function medianBandRead(args: {
  treatedDelta: number | null;
  /** Untouched same-family pages' clicks deltas over the same window. */
  familyDeltas: ReadonlyArray<number>;
}): MedianBandRead | null {
  const deltas = args.familyDeltas.filter((d) => Number.isFinite(d));
  if (deltas.length < MIN_MEDIAN_BAND_PAGES) return null;
  const sorted = [...deltas].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianDelta =
    sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const lead =
    `Every comparison page for this change was disturbed, so I checked it against the typical untouched page in its section instead`;
  const sentence =
    args.treatedDelta != null
      ? `${lead}: this page ${describeClicksDelta(args.treatedDelta)} while the typical one of ${deltas.length} ${describeClicksDelta(medianDelta)} over the same window. That is a weaker comparison, so I am reading this result cautiously.`
      : `${lead} (${deltas.length} pages). That is a weaker comparison, so I am reading this result cautiously.`;
  return { medianDelta, treatedDelta: args.treatedDelta, pagesUsed: deltas.length, sentence };
}

export type PoolHealth = {
  /** Comparison pages with NO known mid-window change (clean or unverified).
   *  "Unverified" (too few scans) counts as still clean here on purpose: the
   *  hold below must never fire off missing scan coverage, and the per-control
   *  unverified reason already renders in the contamination notes. */
  cleanControls: number;
  /** Comparison pages with a KNOWN mid-window change (treated by us, or the
   *  content itself changed between scans). */
  knownDirtyControls: number;
  totalControls: number;
  /** Kept frozen-pool donors still on the bench: not serving as a control,
   *  not the treated page, and not themselves treated inside this window. */
  spareDonors: number;
  /** Host-stripped paths that are this measurement's ONLY remaining clean
   *  comparison basis (the whole clean pool is exactly one page). Tonight's
   *  planner must not treat such a page (last_clean_donor hold). */
  lastCleanDonorPaths: string[];
  /** One plain line for the Results card expand, e.g.
   *  "2 of 4 comparison pages are still clean. 1 spare comparison page is
   *  ready from the list I chose before shipping." */
  sentence: string;
};

/**
 * Pool health for ONE ship's open measurement. PURE. Reads the classifier's
 * per-control results plus the FROZEN donor pool bench; never re-ranks, never
 * re-selects, never mutates anything (N13's ordering rules are inviolable).
 */
export function computePoolHealth(args: {
  /** Classification of the ship's CURRENT (effective) controls, in order. */
  results: ReadonlyArray<ControlContaminationResult>;
  /** The ship's frozen donor pool (ShippedChangeRecord.controlDonorPool). */
  frozenPool: ReadonlyArray<FrozenDonor> | null | undefined;
  /** Current control paths (host-stripped), post-promotion. */
  controlPaths: ReadonlyArray<string>;
  /** Treated page path (host-stripped). */
  treatedPath: string;
  /** Every OTHER ship in the ledger (spare-donor treated-in-window check). */
  ledger: ReadonlyArray<LedgerShipRecord>;
  window: ContaminationWindow;
}): PoolHealth {
  const stripPath = (u: string): string =>
    ((u || "/").replace(/^https?:\/\/[^/]+/, "") || "/").replace(/[?#].*$/, "");
  const knownDirtyStatuses = new Set<ContaminationStatus>(["treated_by_us", "content_changed"]);
  const serving = new Set(args.controlPaths.map(stripPath));
  // Only a known-dirty page STILL SERVING as a comparison counts against the
  // line - a contaminated original that a bench donor already replaced has
  // left the comparison set (the swap note names that story separately).
  const dirty = args.results.filter(
    (r) => knownDirtyStatuses.has(r.status) && serving.has(stripPath(r.path)),
  );
  const totalControls = args.controlPaths.length;
  const knownDirtyControls = dirty.length;
  const cleanControls = Math.max(0, totalControls - knownDirtyControls);

  const dirtyPaths = new Set(dirty.map((r) => stripPath(r.path)));
  const treated = stripPath(args.treatedPath);
  const sparePaths: string[] = [];
  for (const d of args.frozenPool ?? []) {
    if (d.verdict !== "kept") continue; // the matcher excluded it at ship time
    const p = stripPath(d.url);
    if (p === treated || serving.has(p) || sparePaths.includes(p)) continue;
    // A bench donor that was itself treated inside this window is spent.
    const treatedInWindow = args.ledger.some(
      (r) => stripPath(r.path) === p && withinWindow(r.shippedAt, args.window),
    );
    if (treatedInWindow) continue;
    sparePaths.push(p);
  }

  const cleanServingPaths = args.controlPaths.map(stripPath).filter((p) => !dirtyPaths.has(p));
  const cleanPool = [...new Set([...cleanServingPaths, ...sparePaths])];
  const lastCleanDonorPaths = cleanPool.length === 1 ? cleanPool : [];

  const spareDonors = sparePaths.length;
  let sentence = `${cleanControls} of ${totalControls} comparison page${totalControls === 1 ? " is" : "s are"} still clean.`;
  if (spareDonors > 0) {
    sentence += ` ${spareDonors} spare comparison page${spareDonors === 1 ? " is" : "s are"} ready from the list I chose before shipping.`;
  }
  return { cleanControls, knownDirtyControls, totalControls, spareDonors, lastCleanDonorPaths, sentence };
}

/** The planner's plain hold sentence for a last-clean-donor page. No dashes. */
export function lastCleanDonorHoldSentence(treatedPath: string): string {
  return `I am holding this page because it is the last clean comparison page for a change I am still measuring on ${treatedPath}.`;
}
