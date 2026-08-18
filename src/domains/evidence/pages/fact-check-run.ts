import "server-only";

/** evidence/pages/fact-check-run - HOW BEACON ACQUIRES A SOURCE-CHECKED FACT ON ITS OWN, for any account and
 *  any subject. Written because the first fact-check evidence was seeded by hand from outside the product,
 *  which is a demonstration and not a loop (Codex, 2026-08-18): nothing could research another page, refresh
 *  a finding, or notice that the operator had fixed one.
 *
 *  THE LOOP, all of it inside the budgeted runtime: read the page this account already stored, extract the
 *  statements it makes that a source could contradict, buy ONE results page per statement to find who the
 *  authorities on that subject actually are, grade each domain's authority deterministically, ask the
 *  structured reader to compare the page's claim with those sources, and persist one row per statement with
 *  the page hash it was checked against.
 *
 *  ITS CONFIDENCE CEILING IS HONEST. This path finds WHO the authorities are and what they are understood to
 *  say; it does not fetch and read their pages, so it may never mint `confirmed` and may never authorize
 *  replacing published words on its own. It banks `likely`, `disputed` and `unsupported`, which reach the
 *  operator as findings to confirm. `confirmed` stays reserved for a check whose source body was actually
 *  read. A loop that cannot prove a thing must not be allowed to license a destructive edit. */

import { createHash } from "node:crypto";
import { log } from "@/lib/logger";
import { recordFactChecks, statementKeyOf, type FactCheck, type SourceKind } from "./fact-checks";

/** How many statements one pass checks, and how many sources it weighs per statement. */
const STATEMENTS_PER_PASS = 12, SOURCES_PER_STATEMENT = 6;

/** WHAT A DOMAIN IS WORTH AS A SOURCE, decided here and nowhere else so two callers cannot disagree. A
 *  baby-name aggregator may notice a claim worth checking and may never authorize a replacement. */
const SCHOLARLY = /(^|\.)(iranicaonline\.org|dsal\.uchicago\.edu|jstor\.org|academia\.edu|brill\.com|oup\.com|cambridge\.org)$|\.(edu|ac\.[a-z]{2})$/i;
const DICTIONARY = /(^|\.)(wiktionary\.org|merriam-webster\.com|oed\.com|dehkhoda\.ut\.ac\.ir|vajehyab\.com|abadis\.ir)$/i;
const ENCYCLOPEDIA = /(^|\.)(wikipedia\.org|britannica\.com|encyclopedia\.com)$/i;
const REFERENCE = /(^|\.)(behindthename\.com|nameberry\.com|ethnologue\.com)$/i;
const BABYNAME = /(baby|names?)[-.]?(names?|meaning|central|nology)|(^|\.)(momjunction|pampers|thebump|babycenter|parents)\./i;

export function sourceClassOf(domain: string): SourceKind {
  const d = domain.replace(/^www\./, "").toLowerCase();
  if (SCHOLARLY.test(d)) return "scholarly";
  if (DICTIONARY.test(d)) return "dictionary";
  if (ENCYCLOPEDIA.test(d)) return "encyclopedia";
  if (REFERENCE.test(d)) return "reference";
  if (BABYNAME.test(d)) return "babyname";
  return "community";
}

export const pageHashOf = (body: string): string => createHash("sha256").update(body).digest("hex").slice(0, 16);

const CLAIM_SYSTEM = 'You read one web page and list the statements on it that an outside source could confirm or contradict. '
  + 'Return ONLY {"statements":[{"subject","current"}]}: `subject` is the thing the statement is about, exactly as the page writes it; '
  + '`current` is the page\'s own wording for it, quoted exactly. Only statements of FACT about the world (a meaning, an origin, a date, a figure, a definition). '
  + 'Never marketing copy, navigation, headings with no claim in them, or anything about the page itself. Return at most 40.';

const CHECK_SYSTEM = 'You compare ONE statement a web page makes against the sources actually found for that subject. '
  + 'Return ONLY {"verdict","proposed","literal","usage","agreement","confidence","note"}. '
  + 'verdict: page_correct | page_wrong | page_imprecise | undecidable. '
  + 'confidence: likely | disputed | unsupported. You may NEVER answer "confirmed": you are working from which sources exist and what they are understood to say, not from their fetched text, and a replacement nobody has read the source for may not license a live edit. '
  + 'agreement: multiple_agree | single_source | sources_conflict | none_found. '
  + 'Answer unsupported with proposed "" when no credible source addresses it. Distinguish literal etymology from modern usage: a page recording a live poetic sense is not automatically wrong. '
  + 'Prefer the highest-authority sources in the list and say which one you are relying on in `note`.';

type Extracted = { statements: { subject: string; current: string }[] };
type Checked = { verdict: FactCheck["verdict"]; proposed: string; literal: string; usage: string;
  agreement: FactCheck["agreement"]; confidence: "likely" | "disputed" | "unsupported"; note: string };

/** THE STRUCTURED READER, INJECTED. Evidence may not import Decision, and a fact check should be testable
 *  without a provider anyway: the runtime hands in the one call, this file owns the reasoning around it. */
export type StructuredRead = (input: { system: string; user: string; grounded: string; projectedCostUsd: number; maxTokens: number })
  => Promise<Record<string, unknown> | null>;

export type FactCheckRunDeps = {
  /** The one model call this pass may make. Absent = nothing is banked. */
  read: StructuredRead;
  /** The page's stored words and address. */
  page: { url: string; path: string; body: string };
  /** Buys one results page for a source-seeking query. Absent = this pass weighs no sources and banks nothing. */
  serpFor?: (query: string) => Promise<{ organic: { domain: string; url: string; title: string | null }[] } | null>;
  tenantId: string; now: Date; basis: string | null;
  /** Statements already on file, so a pass rechecks what the page changed and not what it did not. */
  alreadyChecked?: ReadonlySet<string>;
};

/** ONE bounded fact-check pass over one page. Returns how many statements it banked. */
export async function runFactCheckPass(d: FactCheckRunDeps): Promise<{ banked: number; reason?: string }> {
  const { tenantId, page, now } = d;
  if (!page.body.trim()) return { banked: 0, reason: "no stored words for this page" };
  if (!d.serpFor) return { banked: 0, reason: "no source acquisition wired for this pass" };
  const hash = pageHashOf(page.body);

  const extracted = await d.read({ system: CLAIM_SYSTEM,
    user: `Page: ${page.url}\n\nIts stored words:\n${page.body.slice(0, 12_000)}\n\nReturn the JSON now.`,
    grounded: page.body.slice(0, 12_000), projectedCostUsd: 0.02, maxTokens: 3000 }).catch(() => null);
  if (!extracted) return { banked: 0, reason: "the page's checkable statements could not be read" };
  const all = ((extracted as unknown as Extracted).statements ?? []).filter((s) => s.subject?.trim() && s.current?.trim());
  const fresh = all.filter((s) => !d.alreadyChecked?.has(statementKeyOf(s.subject))).slice(0, STATEMENTS_PER_PASS);
  if (fresh.length === 0) return { banked: 0, reason: "every statement on this page is already checked at this version" };

  const checks: FactCheck[] = [];
  for (const s of fresh) {
    const serp = await d.serpFor(`${s.subject} meaning origin etymology`).catch(() => null);
    const sources = (serp?.organic ?? []).slice(0, SOURCES_PER_STATEMENT)
      .map((o) => ({ url: o.url, kind: sourceClassOf(o.domain), says: o.title ?? "" }))
      .filter((x) => x.kind !== "community" && x.kind !== "babyname");
    if (sources.length === 0) {
      checks.push({ page: page.path, statementKey: statementKeyOf(s.subject), subject: s.subject, current: s.current,
        proposed: null, literal: null, usage: null, sources: [], agreement: "none_found", confidence: "unsupported",
        verdict: "undecidable", alsoAt: [], note: "No source of any authority came back for this subject, so nothing is proposed.",
        pageContentHash: hash, evidenceBasis: d.basis, checkedAt: now.toISOString() });
      continue;
    }
    const judged = await d.read({ system: CHECK_SYSTEM,
      user: [`Subject: ${s.subject}`, `The page says: "${s.current}"`, "The sources found for this subject, best authority first:",
        ...sources.map((x) => `- [${x.kind}] ${x.url}${x.says ? ` (${x.says})` : ""}`), "", "Return the JSON now."].join("\n"),
      grounded: sources.map((x) => x.url).join(" "), projectedCostUsd: 0.01, maxTokens: 1200 }).catch(() => null);
    if (!judged) continue;
    const v = judged as unknown as Checked;
    checks.push({ page: page.path, statementKey: statementKeyOf(s.subject), subject: s.subject, current: s.current,
      proposed: v.confidence === "unsupported" ? null : (v.proposed?.trim() || null),
      literal: v.literal?.trim() || null, usage: v.usage?.trim() || null, sources,
      agreement: v.agreement, confidence: v.confidence, verdict: v.verdict, alsoAt: [],
      note: `${v.note ?? ""} Sources were identified and graded, not fetched, so this stays a finding to confirm rather than an authorized replacement.`.trim(),
      pageContentHash: hash, evidenceBasis: d.basis, checkedAt: now.toISOString() });
  }
  const banked = await recordFactChecks(tenantId, page.path, checks);
  log.info("[fact-check-run] a page was checked against its sources", { tenantId, page: page.path, statements: checks.length, banked });
  return { banked };
}
