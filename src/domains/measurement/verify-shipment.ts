import "server-only";
import { load } from "cheerio";

/** Verify the applied unit from owned-page evidence; bind the receipt to its copy and checker.
 * Historical requalification keeps the original read bound and never buys a SERP. */

import { loadBusinessProfile } from "@/domains/account";
import { isDataForSeoConfigured } from "@/domains/evidence/dataforseo/client";
import { parseCapability, providerCall } from "@/domains/evidence/dataforseo/funnel-boundary";
import { fetchPageHtml } from "@/domains/evidence/competitor-intel/polite-fetch";
import { extractPageSnapshot } from "@/domains/evidence/pages/extractor";
import { loadOwnedPageBodies, type OwnedPageBody } from "@/domains/evidence/pages/owned-context";
import type { PageSnapshot } from "@/domains/evidence/pages/types";
import { pageIdFor } from "@/domains/evidence/scanning/in-process-scan";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { syncPageSnapshots } from "@/lib/persistence/dual-write";
import { log } from "@/lib/logger";
import { reportingDay } from "@/lib/reporting-day";
import { SHIPMENT_PROOF } from "./proof-gsc/shipment-proof";
import {
  loadShippedChangesForTenant, recordVerification,
  type ShipmentVerification, type ShippedChangeRecord,
} from "./proof-gsc/shipped-change-store";

/** The Shipment store owns the canonical `ShipmentVerification`; this module produces one and hands it
 *  straight back. The store is the ONE reader and writer of a shipment row, so nothing here talks to a table. */
type ComponentState = ShipmentVerification["components"][number]["state"];
type Reason = NonNullable<ShipmentVerification["reason"]>;

/** What verification needs off a Shipment, named STRUCTURALLY: Measurement never imports Decision, so a
 *  component arrives as a kind and the exact copy the operator was handed, nothing else. `after` is the
 *  proposal (the copy, or the exact structural instruction). */
type VerifiableShipment = {
  id: string; url: string;
  components: Array<Pick<ReturnType<typeof SHIPMENT_PROOF.components>[number], "kind" | "after"> & Partial<Omit<ReturnType<typeof SHIPMENT_PROOF.components>[number], "kind" | "after">>>;
  claim?: Parameters<typeof SHIPMENT_PROOF.of>[0];
  requalification?: boolean;
  /** The searches this change was recorded against; the first of them is the one Google is asked about. */
  targetQueries?: string[];
  /** How many live reads this shipment has already had, so every recheck loop stays bounded. */
  priorChecks?: number;
  /** When the operator marked it done, so a read inside the publish grace window is never counted against the bounded checks. */
  implementedAt?: string | null;
};
/** THE PUBLISH GRACE WINDOW (operator, 2026-09-02): Mark Done means applied in the editor, and a site is often published once at the end of the session, so a difference read inside this window is "not published yet", spends none of the bounded checks and is read again tomorrow. */
const PUBLISH_GRACE_MS = 6 * 60 * 60 * 1000;

type VerifyDeps = {
  fetchPage?: typeof fetchPageHtml; now?: () => number;
  loadProfile?: (tenantId: string) => Promise<Awaited<ReturnType<typeof loadBusinessProfile>> | null>;
  writeOwnedPage?: (snapshot: PageSnapshot, tenantId: string) => Promise<void>;
  readHeld?: (urls: string[], tenantId: string) => Promise<Map<string, OwnedPageBody>>; // the pages as the store already holds them: for a read that came back with nothing at all, and for a closed reading whose page has moved since
  /** ONE results page for ONE search, seamed so a test never reaches a provider, and what is left of the whole pass's bound on those reads. */
  readSerp?: (query: string, tenantId: string) => Promise<SerpRow[] | null>;
  serpReads?: { left: number };
  /** The Shipment store's own reads and writes, injected in tests and nowhere else. */
  loadShipments?: (tenantId: string) => Promise<ShippedChangeRecord[]>;
  record?: (tenantId: string, shipmentId: string, verification: ShipmentVerification) => Promise<boolean>;
};

/** How many live pages ONE pass may read for verification. A verification is one free read of a page the
 *  account owns, and three of them is a pass's worth: the rest are still due on the next visit. */
const MAX_VERIFICATIONS_PER_PASS = 15, TARGET_SCAN_BOUND = 50; // verifications 3 to 15 (operator, 2026-08-30): 56 changes measuring drained at three a pass; the fetch itself is the only cost
/** The kinds a live page answers for on its own, with no wording needed to check them. */
const COPY_FREE_KINDS: ReadonlySet<string> = new Set(["noindex", "redirect", "consolidation", "navigation"]);
/** Where a sitemap lives when nobody has told me otherwise. Anything else is honestly unreadable rather than graded against a guess. */
const SITEMAP_PATH = "/sitemap.xml";
const TEMPLATE_SLOT = /\b(NUMBER|YEAR|SOURCE|TODO|TBD)\b/; // COPY THAT IS STILL A TEMPLATE was applied to nothing: two answer blocks on file read "has a population of NUMBER as of YEAR (SOURCE)", and grading a page against an unfilled slot calls work undone that nobody was ever handed

const norm = (s: string): string => s.normalize("NFKC").toLowerCase().replace(/[‘’“”]/g, "'").replace(/[^\p{L}\p{N}']+/gu, " ").trim();
const copyText = (s: string): string => s.normalize("NFKC").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
/** Opening-word checks are for Google's potentially rewritten display, never copy-delivery proof. */
const opener = (s: string, words = 12): string => norm(s).split(" ").filter(Boolean).slice(0, words).join(" ");
const firstLine = (s: string): string => s.split(/\r?\n/).map((l) => l.trim()).find((l) => !!l) ?? "";
const urlIn = (s: string): string | null => s.match(/https?:\/\/[^\s"'<>)\]]+|(?:^|\s)\/[a-z0-9][a-z0-9\-/_]*/i)?.[0]?.trim() ?? null;
const judged = (state: ComponentState, note: string, reason: Reason | null = null): { state: ComponentState; note: string; reason: Reason | null } => ({ state, note, reason });
// THE WORDS A LINK WAS RENAMED TO where the Shipment stored them as the label itself: a single short line with no quotation marks IS the wording, a sentence written about the link is not. 27 applied renames read as unreadable while their new words sat on the row, each equal to a live anchor.
const labelIn = (s: string): string => { const one = firstLine(s); return one === s.trim() && !/["“”]|(?<![A-Za-z0-9])['‘’]|['‘’](?![A-Za-z0-9])/.test(s) && one.split(/\s+/).filter(Boolean).length <= 12 ? one : ""; }; // AN APOSTROPHE INSIDE A WORD IS NOT A QUOTATION MARK (reviewer, 2026-09-05): every straight or curly single quote was rejected, so the one live rename reading "Pallas's Cat facts" read as unreadable while its exact new words sat on the row. A quote MARKS a passage and stands at a word boundary; a possessive stands between letters. Measured on the account's 27 stored renames: 1 unresolved before, 0 after.
/** A RECORD THAT NAMES NOTHING TO LOOK FOR, and the sentence that says so; null where the live page really can answer. Some kinds are visible with no wording at all (the address forwards, the page asks to be left out of search, the page exists); every other kind needs the exact wording that was applied, and what is on file is either empty, still the template with its slots unfilled, or a note ABOUT the change rather than the words it applied. THE ONE PLACE THAT ANSWERS IT (measured, 2026-09-05): a link rename asked the same question a second time inside the reading, AFTER a live read had already been spent, so a record could be written off for naming nothing while this rule said it named something. One rule, asked before any fetch and asked again at the door that reopens a closed record, so the two can never disagree. Wording is never invented to check against. */
const noExpectation = (kind: string, after: string, anchorAfter?: string | null): string | null => {
  if (["schema", "schema_add", "schema_replace"].includes(kind)) { const claim = schemaClaim(after); return claim.unread || !claim.roots.length ? "The record does not contain JSON-LD this checker can certify. A type name, malformed JSON or unsupported context cannot confirm the applied values. Keep the exact applied block for review; another page read cannot resolve this record." : null; }
  return COPY_FREE_KINDS.has(kind) || (norm(after) && !TEMPLATE_SLOT.test(after) && (kind !== "anchor_text" || !!norm(anchorAfter ?? "") || !!norm(labelIn(after)))) ? null : `${!norm(after) ? "The exact wording that was applied here was never recorded, so no reading of the page can confirm it." : TEMPLATE_SLOT.test(after) ? "What was recorded here is still the template wording, with its NUMBER, YEAR or SOURCE never filled in, so no live page could be carrying it." : "What was recorded here reads as a note about the change and not as the words that were applied, so no reading of the page can confirm it."} Nothing more is read for it. Record the words that are on the page and the next check reads them.`;
};
// THE PAGES AS THE STORE ALREADY HOLDS THEM, through the ONE canonical body reader: it picks the capture that IS the page (a newer blank never erases a confirmed body), so a javascript page answers from the rendered read already bought for it, and a closed reading learns its page moved. No second crawler, no spend.
const heldBodies = (urls: string[], tenantId: string): Promise<Map<string, OwnedPageBody>> => loadOwnedPageBodies(tenantId, urls);

/** Copy is checked against main content, never pooled metadata, navigation or schema assertions. */
/** `sitemap` is the account's own sitemap as it reads right now, fetched ONLY when a change asked to be
 *  listed in it and null when there was none to read: no read of the PAGE can answer whether it is on that list. */
/** `blind` is a read whose BODY never arrived (a javascript page hands the polite fetch a shell) and that no held capture could answer for. ONE fact for the whole reading: honoured in the two structured-data branches alone, one page said its markup builds in the browser while its sections said the operator did no work. */
type LiveRead = { snap: PageSnapshot; text: string; opening: string; schema: ReturnType<typeof schemaClaim>; markupBlind: boolean; finalUrl: string | null; requestedUrl: string; sitemap: string | null; blind: boolean };

function liveTextOf(html: string): { text: string; opening: string } {
  const $ = load(html); $("nav, body > header, footer, aside, script, style, noscript, svg, iframe, [hidden], [aria-hidden=true]").remove();
  const root = $("main").first().length ? $("main").first() : $("article").first().length ? $("article").first() : $("body");
  root.find("br, p, div, section, article, h1, h2, h3, h4, h5, h6, li, dt, dd, blockquote, pre, table, caption, tr, th, td, figure, figcaption").each((_, el) => { $(el).before(" ").after(" "); });
  const text = copyText(root.text()); root.find("h1").remove();
  return { text, opening: copyText(root.text()) };
}

/** WHAT GOOGLE PUTS ON SCREEN for one search: the rows of a results page, reduced to the address and the two
 *  pieces of wording Google writes there. No rank travels with them, so no surface can print one. */
type SerpRow = { url: string; title: string | null; snippet: string | null };
/** The whole pass's ceiling on paid results-page reads, and the tag the Results surface reads this one reading back by (app/(shell)/results/results-presentation.ts). */
const SERP_READS_PER_PASS = 12, GOOGLE_SHOWS = "google_display";
const serpRows = async (query: string, tenantId: string): Promise<SerpRow[] | null> => {
  if (!isDataForSeoConfigured()) return null; // no provider on file: the question is skipped in silence and the page reading is exactly what it was
  const got = await providerCall("serp_organic", { keyword: query }, { tenantId, unitKey: `shipment-display:${query}`.slice(0, 80) }).catch(() => null);
  return got && (got.state === "hit" || got.state === "ok") ? parseCapability("serp_organic", got.envelope)?.organic ?? null : null;
};
/** IS GOOGLE SHOWING THE NEW WORDS? Asked only where a title or a search description was applied, only for a
 *  shipment that named a search, and only while the pass has a read left. Returns the ONE extra component to
 *  store beside the page's own, or nothing at all, which is what every unanswerable case comes back as. */
async function googleShows(s: VerifiableShipment, tenantId: string, live: LiveRead, deps: VerifyDeps, checkedAt: string): Promise<ShipmentVerification["components"][number] | null> {
  const part = s.components.find((c) => (c.kind === "title" || c.kind === "meta") && !!norm(c.after ?? "")), budget = deps.serpReads ?? { left: 1 };
  const query = (s.targetQueries ?? []).map((q) => (q ?? "").trim()).find(Boolean);
  if (!part || !query || budget.left <= 0) return null; budget.left -= 1;
  const rows = await (deps.readSerp ?? serpRows)(query, tenantId).catch(() => null); if (!rows) return null;
  const here = canonicalUrlKey(live.requestedUrl), mine = rows.find((r) => canonicalUrlKey(r.url) === here), what = part.kind === "title" ? "title" : "search description";
  if (!mine) return { kind: GOOGLE_SHOWS, state: "unverifiable", note: "That search did not bring your page back, so what Google shows for it could not be read." };
  const days = Math.floor((Date.parse(checkedAt) - Date.parse(s.implementedAt ?? "")) / 86_400_000);
  const when = !Number.isFinite(days) ? "" : days < 1 ? ", checked the same day the change was made" : `, checked ${days} ${days === 1 ? "day" : "days"} after the change`;
  const shown = norm((part.kind === "title" ? mine.title : mine.snippet) ?? ""), old = opener(firstLine(part.before ?? ""), 8);
  return shown.includes(opener(firstLine(part.after ?? ""), 8))
    ? { kind: GOOGLE_SHOWS, state: "verified", note: `Google is showing your new ${what}.` }
    : { kind: GOOGLE_SHOWS, state: "not_verified", note: `${old && shown.includes(old) ? `Google still shows the old ${what}` : `Google is not yet showing your new ${what}`}${when}.` };
}

/** Read recorded Schema.org properties, nested nodes and standard @graph/@id links; custom contexts remain uncertified. */
function schemaClaim(block: string): { roots: Record<string, unknown>[]; nodes: Record<string, unknown>[]; unread: boolean } {
  const roots: Record<string, unknown>[] = [], nodes: Record<string, unknown>[] = []; let unread = false;
  const walk = (node: unknown, context: boolean, root: boolean): void => {
    if (Array.isArray(node)) { node.forEach((n) => walk(n, context, root)); return; }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (o["@context"] !== undefined) context = typeof o["@context"] === "string" && /^https?:\/\/schema\.org\/?$/.test(o["@context"]);
    if (!context) unread = true;
    if (Object.keys(o).some((k) => k.startsWith("@") && !["@context", "@type", "@id", "@graph", "@list", "@value", "@language"].includes(k))) unread = true;
    if (o["@type"] !== undefined) { const types = Array.isArray(o["@type"]) ? o["@type"] : [o["@type"]]; if (!types.length || types.some((t) => typeof t !== "string" || !t.trim())) unread = true; if (root) roots.push(o); }
    if (o["@type"] !== undefined || (typeof o["@id"] === "string" && Object.keys(o).some((k) => !k.startsWith("@")))) nodes.push(o);
    for (const [k, v] of Object.entries(o)) if (k !== "@context" && v && typeof v === "object") walk(v, context, k === "@graph" ? root : false);
  };
  const text = block.trim(), $ = text.startsWith("<") ? load(text) : null;
  const bodies = $ ? $("script").filter((_, el) => ($(el).attr("type") ?? "").trim().toLowerCase() === "application/ld+json").map((_, el) => $(el).html() ?? "").get() : text ? [text] : [];
  for (const body of bodies) { try { walk(JSON.parse(body), false, true); } catch { unread = true; } }
  const byId = new Map<string, Record<string, unknown>>();
  for (const node of nodes) if (typeof node["@id"] === "string") { const prior = byId.get(node["@id"]); if (!prior) byId.set(node["@id"], { ...node }); else for (const [k, v] of Object.entries(node)) { if (k !== "@context" && k in prior && !(schemaContains(v, prior[k], []) && schemaContains(prior[k], v, []))) unread = true; else prior[k] = v; } }
  const resolved = (n: Record<string, unknown>) => typeof n["@id"] === "string" ? byId.get(n["@id"])! : n;
  return { roots: roots.map(resolved), nodes: nodes.map(resolved), unread };
}
function schemaContains(want: unknown, live: unknown, nodes: readonly Record<string, unknown>[]): boolean {
  if (want === live) return true;
  if (Array.isArray(want)) { if (!Array.isArray(live)) return false; const owners = new Map<number, number>();
    const place = (i: number, visited: Set<number>): boolean => live.some((l, j) => { if (visited.has(j) || !schemaContains(want[i], l, nodes)) return false; visited.add(j); const prior = owners.get(j); if (prior !== undefined && !place(prior, visited)) return false; owners.set(j, i); return true; });
    return want.every((_, i) => place(i, new Set())); }
  if (!want || !live || typeof want !== "object" || typeof live !== "object" || Array.isArray(live)) return false;
  const w = want as Record<string, unknown>, l = live as Record<string, unknown>;
  if (typeof l["@id"] === "string" && Object.keys(l).length === 1 && Object.keys(w).length > 1) return nodes.some((n) => n["@id"] === l["@id"] && schemaContains(w, n, nodes));
  return Object.entries(w).every(([k, v]) => k === "@context" || (k === "@list" ? Array.isArray(v) && Array.isArray(l[k]) && v.length === l[k].length && v.every((item, i) => schemaContains(item, (l[k] as unknown[])[i], nodes)) : k === "@type" ? schemaContains(Array.isArray(v) ? v : [v], Array.isArray(l[k]) ? l[k] : [l[k]], nodes) : schemaContains(v, l[k], nodes)));
}

/** ONE component, judged against the page as it stands right now. Pure. */
function classify(component: { kind: string; after: string; anchorAfter?: string | null; redirectTo?: string | null; before?: string | null }, live: LiveRead): { state: ComponentState; note: string; reason: Reason | null } {
  const { snap } = live, proposed = component.after ?? "", nothingToFind = noExpectation(component.kind, proposed, component.anchorAfter); // NO COPY, NO CLAIM: the same rule the whole reading is settled by above, asked here for one piece of a bundle whose other pieces the page can answer for, and asked with everything the piece holds so a link rename is judged by ONE rule rather than by this one and then again below
  if (nothingToFind) return judged("unverifiable", nothingToFind, "applied_wording_missing");
  // A FIELD IS ABSENT ONLY WHERE THE READ COULD SEE ONE: a head that never parsed proves nothing about what is in it. And the wording that was there BEFORE, still live, is a publish that has not happened; calling that the operator's own version blamed them for a CMS cache and taught the loop off a page they never wrote.
  const field = (value: string | null, what: string) => !value?.trim() ? (live.blind && !snap.title ? judged("unverifiable", `Your page builds its content in the browser, so its ${what} could not be read from the outside.`, "rendered_content_gap") : judged("not_verified", `Your page has no ${what} at all.`, "not_published_yet"))
    : norm(value) === norm(proposed) ? judged("verified", `Your ${what} matches the prepared wording exactly.`) : norm(value) === norm(component.before ?? "") ? judged("not_verified", `Your ${what} still reads the way it did before this change.`, "not_published_yet")
      : judged("changed_differently", `Your ${what} is live, and it is not the prepared wording. Your page says "${value.trim().slice(0, 140)}", which is what this change is measured on.`, "published_differently");
  const headings = [...(snap.h2_list ?? []), ...(snap.h3_list ?? [])].map(norm).filter(Boolean);
  const wanted = copyText(proposed), headingHit = !!wanted && headings.includes(norm(proposed));
  const carries = !!wanted && (` ${live.text} `).includes(` ${wanted} `);
  // A link is compared as an ADDRESS, never as a string: a relative href on the page and an absolute one in
  // the proposal are the same link, and www or a trailing slash is not a difference.
  const absolute = (href: string): string => { try { return new URL(href, live.requestedUrl).toString(); } catch { return href; } };
  // THE ADDRESS THE CHANGE NAMED, off the change itself. Picking the first url-shaped word out of the
  // instruction picked the address being MOVED, so a correct forward read as one that went elsewhere. The
  // sentence is the last resort now, kept for rows on file that carry no destination of their own.
  const target = (component.redirectTo ?? "").trim() || urlIn(proposed), targetKey = target ? canonicalUrlKey(absolute(target)) : null;
  const linkHit = !!targetKey && (snap.internal_links ?? []).some((l) => canonicalUrlKey(absolute(l.href)) === targetKey);
  switch (component.kind) {
    case "title": return field(snap.title, "page title");
    case "meta": return field(snap.meta_description, "search description");
    case "h1": return field(snap.h1, "headline");
    case "opening_answer": {
      if (!live.opening) return judged("unverifiable", "The opening of your page could not be read, so this one is not called either way.", "rendered_content_gap");
      return (` ${live.opening} `).startsWith(` ${wanted} `) ? judged("verified", "Your page opens with the complete recorded answer.") : live.blind ? judged("unverifiable", "The complete opening could not be read, so the answer cannot be confirmed.", "rendered_content_gap") : judged("changed_differently", "Your page opens with different words than the prepared ones.", "published_differently");
    }
    case "section": case "section_add": case "section_rewrite": case "restructure": case "table_or_list_add":
      return headingHit ? judged("unverifiable", "The record names only a heading, so it cannot confirm the section's substantive copy.", "applied_wording_missing") : carries ? judged("verified", "The complete recorded section copy is on the page.")
        : !wanted ? judged("unverifiable", "This change names no wording to look for.", "applied_wording_missing")
          : live.blind ? judged("unverifiable", "Your page builds its content in the browser, so what is on it could not be read from the outside.", "rendered_content_gap") : judged("not_verified", "Your whole page was read, and this section is not on it.", "not_published_yet");
    case "section_remove":
      return !wanted ? judged("unverifiable", "This change names no heading to look for.", "applied_wording_missing")
        : headingHit || carries ? judged("not_verified", "The recorded section heading or copy is still on the page.") : live.blind ? judged("unverifiable", "The page could not be read completely, so the removal cannot be confirmed.", "rendered_content_gap") : judged("verified", "The recorded section heading or copy is no longer present.");
    // A RENAMED LINK IS CHECKED ON ITS WORDS, NEVER ON ITS ADDRESS. The swap renames a link that already
    // exists, so asking whether a link to that address is on the page answered yes the moment the change was
    // written: it read verified without anything having happened. What changed is the wording, so the wording
    // is what I read, off the live link itself, and if the exact new words did not travel I say so.
    case "anchor_text": {
      const want = norm(component.anchorAfter ?? "") || norm(labelIn(proposed)); // the Shipment stores the new label as the component's own copy on every link change the queue mints; only an instruction ABOUT the link is not the wording, and the "names nothing to look for" answer for it is the ONE rule above, reached before this branch and before any fetch
      if (snap.internal_links == null) return judged("unverifiable", "The links on your page could not be read this time.", "rendered_content_gap");
      // NAMED BY ITS ADDRESS WHERE THE CHANGE STORED ONE, AND BY ITS EXACT WORDS WHERE IT DID NOT, never both loosened at once. Containment over a list that fell back to EVERY link on the page could pass a short label on a link nobody had touched, so the whole anchor must be equal, and with no address on file the wording is the only thing naming the link: no arbitrary link is ever searched.
      const links = targetKey ? snap.internal_links.filter((l) => canonicalUrlKey(absolute(l.href)) === targetKey) : snap.internal_links;
      return targetKey && links.length === 0 ? judged("not_verified", "No link to that address is on your page at all.", "not_published_yet")
        : links.some((l) => norm(l.anchor_text ?? "") === want) ? judged("verified", targetKey ? "That link now reads the way this change asked." : "A link on your page reads exactly the words this change asked for, and this change stored no address, so it is named by its wording alone.")
          : judged("not_verified", "That link is on your page, and it still does not read the way this change asked.", "not_published_yet");
    }
    case "internal_links": case "internal_link_add": { // BOTH THE ADDRESS AND THE WORDS (operator, 2026-09-02): a link is verified only when the live link to the named address carries the anchor words the change asked for
      const want = norm(component.anchorAfter ?? ""), worded = !want || (snap.internal_links ?? []).some((l) => canonicalUrlKey(absolute(l.href)) === targetKey && norm(l.anchor_text ?? "").includes(want));
      return !target ? judged("unverifiable", "This change names no address to look for.", "applied_wording_missing")
        : snap.internal_links == null ? judged("unverifiable", "The links on your page could not be read this time.", "rendered_content_gap")
          : linkHit && worded ? judged("verified", "The link this change asked for is on the page.") : linkHit ? judged("not_verified", "A link to that address is on the page, and it does not carry the words this change asked for.", "not_published_yet") : judged("not_verified", "That link is not on the page yet.", "not_published_yet"); }
    // A SITEMAP EDIT IS READ IN THE SITEMAP. This looked for a link on the PAGE, which no edit to
    // sitemap.xml can ever put there, so every one of them read as work the operator had not done.
    case "navigation": {
      if (live.sitemap == null) return judged("unverifiable", `No sitemap answered at ${SITEMAP_PATH} on your site, so this one is not called either way. Publish your sitemap at that address and the next check reads it.`, "page_unreachable");
      if (/<sitemapindex/i.test(live.sitemap)) return judged("unverifiable", `Your ${SITEMAP_PATH} lists other sitemap files rather than pages, so it cannot say whether this page is on one.`, "unmeasurable");
      const listed = [...live.sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!), here = canonicalUrlKey(live.requestedUrl);
      if (listed.length === 0) return judged("unverifiable", `Your ${SITEMAP_PATH} answered and lists no readable addresses, so this one is not called either way.`, "unmeasurable");
      return listed.some((u) => canonicalUrlKey(absolute(u)) === here) ? judged("verified", "Your sitemap now lists this page.")
        : judged("not_verified", `Your sitemap lists ${listed.length} ${listed.length === 1 ? "address" : "addresses"}, and this page is not one of them.`, "not_published_yet");
    }
    case "internal_link_remove":
      return !target || snap.internal_links == null ? judged("unverifiable", "That link on your page could not be checked this time.", "rendered_content_gap")
        : linkHit ? judged("not_verified", "That link is still on the page.", "not_published_yet") : judged("verified", "That link is gone.");
    // Verify the recorded values in their own entities, not globally pooled types/names or truncated answers.
    case "schema_add": case "schema_replace": case "schema": {
      const want = schemaClaim(proposed), seen = live.schema;
      if (seen.unread) return judged("unverifiable", "The live JSON-LD contains malformed data, unsupported context or conflicting entity values, so this exact block cannot be confirmed.", "unmeasurable");
      if (!seen.nodes.length) return live.markupBlind ? judged("unverifiable", "The page's live structured data could not be read; a saved text capture cannot answer for its markup.", "rendered_content_gap") : judged("not_verified", "No structured data is on your page at all.", "not_published_yet");
      const carries = (claim: ReturnType<typeof schemaClaim>) => !claim.unread && claim.roots.length > 0 && claim.roots.every((w) => seen.nodes.some((n) => schemaContains(w, n, seen.nodes)));
      const here = carries(want), old = schemaClaim(component.before ?? ""), oldHere = carries(old);
      if (here && oldHere && old.roots.some((w) => seen.nodes.some((n) => schemaContains(w, n, seen.nodes) && !want.roots.some((next) => schemaContains(next, n, seen.nodes))))) return judged("changed_differently", "Both the old and replacement structured data remain on the page.", "published_differently");
      if (here) return judged("verified", "Every recorded structured-data property matches the live block, including its full answer text and entity values.");
      if (oldHere) return judged("not_verified", "Your page still carries the structured-data block that was there before this change.", "not_published_yet");
      return want.roots.some((w) => seen.nodes.some((n) => schemaContains({ "@type": w["@type"] }, n, seen.nodes))) ? judged("changed_differently", "The requested schema type is live, but its recorded property values do not match the prepared block.", "published_differently") : judged("not_verified", "The requested structured-data block is not on your page yet.", "not_published_yet");
    }
    case "canonical":
      return !target ? judged("unverifiable", "This change names no address to look for.", "applied_wording_missing")
        : !snap.canonical_url ? judged("not_verified", "Your page names no preferred address.", "not_published_yet")
          : canonicalUrlKey(snap.canonical_url) === canonicalUrlKey(target) ? judged("verified", "Your page points at the address this change asked for.")
            : judged("changed_differently", "Your page points at a different address than the one this change asked for.", "published_differently");
    case "redirect": case "consolidation": {
      if (!live.finalUrl) return judged("unverifiable", "Where that address ended up could not be seen.", "page_unreachable");
      if (canonicalUrlKey(live.finalUrl) === canonicalUrlKey(live.requestedUrl)) return judged("not_verified", "That address still serves its own page, so nothing is forwarding yet.", "not_published_yet");
      // MOVED IS NOT ARRIVED. A forward with no destination named could be landing anywhere, a login wall
      // included, so it is honestly unknown rather than a pass I cannot stand behind.
      if (!targetKey) return judged("unverifiable", "It forwards somewhere, and the change named no destination, so there is nothing to confirm it against.", "applied_wording_missing");
      return canonicalUrlKey(live.finalUrl) === targetKey ? judged("verified", "That address now forwards visitors on.")
        : judged("changed_differently", "That address forwards somewhere other than where this change asked.", "published_differently");
    }
    case "noindex":
      return snap.robots_meta == null ? judged("unverifiable", "This setting cannot be seen from outside your page.", "unmeasurable")
        : /noindex/i.test(snap.robots_meta) ? judged("verified", "Your page now asks search engines to leave it out.")
          : judged("changed_differently", "Your page still asks search engines to keep it.", "not_published_yet");
    case "new_page":
      return !wanted ? judged("unverifiable", "The page is live, but no applied page copy was recorded to verify.", "applied_wording_missing") : carries ? judged("verified", "The complete recorded page copy is live.")
        : live.blind ? judged("unverifiable", "The page's content could not be read.", "rendered_content_gap") : judged("not_verified", "The address answers, but the complete recorded page copy is not there.", "not_published_yet");
    default: {
      return !wanted ? judged("unverifiable", "This change names no wording to look for.", "applied_wording_missing") : carries ? judged("verified", "The complete recorded wording is on your page.")
        : live.blind ? judged("unverifiable", "Your page builds its content in the browser, so what is on it could not be read from the outside.", "rendered_content_gap") : judged("not_verified", "Your whole page was read, and this wording is not on it.", "not_published_yet");
    }
  }
}
/** Every component unverifiable, for the cases where the page itself could not be read. */
const allUnknown = (shipment: VerifiableShipment, note: string) => shipment.components.map((c) => ({ kind: c.kind, state: "unverifiable" as ComponentState, note }));

/**
 * VERIFY ONE SHIPMENT against the live page. One fetch, on the free owned-page path, and the answer is
 * whatever I could actually see. The page snapshot is persisted on the way through (the same row every
 * other read of the account's own pages writes) so the next read of that page is served from what I already
 * hold instead of going back out to the customer's website.
 */
async function verifyShipmentReading(tenantId: string, shipment: VerifiableShipment, deps: VerifyDeps = {}): Promise<ShipmentVerification> {
  const now = deps.now ?? Date.now, stamp = (): string => new Date(now()).toISOString(), fetchPage = deps.fetchPage ?? fetchPageHtml; /* A READING IS STAMPED WHEN IT ANSWERS, NEVER WHEN IT STARTS (measured on the live ledger, 2026-09-05). The stamp was taken before the fetch and this door writes the capture it just read, so every reading left behind a capture stamped AFTER itself: shp_d5a9862db7099a2d645c97139634540f read iranopedia.com/cities at 07:32:52.706Z and wrote a capture at 07:32:53.665Z, 959 ms later, which the closed-row door below reads as "the page moved since" and reopens. Twenty-eight live reads against a bound of three, each one manufacturing the capture that reopened it, and that pile of captures is what starved the body reader. Stamped on the way out, a reading's own capture can never be newer than it. */
  const requested = /^https?:\/\//i.test(shipment.url) ? shipment.url : `https://${shipment.url}`;
  // NO READ THAT SAW NOTHING IS FINAL ON ITS FIRST ANSWER (R-059, 2026-09-03). A read that could not see the
  // change says nothing about the change, so a site that did not answer counts ONE check and comes back the
  // next day; the third blocked answer stands, exactly as a difference does.
  const early = !!shipment.implementedAt && now() - Date.parse(shipment.implementedAt) < PUBLISH_GRACE_MS;
  const checks = (shipment.priorChecks ?? 0) + (early ? 0 : 1); // a read inside the grace window is free: it informs, it never counts
  // NO LIVE READ FOR A RECORD NO PAGE CAN ANSWER. Every piece names nothing to look for, so the answer is settled from the record itself: no fetch, no check spent, no day promised, and the row is never scheduled again. A historical record is reconciled from what it holds; only a page that could carry the change is read.
  const unanswerable = shipment.components.map((c) => noExpectation(c.kind, c.after ?? "", c.anchorAfter));
  if (shipment.components.length > 0 && unanswerable.every((n) => n != null)) return { status: "blocked", checkedAt: stamp(), checks: shipment.priorChecks ?? 0, reason: "applied_wording_missing", recheckAfter: null, components: shipment.components.map((c, i) => ({ kind: c.kind, state: "unverifiable" as ComponentState, note: unanswerable[i]! })) };
  const blockedRead = (note: string, reason: Reason): ShipmentVerification =>
    ({ status: "blocked", checkedAt: stamp(), components: allUnknown(shipment, note), checks, reason, recheckAfter: checks < MAX_CHECKS ? reportingDay(now() + 86_400_000) : null });
  let res: Awaited<ReturnType<typeof fetchPageHtml>>;
  try { res = await fetchPage(requested, new Map(), {}); } catch { return blockedRead("Your website did not answer, so this change could not be checked.", "page_unreachable"); }
  if (!res.ok) {
    if (/^http_(404|410)$/.test(res.detail ?? "")) {
      // NOT_FOUND INSIDE THE PUBLISH LAG IS THE SAME LAG (operator, 2026-08-29): Mark Done means applied in the editor and the site may be published once at the end of the session, so a page not there yet is re-read on the same bounded schedule rather than buried on read one.
      return { status: "not_found", checkedAt: stamp(), checks, reason: early ? "not_published_yet" : "address_mismatch", components: allUnknown(shipment, early ? "There is no page at that address yet. Sites are often published later in the session, so it is read again tomorrow." : "There is no page at that address right now."), recheckAfter: early ? reportingDay(now() + 86_400_000) : checks < MAX_CHECKS ? reportingDay(now() + 2 * 86_400_000) : null };
    }
    return res.reason === "robots_blocked" // the site's own standing instruction, answered once and never re-fetched
      ? { status: "blocked", checkedAt: stamp(), checks, reason: "unmeasurable", recheckAfter: null, components: allUnknown(shipment, "Your site's robots rules ask for this page not to be read, so it was not.") }
      : blockedRead("Your website did not answer, so this change could not be checked.", "page_unreachable");
  }
  const profile = deps.loadProfile ? await deps.loadProfile(tenantId).catch(() => null) : await loadBusinessProfile(tenantId).catch(() => null);
  const snap = extractPageSnapshot(res.html, requested, pageIdFor(canonicalUrlKey(shipment.url)), tenantId, res.status, profile ?? undefined); // ONE PAGE IDENTITY (operator, 2026-09-01): the raw address minted a second page id for eight pages beside the crawler's canonical one
  const shell = !snap.title && snap.word_count === 0; // A READ THAT PARSED NOTHING IS NOT AN EMPTY PAGE: a javascript site hands the polite fetch a shell, so the page store answers for it below, and only while its capture is newer than the change, because older words prove what the page said before it and never what it says now
  const held = shell ? await (deps.readHeld ?? heldBodies)([requested], tenantId).then((m) => m.get(canonicalUrlKey(requested)) ?? null).catch(() => null) : null;
  const fresh = held && ["current", "sample_only"].includes(held.version ?? "") && !!held.fetchedAt && (!shipment.implementedAt || held.fetchedAt >= shipment.implementedAt) ? held : null;
  // Fail-soft on purpose: the verification I just computed is the evidence, and a snapshot row I could not save changes nothing about what I read with my own eyes. A shell is never written OVER the capture that IS the page.
  if (!shell) await (deps.writeOwnedPage ?? ((s: PageSnapshot, t: string) => syncPageSnapshots([s], t)))(snap, tenantId).catch(() => {});
  // ONE extra read, only when a change asked to be listed in the sitemap, and never a second time.
  const got = shipment.components.some((c) => c.kind === "navigation") ? await fetchPage(`${new URL(requested).origin}${SITEMAP_PATH}`, new Map(), {}).catch(() => null) : null;
  const asRead = fresh ? { ...snap, title: fresh.title, meta_description: fresh.metaDescription, h1: fresh.h1, h2_list: fresh.headings, body_paragraph_sample: fresh.passages, internal_links: fresh.internalLinks.map((l) => ({ href: l.href, anchor_text: l.anchorText })) } : snap;
  const heldText = copyText(fresh?.passages.join(" ") ?? ""), heldH1 = copyText(fresh?.h1 ?? "");
  const live: LiveRead = { snap: asRead, ...(fresh ? { text: heldText, opening: heldH1 && heldText.startsWith(`${heldH1} `) ? heldText.slice(heldH1.length).trim() : heldText } : liveTextOf(res.html)), schema: schemaClaim(res.html), markupBlind: snap.extraction_certainty === "uncertain", finalUrl: res.finalUrl ?? null, requestedUrl: requested, sitemap: got?.ok ? got.html : null, blind: fresh ? fresh.completeness !== "complete" : snap.extraction_certainty === "uncertain" };
  const components = shipment.components.map((c) => ({ kind: c.kind, ...classify(c, live) })), seen = components.filter((c) => c.state !== "unverifiable");
  const status: ShipmentVerification["status"] = seen.length === 0 ? "blocked"
    : components.every((c) => c.state === "verified") ? "verified" : seen.some((c) => c.state === "verified") ? "partially_verified" : "differs";
  // A DIFFERENCE, OR A READING THAT GRADED NOTHING, IS RE-READ AND NEVER BURIED. CMSes serve the old page through caches and build queues for hours after a paste, so the first read routinely differs, and a page where every piece came back unreadable is a fact about that one read. Up to MAX_CHECKS bounded reads, two days apart; a verified answer is final on any read, and the third read's answer stands whatever it is. AND A READING TAKEN OFF A CAPTURE OLDER THAN THE CHANGE IS NOT ANSWERED BY FETCHING AGAIN: the same shell comes back every time, so it closes here rather than promising a day. The page itself reopens it the moment a newer capture lands, which is the rule shipmentsAwaitingVerification already carries.
  const again = status !== "verified" && (early || checks < MAX_CHECKS) && !(shell && held && !fresh), spent = !again && checks >= MAX_CHECKS && status !== "verified"; /* AND THE READING THAT SPENDS THE LAST CHECK SAYS SO, ON THE RECORD (2026-09-05): `checks` at the bound with no day promised is where the recheck ends, and a record that does not say it reads as one still waiting its turn. */
  // WHAT GOOGLE SHOWS IS BANKED AFTER THE ROLL-UP AND NEVER INSIDE IT: a results page that has not caught up yet is a fact about Google, and letting it into `status` would take a landed change back off the board.
  const said = <T extends { state: ComponentState; note: string }>(c: T, tail: string): T => c.state !== "verified" && c.state !== "unverifiable" ? { ...c, note: `${c.note} ${tail}` } : c;
  const graded = early && again ? components.map((c) => said(c, "Sites are often published later in the session, so this is read again tomorrow without counting against the check limit.")) : spent ? components.map((c) => said(c, `That is ${MAX_CHECKS} reads of this page, which is the limit, so this one stands and nothing more is read for it. Apply it again and mark it done, or make the next change on this page and measure that.`)) : components, shows = await googleShows(shipment, tenantId, live, deps, stamp());
  // ONE TYPED CAUSE FOR THE WHOLE READING, off the pieces that produced it, so an unconfirmed backlog partitions by what is actually wrong instead of by the outcome. The operator's own wording wins the tie: it is the one cause that ends the waiting rather than extending it. The cause never travels inside a component.
  const causes = graded.map((c) => c.reason).filter((r): r is Reason => !!r);
  const reason: Reason | null = status === "verified" ? (shows?.state === "not_verified" ? "google_not_updated" : null)
    : shell && held && !fresh ? "stale_reading" : causes.find((r) => r === "published_differently") ?? causes[0] ?? "unmeasurable";
  const claim = shipment.claim ?? { page: shipment.url, implementedAt: shipment.implementedAt, componentsApplied: shipment.components.map((c) => ({ ...c, label: "" })) };
  return { status, checkedAt: stamp(), checks, reason, proof: SHIPMENT_PROOF.of(claim, JSON.stringify([res.html, fresh])), components: (shows ? [...graded, shows] : graded).map(({ kind, state, note }) => ({ kind, state, note })), recheckAfter: again ? reportingDay(now() + (early ? 1 : 2) * 86_400_000) : null };
}

export async function verifyShipment(tenantId: string, shipment: VerifiableShipment, deps: VerifyDeps = {}): Promise<ShipmentVerification> {
  return { ...await verifyShipmentReading(tenantId, shipment, deps), checkerContract: SHIPMENT_PROOF.contract };
}

/** AND THE PAGE IS READ AGAINST THE VERSION THAT IS ACTUALLY ON IT. Where the operator told this door they applied their own wording, that wording is what the page is checked for, and the prepared wording stays on the record beside it: both versions are kept, the suggestion and the version applied, and neither is overwritten by the other. */
const componentsOf = SHIPMENT_PROOF.components;

/** One Shipment row, as verification reads it. A row that already holds an answer is here on the day that
 *  answer promised, carrying the reads it has had so the bound is counted from them and never from zero. */
const toVerifiable = (r: ShippedChangeRecord): VerifiableShipment =>
  ({ id: r.id, url: r.page, claim: r, requalification: r.verification?.status === "verified" && !SHIPMENT_PROOF.of(r), components: componentsOf(r), targetQueries: r.targetQueries ?? [], implementedAt: r.implementedAt ?? null, ...(r.verification != null ? { priorChecks: r.verification.checks ?? 1 } : {}) });

/** The most live reads one shipment ever gets, and the ONE place that number is written (seventh round: the repair pass beside this one carried its own literal 3 for want of an export slot, so two files could drift apart on the bound that decides whether a customer's page is ever read again). */
export const MAX_CHECKS = 3;
const loadRows = (tenantId: string, deps: VerifyDeps): Promise<ShippedChangeRecord[]> =>
  (deps.loadShipments ?? loadShippedChangesForTenant)(tenantId).catch(() => []);

/** The changes the operator marked implemented that I have NOT checked on their live page yet, newest stamp
 *  first and bounded. Free: rows already on file, and `verification` being null IS the due marker. */
export async function shipmentsAwaitingVerification(tenantId: string, limit = MAX_VERIFICATIONS_PER_PASS, deps: VerifyDeps = {}): Promise<VerifiableShipment[]> {
  if (!tenantId?.trim()) return [];
  const rows = await loadRows(tenantId, deps);
  // TODAY IS THE OPERATOR'S DAY, never the UTC one. A retry promised for the 5th was owed from 5 PM Pacific
  // on the 4th when today came off a UTC instant, so a read a silent site was owed was taken a day early and
  // its answer, taken before the site had a chance, spent one of the bounded checks.
  const today = reportingDay(deps.now ? deps.now() : Date.now());
  /** Never checked, or a read whose own promised recheck day has arrived. */
  const closed = rows.filter((r) => !!r?.page && r.verification != null && r.verification.status !== "verified" && (r.verification.recheckAfter ?? null) == null);
  const moved = closed.length === 0 ? new Map<string, OwnedPageBody>() : await (deps.readHeld ?? heldBodies)(closed.map((r) => r.page), tenantId).catch(() => new Map<string, OwnedPageBody>());
  const due = (r: ShippedChangeRecord): boolean => {
    if (r.verification == null) return true;
    if (r.verification.status === "verified" && !SHIPMENT_PROOF.of(r)) return (r.verification.checks ?? 1) < MAX_CHECKS && componentsOf(r).some((c) => noExpectation(c.kind, c.after, c.anchorAfter) == null);
    const at = r.verification.recheckAfter ?? null;
    // A CLOSED READING IS REOPENED BY THE PAGE ITSELF, exactly once per capture. A row terminal since August carries a live headline equal to its applied copy byte for byte, and nothing could ever ask again. No fetch decides this: the capture already on file does, and the answer the re-read writes back is stamped later than that capture, so the same capture can never open it twice.
    // AND A RECORD THAT HOLDS NO WORDING IS NOT REOPENED BY A CAPTURE EITHER: a newer read of the page cannot answer a record that names nothing to look for, so it is reconciled from what it holds and never queued for live work again. AND THE BOUND HOLDS AT THIS DOOR TOO (measured, 2026-09-05): it was written into the reading and never into the door that reopens one, so a shipment on a page that keeps being captured came back for a twenty-eighth live read against a bound of three. A reading closed on its last check is the last one there is, whatever the page does next; the next change made to that page is measured on its own record.
    // BUT A RECORD CLOSED BY A RULE THAT NO LONGER HOLDS IS RE-DERIVED, NOT LEFT WRITTEN OFF (measured, 2026-09-05). `applied_wording_missing` is not a verdict about the page: it is this code's own answer to "does the record name anything to look for", so it is asked again from the record every pass instead of being kept as a stored fact. The day the reader learned that an apostrophe inside a word is not a quotation mark, shp_6de7016c5cdf7e078f597a28f5a8975b held the exact words "Pallas's Cat facts" and stayed written off for ever, because the fix was forward-only and the door excluded that reason by name. The same one rule decides both sides now, and the arithmetic bounds it rather than an argument about which branch answers: a re-derivation may take the read the bound allows and ONE more, never a third, so a record whose reading still cannot grade it is closed for ever on that read instead of coming back every pass.
    if (!at) return r.verification.status !== "verified" && (r.verification.reason === "applied_wording_missing" ? (r.verification.checks ?? 1) <= MAX_CHECKS && componentsOf(r).some((c) => noExpectation(c.kind, c.after ?? "", c.anchorAfter) == null) : (r.verification.checks ?? 1) < MAX_CHECKS && (moved.get(canonicalUrlKey(r.page))?.fetchedAt ?? "") > (r.verification.checkedAt ?? ""));
    return today >= at;
  };
  return rows
    .filter((r) => !!r?.id && !!r.page && !!r.implementedAt && due(r))
    .sort((a, b) => String(b.implementedAt).localeCompare(String(a.implementedAt)))
    .slice(0, Math.max(1, Math.min(limit, MAX_VERIFICATIONS_PER_PASS)))
    .map(toVerifiable);
}

/**
 * ONE bounded verification pass: up to three live pages read, each one written back exactly once. Nothing
 * here pauses a run, and nothing here spends a cent. Returns how many verifications actually landed.
 */
/** ONE SHIPMENT, CHECKED NOW: "did my paste land" waited for the next sweep, which is the wrong answer at ten to thirty applies a day, and the verifier, the due read and the record all existed already (Codex, 2026-08-28). Same path, so this is no second verification route; a shipment no longer due is simply absent and this returns 0. */
export const verifyShipmentNow = (tenantId: string, shipmentId: string, deps: VerifyDeps = {}): Promise<number> => verifyDueShipments(tenantId, deps, (s) => s.id === shipmentId); // the target is picked BY ID across a wider bound, so a shipment fourth in the due order is still the one checked

export async function verifyDueShipments(tenantId: string, deps: VerifyDeps = {}, only?: (s: { id: string }) => boolean): Promise<number> { // `only` narrows the SAME due read to one shipment
  // A TARGETED CHECK SELECTS ITS SHIPMENT BEFORE ANY SWEEP LIMIT: filtering after the three-row cap meant a target fourth in line was never the one verified (Codex, 2026-08-28). The sweep keeps its own cap.
  const due = (await shipmentsAwaitingVerification(tenantId, only ? TARGET_SCAN_BOUND : MAX_VERIFICATIONS_PER_PASS, deps)).filter((s) => !only || only(s)).slice(0, MAX_VERIFICATIONS_PER_PASS); let written = 0; const serpReads = { left: SERP_READS_PER_PASS }; // ONE ceiling for the whole pass, carried across every shipment in it
  const unsavable = new Set<string>(); // BOUNDED IN-RUN SKIP, carried on the pass and nowhere else: an answer that could not be SAVED means the shipment is still due, so a second shipment at the SAME address would send me back to the customer's website inside one pass for a result I already know I cannot store
  const read = new Map<string, ReturnType<NonNullable<VerifyDeps["fetchPage"]>>>(), stored = new Set<string>(); /** ONE ADDRESS IS READ ONCE A PASS, AND STORED ONCE (measured, 2026-09-05). Four shipments sit on iranopedia.com/iran-animals, so one pass fetched that page four times and wrote four captures of it inside five seconds; 79 of the account's 1,086 stored page versions are that one address, and a pile like that is what the body reader's row budget has to page around. The fetch is shared across the shipments at one address and the capture is written once, so every shipment still gets its own reading of the same words. */
  const fetchOnce: NonNullable<VerifyDeps["fetchPage"]> = (url, ...rest) => { const k = canonicalUrlKey(url), had = read.get(k); if (had) return had; const got = (deps.fetchPage ?? fetchPageHtml)(url, ...rest); read.set(k, got); return got; },
    writeOnce = async (snapshot: PageSnapshot, tenant: string): Promise<void> => { const k = canonicalUrlKey(snapshot.url); if (stored.has(k)) return; stored.add(k); await (deps.writeOwnedPage ?? ((s: PageSnapshot, t: string) => syncPageSnapshots([s], t)))(snapshot, tenant); };
  for (const shipment of due) {
    const address = canonicalUrlKey(shipment.url);
    if (unsavable.has(address)) continue;
    const verification = await verifyShipment(tenantId, shipment, { serpReads, ...deps, ...(shipment.requalification ? { readSerp: async () => null } : {}), fetchPage: fetchOnce, writeOwnedPage: writeOnce }).catch(() => null);
    if (!verification) continue;
    // A verification that could not be SAVED is not a verification: the shipment stays due and I check it
    // again on the next visit, which is the ONE case where the same page is read twice.
    const saved = await (deps.record ?? recordVerification)(tenantId, shipment.id, verification).catch(() => false);
    if (saved) written += 1; else unsavable.add(address);
    log.info("[verify-shipment] checked what you marked as done", { tenantId, shipment: shipment.id, status: verification.status, saved });
  }
  return written;
}

/** WHEN THIS PAGE'S TRUTH LAST MOVED UNDERNEATH ME: the latest moment the operator implemented something at
 *  this address. The freshness matrix takes it as `bustedAt`, so a body read BEFORE the operator changed the
 *  page is not treated as a read of the page that exists now, however recent the clock says it is.
 *  Fail-soft to null, which is the same answer as "nothing changed it". */
export async function shipmentBustedAt(tenantId: string, url: string, deps: VerifyDeps = {}): Promise<string | null> {
  if (!tenantId?.trim() || !url?.trim()) return null;
  const key = canonicalUrlKey(url);
  // ONE ADDRESS, COMPARED AS AN ADDRESS. A path suffix test made the home page ("/", which every address
  // ends with) bust every page on the site, and /guide bust /nowruz-guide, so one change threw away every
  // body Beacon held. Only the page the change was made to is busted by it.
  const stamps = (await loadRows(tenantId, deps))
    .filter((r) => !!r.implementedAt && canonicalUrlKey(r.page) === key)
    .map((r) => r.implementedAt!)
    .filter((at) => Number.isFinite(Date.parse(at)))
    .sort();
  return stamps.length > 0 ? stamps[stamps.length - 1]! : null;
}
