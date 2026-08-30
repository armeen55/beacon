import "server-only";

import { treatmentLearning, type ShippedChangeRecord, type TreatmentGroup } from "@/domains/measurement";
import { pageLabel } from "../changes/types";

/**
 * results-learning - WHAT THE KINDS OF WORK HAVE DONE ON THIS SITE, at the top of Results, so the surface
 * opens on what has been learned rather than on a ledger nobody can add up in their head. Every number here is
 * the measurement kernel's own (`treatmentLearning`), untouched: this file decides the words, the order and
 * what may not be said, and nothing else. Three rules it exists to hold. A group under five finished readings
 * is a story rather than a measurement, so it says so and never recommends itself. A reading taken on a page
 * that was already carrying other work says that too. And no line here claims a change CAUSED anything: what
 * is printed is what was read, against this site's own pages that were not changed.
 */

/** The coarse family a reading is filed under, in the customer's words. An unmapped family reads as "Other
 *  changes" and never as its slug. */
const KIND_NAME: Record<string, string> = {
  title: "Titles", meta: "Meta descriptions", title_meta: "Titles and meta descriptions",
  h1: "Page headlines", answer: "Answers at the top", link: "Internal links",
  schema: "Structured data", content: "Page content", new_page: "New pages",
  full_rewrite: "Full rewrites", other: "Other changes",
};
/** The finer bet inside a family, where the press stamped one. Unmapped falls back to the family name. */
const TREATMENT_NAME: Record<string, string> = {
  rewrite_existing_section: "rewritten sections", add_answer_section: "added answers",
  title_or_h1: "titles and headlines", meta_description: "meta descriptions",
  internal_link_or_navigation: "links and navigation", technical_reachability: "technical fixes",
  consolidate_or_differentiate: "merged and split pages", factual_correction_batch: "factual corrections",
  new_page: "new pages",
};
/** Finished readings before the kernel stops calling a group early. Read here only to say what is still owed. */
const EARLY_AT = 5;

const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const clicks = (n: number): string => `${Math.abs(n).toLocaleString("en-US")} ${Math.abs(n) === 1 ? "click" : "clicks"}`;
/** A reading in the words the ledger below already uses. Never "caused": this is what was measured, not why. */
const against = (n: number): string => (n === 0
  ? "level with pages that were not changed"
  : `${clicks(n)} ${n > 0 ? "ahead of" : "behind"} pages that were not changed`);
const shortly = (n: number): string => (n === 0 ? "level" : `${clicks(n)} ${n > 0 ? "ahead" : "behind"}`);
const signedClicks = (n: number): string => (n === 0 ? "Level" : `${n > 0 ? "+" : "-"}${clicks(n)}`);
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** THE ROW'S OWN LINE AND WHERE TO READ IT. The address the ledger under this already links to, said the way a
 *  person says it. A frozen reading whose credit is shared with a later change carries that fact with it. */
type Example = { label: string; url: string; line: string };
/** EVERY FIELD THIS STRIP READS OFF A LEDGER ROW, and not one more, so a fixture and the live ledger present
 *  the same handful of facts. The kernel picks its own set off the same rows; this adds only where to read it. */
type LedgerRow = Pick<ShippedChangeRecord, "path" | "page" | "actionType" | "after" | "windows" | "implementedAt"
  | "verification" | "operatorVerdictOverride" | "pinnedRead" | "treatmentStamp" | "componentsApplied">;
type OwnedRow = { record: LedgerRow; own: TreatmentGroup };

/** What this kind of work is called. A stamped treatment wins; a row that never said reads as older work. */
function nameOf(g: TreatmentGroup): string {
  if (g.family == null) return "Older changes recorded before kinds were tracked";
  const treatment = g.treatment ? TREATMENT_NAME[g.treatment] : null;
  return treatment ? cap(treatment) : KIND_NAME[g.family] ?? "Other changes";
}

/** Which way the finished readings went, with every zero left off: "no clear result 0" is not a fact worth a slot. */
function splitLine(g: TreatmentGroup): string {
  const parts = ([["ahead", g.ahead], ["behind", g.behind], ["no clear result", g.inconclusive]] as const)
    .filter(([, n]) => n > 0).map(([word, n]) => `${word} ${n}`);
  return parts.length === 0 ? "" : ` ${cap(parts.join(", "))}.`;
}

/** WHAT THE RECORD ADDS UP TO, AND THE ONE THING TWO SURFACES MAY NOT DISAGREE ABOUT. The count of readings
 *  and the clicks they add up to have to point the same way before this group is called anything: titles on
 *  this account finished ahead more often than behind AND ended 24 clicks behind, which is a mixed record, so
 *  it is said as one and never painted as a win. Under five readings nothing is called at all. */
type Verdict = "early" | "up" | "down" | "level" | "mixed";
function verdictOf(g: TreatmentGroup): Verdict {
  if (g.early) return "early";
  const byCount = Math.sign(g.ahead - g.behind), byTotal = Math.sign(g.netEffect);
  if (byCount > 0 && byTotal > 0) return "up";
  if (byCount < 0 && byTotal < 0) return "down";
  return byCount === 0 && byTotal === 0 ? "level" : "mixed";
}

/** ONE NEXT STEP, AND AN EARLY OR MIXED GROUP NEVER GETS A RECOMMENDATION: what is owed, or where to read. */
function nextStepOf(g: TreatmentGroup, verdict: Verdict): string {
  if (verdict === "early") {
    const owed = Math.max(1, EARLY_AT - g.sampleSize);
    return `Needs ${plural(owed, "more reading", "more readings")} before this kind of change can be counted on.`;
  }
  if (verdict === "up") return "Do this again on a similar page.";
  if (verdict === "down") return "Try a different kind of change on these pages.";
  if (verdict === "level") return "Nothing has moved either way. Pick the page before the kind of change.";
  return "Mixed so far. Open the strongest and the weakest below before doing this again.";
}

/** One finished reading, named by its page and linked where the ledger links it. A reading the kernel muted
 *  (credit shared with a later change on the same page) carries that fact rather than standing as a clean one. */
function exampleOf(o: OwnedRow): Example {
  const moved = o.own.netEffect;
  const shared = o.own.inconclusive === 1 && moved !== 0;
  return {
    label: pageLabel(o.record.path || o.record.page),
    url: o.record.page,
    line: `${cap(against(moved))}${shared ? ", credit shared with another change on the page" : ""}.`,
  };
}

/** ONE CARD: the kernel's counts put into words, plus the strongest and the weakest reading behind them. */
function cardOf(g: TreatmentGroup, rows: readonly OwnedRow[]) {
  const mine = rows.filter((o) => o.own.key === g.key && o.own.sampleSize === 1)
    .sort((a, b) => b.own.netEffect - a.own.netEffect);
  const verdict = verdictOf(g);
  return {
    key: g.key,
    name: nameOf(g),
    early: g.early,
    // AN EARLY OR MIXED GROUP IS NEVER PAINTED AS AN ANSWER: the sign stays in the words, the colour does not.
    // A green median over "24 clicks behind in total" is the surface arguing with itself in front of the operator.
    value: g.medianEffect == null ? "Not read yet" : signedClicks(g.medianEffect),
    tone: (g.medianEffect ?? 0) > 0 && verdict === "up" ? "up"
      : (g.medianEffect ?? 0) < 0 && verdict === "down" ? "down" : "muted",
    valueNote: "typically, against pages that were not changed",
    counts: `${plural(g.shipped, "change", "changes")} marked done, ${g.verified} counted, `
      + `${plural(g.sampleSize, "read", "read")} to the end.${splitLine(g)} ${cap(shortly(g.netEffect))} in total.`,
    earlyLine: g.early ? `Early: ${plural(g.sampleSize, "reading", "readings")} so far.` : null,
    overlapLine: g.overlapping > 0
      ? `${g.overlapping} of these ${g.overlapping === 1 ? "was" : "were"} measured alongside other changes on the same page.`
      : null,
    nextStep: nextStepOf(g, verdict),
    strongest: mine.length > 0 ? exampleOf(mine[0]!) : null,
    weakest: mine.length > 1 ? exampleOf(mine.at(-1)!) : null,
  };
}

/**
 * THE WHOLE STRIP, off the ledger rows themselves. Pure: hand it the same records the surface below reads and
 * it says the same thing every time. Ordered by how much of the record is countable, then by how much work is
 * behind it, and the group whose rows never said what kind of work they were is last whatever it holds.
 */
export function buildLearningStrip(records: readonly LedgerRow[]) {
  const groups = [...treatmentLearning(records)].sort((a, b) =>
    (a.family == null ? 1 : 0) - (b.family == null ? 1 : 0) || b.verified - a.verified || b.shipped - a.shipped);
  // ONE ROW HANDED TO THE SAME FUNCTION returns that row's own group key and its own finished reading, so an
  // example can never disagree with the card above it: nothing here re-derives what counts as a reading.
  const rows: OwnedRow[] = records.map((record) => ({ record, own: treatmentLearning([record])[0]! }));
  return {
    cards: groups.filter((g) => g.sampleSize > 0).map((g) => cardOf(g, rows)),
    // NOTHING DISAPPEARS BEHIND THE STRIP. Work that has not finished a read earns no card and is still counted.
    waiting: groups.reduce((n, g) => n + g.shipped - g.sampleSize, 0),
  };
}

const TONE: Record<string, string> = { up: "text-emerald-700", down: "text-rose-700", muted: "text-muted-foreground" };

/** WHAT EACH KIND OF CHANGE HAS DONE HERE, above the ledger it is drawn from. Server rendered; the detail
 *  opens with the browser's own control, exactly as the record form below this page already does. */
export function LearningStrip({ strip }: { strip: ReturnType<typeof buildLearningStrip> }) {
  return (
    <section className="mb-6" data-learning-strip="true">
      <h2 className="text-[15px] font-semibold tracking-tight">What each kind of change has done here</h2>
      <p className="mb-3 mt-0.5 text-[12px] text-muted-foreground">
        Every change marked done on this site, grouped by kind and read against this site&apos;s own pages that
        were not changed.
      </p>
      {strip.cards.length === 0 ? (
        <p className="rounded-lg border border-border-subtle bg-surface-raised px-4 py-4 text-[13px] text-muted-foreground" data-learning-empty="true">
          No verified readings yet. Changes verify after they are applied and the page is read back.
        </p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {strip.cards.map((c) => (
              <div key={c.key} className="rounded-xl border border-border-subtle bg-surface-raised px-3 py-2.5" data-learning-card={c.key}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-medium text-foreground">{c.name}</p>
                  {c.early ? (
                    <span className="shrink-0 rounded-full bg-surface-inset px-1.5 py-px text-[10px] text-muted-foreground" data-learning-early="true">Early</span>
                  ) : null}
                </div>
                <p className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${TONE[c.tone]}`}>{c.value}</p>
                <p className="text-[11px] text-muted-foreground">{c.valueNote}</p>
                <p className="mt-1.5 text-[12px] tabular-nums text-foreground/80">{c.counts}</p>
                {c.earlyLine ? <p className="mt-1 text-[12px] tabular-nums text-amber-700">{c.earlyLine}</p> : null}
                {c.overlapLine ? <p className="mt-1 text-[12px] tabular-nums text-muted-foreground">{c.overlapLine}</p> : null}
                <p className="mt-1.5 text-[12px] font-medium text-foreground">{c.nextStep}</p>
                {c.strongest ? (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-[11px] text-accent-primary underline underline-offset-2">
                      {c.weakest ? "See the strongest and the weakest" : "See the one reading behind this"}
                    </summary>
                    {([["Strongest", c.strongest], ["Weakest", c.weakest]] as const).map(([word, e]) => (e ? (
                      <p key={word} className="mt-1 text-[11px] text-muted-foreground">
                        {word}:{" "}
                        <a href={e.url} target="_blank" rel="noreferrer" className="font-medium text-accent-primary underline underline-offset-2">{e.label}</a>
                        {`, ${e.line}`}
                      </p>
                    ) : null))}
                  </details>
                ) : null}
              </div>
            ))}
          </div>
          {strip.waiting > 0 ? (
            <p className="mt-2 text-[12px] tabular-nums text-muted-foreground">
              {plural(strip.waiting, "more change has", "more changes have")} not finished a read yet,{" "}
              {strip.waiting === 1 ? "and it is" : "and they are"} in the list below.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
