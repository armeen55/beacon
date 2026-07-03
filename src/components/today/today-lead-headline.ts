/**
 * today-lead-headline (P14, v1 459/461 - "lead story / verdict takeover") - the single most
 * important thing today, told as ONE plain headline at the very top of Today:
 *
 *   "Your biggest win this week: /farsi-numbers is up 40 clicks. Your next move: ship the /cities title."
 *
 * PURE (no I/O). Composed ONLY from data the Today page already loaded for its other sections -
 * the shipped-change ledger (the SAME rows the header streak + cumulative strip read), tonight's
 * top pick (the SAME first selected plan row the Tonight panel renders), the highest-priority
 * fired alert (today.attention[0], the SAME item the Needs-attention list leads with), and the
 * scoreboard's daily click series (the SAME 84-day totals the chart reads). No new count is
 * invented here; every clause reuses a number another surface already owns.
 *
 * Two clauses, each self-hiding:
 *   WIN  - the strongest measured win this week (a won verdict with a positive click lift), or
 *          the biggest positive click mover of the week when no verdict has landed. Owns a loss
 *          plainly when the only settled result this week did not work (no false celebration).
 *   NEXT - tonight's top planned pick if one exists, else the single most urgent fired alert.
 *
 * When BOTH clauses come up empty the whole headline self-hides (returns null) so a quiet day
 * never shows an empty hero. Beacon voice: first person where it speaks, a concrete number in
 * every clause, a next step; no lab jargon; no em or en dashes.
 *
 * This is the ONE lead block on Today - it subsumes the earlier single-signal lead card so the
 * page never shows two "what matters most" widgets for the same underlying numbers.
 */

export type LeadHeadlineLedgerRow = {
  path: string;
  shippedAt: string; // ISO
  verdict: "measuring" | "won" | "lost" | "inconclusive" | "insufficient_data";
  pageLabel?: string | null;
  /** Measured extra clicks a month this win is adding, when known (null for a loss / unmeasured). */
  monthlyClickLift?: number | null;
  /** P14 still-arriving shading (v1 520): false when the lift comes from an early/interim window
   *  that has not reached the final 28-day read, so the win clause shades it "still arriving"
   *  instead of showing a hard number that will still change. Defaults to true (a bare number). */
  liftFinal?: boolean;
};

export type LeadHeadlineNextPick = {
  /** Plain page label, e.g. "/cities". */
  pageLabel: string;
  /** The prepared move headline, e.g. "Tighten the title on /cities". */
  headline: string;
};

export type LeadHeadlineAlert = {
  title: string;
  href: string;
};

export type LeadHeadlineMoverDay = {
  date: string; // YYYY-MM-DD
  clicks: number;
};

export type TodayLeadHeadline = {
  /** The win / loss clause ("Your biggest win this week: ..."), or null when nothing measured. */
  winClause: string | null;
  /** The next-move clause ("Your next move: ..."), or null when nothing is queued. */
  nextClause: string | null;
  /** Where the single action link goes (tonight's plan, or the alert's target). */
  href: string;
  /** The action link text. */
  actionLabel: string;
  /** Color language: a landed win reads good, a landed loss reads bad, otherwise neutral ink. */
  tone: "good" | "bad" | "neutral";
};

const DAY_MS = 86_400_000;

/**
 * Adapt a re-measured proof record (the SAME ShippedChangeRecord[] page.tsx already loaded from
 * loadProofLedgerCached, which carries closed `windows`) into the lean ledger row this selector
 * needs, computing `monthlyClickLift` from the latest CLOSED window's adjustedLift rolled to a
 * monthly rate - the SAME math the cumulative-outcome strip uses. PURE: reads only the record's
 * own windows + verdict, no I/O. A row with no closed window (still collecting) gets a null lift
 * so the win clause never shows a hard number off an open measurement.
 */
export function adaptProofRecordForLead(record: {
  path: string;
  pageLabel?: string | null;
  shippedAt: string;
  verdict: LeadHeadlineLedgerRow["verdict"];
  windows: ReadonlyArray<{ day: number; ran: boolean; adjustedLift: number }>;
}): LeadHeadlineLedgerRow {
  const closed = record.windows
    .filter((w) => w.ran && (w.day === 7 || w.day === 14 || w.day === 28))
    .sort((a, b) => b.day - a.day);
  const basis = closed[0];
  const monthlyClickLift =
    basis && Number.isFinite(basis.adjustedLift) && basis.adjustedLift > 0
      ? Math.round((basis.adjustedLift * 30) / basis.day)
      : null;
  // P14 still-arriving shading (v1 520): the lift is a FINAL number only once the 28-day window
  // has closed; a 7- or 14-day basis is directional and still arriving.
  const liftFinal = basis?.day === 28;
  return {
    path: record.path,
    pageLabel: record.pageLabel ?? null,
    shippedAt: record.shippedAt,
    verdict: record.verdict,
    monthlyClickLift,
    liftFinal,
  };
}

function prettyPath(u: string): string {
  const p = (u.replace(/^https?:\/\/[^/]+/i, "") || "/").replace(/\/$/, "") || "/";
  return p.length > 40 ? p.slice(0, 37) + "..." : p;
}

/**
 * The WIN clause. Priority:
 *   1. The strongest WON verdict shipped this week that carries a measured monthly click lift.
 *   2. Any WON verdict shipped this week (celebrated without a fabricated number - names the page).
 *   3. The biggest positive daily click mover in the window (a real number, "up N clicks").
 *   4. If the ONLY settled result this week was a loss, own it plainly (no false win).
 *
 * Returns { text, tone }. tone is "good" for a win/positive mover, "bad" for an owned loss,
 * null-clause (text null) when there is genuinely nothing measured to lead with.
 */
function buildWinClause(
  ledger: LeadHeadlineLedgerRow[],
  moverDays: LeadHeadlineMoverDay[],
  nowMs: number,
): { text: string | null; tone: "good" | "bad" | "neutral" } {
  const weekStart = nowMs - 7 * DAY_MS;
  const thisWeek = ledger.filter((r) => {
    const t = Date.parse(r.shippedAt);
    return Number.isFinite(t) && t >= weekStart && t <= nowMs;
  });

  // 1 + 2: a WON verdict this week. Prefer the one with the largest measured lift.
  const wonThisWeek = thisWeek
    .filter((r) => r.verdict === "won")
    .sort((a, b) => (b.monthlyClickLift ?? 0) - (a.monthlyClickLift ?? 0));
  const topWon = wonThisWeek[0];
  if (topWon) {
    const page = topWon.pageLabel ?? prettyPath(topWon.path);
    const lift = topWon.monthlyClickLift ?? 0;
    if (lift > 0) {
      // P14 still-arriving shading (v1 520): a lift off an early/interim window is real but not
      // final, so say "on track for about N a month, still arriving" instead of a hard figure.
      const finalLift = topWon.liftFinal !== false;
      const text = finalLift
        ? `Your biggest win this week: ${page} is up about ${lift.toLocaleString()} click${lift === 1 ? "" : "s"} a month.`
        : `Your biggest win this week: ${page} is on track for about ${lift.toLocaleString()} click${lift === 1 ? "" : "s"} a month, still arriving.`;
      return { text, tone: "good" };
    }
    return { text: `Your biggest win this week: the change on ${page} won.`, tone: "good" };
  }

  // 3: the biggest positive daily click mover this week (a real, page-agnostic number).
  const weekMovers = moverDays.filter((d) => {
    const t = Date.parse(`${d.date}T00:00:00Z`);
    return Number.isFinite(t) && t >= weekStart && t <= nowMs;
  });
  let bestDelta = 0;
  let bestDate: string | null = null;
  for (let i = 1; i < weekMovers.length; i++) {
    const delta = weekMovers[i].clicks - weekMovers[i - 1].clicks;
    if (delta > bestDelta) {
      bestDelta = delta;
      bestDate = weekMovers[i].date;
    }
  }
  if (bestDelta > 0 && bestDate) {
    return {
      text: `Your biggest win this week: clicks jumped by ${bestDelta.toLocaleString()} on ${monthDay(bestDate)}.`,
      tone: "good",
    };
  }

  // 4: no win at all - if the only settled result this week was a loss, own it plainly.
  const lostThisWeek = thisWeek
    .filter((r) => r.verdict === "lost")
    .sort((a, b) => (a.shippedAt < b.shippedAt ? 1 : -1));
  const anyWonEver = ledger.some((r) => r.verdict === "won");
  if (lostThisWeek[0] && !anyWonEver) {
    const page = lostThisWeek[0].pageLabel ?? prettyPath(lostThisWeek[0].path);
    return {
      text: `This week: the change on ${page} did not work. Here is what I learned.`,
      tone: "bad",
    };
  }

  return { text: null, tone: "neutral" };
}

/** "Jul 2" from a YYYY-MM-DD date, in Pacific to match the rest of Today's date labels. */
function monthDay(date: string): string {
  const t = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(t)) return date;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
}

/**
 * The NEXT clause. Priority: tonight's top planned pick > the single most urgent fired alert.
 * Returns the sentence plus where the action link should point.
 */
function buildNextClause(
  nextPick: LeadHeadlineNextPick | null,
  topAlert: LeadHeadlineAlert | null,
): { text: string | null; href: string; actionLabel: string } {
  if (nextPick) {
    return {
      text: `Your next move: ${nextPick.headline}.`,
      href: "#daily-experiments",
      actionLabel: "See tonight's plan",
    };
  }
  if (topAlert) {
    return {
      text: `Your next move: ${topAlert.title}.`,
      href: topAlert.href,
      actionLabel: "Review it",
    };
  }
  return { text: null, href: "/changes", actionLabel: "Open Changes" };
}

/**
 * Compose the one lead headline. Returns null ONLY when BOTH clauses are empty (a genuinely
 * quiet day), so the hero self-hides rather than render an empty band. Deterministic for a
 * fixed nowMs; no I/O.
 */
export function buildTodayLeadHeadline(input: {
  ledger: LeadHeadlineLedgerRow[];
  moverDays: LeadHeadlineMoverDay[];
  nextPick: LeadHeadlineNextPick | null;
  topAlert: LeadHeadlineAlert | null;
  nowMs: number;
}): TodayLeadHeadline | null {
  const win = buildWinClause(input.ledger, input.moverDays, input.nowMs);
  const next = buildNextClause(input.nextPick, input.topAlert);
  if (!win.text && !next.text) return null;
  // Tone leads on the win when there is one; a headline that is only a next-move reads neutral.
  const tone = win.text ? win.tone : "neutral";
  // The action link points at whatever the NEXT clause targets; if there is no next clause but
  // there is a win, the link opens Results so the operator can act on the win.
  const href = next.text ? next.href : "/results";
  const actionLabel = next.text ? next.actionLabel : "See the result";
  return {
    winClause: win.text,
    nextClause: next.text,
    href,
    actionLabel,
    tone,
  };
}
