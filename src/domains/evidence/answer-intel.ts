/**
 * evidence/answer-intel - WHAT THE ENGINES' OWN ANSWERS SAID about one case, projected off the readings
 * already settled against them and nothing else. PURE and deterministic: same answers in, same packet out,
 * no clock, no I/O, no LLM. It is the ENGINES' reading, never mine, which is why a claim and a caveat stay
 * receipt context here and never become source material for a word of drafted copy.
 */

import type { CanonicalPairObservation } from "./funnel/research-evidence";
import { CURRENT_CLAIM } from "@/lib/constants";

type ObsRow = CanonicalPairObservation;
const norm = (s: string): string => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");

/** ONE signal read off the settled readings of the answers that joined this case, with the answers that
 *  produced it kept beside it. `prompts` counts DISTINCT tracked questions whose answers said it, which is
 *  the whole recurrence rule: a pattern claimed across answers needs two, and anything one answer said is
 *  worded as one answer or not said at all. `observedAt` is WHEN THE QUOTED ANSWER LANDED (`observationIds[0]`),
 *  because a receipt line carrying an engine's own wording and no date is refused outright the moment that
 *  wording happens to say "currently", and the refusal names a date problem nobody can see in the sentence. */
export type AnswerSignal = { text: string; prompts: number; observationIds: string[]; observedAt: string };

/** WHAT THE ANSWERS THEMSELVES SAID about this case, bounded, deterministic and fully attributed. It is the
 *  ENGINES' reading, never mine: a competitor here is a name an answer put in front of a customer and a claim
 *  is an assertion an engine made, so claims and caveats are receipt CONTEXT and pattern evidence only and
 *  never grounded source material for drafted copy. */
export type AnswerIntel = {
  /** Settled readings that joined this case. Zero = nothing below was derived from anything. */
  answers: number;
  /** When the newest of those readings landed, which is the only honest date on a fact about what NOBODY said. */
  latestObservedAt: string | null;
  competitors: AnswerSignal[];
  contentTypes: AnswerSignal[];
  omissions: AnswerSignal[];
  sections: AnswerSignal[];
  claims: { subject: string; text: string; observationId: string }[];
  caveats: { text: string; observationId: string }[];
  /** Whether the account's own brand was named, in how many of those answers, where, and by which engines.
   *  `observedAt` is the day the QUOTED naming answer landed; it is null exactly when nobody named the brand. */
  brand: { mentioned: number; position: number | null; context: string | null; engines: string[]; observationIds: string[]; observedAt: string | null };
};

/** Bounds. Six signals is enough to argue a pattern and small enough that a receipt stays readable; claims and
 *  caveats are context only, so they are tighter still. */
const MAX_SIGNALS = 6, MAX_CLAIMS = 4, MAX_CAVEATS = 3;
/** The present-tense vocabulary validate-proposal refuses on any line not read today (its own regex). */
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** WHEN THIS ANSWER LANDED. A row that never recorded a completion still has the day the plan filed it under,
 *  read at noon so no zone can slide it onto a neighbouring day. Never invented: every canonical row has one. */
const landedAt = (o: ObsRow): string => o.observedAt ?? `${o.reportingDay}T12:00:00.000Z`;
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Fold one category of one answer's reading into the shared tally: same wording said by two answers is ONE
 *  signal standing on two, never two signals. The keeper is the FIRST wording seen in the sorted walk, so the
 *  same evidence always produces the same sentence. */
function tally(rows: readonly { o: ObsRow; values: string[] }[]): AnswerSignal[] {
  const acc = new Map<string, { text: string; prompts: Set<string>; ids: string[]; observedAt: string }>();
  for (const { o, values } of rows) {
    for (const v of values) {
      if (!v) continue;
      const key = norm(v);
      const held = acc.get(key) ?? { text: v, prompts: new Set<string>(), ids: [], observedAt: landedAt(o) };
      held.prompts.add(o.promptId);
      if (!held.ids.includes(o.observationId)) held.ids.push(o.observationId);
      acc.set(key, held);
    }
  }
  return [...acc.values()].map((h) => ({ text: h.text, prompts: h.prompts.size, observationIds: h.ids, observedAt: h.observedAt }))
    .sort((a, b) => b.prompts - a.prompts || b.observationIds.length - a.observationIds.length || a.text.localeCompare(b.text))
    .slice(0, MAX_SIGNALS);
}

/** PURE: the settled readings of a case's own answers, projected into one bounded, attributed intel packet.
 *  An answer with no reading on file contributes NOTHING here (the loader only ever fills `analysis` for a
 *  reading validly settled against that exact answer, so this never re-checks it). */
export function answerIntelOf(observations: readonly ObsRow[]): AnswerIntel {
  const read = [...observations].filter((o) => !!o.analysis)
    .sort((a, b) => a.promptId.localeCompare(b.promptId) || a.engine.localeCompare(b.engine) || a.observationId.localeCompare(b.observationId));
  const of = (pick: (a: Record<string, unknown>) => string[]): AnswerSignal[] => tally(read.map((o) => ({ o, values: pick(o.analysis!) })));
  const brandRows = read.map((o) => ({ o, m: (o.analysis!.ownedBrandMention ?? null) as { mentioned?: unknown; position?: unknown; context?: unknown } | null }))
    .filter((r) => r.m?.mentioned === true);
  const positions = brandRows.map((r) => (typeof r.m!.position === "number" ? r.m!.position : null)).filter((p): p is number => p != null);
  return {
    answers: read.length, latestObservedAt: read.map(landedAt).sort().at(-1) ?? null,
    competitors: of((a) => list(a.competitors).map((c) => text((c as { name?: unknown })?.name))),
    contentTypes: of((a) => list(a.contentTypesRecommended).map(text)),
    omissions: of((a) => list(a.materialOmissions).map(text)),
    sections: of((a) => list(a.sections).map((s) => text((s as { heading?: unknown })?.heading))),
    claims: read.flatMap((o) => list(o.analysis!.claims).slice(0, 2).map((c) => ({
      subject: text((c as { subject?: unknown })?.subject), text: text((c as { text?: unknown })?.text), observationId: o.observationId })))
      .filter((c) => !!c.text).slice(0, MAX_CLAIMS),
    caveats: read.flatMap((o) => list(o.analysis!.caveats).slice(0, 1).map((c) => ({ text: text(c), observationId: o.observationId })))
      .filter((c) => !!c.text).slice(0, MAX_CAVEATS),
    brand: { mentioned: brandRows.length, position: positions.length > 0 ? Math.min(...positions) : null,
      context: brandRows.map((r) => text(r.m!.context)).find((c) => !!c) ?? null, observedAt: brandRows[0] ? landedAt(brandRows[0].o) : null,
      engines: [...new Set(brandRows.map((r) => r.o.engine))].sort(), observationIds: brandRows.map((r) => r.o.observationId) },
  };
}

/** ONE receipt line per signal, in the operator's own language, each carrying the answer it QUOTES. A line
 *  that speaks for several answers SAYS how many stand behind it, and a signal only one answer produced says
 *  exactly that rather than passing for agreement. CLAIMS AND CAVEATS ARE DELIBERATELY ABSENT: they are an
 *  engine's assertions, and every fact here is handed to the drafters as grounding, so putting them in this
 *  list would make somebody else's claim source material for copy of yours. */
export function answerIntelFacts(intel: AnswerIntel): { key: string; fact: string; observationId?: string; observedAt: string | null }[] {
  const out: { key: string; fact: string; observationId?: string; observedAt: string | null }[] = [];
  // THE NUMBER IS WHAT THE NUMBER COUNTS. `prompts` is DISTINCT QUESTIONS I TRACK, so calling it a count of
  // answers said something I never measured: four engines answering one question is four answers, not four questions.
  const many = (s: AnswerSignal, plural: string, one: string): string =>
    s.prompts > 1 ? `The answers to ${s.prompts} of the questions I track ${plural}` : `One answer I hold here ${one}`;
  // AN ENGINE'S ADVERB IS NOT A READING I TOOK TODAY. These lines quote free wording, and one answer saying
  // "what it costs currently" turns a dated receipt line into a claim about right now that I cannot stand
  // behind on any day but the day it landed: the one validator refuses the WHOLE change for it, permanently
  // and with a date message nobody can see in the sentence. So a signal that claims the present is not put on
  // the receipt at all. It stays on the packet for a surface that shows context without grounding a word.
  const push = (key: string, fact: string, s: AnswerSignal): void => {
    if (!CURRENT_CLAIM.test(s.text)) out.push({ key, fact, observationId: s.observationIds[0]!, observedAt: s.observedAt }); };
  intel.competitors.slice(0, 2).forEach((s, i) => push(`named${i + 1}`, `${many(s, "name", "names")} ${s.text} as an option for this.`, s));
  intel.contentTypes.slice(0, 2).forEach((s, i) => push(`format${i + 1}`, `${many(s, "ask for", "asks for")} ${s.text}.`, s));
  intel.omissions.slice(0, 2).forEach((s, i) => push(`missing${i + 1}`, `${many(s, "leave", "leaves")} this unanswered: ${s.text}`, s));
  // A SHAPE IS A PATTERN OR IT IS NOTHING: one answer's own headings are that answer's, never what answers agree on.
  intel.sections.filter((s) => s.prompts > 1).slice(0, 1).forEach((s) => push("covered1", `The answers to ${s.prompts} of the questions I track cover "${s.text}".`, s));
  // AN ABSENCE IS NOBODY'S ANSWER. "Not one of them names you" is read off every answer at once, so it quotes
  // none of them and carries NO observation id, exactly as the tracked-question line next door refuses to borrow
  // one. It still carries the date of the newest answer behind it, because a date is not an identity.
  if (intel.answers > 0) {
    out.push({ key: "brandnamed", ...(intel.brand.observationIds[0] ? { observationId: intel.brand.observationIds[0] } : {}),
      observedAt: intel.brand.observedAt ?? intel.latestObservedAt,
      fact: intel.brand.mentioned > 0
        ? `Your own site is named in ${intel.brand.mentioned} of the ${intel.answers} answers I hold here${intel.brand.position != null ? `, ${intel.brand.position === 1 ? "first" : `in ${intel.brand.position} place`} in the answer` : ""}.`
        : `Not one of the ${intel.answers} answers I hold here names your own site.` });
  }
  return out;
}
