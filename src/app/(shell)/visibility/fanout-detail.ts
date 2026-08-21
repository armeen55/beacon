/**
 * fanout-detail - ONE search an assistant ran, opened all the way down: every exact wording it was typed
 * with, the tracked questions it came out of, every answer that ran it with the instrument that served it,
 * the pages of this account those answers read, the pages they credited instead, and what to do about it.
 *
 * WHY THIS EXISTS AS ITS OWN FILE: the Query fan-outs table was a dead end. A search four assistants ran on
 * six days printed a number and nothing a customer could open, so the evidence under it stayed unreadable and
 * the row could not be argued with (operator, 2026-08-19). Everything here is read back off rows the table
 * above it already loaded: this builder fetches nothing, calls no provider and pays nobody.
 *
 * NOTHING HERE DECIDES ANYTHING. The disposition arrives already resolved by the decision kernel, because a
 * screen that works out its own verdict is a second opinion nobody reconciled, and that is exactly how the
 * queue and the surface came to disagree before.
 */

import { monthDayLabel } from "@/components/data/receipt-line";
import { FANOUT_LINKAGE_CAVEAT, type FanoutRow } from "@/domains/evidence";
import type { AnswerRow } from "./visibility-view";

/** ONE cell and ONE table, structural on purpose: DataTable infers both, so no extra symbol becomes public. */
type Cell = { text: string; sub?: string; tone?: "up" | "down" | "flat" | "own"; sort?: number; href?: string };
type Table = { columns: Array<{ key: string; label: string; numeric?: boolean; wide?: boolean }>;
  rows: Array<{ id: string; href?: string; cells: Cell[] }>; note: string | null; empty: string };

/** WHAT THIS SEARCH IS WORTH AND WHAT TO OPEN, decided in the decision kernel and only printed here.
 *  `href` is null when the honest answer is that there is nothing to open about it yet. */
/** WHERE THIS SEARCH ENDED UP, as Decision filed it. `held` is the honest fourth state: the page that would
 *  answer it has never been read, so the next work is that reading and not a change. `change` and `research`
 *  are the two the queue itself carries once a card exists. */
type Disposition = {
  state: "already_credited" | "actionable" | "no_page" | "unreported" | "monitoring" | "held" | "covered" | "change" | "research" | "unavailable";
  line: string; href: string | null;
};

// THESE FORMATTERS ARE COPIED, NOT IMPORTED, from visibility-view: that module sits at the surface's public
// export ceiling, and widening it to share a one line number formatter would spend a public symbol nobody
// outside this folder should ever see. They are kept character for character identical on purpose.
const num = (n: number): string => Math.round(n).toLocaleString("en-US");
const pct = (n: number): string => `${n > 0 && n < 0.1 ? (n * 100).toFixed(1) : Math.round(n * 100)}%`;
const shortUrl = (raw: string): string => (raw ?? "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
const ENGINE_LABEL: Record<string, string> = { chatgpt: "ChatGPT", perplexity: "Perplexity", gemini: "Gemini", claude: "Claude" };
const engineName = (raw: string): string => ENGINE_LABEL[(raw || "").toLowerCase()] ?? "An AI assistant";
/** HOW an answer was asked for, in words. A mode key is what a provider is called with, never what a customer reads. */
const MODE_LABEL: Record<string, string> = { api: "asked directly", consumer_search: "asked the way a person searching would be" };

/** How many runs this panel prints before it says out loud that it cut the list. A live account runs one
 *  recurring search a few hundred times in a month, and a wall of them is not evidence anybody reads. */
const EXECUTIONS_SHOWN = 60;
/** A stored URL compared the way the evidence keys it: a query string and a trailing slash are not identity. */
const trimUrl = (u: string): string => (u.split("?")[0] ?? u).replace(/\/+$/, "");

/** ONE fan-out row opened. `rows` is every reading in the window that ran this exact search, already filtered
 *  by the caller off rows it had in hand, so nothing here triggers a second read of anything. */
export function fanoutDetail(input: {
  row: FanoutRow; rows: readonly AnswerRow[]; spanDays: number; disposition: Disposition;
}) {
  const { row, disposition } = input;
  const spanDays = Math.max(1, Math.round(input.spanDays));
  const plural = (n: number, one: string, many: string): string => `${num(n)} ${n === 1 ? one : many}`;
  // The pages the engine itself named as this account's, so "read and passed over" on a single run is read off
  // the engine's own journey and never guessed by matching words in a URL.
  const ownUrls = new Set(row.ownPages.map((p) => trimUrl(p.url)));
  // WHERE THIS ACCOUNT STOOD ON ONE RUN. An answer that never said what it used is UNREPORTED, which is a
  // different claim from an answer that reported its pages and credited somebody else.
  const stood = (r: AnswerRow): Cell => r.citations == null ? { text: "sources unreported", tone: "flat", sort: 0 }
    : r.cited === true ? { text: "credited a page of yours", tone: "own", sort: 3 }
      : (r.retrievedNotCited ?? []).some((u) => ownUrls.has(trimUrl(u))) ? { text: "read a page of yours, credited somebody else", tone: "down", sort: 2 }
        : { text: "credited somebody else", tone: "down", sort: 1 };
  const runs = [...input.rows].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.engine.localeCompare(b.engine)));

  // ── the tracked questions this search came out of, each one openable ──────────────────────────────
  const parents: Table = {
    columns: [{ key: "question", label: "Tracked question behind it", wide: true }, { key: "runs", label: "Answers that ran it", numeric: true }],
    empty: "No tracked question is recorded behind this search.",
    note: row.parents.length === 0 ? null
      : `${plural(row.parentExecutions, "answer", "answers")} to ${row.parents.length === 1 ? "this question" : "these questions"} reported a search at all, and this one ran on ${pct(row.parentShare)} of them. Open a question for every reading behind it.`,
    rows: [...row.parents].sort((a, b) => b.executions - a.executions || a.promptText.localeCompare(b.promptText))
      .map((p) => ({ id: p.promptId, href: `?view=ai&prompt=${encodeURIComponent(p.promptId)}`,
        cells: [{ text: p.promptText }, { text: num(p.executions), sort: p.executions }] })),
  };

  // ── every run, newest first, each one opening into the whole answer behind it ─────────────────────
  const executions: Table = {
    columns: [{ key: "day", label: "Day", numeric: true }, { key: "engine", label: "Assistant", wide: true },
      { key: "model", label: "Model it answered with", wide: true }, { key: "mode", label: "How it was asked", wide: true },
      { key: "question", label: "Question behind it", wide: true }, { key: "stood", label: "Where you stood", wide: true }],
    empty: "None of the answers behind this search could be read back in time just now. Nothing is lost: the stored answers are safe and this fills in on the next visit.",
    note: runs.length === 0 ? null
      : `Every answer that ran this search, newest first. Open one for the whole answer, every page it credited and every other search behind it.${runs.length > EXECUTIONS_SHOWN ? ` Showing the ${num(EXECUTIONS_SHOWN)} newest of ${num(runs.length)} executions. The rest are on file, not gone.` : ""}`,
    rows: runs.slice(0, EXECUTIONS_SHOWN).map((r) => ({
      id: r.id, href: `?view=ai&prompt=${encodeURIComponent(r.promptId)}&reading=${encodeURIComponent(r.id)}`,
      cells: [
        { text: monthDayLabel(r.day) ?? r.day, sort: Number(r.day.replace(/-/g, "")) || 0 },
        { text: engineName(r.engine) },
        { text: r.modelServed ?? "not named" },
        { text: r.mode && MODE_LABEL[r.mode] ? MODE_LABEL[r.mode]! : "not named" },
        { text: r.promptText },
        stood(r),
      ],
    })),
  };

  // ── the pages of this account those same answers opened ──────────────────────────────────────────
  const ownPages: Table = {
    columns: [{ key: "page", label: "Your page the assistants opened", wide: true }, { key: "cited", label: "Credited", numeric: true },
      { key: "read", label: "Read", numeric: true }, { key: "rnc", label: "Read, passed over", numeric: true }],
    empty: row.reportingAnswers === 0
      ? "None of the answers that ran this search said what they read, so there is no claim that they skipped every page of yours."
      : "No answer that ran this search reported opening a page of yours.",
    note: row.ownPages.length === 0 ? null
      : `The pages the assistants themselves named on the answers that ran this search. "Read, passed over" is the page that was good enough to open and not good enough to quote: the clearest change to make.`,
    rows: row.ownPages.map((p) => ({ id: p.url, cells: [
      { text: shortUrl(p.url), tone: "own" as const }, { text: num(p.cited), sort: p.cited },
      { text: num(p.retrieved), sort: p.retrieved },
      { text: num(p.retrievedNotCited), sort: p.retrievedNotCited, tone: p.retrievedNotCited > 0 ? "down" as const : undefined },
    ] })),
  };

  // ── who took the credit instead, and how many were never listed ──────────────────────────────────
  const rivals: Table = {
    columns: [{ key: "page", label: "Page credited instead", wide: true }, { key: "site", label: "Site", wide: true },
      { key: "answers", label: "Answers crediting it", numeric: true }],
    empty: row.reportingAnswers === 0
      ? "None of the answers that ran this search said which pages they used, so there is no claim that they credited nobody."
      : "Not one answer that ran this search credited a page outside this account.",
    // FIVE SHOWN NEVER READS AS ALL THERE WERE: the total says what the list is a top of.
    note: row.rivalPagesTotal === 0 ? null
      : row.rivalPagesTotal > row.rivalPages.length
        ? `${plural(row.rivalPagesTotal, "page", "pages")} outside this account were credited on these answers, and the ${num(row.rivalPages.length)} credited most often are listed. The rest are on file, not gone.`
        : `All ${plural(row.rivalPagesTotal, "page", "pages")} outside this account credited on these answers are listed.`,
    rows: row.rivalPages.map((p) => ({ id: p.url, cells: [
      { text: shortUrl(p.url) }, { text: p.domain }, { text: num(p.answers), sort: p.answers },
    ] })),
  };

  // WHERE THIS ACCOUNT STOOD ACROSS ALL OF THEM, over the denominator that reported anything at all.
  const standing = row.ownState === "cited"
    ? `A page here was credited on ${num(row.ownCitedAnswers)} of the ${plural(row.reportingAnswers, "answer", "answers")} that said which pages they used.`
    : row.ownState === "retrieved_not_cited"
      ? `A page here was opened and passed over on ${num(row.retrievedNotCitedAnswers)} of the ${plural(row.reportingAnswers, "answer", "answers")} that said which pages they used. That page earned the read and lost the credit.`
      : row.ownState === "not_retrieved"
        ? `Not one of the ${plural(row.reportingAnswers, "answer", "answers")} that said which pages they used opened a page of yours for this search.`
        : "None of the answers that ran this search said what they read or credited, so where this account stood on it is unknown.";

  return {
    key: row.key, query: row.query,
    headline: `Ran ${plural(row.executions, "time", "times")} over ${plural(row.days, "day", "days")} on ${plural(row.engines.length, "assistant", "assistants")}, behind ${plural(row.parents.length, "tracked question", "tracked questions")}: ${row.engines.map(engineName).join(", ")}.`,
    basis: `${pct(row.parentShare)} of the answers to those questions that reported a search, and ${pct(row.windowShare)} of every reporting answer over the last ${plural(spanDays, "day", "days")}. ${row.material ? `Worth work: it ${row.materialBecause}.` : `Watched, not yet work: ${row.materialBecause}.`}`,
    standing,
    // THE ASSISTANT'S OWN IDEA OF WHAT WAS MISSING: the words it went looking for that no tracked question used.
    added: row.addedWords.length > 0 ? `Beyond the words of the questions themselves it went looking for: ${row.addedWords.join(", ")}.` : null,
    // NOTHING IS SILENTLY COLLAPSED: a cluster shown under one wording used to lose the other four the
    // assistants actually typed, so every one of them is listed with the count that earned its place.
    wordings: row.variants.map((v) => ({ text: v.text, basis: `run ${plural(v.executions, "time", "times")}` })),
    parents, executions, ownPages, rivals,
    // THE HONEST LIMIT ON EVERY LINE ABOVE, printed word for word from the one string Decision quotes too, so
    // the screen and the card behind a change can never drift into two different claims about the same evidence.
    caveat: FANOUT_LINKAGE_CAVEAT,
    disposition: { state: disposition.state, line: disposition.line, href: disposition.href, label: "Open the next step" },
  };
}
