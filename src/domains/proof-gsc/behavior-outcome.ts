/**
 * behavior-outcome (BEACON_500 N4 + N17, 2026-07-03) - PURE math + copy for the
 * "how visitors behaved" lane on a shipped change.
 *
 * The GSC verdict answers "did Search move?" and the GA4 traffic outcome answers
 * "did visits move?". This lane answers the two questions between them:
 *   N4  - did visitors BEHAVE better on the page since the change? Engagement
 *         (GA4 engaged share), frustration (Clarity rage + dead clicks per 100
 *         visits), bounce-backs (Clarity quick-back share), and conversions,
 *         each read before/after on the live_at clock (the ship date), never
 *         gated on Google recrawl or GSC finalization.
 *   N17 - did visitors FIND THE ANSWER they searched for? A visit counts as
 *         "found it" when it neither bounced straight back (Clarity quick-backs)
 *         nor left unengaged (GA4 engaged share as the proxy). The share is the
 *         engaged share adjusted down by the quick-back share.
 *
 * HONESTY FLOORS - every metric is null unless its window clears a real sample:
 *   GA4 lanes:     >= 50 sessions in that window.
 *   Clarity lanes: >= 100 visits in that window.
 * A 12-session window never produces a percent, a verdict, or a sentence.
 *
 * CORROBORATION ONLY - the composite verdict feeds N10 (verdict-reliability.ts)
 * as an optional demotion input on wins; it NEVER touches windows/verdict/
 * confidence and behavior alone never upgrades any read.
 *
 * PURE - no I/O; the server reads live in behavior-window.ts / clarity-window.ts.
 * Beacon voice: plain words for what people did (no "pogo-stick", no "engaged
 * sessions", no lab jargon), concrete numbers, no em or en dashes.
 */

export type BehaviorGa4Window = {
  sessions: number;
  engagedSessions: number;
  conversions: number;
};

export type BehaviorClarityWindow = {
  visits: number;
  rageClicks: number;
  deadClicks: number;
  quickbacks: number;
};

/** GA4 sample floor per window - below this every GA4-derived metric is null. */
export const GA4_MIN_SESSIONS_PER_WINDOW = 50;
/** Clarity sample floor per window - below this every Clarity metric is null. */
export const CLARITY_MIN_VISITS_PER_WINDOW = 100;

/** A share must move at least this much (relative) to count as a direction. */
const ENGAGED_REL_THRESHOLD = 0.05;
/** Frustration/quick-back rates are noisier; require a bigger relative move. */
const FRICTION_REL_THRESHOLD = 0.15;
const CONVERSIONS_REL_THRESHOLD = 0.15;
/** Conversions are sparse; below this combined volume the lane stays flat. */
const MIN_CONVERSIONS_TO_JUDGE = 5;
/** Frustration appearing where there was none: worth naming only past this. */
const MIN_FRUSTRATION_PER_100_FROM_ZERO = 5;
/** Quick-backs appearing where there were none: worth naming only past this. */
const MIN_QUICKBACK_SHARE_FROM_ZERO = 0.05;

export type BehaviorCompositeVerdict = "better" | "worse" | "mixed" | "same" | "none";

export type BehaviorOutcome = {
  /** A post-ship day exists in at least one source. */
  ran: boolean;
  /** Elapsed post-window days (capped at the largest proof window). */
  windowDays: number;
  /** GA4 engaged share (engaged visits / visits), per window; null below floor. */
  engagedSharePre: number | null;
  engagedSharePost: number | null;
  /** Clarity rage + dead clicks per 100 visits, per window; null below floor. */
  frustrationPer100Pre: number | null;
  frustrationPer100Post: number | null;
  /** Clarity quick-backs / visits, per window; null below floor. */
  quickbackSharePre: number | null;
  quickbackSharePost: number | null;
  /** GA4 conversions: pre pro-rated to the post length; null below floor. */
  conversionsPre: number | null;
  conversionsPost: number | null;
  /** Raw sample receipts (always present, even below floor). */
  ga4SessionsPre: number;
  ga4SessionsPost: number;
  clarityVisitsPre: number;
  clarityVisitsPost: number;
  /** N17: share of visits that neither bounced straight back nor left
   *  unengaged, per window. Needs BOTH sources above floor; null otherwise. */
  taskCompletionSharePre: number | null;
  taskCompletionSharePost: number | null;
  /** N4 composite call across the available lanes. "none" = no lane cleared
   *  its floor, so there is nothing honest to say. */
  compositeVerdict: BehaviorCompositeVerdict;
  /** The one plain composite sentence, or null when there is nothing to say. */
  sentence: string | null;
  /** N17 card line ("About 7 in 10 visitors who land here appear to find what
   *  they came for."), from the freshest floored window. Null below floors. */
  taskCompletionLine: string | null;
  /** N17 before/after delta line, ONLY for answer-shaped changes (answer block
   *  or FAQ) with both windows above floor. Null otherwise. */
  answerDeltaLine: string | null;
  /** Latest source day used (for the receipt line). */
  dataThrough: string | null;
};

/** Answer-shaped changes: the ship targeted an answer block or FAQ, so the
 *  found-their-answer share gets its own before/after outcome line. */
const ANSWER_SHAPED_ACTIONS = new Set([
  "add_answer_block",
  "answer_block",
  "intro_answer_block",
  "add_faq",
  "faq",
  "faq_schema",
  "add_faq_schema",
]);

export function isAnswerShapedAction(actionType: string): boolean {
  return ANSWER_SHAPED_ACTIONS.has((actionType || "").toLowerCase());
}

/**
 * Elapsed post-window days on the live_at clock: ship day..latest source day
 * inclusive, capped at `maxWindowDays`. 0 when no source day has landed on or
 * after the ship (mirrors the GA4 traffic lane's elapsed math).
 */
export function elapsedPostDays(
  shipDate: string,
  latestSourceDate: string | null,
  maxWindowDays: number,
): number {
  if (latestSourceDate == null || latestSourceDate < shipDate) return 0;
  const diffDays = Math.round(
    (Date.parse(latestSourceDate) - Date.parse(shipDate)) / 86_400_000,
  );
  return Math.min(maxWindowDays, Math.max(0, diffDays) + 1);
}

/**
 * N17: the found-their-answer share. A visit counts when it neither bounced
 * straight back (quick-back) nor left unengaged (1 - engaged share). The two
 * conditions come from different tools, so the honest combination is the
 * engaged share scaled down by the quick-back share. Null unless BOTH inputs
 * cleared their own sample floors (never a verdict from 12 sessions).
 */
export function taskCompletionShare(
  engagedShare: number | null,
  quickbackShare: number | null,
): number | null {
  if (engagedShare == null || quickbackShare == null) return null;
  const v = engagedShare * (1 - quickbackShare);
  return Math.min(1, Math.max(0, v));
}

/** True when the card block has anything honest to render (self-hiding rule). */
export function behaviorHasContent(b: BehaviorOutcome | null | undefined): boolean {
  return (
    b != null &&
    (b.sentence != null || b.taskCompletionLine != null || b.answerDeltaLine != null)
  );
}

// ── internals ────────────────────────────────────────────────────────────────

type LaneDirection = "better" | "worse" | "flat";
type Lane = { direction: LaneDirection; clause: string | null };

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function pctWord(rel: number): string {
  return `${Math.abs(Math.round(rel * 100))} percent`;
}

function fmtCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Engagement lane: higher engaged share is better. */
function engagedLane(pre: number | null, post: number | null): Lane | null {
  if (pre == null || post == null) return null;
  if (pre <= 0) return { direction: "flat", clause: null };
  const rel = (post - pre) / pre;
  if (rel >= ENGAGED_REL_THRESHOLD) {
    return { direction: "better", clause: `engaged visits up ${pctWord(rel)}` };
  }
  if (rel <= -ENGAGED_REL_THRESHOLD) {
    return { direction: "worse", clause: `engaged visits down ${pctWord(rel)}` };
  }
  return { direction: "flat", clause: null };
}

/** Frustration lane (rage + dead clicks per 100 visits): lower is better. */
function frustrationLane(pre: number | null, post: number | null): Lane | null {
  if (pre == null || post == null) return null;
  if (pre <= 0) {
    if (post >= MIN_FRUSTRATION_PER_100_FROM_ZERO) {
      return {
        direction: "worse",
        clause: `frustrated clicks rose to ${Math.round(post)} per 100 visits`,
      };
    }
    return { direction: "flat", clause: null };
  }
  const rel = (post - pre) / pre;
  if (rel <= -FRICTION_REL_THRESHOLD) {
    return { direction: "better", clause: `frustrated clicks down ${pctWord(rel)}` };
  }
  if (rel >= FRICTION_REL_THRESHOLD) {
    return { direction: "worse", clause: `frustrated clicks up ${pctWord(rel)}` };
  }
  return { direction: "flat", clause: null };
}

/** Quick-back lane (visits that bounced straight back): lower is better. */
function quickbackLane(pre: number | null, post: number | null): Lane | null {
  if (pre == null || post == null) return null;
  if (pre <= 0) {
    if (post >= MIN_QUICKBACK_SHARE_FROM_ZERO) {
      return {
        direction: "worse",
        clause: `${Math.round(post * 100)} percent of visits now bounce straight back`,
      };
    }
    return { direction: "flat", clause: null };
  }
  const rel = (post - pre) / pre;
  if (rel <= -FRICTION_REL_THRESHOLD) {
    return {
      direction: "better",
      clause: `visitors bouncing straight back down ${pctWord(rel)}`,
    };
  }
  if (rel >= FRICTION_REL_THRESHOLD) {
    return {
      direction: "worse",
      clause: `visitors bouncing straight back up ${pctWord(rel)}`,
    };
  }
  return { direction: "flat", clause: null };
}

/** Conversions lane: pre is already pro-rated to the post length. */
function conversionsLane(pre: number | null, post: number | null): Lane | null {
  if (pre == null || post == null) return null;
  if (Math.max(pre, post) < MIN_CONVERSIONS_TO_JUDGE) return { direction: "flat", clause: null };
  const delta = Math.round(post - pre);
  if (delta >= 1 && (pre <= 0 || (post - pre) / pre >= CONVERSIONS_REL_THRESHOLD)) {
    return { direction: "better", clause: `${delta} more sign-ups or sales` };
  }
  if (delta <= -1 && pre > 0 && (post - pre) / pre <= -CONVERSIONS_REL_THRESHOLD) {
    return { direction: "worse", clause: `${-delta} fewer sign-ups or sales` };
  }
  return { direction: "flat", clause: null };
}

/** "About 7 in 10 visitors who land here appear to find what they came for." */
function taskCompletionLineFor(share: number | null): string | null {
  if (share == null) return null;
  const tenths = Math.round(clamp01(share) * 10);
  if (tenths <= 0) return "Very few visitors who land here appear to find what they came for.";
  if (tenths >= 10) return "Nearly all visitors who land here appear to find what they came for.";
  return `About ${tenths} in 10 visitors who land here appear to find what they came for.`;
}

function answerDeltaLineFor(
  actionType: string,
  pre: number | null,
  post: number | null,
): string | null {
  if (!isAnswerShapedAction(actionType)) return null;
  if (pre == null || post == null) return null;
  const tPre = Math.round(clamp01(pre) * 10);
  const tPost = Math.round(clamp01(post) * 10);
  if (tPost > tPre) {
    return `More people are finding their answer since the change: ${tPre} in 10 before, ${tPost} in 10 after.`;
  }
  if (tPost < tPre) {
    return `Fewer people are finding their answer since the change: ${tPre} in 10 before, ${tPost} in 10 after.`;
  }
  return `About the same share of people are finding their answer: ${tPre} in 10 before and after.`;
}

/**
 * The one composite read. Floors are applied PER METRIC PER WINDOW: a window
 * below its floor contributes null for that source's metrics (honest absence),
 * and a lane needs both windows to say anything about direction.
 */
export function computeBehaviorOutcome(args: {
  /** Elapsed post-window days (0 = no post day yet; everything stays null). */
  windowDays: number;
  /** Pre window length in days (the 28-day baseline). */
  preWindowDays: number;
  actionType: string;
  ga4Pre: BehaviorGa4Window;
  ga4Post: BehaviorGa4Window;
  clarityPre: BehaviorClarityWindow;
  clarityPost: BehaviorClarityWindow;
  dataThrough: string | null;
}): BehaviorOutcome {
  const { windowDays, preWindowDays, actionType, ga4Pre, ga4Post, clarityPre, clarityPost } = args;
  const ran = windowDays > 0;

  const ga4PreOk = ran && ga4Pre.sessions >= GA4_MIN_SESSIONS_PER_WINDOW;
  const ga4PostOk = ran && ga4Post.sessions >= GA4_MIN_SESSIONS_PER_WINDOW;
  const clarityPreOk = ran && clarityPre.visits >= CLARITY_MIN_VISITS_PER_WINDOW;
  const clarityPostOk = ran && clarityPost.visits >= CLARITY_MIN_VISITS_PER_WINDOW;

  const engagedSharePre = ga4PreOk ? clamp01(ga4Pre.engagedSessions / ga4Pre.sessions) : null;
  const engagedSharePost = ga4PostOk ? clamp01(ga4Post.engagedSessions / ga4Post.sessions) : null;

  // Pre conversions pro-rated to the post length so the counts compare fairly.
  const scale = preWindowDays > 0 ? windowDays / preWindowDays : 1;
  const conversionsPre = ga4PreOk ? ga4Pre.conversions * scale : null;
  const conversionsPost = ga4PostOk ? ga4Post.conversions : null;

  const frustrationPer100Pre = clarityPreOk
    ? ((clarityPre.rageClicks + clarityPre.deadClicks) / clarityPre.visits) * 100
    : null;
  const frustrationPer100Post = clarityPostOk
    ? ((clarityPost.rageClicks + clarityPost.deadClicks) / clarityPost.visits) * 100
    : null;
  const quickbackSharePre = clarityPreOk ? clamp01(clarityPre.quickbacks / clarityPre.visits) : null;
  const quickbackSharePost = clarityPostOk
    ? clamp01(clarityPost.quickbacks / clarityPost.visits)
    : null;

  const taskCompletionSharePre = taskCompletionShare(engagedSharePre, quickbackSharePre);
  const taskCompletionSharePost = taskCompletionShare(engagedSharePost, quickbackSharePost);

  // Lanes (null = below floor somewhere, honestly excluded from the composite).
  const lanes = [
    engagedLane(engagedSharePre, engagedSharePost),
    frustrationLane(frustrationPer100Pre, frustrationPer100Post),
    quickbackLane(quickbackSharePre, quickbackSharePost),
    conversionsLane(conversionsPre, conversionsPost),
  ].filter((l): l is Lane => l != null);

  const betterClauses = lanes.filter((l) => l.direction === "better" && l.clause).map((l) => l.clause!);
  const worseClauses = lanes.filter((l) => l.direction === "worse" && l.clause).map((l) => l.clause!);

  let compositeVerdict: BehaviorCompositeVerdict;
  if (lanes.length === 0) compositeVerdict = "none";
  else if (betterClauses.length > 0 && worseClauses.length > 0) compositeVerdict = "mixed";
  else if (betterClauses.length > 0) compositeVerdict = "better";
  else if (worseClauses.length > 0) compositeVerdict = "worse";
  else compositeVerdict = "same";

  // Sample receipt tail: name the visits the read stands on, preferring the
  // GA4 lane's sessions when it cleared its floors, else Clarity's visits.
  const tail =
    ga4PreOk && ga4PostOk
      ? `Read on ${fmtCount(ga4Pre.sessions)} visits before the change and ${fmtCount(ga4Post.sessions)} after.`
      : clarityPreOk && clarityPostOk
        ? `Read on ${fmtCount(clarityPre.visits)} visits before the change and ${fmtCount(clarityPost.visits)} after.`
        : null;

  let sentence: string | null = null;
  if (compositeVerdict === "better") {
    sentence = `Visitors behave better since the change: ${betterClauses.join(", ")}.`;
  } else if (compositeVerdict === "worse") {
    sentence = `Visitors behave worse since the change: ${worseClauses.join(", ")}.`;
  } else if (compositeVerdict === "mixed") {
    sentence = `Mixed read on visitors since the change: ${betterClauses.join(", ")}, but ${worseClauses.join(", ")}.`;
  } else if (compositeVerdict === "same") {
    sentence = "Visitors behave about the same since the change.";
  }
  if (sentence != null && tail != null) sentence = `${sentence} ${tail}`;

  return {
    ran,
    windowDays,
    engagedSharePre,
    engagedSharePost,
    frustrationPer100Pre,
    frustrationPer100Post,
    quickbackSharePre,
    quickbackSharePost,
    conversionsPre,
    conversionsPost,
    ga4SessionsPre: ga4Pre.sessions,
    ga4SessionsPost: ga4Post.sessions,
    clarityVisitsPre: clarityPre.visits,
    clarityVisitsPost: clarityPost.visits,
    taskCompletionSharePre,
    taskCompletionSharePost,
    compositeVerdict,
    sentence,
    // The card's current-state read prefers the post window (the page as it is
    // now); an in-flight change whose post window is still thin honestly falls
    // back to the pre-window read of the same page.
    taskCompletionLine: taskCompletionLineFor(taskCompletionSharePost ?? taskCompletionSharePre),
    answerDeltaLine: answerDeltaLineFor(actionType, taskCompletionSharePre, taskCompletionSharePost),
    dataThrough: args.dataThrough,
  };
}
