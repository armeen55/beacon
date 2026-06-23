/**
 * Pure traffic/conversion outcome math for the proof ledger (Dollar-ROI, gap #1).
 *
 * Turns GA4 pre/post window metrics into a control-adjusted "did traffic +
 * conversions move?" outcome that sits ALONGSIDE the GSC search verdict. No I/O,
 * no em dashes in copy. Revenue is structurally absent (`hasRevenue: false`):
 * this property's GA4 returns no revenue/eventValue, so proof never implies money.
 */

import type { Ga4WindowMetrics } from "./ga4-window";

export type TrafficOutcome = {
  /** GA4 had usable rows for the treated page in this window. */
  hasData: boolean;
  /** Post window had enough settled GA4 data to read (else "measuring"). */
  ran: boolean;
  /** Post window length measured, in days. */
  windowDays: number;
  /** Treated page, pre (pro-rated to the post length) vs post. */
  treated: {
    sessionsPre: number;
    sessionsPost: number;
    conversionsPre: number;
    conversionsPost: number;
  };
  /** Treated sessions % change pre to post (pro-rated), null when no pre data. */
  sessionsPctChange: number | null;
  /** Mean control sessions % change (diff-in-diff baseline), null when none. */
  controlSessionsPctChange: number | null;
  /** treated minus control sessions % (the control-adjusted lift), null-safe. */
  adjustedSessionsPct: number | null;
  /** Conversions delta = post minus pro-rated pre, treated page. */
  conversionsDelta: number;
  /** GA4 returns no revenue for this property; proof must not imply money. */
  hasRevenue: false;
  /** Plain-English summary (no em dashes). */
  label: string;
};

function pct(pre: number, post: number): number | null {
  return pre > 0 ? (post - pre) / pre : null;
}

function pctStr(v: number): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${Math.round(v * 100)}%`;
}

export function computeTrafficOutcome(args: {
  windowDays: number;
  ran: boolean;
  preWindowDays: number;
  treatedPre: Ga4WindowMetrics;
  treatedPost: Ga4WindowMetrics;
  controls: Array<{ pre: Ga4WindowMetrics; post: Ga4WindowMetrics }>;
}): TrafficOutcome {
  const { windowDays, ran, preWindowDays, treatedPre, treatedPost, controls } = args;

  // Pro-rate the (longer) pre window to the post window length so a 28d pre is
  // compared fairly against a 7/14/28d post.
  const scale = preWindowDays > 0 ? windowDays / preWindowDays : 1;
  const tPreSessions = treatedPre.sessions * scale;
  const tPreConv = treatedPre.conversions * scale;

  // A post window of 0 days means "no GA4 day since ship yet" → measuring, never
  // a -100% artifact. Real data needs an elapsed window AND some sessions.
  const hasPostWindow = windowDays > 0;
  const hasData = hasPostWindow && (treatedPost.sessions > 0 || treatedPre.sessions > 0);
  const sessionsPctChange = hasPostWindow ? pct(tPreSessions, treatedPost.sessions) : null;

  const ctlPcts: number[] = [];
  for (const c of controls) {
    const v = pct(c.pre.sessions * scale, c.post.sessions);
    if (v != null) ctlPcts.push(v);
  }
  const controlSessionsPctChange =
    ctlPcts.length > 0 ? ctlPcts.reduce((a, b) => a + b, 0) / ctlPcts.length : null;

  const adjustedSessionsPct =
    sessionsPctChange != null && controlSessionsPctChange != null
      ? sessionsPctChange - controlSessionsPctChange
      : sessionsPctChange;

  const conversionsDelta = Math.round(treatedPost.conversions - tPreConv);

  return {
    hasData,
    ran,
    windowDays,
    treated: {
      sessionsPre: Math.round(tPreSessions),
      sessionsPost: treatedPost.sessions,
      conversionsPre: Math.round(tPreConv),
      conversionsPost: treatedPost.conversions,
    },
    sessionsPctChange,
    controlSessionsPctChange,
    adjustedSessionsPct,
    conversionsDelta,
    hasRevenue: false,
    label: buildLabel({ hasData, ran, hasPostWindow, adjustedSessionsPct, conversionsDelta, windowDays }),
  };
}

function buildLabel(a: {
  hasData: boolean;
  ran: boolean;
  hasPostWindow: boolean;
  adjustedSessionsPct: number | null;
  conversionsDelta: number;
  windowDays: number;
}): string {
  if (!a.hasPostWindow) return "Visitor traffic: too soon to tell, first results come a week after you ship";
  if (!a.hasData) return "Visitor traffic: no data for this page yet";
  // Under ~7 days the percentage is pure noise (and a control-adjusted figure can
  // even read an impossible "-122%"). Never show a scary early number (audit #97):
  // say it is too soon and when the first real read lands.
  if (a.windowDays < 7) {
    return `Visitor traffic: too soon to tell (only ${a.windowDays} day${a.windowDays === 1 ? "" : "s"} of data, first read after 7 days)`;
  }
  const parts: string[] = [];
  if (a.adjustedSessionsPct != null) {
    parts.push(`${pctStr(a.adjustedSessionsPct)} visits vs similar pages`);
  }
  if (a.conversionsDelta !== 0) {
    const sign = a.conversionsDelta > 0 ? "+" : "";
    parts.push(`${sign}${a.conversionsDelta} sign-ups or sales`);
  }
  const body = parts.length > 0 ? parts.join(", ") : "about the same";
  // "early" until a full proof window has settled; full read once it has.
  return a.ran
    ? `Visitor traffic (${a.windowDays} days): ${body}`
    : `Visitor traffic so far (${a.windowDays} days, still early): ${body}`;
}
