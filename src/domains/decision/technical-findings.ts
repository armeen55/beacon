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
 *  operator's own words: `evidence` is what I saw, `exactFix` is what to do, and neither is a caution. */
export type TechnicalFinding = { url: string; kind: TechnicalKind; exactFix: string; evidence: string };

/** One inventory row, exactly the columns owned_pages hands over. Everything optional: a row from an
 *  older write carries less, and less is unknown rather than a fault. */
type InventoryRow = { url: string; discovered_via?: string | null; crawl_state?: string | null;
  http_status?: number | null; redirects_to?: string | null };

/** One captured page, exactly the fields the page capture holds. A field ABSENT from the object is not
 *  held; a field present and empty is held and empty, which is the only thing that may ever accuse. */
type CapturedPage = { url: string; title?: string | null; h1?: string | null; canonical_url?: string | null;
  has_canonical_mismatch?: boolean | null; robots_meta?: string | null; internal_links?: readonly string[] };

export type TechnicalHeld = { inventory?: readonly InventoryRow[]; pages?: readonly CapturedPage[] };

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
  const add = (url: string, kind: TechnicalKind, exactFix: string, evidence: string): void => { out.push({ url, kind, exactFix, evidence }); };
  const byKey = new Map(rows.map((r) => [canonicalUrlKey(r.url), r]));
  /** An address my own last read found nothing at. Never a guess: the state or the status says so. */
  const dead = (r?: InventoryRow): boolean => !!r && (r.crawl_state === "gone" || (typeof r.http_status === "number" && r.http_status >= 400));
  const answers = (r: InventoryRow): string => (typeof r.http_status === "number" ? `${r.http_status}` : "nothing at all");

  for (const r of rows) {
    if (dead(r)) add(r.url, "non_200", `I would put ${at(r.url)} back at its own address, or send that address on to the page that replaced it.`,
      `Your own site answers ${answers(r)} for ${at(r.url)}, so nobody following a link to it lands on anything.`);
    const to = (r.redirects_to ?? "").trim();
    const onward = (to ? byKey.get(canonicalUrlKey(to))?.redirects_to ?? "" : "").trim();
    if (to && onward) add(r.url, "redirect_chain", `I would point ${at(r.url)} straight at ${at(onward)}, so there is one hop instead of two.`,
      `${at(r.url)} sends people to ${at(to)}, and ${at(to)} sends them on again to ${at(onward)}.`);
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
    if ("h1" in p && !(p.h1 ?? "").trim()) add(p.url, "missing_h1",
      `I would put one heading at the top of ${here} saying what it answers${(p.title ?? "").trim() ? `, starting from its own title "${(p.title ?? "").trim()}"` : ""}.`,
      `${here} has no main heading at all, so the first thing a reader sees never says what the page is.`);
  }
  // TWO PAGES WEARING ONE NAME. Counted across the capture itself, so both addresses are named and the
  // operator picks which one keeps the wording; I never choose that for them.
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
      `${at(p.url)} links to ${at(target!.url)}, and that address answers ${answers(target!)}.`);
  }
  const root = rows.find((r) => at(r.url) === "/");
  if (graph.length >= MIN_LINK_GRAPH && root) for (const r of rows) {
    // An address that sends people somewhere else is not a page nobody links to, it is a signpost.
    if (r.crawl_state !== "crawled" || at(r.url) === "/" || dead(r) || (r.redirects_to ?? "").trim() || linked.has(canonicalUrlKey(r.url))) continue;
    add(r.url, "orphaned_page", `I would add a link to ${at(r.url)} from ${at(root.url)}, in the part of it that covers the same subject.`,
      `Not one of the ${graph.length} pages of yours whose links I hold points at ${at(r.url)}, so a reader can only reach it from search.`);
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
    return { kind: lever.kind, label: lever.label, before: null, after: f.exactFix, evidenceKeys: [technicalKey(i)],
      risk: lever.risk, where: `${at(f.url)}, and how it is served rather than the words on it`,
      objective: lever.objective, mechanism: f.evidence,
      measurementPlan: `I will read clicks, views and average position for "${query}" on ${at(f.url)} at 7, 14 and 28 days after you make the change.` };
  });
}
