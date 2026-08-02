/**
 * visibility-view (Dream V1 Phase 7) - EVERY operator-facing string the Visibility surface says, as
 * pure functions over readings the kernels ALREADY took and stored. A rate names the count it was
 * computed over, so "named in 18 of the 50 I read closely" can never become a share of answers
 * nobody read. A missing day is listed by name, never filled in from its neighbours. And nothing
 * adds up into one score: an invented number is not an explanation. Both tabs come back as the same
 * BLOCK shape, so one component renders every section.
 */

import { monthDayLabel } from "@/components/data/receipt-line";
import type { AiOutcomeReport } from "@/domains/measurement";
import type { ClassifiedDomain, CompetitorKind } from "@/domains/evidence";

/** One section of either tab. An empty block renders nothing at all, never an empty heading. `runs`
 *  is one stretch read on ONE instrument, with the named break that started it. */
export type VisBlock = {
  title: string; notes: string[]; rows: Array<{ head: string; body: string }>; chips: string[];
  runs: Array<{ breakLabel: string | null; span: string | null; points: Array<{ date: string; clicks: number }> }>;
};

const num = (n: number): string => Math.round(n).toLocaleString("en-US");
const block = (title: string, over: Partial<VisBlock> = {}): VisBlock => ({ title, notes: [], rows: [], chips: [], runs: [], ...over });
const keep = (blocks: VisBlock[]): VisBlock[] => blocks.filter((b) => b.notes.length + b.rows.length + b.chips.length + b.runs.length > 0);

const MAX_MOVERS = 5, MAX_PROMPTS = 50, MAX_FANOUTS = 12, MAX_DOMAINS = 20; // it explains where you stand, it is not a table dump

export type GoogleViewInput = {
  /** Whether Search Console has reported ANY day for this account, and the measurement kernel's own
   *  week against the week before it (null under two weeks of history, which is when it refuses to
   *  say anything, so this view refuses too). */
  hasData: boolean;
  board: { last7Clicks: number; last7Impressions: number; deltaPct: number | null; reportedThrough: string } | null;
  /** Per page, the last 28 reported days against the 28 before them, and the finalized day those
   *  windows split on, so the list names one reproducible window. */
  decay: Array<{ page: string; clicksNow: number; clicksPrior: number; positionNow: number; positionPrior: number }>;
  windowEnd: string | null;
  /** The weekly "how you show up" lines already built by the evidence kernel, and the week they cover. */
  weekly: { lines: string[]; weekEnd: string | null } | null;
};

/**
 * WHERE GOOGLE HAS YOU. The week against the week before it comes from the SAME scoreboard kernel
 * Today's chart draws, so the two surfaces can never quote different numbers for one question.
 * `limitation` is set only when there is no Search Console data at all: the tab then says what it
 * cannot show and points at Connections, and it never goes blank.
 */
export function googleView(input: GoogleViewInput): { limitation: string | null; blocks: VisBlock[] } {
  if (!input.hasData) {
    return {
      limitation: "I do not have any Search Console numbers for this account, so I cannot show you clicks, appearances, or rankings here. Connect Google Search Console on Connections and I will fill this tab in on my next daily round.",
      blocks: [],
    };
  }
  const b = input.board, pct = b?.deltaPct ?? null;
  const compare = pct == null ? "I do not have a full week before that one to compare it against yet."
    : pct > 2 ? `That is up ${pct}% on the week before.`
      : pct < -2 ? `That is down ${Math.abs(pct)}% on the week before.` : "That is about even with the week before.";
  const through = monthDayLabel(b?.reportedThrough ?? null), end = monthDayLabel(input.windowEnd);
  // Clicks first, because clicks are what pays, then rank. A position of zero means no ranking was
  // reported for that window, which is not a rank of zero.
  const movers = input.decay.filter((r) => r.page && (r.clicksNow > 0 || r.clicksPrior > 0)).sort((x, y) => (y.clicksNow - y.clicksPrior) - (x.clicksNow - x.clicksPrior));
  const row = (r: GoogleViewInput["decay"][number], gaining: boolean) => ({ head: `${gaining ? "Gaining" : "Losing"}: ${r.page}`, body:
    `${num(r.clicksNow)} clicks, ${gaining ? "up" : "down"} from ${num(r.clicksPrior)}.`
    + (r.positionNow > 0 && r.positionPrior > 0 ? ` I see it at ${r.positionNow.toFixed(1)} on average now, against ${r.positionPrior.toFixed(1)} before.` : "") });
  const moved = [
    ...movers.filter((r) => r.clicksNow > r.clicksPrior).slice(0, MAX_MOVERS).map((r) => row(r, true)),
    ...[...movers].reverse().filter((r) => r.clicksNow < r.clicksPrior).slice(0, MAX_MOVERS).map((r) => row(r, false)),
  ];
  return {
    limitation: null,
    blocks: keep([
      block("Where Google has you", { notes: [
        ...(b ? [`You had ${num(b.last7Clicks)} clicks and ${num(b.last7Impressions)} appearances over the last 7 reported days. ${compare}`]
          : ["I need two weeks of Search Console history before I compare one stretch with another. I am collecting it every day and this fills in the moment there is enough."]),
        ...(through ? [`Google's numbers run through ${through}. Google reports a few days behind, so the newest days are still settling.`] : []),
      ] }),
      block("Pages that moved", { rows: moved, notes: moved.length === 0 ? [] : [
        `Each page here compares the 28 days${end ? ` ending ${end}` : ""} with the 28 days before them. The fix for a page losing ground lives in Changes, never on this page.`,
      ] }),
      block("How you show up on Google", { notes: (input.weekly?.lines ?? []).concat(
        input.weekly?.lines.length && monthDayLabel(input.weekly.weekEnd) ? [`I check this once a week. This is the week ending ${monthDayLabel(input.weekly.weekEnd)}.`] : []) }),
    ]),
  };
}

const ENGINE_LABEL: Record<string, string> = { chatgpt: "ChatGPT", perplexity: "Perplexity", gemini: "Gemini", claude: "Claude" };
const engineName = (raw: string): string => ENGINE_LABEL[(raw || "").toLowerCase()] ?? "An AI assistant";

/** Plain English for the eight groups a recurring domain lands in. */
const KIND_LABEL: Record<CompetitorKind, string> = {
  commercial_competitor: "A competitor", citation_authority: "A source", publisher: "A publisher",
  marketplace_directory: "A marketplace", social_community: "A social platform",
  government_educational: "A government or school site", owned: "Your own site", irrelevant_unknown: "Not relevant",
};

/** ONE stored answer, flattened by the caller so nothing here has to know a database row. `mentioned`
 *  and `cited` are tri-state: null means nobody has read it closely yet, a different claim from "you
 *  were not named". */
export type AnswerRow = {
  promptId: string; promptText: string; engine: string; slot: number; answered: boolean;
  mentioned: boolean | null; cited: boolean | null; fanOuts: string[] | null;
};

export type AiViewInput = {
  /** The daily read, already cut at every model or mode change by the measurement kernel, plus those
   *  same segments as runs with named breaks from the ONE trend presenter. */
  segments: AiOutcomeReport["segments"];
  trend: { summary: string | null; runs: Array<{ breakLabel: string | null; points: Array<{ day: string; label: string; rate: number | null }> }> };
  /** How many days were asked for, so a day nobody read can be named as missing, and today's
   *  canonical round off the persisted run: settled of owed, and how they landed. */
  windowDays: number;
  checks: { done?: number; total?: number; answered?: number; unavailable?: number; unsupported?: number };
  /** The newest day that holds readings with every reading on it including extra samples, and every
   *  recurring domain with its group and its why (null when I could not assemble that list). */
  latest: { day: string | null; rows: AnswerRow[] };
  landscape: ClassifiedDomain[] | null;
};

/** Today's round as one sentence. Null when no run has planned a round yet: a bare "0 of 0" is noise. */
function coverageLine(c: AiViewInput["checks"]): string | null {
  if (typeof c.done !== "number" || typeof c.total !== "number" || c.total <= 0) return null;
  const parts = [
    ...(typeof c.answered === "number" ? [`${num(c.answered)} came back with an answer`] : []),
    ...(c.unavailable ? [`${num(c.unavailable)} found nothing to give me`] : []),
    ...(c.unsupported ? [`${num(c.unsupported)} I cannot ask at all today`] : []),
  ];
  return `I have settled ${num(c.done)} of the ${num(c.total)} answer checks I planned for today${parts.length > 0 ? `: ${parts.join(", ")}.` : "."}`;
}

/** The days in the window I never got a reading on, named rather than smoothed over. */
function missingLine(days: AiOutcomeReport["segments"][number]["days"], windowDays: number): string | null {
  const read = days.filter((d) => d.observed > 0);
  if (read.length === 0) return null;
  if (read.length >= windowDays) return `I read answers on all ${num(windowDays)} of the last ${num(windowDays)} days.`;
  const have = new Set(read.map((d) => d.day));
  const gaps = days.filter((d) => !have.has(d.day) && d.day >= read[0]!.day).map((d) => monthDayLabel(d.day) ?? d.day);
  const named = gaps.length === 0 ? "" : ` ${gaps.slice(0, 3).join(", ")}${gaps.length > 3 ? ` and ${gaps.length - 3} more` : ""} came back with nothing.`;
  return `I read answers on ${num(read.length)} of the last ${num(windowDays)} days.${named} A day I missed stays missed, and I never fill one in.`;
}

/**
 * WHERE AI ANSWERS HAVE YOU, over answers already bought and stored. Every rate divides by the
 * answers actually read closely, every list is bounded, and `empty` is set when nothing has been
 * read at all so the tab says so rather than showing a wall of honest looking zeros.
 */
export function aiView(input: AiViewInput): { empty: string | null; blocks: VisBlock[] } {
  const days = input.segments.flatMap((s) => s.days);
  if (days.length === 0) {
    return { empty: "I have not read a single AI answer for this account yet. My daily round reads them for you, and this tab fills in from the first one it stores.", blocks: [] };
  }
  const analyzed = days.filter((d) => d.analyzed > 0), newest = analyzed[analyzed.length - 1] ?? null;
  const standing = newest == null ? null
    : `On ${monthDayLabel(newest.day) ?? newest.day} you were named in ${num(newest.mentioning)} of the ${num(newest.analyzed)} answers I read closely`
    + (newest.citationSample > 0
      ? `, and a page of yours was credited in ${num(newest.ownedCiting)} of the ${num(newest.citationSample)} that told me what they used.`
      : ". None of that day's answers told me which pages they used, so I am not claiming a citation number.");
  const owned = days.reduce((a, d) => a + d.ownedCiting, 0);

  const byEngine = new Map<string, { asked: number; observed: number; mentioning: number; cited: number }>();
  for (const d of days) for (const e of d.byEngine) {
    const a = byEngine.get(e.engine) ?? { asked: 0, observed: 0, mentioning: 0, cited: 0 };
    a.asked += e.asked; a.observed += e.observed; a.mentioning += e.mentioning; a.cited += e.citedOwned;
    byEngine.set(e.engine, a); }

  const askedDay = monthDayLabel(input.latest.day);
  const canonical = input.latest.rows.filter((r) => r.slot === 0);
  const canonicalBy = new Map(canonical.map((r) => [`${r.promptId}|${r.engine}`, r.mentioned]));
  const compared = input.latest.rows.filter((r) => r.slot > 0 && r.mentioned != null && canonicalBy.has(`${r.promptId}|${r.engine}`));
  const differed = compared.filter((r) => canonicalBy.get(`${r.promptId}|${r.engine}`) !== r.mentioned).length;
  const rows = input.landscape ?? [];
  const fanOuts = [...new Set(input.latest.rows.flatMap((r) => r.fanOuts ?? []).map((q) => q.trim()).filter(Boolean))].slice(0, MAX_FANOUTS);

  return {
    empty: null,
    blocks: keep([
      block("How often AI answers name you", {
        notes: [standing, owned > 0 ? `Across the last ${num(input.windowDays)} days your own pages were credited ${num(owned)} ${owned === 1 ? "time" : "times"} in the answers I read.` : null,
          input.trend.summary, coverageLine(input.checks), missingLine(days, input.windowDays)].filter((s): s is string => !!s),
        runs: input.trend.runs.map((r) => {
          const read = r.points.filter((p) => p.rate != null);
          return { breakLabel: r.breakLabel, span: read.length > 0 ? `${read[0]!.label} to ${read[read.length - 1]!.label}` : null,
            points: read.map((p) => ({ date: p.day, clicks: Math.round((p.rate ?? 0) * 100) })) };
        }),
      }),
      block("Assistant by assistant", {
        rows: [...byEngine.entries()].sort((a, b2) => b2[1].observed - a[1].observed).map(([engine, a]) => ({
          head: engineName(engine),
          body: `${num(a.observed)} of the ${num(a.asked)} questions I put to it came back. You were named in ${num(a.mentioning)} of those answers, and a page of yours was credited in ${num(a.cited)}.`,
        })),
      }),
      block("Question by question", {
        notes: canonical.length === 0 ? [] : [
          `${askedDay ? `Asked on ${askedDay}. ` : ""}${canonical.length > MAX_PROMPTS ? `Showing the first ${MAX_PROMPTS} of ${num(canonical.length)} questions.` : `All ${num(canonical.length)} questions I asked that day.`}`,
          ...(compared.length > 0 ? [`I asked ${num(compared.length)} of them a second time and ${num(differed)} answered differently, which is how much these answers move on their own before anything you do.`] : []),
        ],
        rows: canonical.slice(0, MAX_PROMPTS).map((r) => ({
          head: `${r.promptText} (${engineName(r.engine)})`,
          body: !r.answered ? "The assistant gave me nothing back on this one."
            : r.mentioned == null ? "The answer is on file, but nobody has read it closely enough yet for me to say whether you were named."
              : `${r.mentioned ? "You were named." : "You were not named."} ${r.cited === true ? "A page of yours was credited." : r.cited === false ? "No page of yours was credited." : "This answer did not say which pages it used."}`,
        })),
      }),
      block("What the assistants searched for", { chips: fanOuts,
        notes: fanOuts.length === 0 ? [] : [`These are the searches the assistants ran themselves before answering${askedDay ? ` on ${askedDay}` : ""}, in their own words rather than mine.`] }),
      // ONE list, strongest recurrence first: the authorities the answers keep quoting are in it,
      // labelled "A source", so a second list of them would be the same list twice.
      block("Domains showing up around you", {
        notes: input.landscape == null
          ? ["I could not put together the list of domains showing up around you in time for this visit. Nothing is lost; it lands on your next one."]
          : rows.length === 0 ? ["No domain has shown up around you often enough yet for me to say anything honest about it."] : [],
        rows: rows.filter((r) => r.kind !== "owned").slice(0, MAX_DOMAINS).map((r) => ({ head: r.domain, body: `${KIND_LABEL[r.kind]}. ${r.why}` })),
      }),
    ]),
  };
}
