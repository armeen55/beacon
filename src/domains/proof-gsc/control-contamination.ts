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
