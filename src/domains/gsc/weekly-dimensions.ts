/**
 * weekly-dimensions (BEACON_500 R17b / P2 slice 2, v1 items 136 + 268) - the
 * WEEKLY property-level lenses the nightly day-sliced sync never pulls:
 *
 *   - how the site APPEARS on Google (rich results, FAQ styling, review stars,
 *     the searchAppearance dimension in plain words), and
 *   - WHO the visitors are (phones vs computers vs tablets, the device
 *     dimension).
 *
 * WEEKLY, not nightly, by design: both aggregates move slowly, and egress
 * discipline says do not spend nightly API calls re-reading a number that
 * changes once a week. The sync engine (src/lib/connectors/gsc/
 * weekly-dimensions-sync.ts) pulls ONE searchAppearance request and ONE device
 * request per tenant per week; this module is the pure math + copy over the
 * stored snapshots.
 *
 * PLAIN WORDS ONLY: the operator never sees "searchAppearance", "device
 * dimension", "CTR", or an internal appearance key. Impressions render as
 * "appearances" / "times shown", clicks as clicks or visitors.
 *
 * PURE, no I/O. The sync edge is weekly-dimensions-sync.ts; the read edge is
 * load-weekly-dimensions.ts.
 */

/** One appearance kind's weekly aggregate (searchAppearance grain). */
export type GscWeeklyAppearanceRow = {
  /** Google's raw appearance key (e.g. TPF_FAQ, REVIEW_SNIPPET). Stored for
   *  math and diagnostics; NEVER rendered raw (plainAppearanceLabel). */
  kind: string;
  clicks: number;
  impressions: number;
};

/** One device's weekly aggregate (device grain: DESKTOP / MOBILE / TABLET). */
export type GscWeeklyDeviceRow = {
  device: string;
  clicks: number;
  impressions: number;
  /** Impressions-weighted average position for the week (1-based). */
  position: number;
};

/** One stored weekly snapshot: both dimension pulls over one 7-day final
 *  window. Rows carry tenant_id because the store is written by the nightly
 *  cron fan-out with no request context (same rationale as question-universe). */
export type GscWeeklyDimensionsSnapshot = {
  tenant_id: string;
  property: string;
  /** The 7-day final window this snapshot covers (inclusive, Pacific dates). */
  weekStart: string;
  weekEnd: string;
  pulledAt: string;
  appearance: GscWeeklyAppearanceRow[];
  devices: GscWeeklyDeviceRow[];
};

/** Keep this many weekly snapshots per tenant (about six months). */
export const WEEKLY_SNAPSHOT_CAP = 26;

/**
 * Weekly cadence rule: pull again only when the newest stored snapshot's
 * window ended 7 or more days before the current last final day. Pure so the
 * sync engine and its isolation test share one implementation.
 */
export function shouldPullWeeklyDimensions(
  latestWeekEnd: string | null,
  lastFinalDay: string,
): boolean {
  if (!latestWeekEnd) return true;
  const latest = Date.parse(latestWeekEnd + "T12:00:00Z");
  const target = Date.parse(lastFinalDay + "T12:00:00Z");
  if (!Number.isFinite(latest) || !Number.isFinite(target)) return true;
  return target - latest >= 7 * 86_400_000;
}

// ---------------------------------------------------------------------------
// Plain words for Google's appearance keys. Fallback is a generic phrase,
// never the raw key (no internal vocabulary on a surface, ever).
// ---------------------------------------------------------------------------

const APPEARANCE_PLAIN_LABEL: Record<string, string> = {
  TPF_FAQ: "FAQ answers",
  TPF_HOWTO: "how-to steps",
  TPF_QA: "question and answer styling",
  REVIEW_SNIPPET: "review stars",
  RECIPE_FEATURE: "recipe cards",
  RECIPE_RICH_SNIPPET: "recipe cards",
  FEATURED_SNIPPET: "the answer box at the top",
  VIDEO: "video previews",
  RICHCARD: "rich result cards",
  PRODUCT_SNIPPETS: "product details",
  MERCHANT_LISTINGS: "product listings",
  ORGANIC_SHOPPING: "shopping results",
  JOB_LISTING: "job listings",
  JOB_DETAILS: "job listings",
  EVENTS_LISTING: "event listings",
  EVENTS_DETAILS: "event listings",
  EDU_Q_AND_A: "study question styling",
  TRANSLATED_RESULT: "translated results",
  AMP_TOP_STORIES: "top story cards",
  AMP_BLUE_LINK: "fast mobile pages",
  AMP_NON_RICH: "fast mobile pages",
  PAGE_EXPERIENCE: "page experience highlights",
  PRACTICE_PROBLEMS: "practice problem styling",
  MATH_SOLVERS: "math solver styling",
  SPECIAL_ANNOUNCEMENT: "announcement styling",
};

/** Plain-words label for one appearance kind. Unknown keys collapse to a
 *  generic phrase so a new Google key can never leak jargon onto a surface. */
export function plainAppearanceLabel(kind: string): string {
  return APPEARANCE_PLAIN_LABEL[(kind ?? "").toUpperCase()] ?? "special result styling";
}

// ---------------------------------------------------------------------------
// The lens: the lines the scoreboard expander renders + the trigger input.
// ---------------------------------------------------------------------------

/** Rich-results share only speaks when at least this many total appearances
 *  exist for the week (a share over a handful of rows is noise). */
export const APPEARANCE_MIN_TOTAL_IMPRESSIONS = 500;
/** "Meaningful share" floor for the celebration line: 1 in 10 appearances. */
export const APPEARANCE_MEANINGFUL_SHARE = 0.1;
/** The quiet drop line fires when this week's share fell to under 60 percent
 *  of last week's (a styling regression smell), off a real prior share. */
export const APPEARANCE_DROP_FACTOR = 0.6;
const APPEARANCE_DROP_MIN_PRIOR_SHARE = 0.05;

/** Device visitors line floor: under this many weekly clicks, stay silent. */
export const DEVICE_MIN_WEEKLY_CLICKS = 30;

/** The pure trigger input for the mobile-vs-desktop click gap predicate. */
export type DeviceCtrGapSignal = {
  weekStart: string;
  weekEnd: string;
  mobileClicks: number;
  mobileImpressions: number;
  mobileCtr: number;
  mobilePosition: number;
  desktopClicks: number;
  desktopImpressions: number;
  desktopCtr: number;
  desktopPosition: number;
};

export type GscWeeklyLens = {
  weekStart: string;
  weekEnd: string;
  pulledAt: string;
  /** "7 in 10 of your Google visitors are on phones." Null under the floor. */
  deviceLine: string | null;
  /** "About 1 in 5 of your Google appearances show with extra styling ..."
   *  Null when the share is not meaningful. */
  appearanceLine: string | null;
  /** The quiet week-over-week fall line. Null when the share held. */
  appearanceDropLine: string | null;
  /** Trigger input for the device click-gap predicate; null when either
   *  device row is missing for the week. */
  deviceGap: DeviceCtrGapSignal | null;
};

function deviceRow(
  snapshot: GscWeeklyDimensionsSnapshot,
  device: string,
): GscWeeklyDeviceRow | null {
  return (
    snapshot.devices.find((d) => (d.device ?? "").toUpperCase() === device) ?? null
  );
}

function totalDeviceImpressions(snapshot: GscWeeklyDimensionsSnapshot): number {
  return snapshot.devices.reduce((s, d) => s + (Number(d.impressions) || 0), 0);
}

function totalDeviceClicks(snapshot: GscWeeklyDimensionsSnapshot): number {
  return snapshot.devices.reduce((s, d) => s + (Number(d.clicks) || 0), 0);
}

/** Rich-styling share of the week's appearances: appearance-row impressions
 *  over the device-grain total (devices are exhaustive, so their sum is the
 *  honest denominator). Clamped to 1 because one result can carry several
 *  styling kinds at once. Null when the denominator is under the floor. */
export function appearanceShareOf(snapshot: GscWeeklyDimensionsSnapshot): number | null {
  const total = totalDeviceImpressions(snapshot);
  if (total < APPEARANCE_MIN_TOTAL_IMPRESSIONS) return null;
  const styled = snapshot.appearance.reduce((s, a) => s + (Number(a.impressions) || 0), 0);
  if (styled <= 0) return 0;
  return Math.min(1, styled / total);
}

/** Top appearance kinds by impressions, as plain labels, deduped, max 2. */
function topAppearanceLabels(snapshot: GscWeeklyDimensionsSnapshot): string[] {
  const sorted = [...snapshot.appearance]
    .filter((a) => (Number(a.impressions) || 0) > 0)
    .sort((a, b) => b.impressions - a.impressions);
  const labels: string[] = [];
  for (const row of sorted) {
    const label = plainAppearanceLabel(row.kind);
    if (!labels.includes(label)) labels.push(label);
    if (labels.length >= 2) break;
  }
  return labels;
}

function shareAsOneInN(share: number): string {
  if (share > 0.5) return "More than half";
  const n = Math.max(2, Math.round(1 / share));
  return `About 1 in ${n}`;
}

function pct(share: number): string {
  return `${Math.round(share * 100)} percent`;
}

/** The celebration line, only at a meaningful share. */
export function buildAppearanceLine(snapshot: GscWeeklyDimensionsSnapshot): string | null {
  const share = appearanceShareOf(snapshot);
  if (share == null || share < APPEARANCE_MEANINGFUL_SHARE) return null;
  const labels = topAppearanceLabels(snapshot);
  const styledClause =
    labels.length > 0 ? `, like ${labels.join(" and ")}` : "";
  return (
    `${shareAsOneInN(share)} of your Google appearances show with extra styling${styledClause}. ` +
    `That styling is working for you, keep it in place.`
  );
}

/** The quiet week-over-week fall line (a styling regression smell). */
export function buildAppearanceDropLine(
  current: GscWeeklyDimensionsSnapshot,
  prior: GscWeeklyDimensionsSnapshot | null,
): string | null {
  if (!prior) return null;
  const currentShare = appearanceShareOf(current);
  const priorShare = appearanceShareOf(prior);
  if (currentShare == null || priorShare == null) return null;
  if (priorShare < APPEARANCE_DROP_MIN_PRIOR_SHARE) return null;
  if (currentShare >= priorShare * APPEARANCE_DROP_FACTOR) return null;
  return (
    `Extra styling showed on ${pct(currentShare)} of your Google appearances this week, ` +
    `down from ${pct(priorShare)} last week. That usually means Google stopped reading some ` +
    `of your page styling. I will keep watching it.`
  );
}

/** "7 in 10 of your Google visitors are on phones." from the week's clicks. */
export function buildDeviceLine(snapshot: GscWeeklyDimensionsSnapshot): string | null {
  const total = totalDeviceClicks(snapshot);
  if (total < DEVICE_MIN_WEEKLY_CLICKS) return null;
  const mobile = deviceRow(snapshot, "MOBILE");
  const mobileClicks = Number(mobile?.clicks) || 0;
  const share = mobileClicks / total;
  const tenths = Math.round(share * 10);
  if (tenths >= 10) return "Nearly all of your Google visitors are on phones.";
  if (tenths <= 0) {
    return "Hardly any of your Google visitors are on phones; almost everyone comes from a computer.";
  }
  return `${tenths} in 10 of your Google visitors are on phones.`;
}

/** Extract the trigger input; null when either device row is absent. */
export function deviceCtrGapSignalOf(
  snapshot: GscWeeklyDimensionsSnapshot,
): DeviceCtrGapSignal | null {
  const mobile = deviceRow(snapshot, "MOBILE");
  const desktop = deviceRow(snapshot, "DESKTOP");
  if (!mobile || !desktop) return null;
  const mImpr = Number(mobile.impressions) || 0;
  const dImpr = Number(desktop.impressions) || 0;
  const mClicks = Number(mobile.clicks) || 0;
  const dClicks = Number(desktop.clicks) || 0;
  return {
    weekStart: snapshot.weekStart,
    weekEnd: snapshot.weekEnd,
    mobileClicks: mClicks,
    mobileImpressions: mImpr,
    mobileCtr: mImpr > 0 ? mClicks / mImpr : 0,
    mobilePosition: Number(mobile.position) || 0,
    desktopClicks: dClicks,
    desktopImpressions: dImpr,
    desktopCtr: dImpr > 0 ? dClicks / dImpr : 0,
    desktopPosition: Number(desktop.position) || 0,
  };
}

/**
 * The full lens over the newest snapshot (+ the prior one for the week-over-
 * week styling delta). Null when there is no snapshot yet - the expander
 * self-hides, never a bare zero.
 */
export function buildWeeklyLens(
  current: GscWeeklyDimensionsSnapshot | null,
  prior: GscWeeklyDimensionsSnapshot | null,
): GscWeeklyLens | null {
  if (!current) return null;
  const deviceLine = buildDeviceLine(current);
  const appearanceLine = buildAppearanceLine(current);
  const appearanceDropLine = buildAppearanceDropLine(current, prior);
  if (!deviceLine && !appearanceLine && !appearanceDropLine) return null;
  return {
    weekStart: current.weekStart,
    weekEnd: current.weekEnd,
    pulledAt: current.pulledAt,
    deviceLine,
    appearanceLine,
    appearanceDropLine,
    deviceGap: deviceCtrGapSignalOf(current),
  };
}
