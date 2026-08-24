/**
 * decision/producers/differentiate: TELLING THEM APART IS THE OTHER ANSWER TO A SPLIT.
 *
 * Both merge gates in producers/extended refuse for the same structural reason: the competing pages are NOT
 * duplicates, so no address may move. That refusal is true, and it is not work: it left the strongest split in
 * an account with a correct sentence and nothing to do. Where every competing page is held WHOLE, this writes
 * the change that refusal already names. ONE bundle, one component per address, each carrying the exact line
 * Google shows, the heading a reader sees and the opening that says which search that page answers, every one
 * drafted against THAT page's own stored words through the same editor, the same deterministic checks and the
 * same judge as any other change. NOTHING IS HARDCODED: the pages, the search and the words all come from the
 * finding and the held bodies. PURE apart from the drafting calls handed in.
 *
 * EVERY NAMED ADDRESS LEAVES WITH A STATED VERDICT. An address the editor refuses, or one whose only available
 * rewrite would narrow it off a subject its siblings do not cover, used to be DROPPED: it disappeared from the
 * component list, which is the only record a page was ever named, and completeness then read a one-page change
 * as complete because it only ever checked the survivors. One `dispositions` entry is stamped for every page in
 * the finding, so leaving an address alone is a decision the operator can read and argue with, and a bundle that
 * owes work on a page and wrote none is incomplete by construction.
 */

import type { OwnedPageBody } from "@/domains/evidence/pages/owned-context";
import type { BundleComponent } from "../contracts";
import { log } from "@/lib/logger";
import { topicTokens } from "@/domains/evidence/relevance-gate";
import { effortMinutesFor } from "./contract"; import type { Produced, ProducerCtx } from "./contract";

const count = (n: number): string => Math.round(n).toLocaleString("en-US");

/** How many addresses one differentiation writes on: past this it is a site rebuild, not a change. */
const MAX_DIFFERENTIATED = 4;

export async function produceDifferentiation(ctx: ProducerCtx, named: readonly string[], keep: string,
  bodyFor: (p: string) => OwnedPageBody | null, why: string): Promise<Produced | null> {
  if (!ctx.draft.pageField) return null;
  const inScope = named.slice(0, MAX_DIFFERENTIATED);
  const pages = inScope.map((path) => ({ path, body: bodyFor(path) }))
    .filter((p): p is { path: string; body: OwnedPageBody } => p.body?.completeness === "complete");
  if (pages.length !== inScope.length || pages.length < 2) return null;
  // A HUB AND ITS OWN CHILD ARE NOT RIVALS: one address nesting inside another is a page covering a subject and a page answering one part of it, and a hub earns its head term BY listing what it links to. Read as a split it settled wrong: the child out-clicked the hub, so the survivor rule made the CHILD the owner and the brief told it, in those words, to KEEP the broad search. The ancestor owns it instead, however the clicks fall, and its descendants stay on their own subject.
  /** A LINE IS READ WITHOUT ITS TRAILING DESCRIPTOR. Any short segment after the last " - " or " | " is site furniture, not the page's subject, and holding a rewrite to it refused correct copy. */
  const trimSuffix = (t: string): string => { const at = Math.max(t.lastIndexOf(" - "), t.lastIndexOf(" | ")); return at > 0 && t.slice(at + 3).trim().split(/\s+/).length <= 3 ? t.slice(0, at) : t; };
  const nests = (a: string, b: string): boolean => a !== b && b.startsWith(a === "/" ? a : `${a}/`), hub = pages.map((p) => p.path).find((a) => pages.some((b) => nests(a, b.path))) ?? null, owner = hub ?? keep;
  // THE VERDICT LEDGER. Every named address starts here owing differentiation; a page the editor cannot honestly
  // improve is REWRITTEN to keep_as_is with the reason, never removed. The list is what completeness reads.
  const verdicts = new Map<string, { page: string; verdict: "differentiate" | "keep_as_is"; because: string }>(
    inScope.map((p) => [p, { page: p, verdict: "differentiate" as const, because: `Google serves ${count(inScope.length)} of this site's pages for "${ctx.primary}", and this one has to say what it alone covers.` }]));
  const others = (path: string): string => pages.filter((p) => p.path !== path)
    .map((p) => `${p.path} (${(p.body.title ?? p.body.h1 ?? "").trim()})`).join("; ");
  const components: BundleComponent[] = [];
  for (const { path, body } of pages) {
    // THE SUBJECT THE DRAFTER IS WRITING FOR IS THIS PAGE'S OWN, NEVER THE SHARED SEARCH. Handed the shared
    // search, the drafter did its job and merged it into the line, making the page that should stop competing
    // for it compete harder: it rewrote a page about one flag as "Iran Flag (1979-Present)". The page's own
    // heading is what the page says it is about, so that is the topic, and the shared search is the thing the
    // brief says to stop taking. Read off the stored page, so nothing here is written for one site.
    const subject = (body.h1 ?? body.title ?? ctx.primary).replace(/\s+/g, " ").trim();
    for (const field of ["title", "h1", "answer_block"] as const) {
      const done = await ctx.draft.pageField({
        field, body, query: subject, minutes: effortMinutesFor(field === "answer_block" ? "opening_answer" : field),
        // THE PROVEN OWNER OF THE SEARCH IS NEVER STEERED OFF IT. Told to write every page "narrower than" the
        // shared search, the drafter took "Girl Names" out of the title of the page whose own strongest search is
        // "persian girl names": the card would have cost the operator the very clicks it was measured on. The
        // page the account's own figures prove ahead KEEPS the search and says what else it covers; only the
        // pages behind it move aside, which is the whole point of settling a split without moving an address.
        brief: `Google serves ${count(pages.length)} pages of this site for "${ctx.primary}" and they are not duplicates, so each one has to say what it alone covers. THIS page covers ${subject}. The others are: ${others(path)}. ${field === "answer_block" ? `Write the opening block for the top of this page, under a short heading a reader would look for, saying exactly what this page covers` : `Write the one line that names exactly what this page covers`}, in a reader's words, so somebody who wanted one of the other pages can tell immediately. ${path === owner ? `This page is the one that owns "${ctx.primary}"${hub === path ? ", because every other page here sits underneath it" : ", by your own figures"}, so KEEP those words in it and add what only this page has.` : `Keep this page clearly narrower than "${ctx.primary}", which ${owner} owns, and say the one thing this page is about. NEVER drop the words that make it that page: its era, its dates, its named subject.`} Say only what this page's own stored words above already show.`,
        // NEVER MY OWN FIGURES. A receipt fact is a number ABOUT the page (clicks, views), and handing them over
        // put "41 clicks from 31,346 views" among the claims of a line somebody publishes. Only the structural
        // reason the addresses may not move goes in; everything else the drafter sees is the page's own words.
        evidenceHints: [why],
      });
      // A PAGE WHOSE LINE ALREADY SAYS EXACTLY WHAT IT COVERS NEEDS NO NEW LINE. Demanding all three fields on
      // every address threw away two accepted pieces because the third had nothing to improve, which is the
      // editor being right. A page that ends up with nothing is DROPPED from the change, checked below.
      if (!done) continue;
      // A PIECE THAT MAKES ITS PAGE LESS DISTINCT IS NOT A DIFFERENTIATION, IT IS THE OPPOSITE: the words this page's line carries that NO sibling carries are the reason this address exists, so dropping one narrows the page off its own subject (/persian-names lost "Last Names", the single thing it covered and its siblings did not).
      // TWO SETS, because the guards ask different questions. What is uniquely MINE is asked against everything a rival PRINTS, since a word on their page is a real reason it is not mine alone. What makes me WORTH KEEPING is asked against what those rivals ARE, their title and heading only: a hub's h2 list is a ROSTER OF ITS CHILDREN'S NAMES, so reading it as coverage let the hub answer for the child's whole subject and the guard went vacuous on exactly the pair it was needed for.
      const rivals = pages.filter((x) => x.path !== path), toks = (deep: boolean): Set<string> => new Set(rivals.flatMap((x) => topicTokens([x.body.title ?? "", x.body.h1 ?? "", ...(deep ? x.body.headings.slice(0, 40) : [])].join(" "))));
      const siblings = toks(true), own = toks(false);
      const lost = topicTokens(trimSuffix(done.before ?? "")).filter((w) => !siblings.has(w) && !topicTokens(done.after).includes(w));
      if (lost.length > 0) { log.info("[differentiate] a piece would have made its page less distinct", { page: path, field, dropped: lost.slice(0, 3), after: done.after.slice(0, 90) }); continue; }
      // AND IT CARRIES THE PAGE'S OWN SUBJECT, not merely whatever its old line said: the check above reads `before`, so a page whose line was ALREADY generic may be
      // rewritten more generic still. The page headed "Islamic Republic of Iran Flag (1979-Current)" was handed "Iran Flag History: Meaning, Colors & Full Timeline" and went on competing with /iran-flags for the very search this card exists to settle.
      const distinct = topicTokens(subject).filter((w) => !own.has(w)), carries = new Set(topicTokens(done.after));
      if (distinct.length > 0 && !distinct.some((w) => carries.has(w))) { log.info("[differentiate] a piece carries none of its page's own subject", { page: path, field, subject, after: done.after.slice(0, 90) }); continue; }
      const label = field === "title" ? "Page title" : field === "h1" ? "Page heading" : "Opening lines";
      components.push({
        kind: field === "title" ? "title" : field === "h1" ? "h1" : "opening_answer",
        label: `${label} on ${path}`, page: path, before: done.before, after: done.after,
        evidenceKeys: [...ctx.finding.evidenceKeys], risk: "safe",
        where: field === "answer_block" ? `the top of ${path}, ${done.anchor ? `just before "${done.anchor}"` : "before its first section"}` : `the ${label.toLowerCase()} of ${path}`,
        objective: `Say on ${path} which search it answers, so it stops competing with ${others(path)}.`,
        mechanism: `Google is choosing between ${count(pages.length)} pages of this site for "${ctx.primary}" every time somebody runs it, and no address may move because each of these pages answers a search the others do not, so the only thing left is to say so on every one of them.`,
        measurementPlan: `Clicks and average position for "${ctx.primary}" across all ${count(pages.length)} addresses, read at 7, 14 and 28 days after you publish them.`,
      });
    }
  }
  // AN ADDRESS WITH NOTHING SAFE TO SAY IS LEFT ALONE ON THE RECORD, NOT PADDED AND NOT DROPPED. Holding the
  // whole change hostage to a page whose line is already right, or whose only available rewrite would narrow it
  // off its own subject, threw away the work that WAS good on the other addresses; dropping it silently sold a
  // one-page answer as a settled split. It is stated instead, and the operator reads both halves of the decision.
  const covered = [...new Set(components.map((c) => c.page!))];
  for (const p of inScope) if (!covered.includes(p)) verdicts.set(p, { page: p, verdict: "keep_as_is",
    because: `${p} is left as it is: no wording came back that tells it apart from ${others(p)} without narrowing it off a subject its siblings do not cover.` });
  if (covered.length === 0) return { components: [], dispositions: [...verdicts.values()],
    refusal: `Neither ${pages.map((x) => x.path).join(" nor ")} could be given wording that tells it apart from the others without narrowing it off its own subject, so nothing is handed over. Ask again and anything already written costs nothing a second time.` };
  return { components, refusal: null, dispositions: [...verdicts.values()], considered: [{ option: "Merge them into one page", reason: why }],
    operatorSteps: [...covered.map((path) => `On ${path}, apply the ${count(components.filter((c) => c.page === path).length)} ${components.filter((c) => c.page === path).length === 1 ? "piece" : "pieces"} above marked for it`),
      // THE PAGES THIS CHANGE DELIBERATELY LEAVES ALONE, said out loud, because a split settled on two of four
      // addresses is a different decision from a split settled on all four and the operator has to see which.
      ...[...verdicts.values()].filter((v) => v.verdict === "keep_as_is").map((v) => `Leave ${v.page} exactly as it is: nothing came back for it that would not narrow it off a subject its siblings do not cover`),
      `Come back here and mark it done, and clicks and average position for "${ctx.primary}" get read across all ${count(pages.length)} addresses`] };
}

