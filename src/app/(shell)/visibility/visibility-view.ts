/**
 * visibility-view - EVERY operator-facing string the Visibility surface says, as pure functions over
 * readings the kernels ALREADY took and stored. A rate names the count it was computed over, a missing day
 * is listed by name and never filled in from its neighbours, and nothing adds up into one score. Both tabs
 * come back as the same BLOCK shape, so one component renders every section.
 */

import { monthDayLabel } from "@/components/data/receipt-line";
import type { AiOutcomeReport } from "@/domains/measurement";
import type { ClassifiedDomain, CompetitorKind } from "@/domains/evidence";

/** One section of either tab. An empty block renders nothing at all, never an empty heading. `runs`
 *  is one stretch read on ONE instrument, with the named break that started it. */
export type VisBlock = {
  title: string; notes: string[]; rows: VisRow[]; chips: string[];
  runs: Array<{ breakLabel: string | null; span: string | null; points: Array<{ date: string; clicks: number }> }>;
};

/** ONE line of a section. `details` is the DRILL-DOWN: the whole of what one reading actually was, opened on
 *  demand, so the page stays one screen until the operator asks for more. */
type VisRow = { head: string; body: string; details?: string[] };

const num = (n: number): string => Math.round(n).toLocaleString("en-US");
const block = (title: string, over: Partial<VisBlock> = {}): VisBlock => ({ title, notes: [], rows: [], chips: [], runs: [], ...over });
const keep = (blocks: VisBlock[]): VisBlock[] => blocks.filter((b) => b.notes.length + b.rows.length + b.chips.length + b.runs.length > 0);

/** BOUNDS ON THE SUMMARIES ONLY. Every one of these is a roll-up with a way through to the whole thing:
 *  the searches the assistants ran and the pages they credited are reachable in full, one reading at a time,
 *  through the drill-down below. Nothing an operator cannot reach another way is cut here. */
const MAX_MOVERS = 5, MAX_FANOUTS = 12, MAX_DOMAINS = 20, MAX_ROW_QUERIES = 5;

export type GoogleViewInput = {
  /** Whether Search Console has reported ANY day for this account, and the measurement kernel's own
   *  week against the week before it (null under two weeks of history, which is when it refuses to
   *  say anything, so this view refuses too). */
  hasData: boolean;
  board: { last7Clicks: number; last7Impressions: number; deltaPct: number | null; reportedThrough: string } | null;
  /** Per page, the last 28 reported days against the 28 before them, and the finalized day those
   *  windows split on, so the list names one reproducible window. */
  decay: Array<{ page: string; clicksNow: number; clicksPrior: number; positionNow: number; positionPrior: number }>;
  /** THE SEARCHES BEHIND A MOVING PAGE, per page, off the Search Console rows already held. A page that
   *  gained or lost clicks with no searches named is a number with no explanation under it. */
  queriesByPage?: ReadonlyMap<string, ReadonlyArray<{ query: string; clicks: number; impressions: number; position: number }>>;
  windowEnd: string | null;
  /** The weekly "how you show up" lines already built by the evidence kernel, and the week they cover. */
  weekly: { lines: string[]; weekEnd: string | null } | null;
};

/** WHERE GOOGLE HAS YOU. The week against the week before comes from the SAME scoreboard kernel Today's
 *  chart draws, so the two surfaces can never quote different numbers. `limitation` is set only when there
 *  is no Search Console data at all: the tab then says what it cannot show and points at Connections. */
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
  const queries: NonNullable<GoogleViewInput["queriesByPage"]> = input.queriesByPage ?? new Map();
  const row = (r: GoogleViewInput["decay"][number], gaining: boolean): VisRow => {
    const mine = (queries.get(r.page) ?? []).slice(0, MAX_ROW_QUERIES);
    return { head: `${gaining ? "Gaining" : "Losing"}: ${r.page}`, body:
      `${num(r.clicksNow)} clicks, ${gaining ? "up" : "down"} from ${num(r.clicksPrior)}.`
      + (r.positionNow > 0 && r.positionPrior > 0 ? ` I see it at ${r.positionNow.toFixed(1)} on average now, against ${r.positionPrior.toFixed(1)} before.` : ""),
      ...(mine.length === 0 ? {} : { details: [
        `The searches bringing people to this page, strongest first:`,
        ...mine.map((q) => `"${q.query}": ${num(q.clicks)} ${q.clicks === 1 ? "click" : "clicks"} from ${num(q.impressions)} appearances, at ${q.position.toFixed(1)} on average.`),
        "These are this page's own searches over the last 90 reported days, so they explain the move rather than repeat it.",
      ] }) };
  };
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

/** A FAN-OUT IS WHAT THE ASSISTANT WENT AND SEARCHED FOR, NEVER WHAT I ASKED IT. A tracked question of yours appearing in this list reads as the assistant's
 *  own idea when it was mine, which is Beacon discovering the exact question Beacon put to it. The summary block dropped the self-echo and the per-answer
 *  drill-down printed it straight back, so both go through HERE and cannot drift apart again. (Decision has a third site of this rule in produce-bundle.ts; if
 *  that one is folded in too, this is the helper to hoist, most naturally into evidence/ai-visibility.) */
const fanOutsExcluding = (fanOuts: readonly string[], asked: readonly string[]): string[] => {
  const mine = new Set(asked.map((q) => q.trim().toLowerCase()));
  return [...new Set(fanOuts.map((q) => q.trim()).filter(Boolean))].filter((q) => !mine.has(q.toLowerCase()));
};

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
  /** The stored reading's own identity, which is how the drill-down asks for it again by itself. */
  id: string; day: string;
  promptId: string; promptText: string; engine: string; slot: number; answered: boolean;
  mentioned: boolean | null; cited: boolean | null; fanOuts: string[] | null;
  /** THE READING ITSELF, so the drill-down is the evidence and not a description of it: the whole of what
   *  the assistant wrote, everything it credited (exact addresses, marked yours or not, with the part it
   *  quoted when the provider stored one), what it read without crediting, which model was asked for and
   *  which answered in which mode, when, what the answer cost, and how far I have read it. */
  answerText: string | null;
  citations: Array<{ url: string; domain: string; owned: boolean; passage?: string }> | null;
  retrievedNotCited: string[] | null;
  modelRequested: string | null; modelServed: string | null; mode: string | null;
  askedAt: string | null; answeredAt: string | null; receipt: string | null;
  costUsd: number | null; failureReason: string | null;
  /** read = every word of it has been read closely. part = some of it, the rest still queued. unread. */
  reading: "read" | "part" | "unread";
};

type AiViewInput = {
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

/** WHERE AI ANSWERS HAVE YOU, over answers already bought and stored. Every rate divides by the answers
 *  actually read closely, and `empty` is set when nothing has been read at all so the tab says so rather
 *  than showing a wall of honest looking zeros. */
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
  const kindOf = new Map(rows.map((r) => [r.domain, r.kind]));
  const fanOuts = fanOutsExcluding(input.latest.rows.flatMap((r) => r.fanOuts ?? []), input.latest.rows.map((r) => r.promptText)).slice(0, MAX_FANOUTS);

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
      block("What the assistants searched for", { chips: fanOuts,
        notes: fanOuts.length === 0 ? [] : [`These are searches the assistants ran themselves before answering${askedDay ? ` on ${askedDay}` : ""}, in their own words rather than mine, off the first ${num(input.latest.rows.length)} readings of the day. Open any question below for every search behind that one answer.`,
          ...(compared.length > 0 ? [`I asked ${num(compared.length)} of them a second time and ${num(differed)} answered differently, which is how much these answers move on their own before anything you do.`] : [])] }),
      // ONE list, strongest recurrence first: the authorities the answers keep quoting are in it,
      // labelled "A source", so a second list of them would be the same list twice.
      block("Domains showing up around you", {
        notes: input.landscape == null
          ? ["I could not put together the list of domains showing up around you in time for this visit. Nothing is lost; it lands on your next one."]
          : rows.length === 0 ? ["No domain has shown up around you often enough yet for me to say anything honest about it."] : [],
        rows: rows.filter((r) => r.kind !== "owned").slice(0, MAX_DOMAINS).map((r) => ({ head: r.domain,
          body: `${r.ambiguous ? "Not settled yet" : KIND_LABEL[r.kind]}. ${r.why}` })),
      }),
    ]),
  };
}

/** ONE STORED READING, as a list line and as the whole of itself. `details` is the drill-down and it is CUT
 *  NOWHERE: the complete answer, every search the assistant ran, every page it credited with the part it
 *  quoted when the provider kept one, every page it read without crediting, both model names, the mode, the
 *  day this counts for, when it was asked and answered, what it cost, how far I have read it, and the stored
 *  envelope's own identity. WHAT THE PROVIDER NEVER TOLD ME SAYS SO: "it credited nobody" and "it did not
 *  tell me what it used" are different claims, and printing the first for the second is the lie this
 *  surface exists to refuse. */
export function answerView(
  r: AnswerRow, kindOf: ReadonlyMap<string, CompetitorKind> = new Map(), costUsd: number | null = r.costUsd,
): { id: string; head: string; body: string; details: string[] } {
  const engine = engineName(r.engine), mine = (r.citations ?? []).filter((c) => c.owned).length;
  const own = fanOutsExcluding(r.fanOuts ?? [], [r.promptText]); // the searches that were the assistant's own idea, not an echo of mine
  const cited = (c: NonNullable<AnswerRow["citations"]>[number]): string =>
    `${c.url} (${c.owned ? "your page" : `${c.domain}, ${(KIND_LABEL[kindOf.get(c.domain) ?? "irrelevant_unknown"]).toLowerCase()}`})`
    + (c.passage?.trim() ? ` It quoted this part: "${c.passage.trim()}"` : "");
  return {
    id: r.id, head: `${r.promptText} (${engine})`,
    body: !r.answered ? `${engine} gave me nothing back on this one.${r.failureReason ? ` It said: ${r.failureReason}` : ""}`
      : r.mentioned == null ? "The answer is on file, but nobody has read it closely enough yet for me to say whether you were named."
        : `${r.mentioned ? "You were named." : "You were not named."} ${r.cited === true ? "A page of yours was credited." : r.cited === false ? "No page of yours was credited." : "This answer did not say which pages it used."}`,
    details: [
      `I asked ${engine}, word for word: "${r.promptText}"`,
      ...(r.answerText?.trim() ? [`What it answered, all of it: ${r.answerText.trim()}`]
        : ["I hold no answer text for this one, so there is nothing to quote."]),
      // The tri-state survives the filter: null is still "this path reports nothing", and an answer whose only fan-out was the echo of my own question ran no
      // search of its own, which is a true statement rather than a missing line.
      ...(r.fanOuts == null ? [`${engine} does not report the searches it ran on this path, so I cannot say whether it ran any.`]
        : own.length === 0 ? ["It ran no searches of its own before answering."]
          : [`Before answering it searched for: ${own.map((q) => `"${q}"`).join(", ")}.`]),
      ...(r.citations == null ? [`${engine} does not report which pages it used on this path, so I am not claiming it credited nobody.`]
        : r.citations.length === 0 ? ["It credited no pages at all."]
          : [`It credited ${num(r.citations.length)} ${r.citations.length === 1 ? "page" : "pages"}, ${mine > 0 ? `${num(mine)} of them yours` : "none of them yours"}:`,
            ...r.citations.map(cited)]),
      ...(r.retrievedNotCited == null ? [`${engine} does not report the pages it read but did not credit on this path.`]
        : r.retrievedNotCited.length === 0 ? ["Every page it read, it credited."]
          : [`It also read these and credited none of them: ${r.retrievedNotCited.join(", ")}.`]),
      `${engine} answered as ${r.modelServed ?? "a model it did not name"}${r.modelRequested ? `, and ${r.modelRequested} is what I asked for` : ""}${r.mode ? `, in ${r.mode} mode` : ""}.`,
      `This reading counts for ${monthDayLabel(r.day) ?? r.day}.`
        + (r.askedAt ? ` Asked ${r.askedAt}${r.answeredAt ? `, answered ${r.answeredAt}` : ", and it never came back"}.` : ""),
      r.reading === "read" ? "I have read every word of this answer closely."
        : r.reading === "part" ? "I have read part of this answer closely and the rest is still waiting its turn."
          : "Nobody has read this answer closely yet, so I make no claim here about who it named.",
      // WHAT IT COST, or that I cannot prove it: a row whose own receipt was never preserved is UNKNOWN, and printing zero dollars would sell a paid answer as
      // free. A real charge SMALLER than a cent is the same lie in miniature, because two decimals round 0.004 down to "0.00 dollars", so it says its own size.
      ...(r.receipt ? [`The stored answer this all comes off is filed as ${r.receipt}${costUsd != null && costUsd > 0
        ? `, and it cost ${costUsd < 0.01 ? "under a cent" : `${costUsd.toFixed(2)} dollars`} to buy once.`
        : ", and I hold no receipt proving what it cost, so I am not putting a number on it."}`]
        : ["I did not keep an identity for the stored answer behind this one."]),
    ],
  };
}
