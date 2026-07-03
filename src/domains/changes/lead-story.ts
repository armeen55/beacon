/**
 * lead-story (UX4, 2026-07-02) - "what matters most right now" in ONE card, deterministically
 * picked from data the Today page already loaded. No new I/O, no new persistence: this is a pure
 * selector over the same ledger rows, attention items, daily plan, and scoreboard the page reads
 * for its other sections.
 *
 * Priority (highest first): a landed verdict (a change that shipped and settled won/lost) >
 * a fired alert or investigation (today.attention / the pipe check / overnight investigation) >
 * tonight's top pick (the daily plan's first selected item) > the biggest mover (the day with the
 * largest click swing in the scoreboard window). The first rule that has real data wins; everything
 * else stays silent so the card never invents urgency.
 */

export type LeadStoryKind = "landed_verdict" | "fired_alert" | "tonight_pick" | "biggest_mover";

export type LeadStory = {
  kind: LeadStoryKind;
  /** Small kicker label, e.g. "Result" / "Needs attention" / "Tonight" / "Biggest mover". */
  label: string;
  /** The one sentence answering "what matters most right now". */
  sentence: string;
  /** Where the one action link goes. */
  href: string;
  /** The action link's own text. */
  actionLabel: string;
  tone: "good" | "bad" | "neutral" | "warning";
};

/** A settled ledger row, trimmed to only what the selector needs. */
export type LeadStoryLedgerRow = {
  path: string;
  shippedAt: string;
  verdict: "measuring" | "won" | "lost" | "inconclusive" | "insufficient_data";
  pageLabel?: string | null;
};

export type LeadStoryAttentionItem = {
  title: string;
  message: string;
  href: string;
};

export type LeadStoryPlanPick = {
  pageLabel: string;
  whyNow: string;
  headline: string;
};

export type LeadStoryMoverDay = {
  date: string;
  clicks: number;
};

function prettyLeadPath(u: string): string {
  const p = (u.replace(/^https?:\/\/[^/]+/i, "") || "/").replace(/\/$/, "") || "/";
  return p.length > 40 ? p.slice(0, 37) + "..." : p;
}

function monthDayLabel(iso: string): string | null {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
}

/** Rule 1: the most recently settled won/lost verdict, newest first. A "won" reads as a plain
 *  celebration; a "lost" is owned plainly, per the Beacon voice rule. */
function pickLandedVerdict(ledger: LeadStoryLedgerRow[]): LeadStory | null {
  const settled = ledger
    .filter((r) => r.verdict === "won" || r.verdict === "lost")
    .sort((a, b) => (a.shippedAt < b.shippedAt ? 1 : -1));
  const row = settled[0];
  if (!row) return null;
  const page = row.pageLabel ?? prettyLeadPath(row.path);
  const when = monthDayLabel(row.shippedAt);
  if (row.verdict === "won") {
    return {
      kind: "landed_verdict",
      label: "Result",
      sentence: `The change on ${page} won${when ? ` (shipped ${when})` : ""}.`,
      href: "/proof",
      actionLabel: "See the result",
      tone: "good",
    };
  }
  return {
    kind: "landed_verdict",
    label: "Result",
    sentence: `The change on ${page} did not work${when ? ` (shipped ${when})` : ""}. Here is what I learned.`,
    href: "/proof",
    actionLabel: "See what I learned",
    tone: "bad",
  };
}

/** Rule 2: the single highest-priority fired alert (today.attention is already sorted by
 *  priority, lower = more urgent, and an overnight investigation/pipe break outranks it). */
function pickFiredAlert(attention: LeadStoryAttentionItem[]): LeadStory | null {
  const top = attention[0];
  if (!top) return null;
  return {
    kind: "fired_alert",
    label: "Needs attention",
    sentence: top.message ? `${top.title}. ${top.message}` : top.title,
    href: top.href,
    actionLabel: "Review it",
    tone: "warning",
  };
}

/** Rule 3: tonight's first planned pick, in its own "why it wins" words. */
function pickTonightTopPick(pick: LeadStoryPlanPick | null): LeadStory | null {
  if (!pick) return null;
  return {
    kind: "tonight_pick",
    label: "Tonight",
    sentence: `${pick.headline}. ${pick.whyNow}`,
    href: "#daily-experiments",
    actionLabel: "See tonight's plan",
    tone: "neutral",
  };
}

/** Rule 4: the day with the largest click swing vs the day before it, in the loaded window. */
function pickBiggestMover(days: LeadStoryMoverDay[]): LeadStory | null {
  if (days.length < 2) return null;
  let bestIdx = -1;
  let bestDelta = 0;
  for (let i = 1; i < days.length; i++) {
    const delta = days[i].clicks - days[i - 1].clicks;
    if (Math.abs(delta) > Math.abs(bestDelta)) {
      bestDelta = delta;
      bestIdx = i;
    }
  }
  if (bestIdx < 0 || bestDelta === 0) return null;
  const day = days[bestIdx];
  const when = monthDayLabel(day.date) ?? day.date;
  const direction = bestDelta > 0 ? "jumped" : "dropped";
  return {
    kind: "biggest_mover",
    label: "Biggest mover",
    sentence: `Clicks ${direction} by ${Math.abs(bestDelta).toLocaleString()} on ${when}.`,
    href: "#scoreboard-section",
    actionLabel: "See the chart",
    tone: bestDelta > 0 ? "good" : "warning",
  };
}

/**
 * Deterministically pick the single lead story for right now. Every input is data the page
 * already loaded elsewhere; this function does no I/O. Returns null only when none of the four
 * rules has anything real to say (an empty day for every teammate).
 */
export function selectLeadStory(input: {
  ledger: LeadStoryLedgerRow[];
  attention: LeadStoryAttentionItem[];
  tonightTopPick: LeadStoryPlanPick | null;
  moverDays: LeadStoryMoverDay[];
}): LeadStory | null {
  return (
    pickLandedVerdict(input.ledger) ??
    pickFiredAlert(input.attention) ??
    pickTonightTopPick(input.tonightTopPick) ??
    pickBiggestMover(input.moverDays)
  );
}
