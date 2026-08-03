/**
 * decision/technical-findings (Phase 5): WHAT IS WRONG WITH HOW A PAGE IS SERVED, read off what this
 * account ALREADY holds and nothing else. Beacon has been able to say "something is stopping this page
 * being indexed" since the cause ladder existed, and could never once say WHICH page or WHAT to do, so
 * the cause sat permanently unheld while the two stores that answer it were being written every day.
 *
 * NO GENERIC AUDIT LIVES HERE. A finding exists only with a concrete address and an exact fix an operator
 * can carry out this morning; a rule with nothing behind it produces nothing rather than a caution. Every
 * kind below is decided from the page inventory (how a URL became known, what the last read of it answered,
 * where it sends people) or from the page capture (its title, its heading, its canonical, its robots tag,
 * the links it carries). Nothing is fetched, nothing is inferred, and an absent field is UNKNOWN rather
 * than a fault: `canonical_url` and `h1` accuse a page only when the capture genuinely holds them.
 *
 * PURE and deterministic: same rows in, byte-identical findings out, in address order. server-only is
 * deliberately absent so the reader is testable on fixtures built from the stores' own shapes.
 */

import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import type { BundleComponent, BundleComponentKind } from "./contracts";

/** THE V1 CATALOGUE: every technical fault observable from held data, and not one more. */
export type TechnicalKind =
  | "non_200" | "redirect_chain" | "broken_internal_link" | "canonical_missing" | "canonical_conflict"
  | "robots_noindex" | "sitemap_omission" | "duplicate_title" | "duplicate_h1" | "missing_h1" | "orphaned_page";

/** One fault, on one address, with the exact fix and the observation behind it. Both sentences are the
 *  operator's own words: `evidence` is what I saw, `exactFix` is what to do, and neither is a caution.
 *  `exact` is the REPLACEMENT TEXT itself where the held evidence states it; null means I can describe the
 *  fault but cannot yet write the words, and a change like that is research, never Ready. `redirectTo` is
 *  THE DESTINATION ITSELF for a fault whose fix is a forward, so the live check reads the address I named
 *  instead of guessing one out of my sentence; a forward with no destination is research too. */
export type TechnicalFinding = { url: string; kind: TechnicalKind; exactFix: string; evidence: string; exact: string | null; redirectTo?: string };

/** One inventory row, exactly the columns owned_pages hands over. Everything optional: a row from an
 *  older write carries less, and less is unknown rather than a fault. `status_reconfirmed_at` is the day a
 *  SECOND, independent read returned this same status; absent means nobody has looked twice, which is the
 *  only thing that can turn a server error from a bad minute into a fault. */
type InventoryRow = { url: string; discovered_via?: string | null; crawl_state?: string | null;
  http_status?: number | null; redirects_to?: string | null;
  last_crawled_at?: string | null; status_reconfirmed_at?: string | null };

/** One captured page, exactly the fields the page capture holds. A field ABSENT from the object is not
 *  held; a field present and empty is held and empty, which is the only thing that may ever accuse. */
type CapturedPage = { url: string; title?: string | null; h1?: string | null; canonical_url?: string | null;
  has_canonical_mismatch?: boolean | null; robots_meta?: string | null; internal_links?: readonly string[] };

type TechnicalHeld = { inventory?: readonly InventoryRow[]; pages?: readonly CapturedPage[] };

/** One page's worth of findings is a morning's work; past this it is a project, not a change. */
const MAX_FINDINGS = 12;
/** Under this many pages whose links I hold, "nothing points at it" is my own blind spot, not an orphan. */
const MIN_LINK_GRAPH = 2;
const SITEMAP: ReadonlySet<string> = new Set(["sitemap", "robots_sitemap"]);
const VIA: Record<string, string> = { homepage: "reading your home page", nav: "following your own menu",
  implementation: "a change you recorded on it" };

const flat = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const at = (u: string): string => {
  try { return new URL(u.startsWith("http") ? u : `https://${u}`).pathname.replace(/\/+$/, "") || "/"; } catch { return u; }
};

/**
 * Every fault this account's own rows prove, in address order. Deterministic, free, and empty whenever
 * nothing is held: an account with no inventory and no capture gets no findings rather than a clean bill.
 */
export function readTechnicalFindings(held: TechnicalHeld): TechnicalFinding[] {
  const rows = (held.inventory ?? []).filter((r) => !!r?.url?.trim());
  const pages = (held.pages ?? []).filter((p) => !!p?.url?.trim());
  const out: TechnicalFinding[] = [];
  const add = (url: string, kind: TechnicalKind, exactFix: string, evidence: string, exact: string | null = null, redirectTo?: string): void => { out.push({ url, kind, exactFix, evidence, exact, ...(redirectTo ? { redirectTo } : {}) }); };
  const byKey = new Map(rows.map((r) => [canonicalUrlKey(r.url), r]));
  const day = (s?: string | null): string => (s ?? "").slice(0, 10);
  // THE SUPPORT IS GONE, AND THAT IS THE ONLY THING THAT COUNTS AS GONE. 404 and 410 are the site saying
  // there is no page here. 401, 403, 429 and a robots refusal are ACCESS states: they say I was not let in,
  // which is a fact about me, not about the page, and telling an operator their live page is dead because
  // their firewall rate-limited my crawler is the worst kind of confident wrong. A 5xx is a bad minute
  // until a SECOND read on a LATER day says the same thing; one is unknown and stays unknown.
  const dead = (r?: InventoryRow): boolean => {
    if (!r) return false;
    if (r.crawl_state === "blocked") return false;
    if (r.crawl_state === "gone") return true;
    const code = typeof r.http_status === "number" ? r.http_status : null;
    if (code === 404 || code === 410) return true;
    const twice = !!r.status_reconfirmed_at && day(r.status_reconfirmed_at) !== day(r.last_crawled_at);
    return code != null && code >= 500 && twice;
  };
  const answers = (r: InventoryRow): string => (typeof r.http_status === "number" ? `${r.http_status}` : "nothing at all");
  const because = (r: InventoryRow): string => (typeof r.http_status === "number" && r.http_status >= 500
    ? ` I read it twice, on two different days, and it answered the same both times.` : "");

  for (const r of rows) {
    const to = (r.redirects_to ?? "").trim();
    const onward = (to ? byKey.get(canonicalUrlKey(to))?.redirects_to ?? "" : "").trim();
    // A DEAD ADDRESS IS A CHANGE ONLY WHEN I KNOW WHERE IT LIVES NOW. "Put it back, or forward it" names no
    // destination, so both correct answers read as failures afterwards. With a replacement this account's
    // own rows name it is one imperative forward; without one it is an investigation, held out of Ready.
    if (dead(r)) add(r.url, "non_200",
      to ? `I would send ${at(r.url)} on to ${at(to)}, so everyone arriving at the old address lands on the page that replaced it.`
        : `Tell me the address that replaced ${at(r.url)} and I will write you the forward. Until then I keep it out of your queue.`,
      `Your own site answers ${answers(r)} for ${at(r.url)}, so nobody following a link to it lands on anything.${because(r)}`,
      null, to || undefined);
    if (to && onward) add(r.url, "redirect_chain", `I would point ${at(r.url)} straight at ${at(onward)}, so there is one hop instead of two.`,
      `${at(r.url)} sends people to ${at(to)}, and ${at(to)} sends them on again to ${at(onward)}.`, null, onward);
  }
  // A SITEMAP THIS ACCOUNT DOES NOT PUBLISH ACCUSES NOBODY: the omission is only readable against a sitemap
  // I have actually seen, so a site with none gets no findings here rather than a caution about every page.
  const listed = rows.filter((r) => SITEMAP.has(r.discovered_via ?? ""));
  if (listed.length > 0) for (const r of rows) {
    if (r.crawl_state !== "crawled" || SITEMAP.has(r.discovered_via ?? "") || dead(r) || (r.redirects_to ?? "").trim()) continue;
    add(r.url, "sitemap_omission", `I would add ${at(r.url)} to the sitemap you already publish.`,
      `Your sitemap lists ${listed.length} of your pages and never ${at(r.url)}: I only found that one by ${VIA[r.discovered_via ?? ""] ?? "following a link"}.`);
  }

  for (const p of pages) {
    const here = at(p.url);
    if (p.has_canonical_mismatch === true) add(p.url, "canonical_conflict",
      `I would change the canonical link on ${here} so it names ${here} itself, unless you meant ${at(p.canonical_url ?? "")} to be the one page for this.`,
      `${here} names ${at(p.canonical_url ?? "")} as its real address, so search engines are told to keep that one and not this.`);
    else if ("canonical_url" in p && !(p.canonical_url ?? "").trim()) add(p.url, "canonical_missing",
      `I would add a canonical link on ${here} naming ${here} itself.`,
      `${here} names no address of its own, so the same page reached two ways can be counted as two pages.`);
    if (/\b(noindex|none)\b/i.test(p.robots_meta ?? "")) add(p.url, "robots_noindex",
      `I would take "noindex" out of the robots tag on ${here} so it can come back into search.`,
      `${here} carries a robots tag reading "${(p.robots_meta ?? "").trim()}", so search engines are told to leave it out.`);
    // A HEADING I CAN ACTUALLY WRITE. The page's own title is the exact wording, taken off the page itself
    // rather than invented, so this arrives as text to paste. A page with no title either gives me nothing
    // to write from, so there is no finding at all rather than an instruction to go and think of something.
    const ownTitle = (p.title ?? "").trim();
    if ("h1" in p && !(p.h1 ?? "").trim() && ownTitle) add(p.url, "missing_h1",
      `I would put this heading at the top of ${here}: "${ownTitle}".`,
      `${here} has no main heading at all, so the first thing a reader sees never says what the page is.`, ownTitle);
  }
  // TWO PAGES WEARING ONE NAME. Both addresses are named. I do NOT invent the replacement wording here:
  // nothing this account holds says what only that page answers, so the finding carries no exact text and
  // the producer keeps it out of Ready rather than handing over an instruction dressed as a change.
  const duplicates = (of: "title" | "h1", kind: TechnicalKind, what: string): void => {
    const groups = new Map<string, CapturedPage[]>();
    for (const p of pages) { const v = flat(p[of]); if (v) groups.set(v, [...(groups.get(v) ?? []), p]); }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const said = (group[0]![of] ?? "").trim();
      for (const p of group) add(p.url, kind, `I would give ${at(p.url)} a ${what} of its own that says what only that page answers, instead of "${said}".`,
        `${group.length} of your pages carry the same ${what}, "${said}": ${group.map((x) => at(x.url)).join(", ")}.`);
    }
  };
  duplicates("title", "duplicate_title", "title");
  duplicates("h1", "duplicate_h1", "heading");

  // THE LINK GRAPH, ONLY AS FAR AS I HOLD IT. Both rules below read the same held links, so a link I never
  // captured is never evidence that a page is unreachable or that a link is broken.
  const graph = pages.filter((p) => Array.isArray(p.internal_links));
  const linked = new Set(graph.flatMap((p) => p.internal_links!.map(canonicalUrlKey)));
  for (const p of graph) for (const href of new Set(p.internal_links!.map(canonicalUrlKey))) {
    const target = byKey.get(href);
    if (!dead(target)) continue;
    add(p.url, "broken_internal_link",
      `I would change the link on ${at(p.url)} that points at ${at(target!.url)} so it points at a page that answers, or take that link off the page.`,
      `${at(p.url)} links to ${at(target!.url)}, and that address answers ${answers(target!)}.`,
      null, target!.url);
  }
  // A LINK NEEDS A PAGE TO GO ON, A PLACE ON IT, AND WORDS TO READ. "Add a link from your home page, in the
  // part of it that covers the same subject" is an instruction, not a change: it names no real page, no real
  // spot, and nothing to type. So the source page is CHOSEN from the link graph (the on-topic page the rest
  // of the site already points at most, and the home page only when nothing on the site shares the subject),
  // the anchor is the orphan's own title or heading as captured, and a finding that cannot name all three
  // is not written at all: that page goes to research instead of arriving as work.
  const inbound = new Map<string, number>();
  for (const p of graph) for (const href of new Set(p.internal_links!.map(canonicalUrlKey))) inbound.set(href, (inbound.get(href) ?? 0) + 1);
  const captured = new Map(pages.map((p) => [canonicalUrlKey(p.url), p]));
  /** What a page is ABOUT, as far as I hold it: its address AND the words it calls itself by. */
  const words = (u: string): Set<string> => {
    const p = captured.get(canonicalUrlKey(u));
    return new Set(`${at(u)} ${p?.h1 ?? ""} ${p?.title ?? ""}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  };
  if (graph.length >= MIN_LINK_GRAPH) for (const r of rows) {
    // An address that sends people somewhere else is not a page nobody links to, it is a signpost.
    if (r.crawl_state !== "crawled" || at(r.url) === "/" || dead(r) || (r.redirects_to ?? "").trim() || linked.has(canonicalUrlKey(r.url))) continue;
    const anchor = ((captured.get(canonicalUrlKey(r.url))?.h1 ?? captured.get(canonicalUrlKey(r.url))?.title) ?? "").trim();
    if (!anchor) continue; // I hold no words for this link, so there is nothing exact to hand over.
    const mine = words(r.url);
    const ranked = graph.filter((p) => canonicalUrlKey(p.url) !== canonicalUrlKey(r.url))
      .map((p) => ({ p, shared: [...words(p.url)].filter((w) => mine.has(w)).length, seen: inbound.get(canonicalUrlKey(p.url)) ?? 0 }))
      .sort((a, b) => b.shared - a.shared || b.seen - a.seen || at(a.p.url).localeCompare(at(b.p.url)));
    const best = ranked[0];
    const source = best && best.shared > 0 ? best.p : graph.find((p) => at(p.url) === "/") ?? null;
    if (!source) continue;
    // THE SOURCE PAGE IS NAMED THE WAY A PERSON NAMES IT. A bag of matched tokens read as "the section of
    // it that already covers blog persian restaurants", which is not a place anyone can find on a page.
    const src = captured.get(canonicalUrlKey(source.url));
    const named = ((src?.title ?? "").trim() || (src?.h1 ?? "").trim()) || at(source.url);
    const where = best && best.shared > 0 && source === best.p
      ? `in the part of it about "${named}"`
      : "in the body of the page, under the first heading";
    add(r.url, "orphaned_page",
      `I would add one link on ${at(source.url)}, ${where}, reading "${anchor}" and pointing at ${at(r.url)}.`,
      `Not one of the ${graph.length} pages of yours whose links I hold points at ${at(r.url)}, so a reader can only reach it from search.`,
      anchor);
  }
  return out.sort((a, b) => at(a.url).localeCompare(at(b.url)) || a.kind.localeCompare(b.kind)).slice(0, MAX_FINDINGS);
}

/** THE LEVER EACH FAULT IS, in the component vocabulary that already exists. Moving an address, hiding a
 *  page or naming another page as the real one is `dangerous` and rides the two-step hold; the rest reach
 *  the operator as ordinary work. No fault here invents a kind: this is the same universe every other
 *  producer speaks, so a technical change is ranked, priced and validated exactly like any other. */
const LEVER: Record<TechnicalKind, { kind: BundleComponentKind; risk: BundleComponent["risk"]; label: string; objective: string }> = {
  non_200: { kind: "redirect", risk: "dangerous", label: "Fix an address that answers nothing", objective: "Give the people and the links arriving at this address something to land on." },
  redirect_chain: { kind: "redirect", risk: "dangerous", label: "Shorten a redirect", objective: "Send people to the page they asked for in one hop instead of two." },
  broken_internal_link: { kind: "internal_link_remove", risk: "review", label: "Fix a link that goes nowhere", objective: "Stop sending your own readers to an address that answers nothing." },
  canonical_missing: { kind: "canonical", risk: "dangerous", label: "Name this page's real address", objective: "Say which address is the one page, so the same words are not counted twice." },
  canonical_conflict: { kind: "canonical", risk: "dangerous", label: "Settle this page's real address", objective: "Point search engines at the page you actually want them to keep." },
  robots_noindex: { kind: "noindex", risk: "dangerous", label: "Let this page back into search", objective: "Stop telling search engines to leave this page out of their results." },
  sitemap_omission: { kind: "navigation", risk: "review", label: "List this page in your sitemap", objective: "Put this page on the list search engines read first." },
  duplicate_title: { kind: "title", risk: "review", label: "Give this page its own title", objective: "Let each of these pages win its own search instead of competing on one name." },
  duplicate_h1: { kind: "h1", risk: "review", label: "Give this page its own heading", objective: "Let each of these pages say what only it answers." },
  missing_h1: { kind: "h1", risk: "safe", label: "Give this page a heading", objective: "Say what this page answers in the first thing a reader sees." },
  orphaned_page: { kind: "internal_link_add", risk: "review", label: "Link to a page nothing points at", objective: "Give this page a way in from your own site instead of leaving it to search alone." },
};

/** The receipt id one finding is filed under. Shared by the reader, the ladder and the bundle, so a
 *  technical component always cites a line the operator can actually read. */
export const technicalKey = (i: number): string => `tech${i + 1}`;

/** PURE: the findings, as exact components. Each answers the component gate on its own: where it lands,
 *  what it achieves, why it moves the fault, and what I will read afterwards. */
export function technicalComponents(findings: readonly TechnicalFinding[], query: string): BundleComponent[] {
  return findings.map((f, i) => {
    const lever = LEVER[f.kind];
    // A FIELD CHANGE CARRIES THE FIELD'S OWN NEW VALUE, never a sentence about it: that value is what the
    // operator pastes and it is what the live check reads back off the page afterwards. Everything else is
    // a structural instruction, where the sentence IS the change.
    const after = (lever.kind === "title" || lever.kind === "h1" || lever.kind === "meta") && f.exact ? f.exact : f.exactFix;
    return { kind: lever.kind, label: lever.label, before: null, after, evidenceKeys: [technicalKey(i)],
      // THE DESTINATION TRAVELS AS AN ADDRESS, never inside a sentence: the first url-shaped word in the
      // instruction is the address being MOVED, and the live check graded a correct forward against it.
      ...(f.redirectTo ? { redirectTo: f.redirectTo } : {}),
      risk: lever.risk, where: `${at(f.url)}, and how it is served rather than the words on it`,
      objective: lever.objective, mechanism: f.evidence,
      measurementPlan: `I will read clicks, views and average position for "${query}" on ${at(f.url)} at 7, 14 and 28 days after you make the change.` };
  });
}
