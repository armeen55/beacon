import "server-only";

/**
 * measurement/verify-shipment (V1 Truth Convergence Phase 6, 2026-07-31) - DID THE CHANGE ACTUALLY LAND ON
 * THE LIVE PAGE?
 *
 * A CLICK IS NOT A SHIPMENT, AND IT NEVER BECOMES ONE. "Mark implemented" is the operator telling me what
 * they did, and until I have read the page myself that is a claim, not a fact. The claim STARTS this check
 * and can never finish it: there is no button, no note and no argument that lands a change in the verified
 * state without page evidence behind it. This module goes and looks: ONE read of a page the account OWNS,
 * through the same polite fetch and the same extractor every other read of their own pages goes through,
 * never a paid provider, never from a page render. Then it says, component by component, what it could
 * actually see, in the four honest states there are: verified, not_verified, changed_differently (the page
 * carries a different change in that spot than the one I wrote), and unverifiable (I could not read it).
 *
 * WHAT IT WILL NEVER DO. It will never call a component not_verified when the truth is that I cannot see
 * that kind of change from outside the page (a noindex sent in a header, structured data a raw fetch never
 * renders): that is `unverifiable`, said out loud, every time.
 *
 * DELIVERED IS NOT SHOWING. New words on the page are not the same fact as Google putting them on screen, so
 * a title or description shipment also asks ONE results-page read for that page's own top search, through the
 * shared cache on the cheapest queue, bounded per pass and silent when no provider is configured. It is
 * stored BESIDE the page components and never inside the roll-up, so what Google shows can never move a
 * shipment's own status. No position is read or shown anywhere: a page that starts answering more questions
 * is found by more searches, so its average position gets worse exactly as the page gets better.
 *
 * WHY IT IS NOT A LOOP. Every ending is bounded by MAX_CHECKS live reads and nothing reopens after them: a
 * difference, a site that stayed silent and a page whose pieces could none of them be graded all come back
 * on the promised day and stand for good on the third read. A verified reading is final the moment it lands,
 * and so is a robots rule refusing the read, which is the site's own standing instruction and is said out
 * loud. Bounded to fifteen shipments per pass on top of that, and to one read per address inside a pass
 * whose answers are not landing.
 */

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
  components: Array<{ kind: string; after: string; anchorAfter?: string | null; redirectTo?: string | null; before?: string | null }>;
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
/** Under this many words at the proposed address, a new page is live but not yet a page. */
const THIN_PAGE_WORDS = 120;
/** The kinds a live page answers for on its own, with no wording needed to check them. */
const COPY_FREE_KINDS: ReadonlySet<string> = new Set(["new_page", "noindex", "redirect", "consolidation", "schema", "navigation"]);
/** Where a sitemap lives when nobody has told me otherwise. Anything else is honestly unreadable rather than graded against a guess. */
const SITEMAP_PATH = "/sitemap.xml";
const TEMPLATE_SLOT = /\b(NUMBER|YEAR|SOURCE|TODO|TBD)\b/; // COPY THAT IS STILL A TEMPLATE was applied to nothing: two answer blocks on file read "has a population of NUMBER as of YEAR (SOURCE)", and grading a page against an unfilled slot calls work undone that nobody was ever handed

const norm = (s: string): string => s.toLowerCase().replace(/[‘’“”]/g, "'").replace(/[^a-z0-9']+/g, " ").trim();
/** The claim's own opening words, which is how much of a proposal I can honestly expect to find verbatim. */
const opener = (s: string, words = 12): string => norm(s).split(" ").filter(Boolean).slice(0, words).join(" ");
const firstLine = (s: string): string => s.split(/\r?\n/).map((l) => l.trim()).find((l) => !!l) ?? "";
const urlIn = (s: string): string | null => s.match(/https?:\/\/[^\s"'<>)\]]+|(?:^|\s)\/[a-z0-9][a-z0-9\-/_]*/i)?.[0]?.trim() ?? null;
const judged = (state: ComponentState, note: string, reason: Reason | null = null): { state: ComponentState; note: string; reason: Reason | null } => ({ state, note, reason });
// THE WORDS A LINK WAS RENAMED TO where the Shipment stored them as the label itself: a single short line with no quotation marks IS the wording, a sentence written about the link is not. 27 applied renames read as unreadable while their new words sat on the row, each equal to a live anchor.
const labelIn = (s: string): string => { const one = firstLine(s); return one === s.trim() && !/["'‘’“”]/.test(s) && one.split(/\s+/).filter(Boolean).length <= 12 ? one : ""; };
// THE PAGES AS THE STORE ALREADY HOLDS THEM, through the ONE canonical body reader: it picks the capture that IS the page (a newer blank never erases a confirmed body), so a javascript page answers from the rendered read already bought for it, and a closed reading learns its page moved. No second crawler, no spend.
const heldBodies = (urls: string[], tenantId: string): Promise<Map<string, OwnedPageBody>> => loadOwnedPageBodies(tenantId, urls);

/** What the live page says, reduced to the facts a component can be checked against. `text` is the page's
 *  own words: the extractor's main-content capture PLUS the raw body stripped of markup, so a paragraph far
 *  below the fold is still found and "I did not see it" means I really did look at the whole page. */
/** `sitemap` is the account's own sitemap as it reads right now, fetched ONLY when a change asked to be
 *  listed in it and null when there was none to read: no read of the PAGE can answer whether it is on that list. */
/** `blind` is a read whose BODY never arrived (a javascript page hands the polite fetch a shell) and that no held capture could answer for. ONE fact for the whole reading: honoured in the two structured-data branches alone, one page said its markup builds in the browser while its sections said the operator did no work. */
type LiveRead = { snap: PageSnapshot; text: string; finalUrl: string | null; requestedUrl: string; sitemap: string | null; blind: boolean };

function liveTextOf(snap: PageSnapshot, html: string): string {
  const captured = [snap.title, snap.h1, ...(snap.h2_list ?? []), ...(snap.h3_list ?? []), ...(snap.body_paragraph_sample ?? []), ...(snap.card_texts ?? [])].filter(Boolean).join(" ");
  return norm(`${captured} ${html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")}`);
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

/** WHAT A JSON-LD BLOCK CLAIMS: the @types it declares and the names a live read can be compared against (an
 *  FAQ's questions, an image's own name). Returns nothing at all when the block is not readable JSON, which
 *  is honestly unknown rather than a failure to find it on the page. */
/** The types a live read harvests names for. An ImageObject's own name is NOT among them, so a block that
 *  names only an image is confirmed as far as its type and honestly unknown past that, never graded wrong. */
const NAMED_LIVE: ReadonlySet<string> = new Set(["Question", "Service", "Offer", "Product", "Organization",
  "LocalBusiness", "HomeAndConstructionBusiness", "BreadcrumbList", "ListItem", "ItemList", "Place", "CreativeWork", "WebPage", "Article"]);
function schemaClaim(block: string): { types: string[]; names: string[] } {
  const body = block.trim().replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
  const types: string[] = [], names: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    const o = node as Record<string, unknown>, raw = o["@type"];
    const own = (Array.isArray(raw) ? raw : [raw]).filter((x): x is string => typeof x === "string"); types.push(...own);
    if (own.some((t) => NAMED_LIVE.has(t)) && typeof o.name === "string" && o.name.trim()) names.push(o.name);
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
  };
  try { walk(JSON.parse(body)); } catch { return { types: [], names: [] }; }
  return { types, names };
}

/** ONE component, judged against the page as it stands right now. Pure. */
function classify(component: { kind: string; after: string; anchorAfter?: string | null; redirectTo?: string | null; before?: string | null }, live: LiveRead): { state: ComponentState; note: string; reason: Reason | null } {
  const { snap } = live, proposed = component.after ?? "";
  // NO COPY, NO CLAIM. Some kinds are visible without any wording at all (the address forwards, the page
  // asks to be left out of search, the page exists). Every other kind needs the exact wording that was
  // applied, and when I do not hold it I say so rather than checking the page against a guess.
  if ((!norm(proposed) || TEMPLATE_SLOT.test(proposed)) && !COPY_FREE_KINDS.has(component.kind)) {
    return judged("unverifiable", norm(proposed) ? "What is on file here is still the template wording, with its NUMBER, YEAR or SOURCE never filled in, so there is nothing a page could be carrying." : "The exact wording that was applied here is not on file, so this one is not called either way.", "applied_wording_missing");
  }
  // A FIELD IS ABSENT ONLY WHERE THE READ COULD SEE ONE: a head that never parsed proves nothing about what is in it. And the wording that was there BEFORE, still live, is a publish that has not happened; calling that the operator's own version blamed them for a CMS cache and taught the loop off a page they never wrote.
  const field = (value: string | null, what: string) => !value?.trim() ? (live.blind && !snap.title ? judged("unverifiable", `Your page builds its content in the browser, so its ${what} could not be read from the outside.`, "rendered_content_gap") : judged("not_verified", `Your page has no ${what} at all.`, "not_published_yet"))
    : norm(value) === norm(proposed) ? judged("verified", `Your ${what} matches the prepared wording exactly.`) : norm(value) === norm(component.before ?? "") ? judged("not_verified", `Your ${what} still reads the way it did before this change.`, "not_published_yet")
      : judged("changed_differently", `Your ${what} is live, and it is not the prepared wording. Your page says "${value.trim().slice(0, 140)}", which is what this change is measured on.`, "published_differently");
  const headings = [...(snap.h2_list ?? []), ...(snap.h3_list ?? [])].map(norm).filter(Boolean);
  const wanted = opener(firstLine(proposed), 8), wantedWords = wanted.split(" ").filter(Boolean);
  // A HEADING VERIFIES A SECTION ONLY IF IT COVERS IT. Either the proposed heading is on the page in full,
  // or the live heading carries at least half of its words and never fewer than three. Measured by chars,
  // a two word fragment ("our prices") passed for a nine word section, so a page that answered almost none
  // of what was asked for read as verified.
  const covers = (h: string): boolean => {
    if (h.includes(wanted)) return true;
    const words = new Set(h.split(" ").filter(Boolean)), shared = wantedWords.filter((w) => words.has(w)).length;
    return shared >= Math.max(3, Math.ceil(wantedWords.length / 2));
  };
  const headingHit = !!wanted && headings.some(covers);
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
      const sample = norm((snap.body_paragraph_sample ?? []).join(" ")), want = opener(proposed);
      if (!sample) return judged("unverifiable", "The opening of your page could not be read, so this one is not called either way.", "rendered_content_gap");
      return sample.includes(want) ? judged("verified", "Your page opens with the prepared answer.") : judged("changed_differently", "Your page opens with different words than the prepared ones.", "published_differently");
    }
    case "section": case "section_add": case "section_rewrite": case "restructure": case "table_or_list_add":
      return headingHit || (!!wanted && live.text.includes(wanted)) ? judged("verified", "The section this change asked for is on the page.")
        : !wanted ? judged("unverifiable", "This change names no wording to look for.", "applied_wording_missing")
          : live.blind ? judged("unverifiable", "Your page builds its content in the browser, so what is on it could not be read from the outside.", "rendered_content_gap") : judged("not_verified", "Your whole page was read, and this section is not on it.", "not_published_yet");
    case "section_remove":
      return !wanted ? judged("unverifiable", "This change names no heading to look for.", "applied_wording_missing")
        : headingHit ? judged("not_verified", "That section is still on the page.") : judged("verified", "That section is gone.");
    // A RENAMED LINK IS CHECKED ON ITS WORDS, NEVER ON ITS ADDRESS. The swap renames a link that already
    // exists, so asking whether a link to that address is on the page answered yes the moment the change was
    // written: it read verified without anything having happened. What changed is the wording, so the wording
    // is what I read, off the live link itself, and if the exact new words did not travel I say so.
    case "anchor_text": {
      const want = norm(component.anchorAfter ?? "") || norm(labelIn(proposed)); // the Shipment stores the new label as the component's own copy on every link change the queue mints; only an instruction ABOUT the link is not the wording
      if (!want) return judged("unverifiable", "The exact words that link was meant to read are not on file, so this one is not called either way.", "applied_wording_missing");
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
    // STRUCTURED DATA IS CHECKED ON WHAT IT NAMES, never on the page's own words: no heading will ever match a
    // JSON-LD block, so a block shipped as its field family read as a section nobody had written. The live read
    // holds the types the page carries and the names inside them, which is exactly what a prepared block can be
    // compared against. Where the live read harvests no name for a type (an image's own name is one), the type
    // being there is all that can honestly be said, and a replacement that still reads as the OLD block is not
    // a page carrying a different change, it is a change that has not landed.
    case "schema_add": case "schema_replace": {
      const want = schemaClaim(proposed), liveTypes = snap.schema_types ?? [];
      if (want.types.length === 0) return judged("unverifiable", "What was applied here is not readable structured data, so this one is not called either way.", "applied_wording_missing");
      const liveNames = [...(snap.schema_entity_names ?? []), ...(snap.faqs ?? []).filter((f) => f.source === "jsonld").map((f) => f.question)].map(norm).filter(Boolean);
      if (liveTypes.length === 0 && liveNames.length === 0) {
        return live.blind ? judged("unverifiable", "Your page builds its content in the browser, so its structured data cannot be read from the outside.", "rendered_content_gap")
          : judged("not_verified", "No structured data is on your page at all.", "not_published_yet");
      }
      const type = want.types.find((t) => liveTypes.some((l) => norm(l) === norm(t))), wanted = want.names.map(norm).filter(Boolean);
      if (!type) return judged("not_verified", `Your page carries ${liveTypes.join(", ") || "structured data"}, and no ${want.types[0]} block is on it.`, "not_published_yet");
      if (wanted.length === 0) return judged("unverifiable", `Your page carries a ${type} block, and what is inside it cannot be read from the outside, so whether it is this exact block is not called either way.`, "unmeasurable");
      if (wanted.every((n) => liveNames.some((l) => l.includes(n)))) return judged("verified", `Your page carries the ${type} block this change asked for.`);
      const old = schemaClaim(component.before ?? "").names.map(norm).filter(Boolean);
      return old.length > 0 && old.every((n) => liveNames.some((l) => l.includes(n))) ? judged("not_verified", `Your page still carries the ${type} block that was there before this change.`, "not_published_yet")
        : judged("changed_differently", `Your page carries a ${type} block, and it is not the one this change prepared.`, "published_differently");
    }
    case "schema": {
      const types = snap.schema_types ?? [], named = (snap.schema_entity_names ?? []).length > 0, askedFor = types.find((t) => norm(proposed).includes(norm(t)));
      if (askedFor) return judged("verified", `Your page carries ${askedFor} structured data.`);
      if (types.length > 0 || named) return judged("unverifiable", "Your page carries structured data, and none of it matches this change.", "unmeasurable");
      return live.blind ? judged("unverifiable", "Your page builds its content in the browser, so its structured data cannot be read from the outside.", "rendered_content_gap")
        : judged("not_verified", "No structured data is on your page.", "not_published_yet");
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
      return snap.word_count >= THIN_PAGE_WORDS ? judged("verified", "The new page is live and has real content on it.")
        : judged("changed_differently", `The address answers, and only ${snap.word_count} words are on it.`, "not_published_yet");
    default: {
      const want = opener(proposed);
      return !want ? judged("unverifiable", "This change names no wording to look for.", "applied_wording_missing") : live.text.includes(want) ? judged("verified", "This wording is on your page.")
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
export async function verifyShipment(tenantId: string, shipment: VerifiableShipment, deps: VerifyDeps = {}): Promise<ShipmentVerification> {
  const now = deps.now ?? Date.now, checkedAt = new Date(now()).toISOString(), fetchPage = deps.fetchPage ?? fetchPageHtml;
  const requested = /^https?:\/\//i.test(shipment.url) ? shipment.url : `https://${shipment.url}`;
  // NO READ THAT SAW NOTHING IS FINAL ON ITS FIRST ANSWER (R-059, 2026-09-03). A read that could not see the
  // change says nothing about the change, so a site that did not answer counts ONE check and comes back the
  // next day; the third blocked answer stands, exactly as a difference does.
  const early = !!shipment.implementedAt && now() - Date.parse(shipment.implementedAt) < PUBLISH_GRACE_MS;
  const checks = (shipment.priorChecks ?? 0) + (early ? 0 : 1); // a read inside the grace window is free: it informs, it never counts
  const blockedRead = (note: string, reason: Reason): ShipmentVerification =>
    ({ status: "blocked", checkedAt, components: allUnknown(shipment, note), checks, reason, recheckAfter: checks < MAX_CHECKS ? reportingDay(now() + 86_400_000) : null });
  let res: Awaited<ReturnType<typeof fetchPageHtml>>;
  try { res = await fetchPage(requested, new Map(), {}); } catch { return blockedRead("Your website did not answer, so this change could not be checked.", "page_unreachable"); }
  if (!res.ok) {
    if (/^http_(404|410)$/.test(res.detail ?? "")) {
      // NOT_FOUND INSIDE THE PUBLISH LAG IS THE SAME LAG (operator, 2026-08-29): Mark Done means applied in the editor and the site may be published once at the end of the session, so a page not there yet is re-read on the same bounded schedule rather than buried on read one.
      return { status: "not_found", checkedAt, checks, reason: early ? "not_published_yet" : "address_mismatch", components: allUnknown(shipment, early ? "There is no page at that address yet. Sites are often published later in the session, so it is read again tomorrow." : "There is no page at that address right now."), recheckAfter: early ? reportingDay(now() + 86_400_000) : checks < MAX_CHECKS ? reportingDay(now() + 2 * 86_400_000) : null };
    }
    return res.reason === "robots_blocked" // the site's own standing instruction, answered once and never re-fetched
      ? { status: "blocked", checkedAt, checks, reason: "unmeasurable", recheckAfter: null, components: allUnknown(shipment, "Your site's robots rules ask for this page not to be read, so it was not.") }
      : blockedRead("Your website did not answer, so this change could not be checked.", "page_unreachable");
  }
  const profile = deps.loadProfile ? await deps.loadProfile(tenantId).catch(() => null) : await loadBusinessProfile(tenantId).catch(() => null);
  const snap = extractPageSnapshot(res.html, requested, pageIdFor(canonicalUrlKey(shipment.url)), tenantId, res.status, profile ?? undefined); // ONE PAGE IDENTITY (operator, 2026-09-01): the raw address minted a second page id for eight pages beside the crawler's canonical one
  const shell = !snap.title && snap.word_count === 0; // A READ THAT PARSED NOTHING IS NOT AN EMPTY PAGE: a javascript site hands the polite fetch a shell, so the page store answers for it below, and only while its capture is newer than the change, because older words prove what the page said before it and never what it says now
  const held = shell ? await (deps.readHeld ?? heldBodies)([requested], tenantId).then((m) => m.get(canonicalUrlKey(requested)) ?? null).catch(() => null) : null;
  const fresh = held && (!shipment.implementedAt || (held.fetchedAt ?? "") >= shipment.implementedAt) ? held : null;
  // Fail-soft on purpose: the verification I just computed is the evidence, and a snapshot row I could not save changes nothing about what I read with my own eyes. A shell is never written OVER the capture that IS the page.
  if (!shell) await (deps.writeOwnedPage ?? ((s: PageSnapshot, t: string) => syncPageSnapshots([s], t)))(snap, tenantId).catch(() => {});
  // ONE extra read, only when a change asked to be listed in the sitemap, and never a second time.
  const got = shipment.components.some((c) => c.kind === "navigation") ? await fetchPage(`${new URL(requested).origin}${SITEMAP_PATH}`, new Map(), {}).catch(() => null) : null;
  const asRead = fresh ? { ...snap, title: fresh.title, meta_description: fresh.metaDescription, h1: fresh.h1, h2_list: fresh.headings, body_paragraph_sample: fresh.passages, internal_links: fresh.internalLinks.map((l) => ({ href: l.href, anchor_text: l.anchorText })) } : snap;
  const live: LiveRead = { snap: asRead, text: fresh ? norm([fresh.vocabulary, ...fresh.passages, ...fresh.headings].join(" ")) : liveTextOf(snap, res.html), finalUrl: res.finalUrl ?? null, requestedUrl: requested, sitemap: got?.ok ? got.html : null, blind: snap.extraction_certainty === "uncertain" && !fresh };
  const components = shipment.components.map((c) => ({ kind: c.kind, ...classify(c, live) })), seen = components.filter((c) => c.state !== "unverifiable");
  const status: ShipmentVerification["status"] = seen.length === 0 ? "blocked"
    : seen.every((c) => c.state === "verified") ? "verified" : seen.some((c) => c.state === "verified") ? "partially_verified" : "differs";
  // A DIFFERENCE, OR A READING THAT GRADED NOTHING, IS RE-READ AND NEVER BURIED. CMSes serve the old page
  // through caches and build queues for hours after a paste, so the first read routinely differs, and a page
  // where every piece came back unreadable is a fact about that one read. Up to MAX_CHECKS bounded reads, two
  // days apart; a verified answer is final on any read, and the third read's answer stands whatever it is.
  const again = status !== "verified" && (early || checks < MAX_CHECKS);
  // WHAT GOOGLE SHOWS IS BANKED AFTER THE ROLL-UP AND NEVER INSIDE IT: a results page that has not caught up
  // yet is a fact about Google, and letting it into `status` would take a landed change back off the board.
  const graded = early && again ? components.map((c) => c.state !== "verified" && c.state !== "unverifiable" ? { ...c, note: `${c.note} Sites are often published later in the session, so this is read again tomorrow without counting against the check limit.` } : c) : components, shows = await googleShows(shipment, tenantId, live, deps, checkedAt);
  // ONE TYPED CAUSE FOR THE WHOLE READING, off the pieces that produced it, so an unconfirmed backlog partitions by what is actually wrong instead of by the outcome. The operator's own wording wins the tie: it is the one cause that ends the waiting rather than extending it. The cause never travels inside a component.
  const causes = graded.map((c) => c.reason).filter((r): r is Reason => !!r);
  const reason: Reason | null = status === "verified" ? (shows?.state === "not_verified" ? "google_not_updated" : null)
    : shell && held && !fresh ? "stale_reading" : causes.find((r) => r === "published_differently") ?? causes[0] ?? "unmeasurable";
  return { status, checkedAt, checks, reason, components: (shows ? [...graded, shows] : graded).map(({ kind, state, note }) => ({ kind, state, note })), recheckAfter: again ? reportingDay(now() + (early ? 1 : 2) * 86_400_000) : null };
}

/** WHAT THE OPERATOR SAID THEY APPLIED, with the exact copy WHERE I HOLD IT. A Shipment names the
 *  components that were applied; the wording it stores is the change's own before/after, so a single
 *  component carries its copy and the others carry none. A component whose copy I do not hold is checked
 *  anyway when its kind can be seen without copy (a redirect, a noindex, structured data) and is honestly
 *  UNKNOWN when it cannot. Inventing wording to check against would be worse than saying I cannot tell. */
function componentsOf(r: ShippedChangeRecord): VerifiableShipment["components"] {
  const copy = (r.after ?? "").trim(), was = (r.before ?? "").trim(); // AND WHAT IT REPLACED, on the same fallback the copy already takes: the row holds the wording that was there before and the component was handed none of it, so the page still carrying it read as the operator's own version
  const applied = (r.componentsApplied ?? []) as Array<{ kind: string; after?: string | null; anchorAfter?: string | null; redirectTo?: string | null; before?: string | null }>;
  if (applied.length === 0) return copy || r.actionType ? [{ kind: r.actionType || "content", after: copy, before: was || null }] : [];
  const lone = applied.length === 1;
  return applied.map((c) => ({ kind: c.kind, anchorAfter: c.anchorAfter ?? null, redirectTo: c.redirectTo ?? null, before: (c.before ?? "").trim() || (lone || c.kind === r.actionType ? was : "") || null,
    after: (c.after ?? "").trim() || (lone || c.kind === r.actionType ? copy : "") }));
}

/** One Shipment row, as verification reads it. A row that already holds an answer is here on the day that
 *  answer promised, carrying the reads it has had so the bound is counted from them and never from zero. */
const toVerifiable = (r: ShippedChangeRecord): VerifiableShipment =>
  ({ id: r.id, url: r.page, components: componentsOf(r), targetQueries: r.targetQueries ?? [], implementedAt: r.implementedAt ?? null, ...(r.verification != null ? { priorChecks: r.verification.checks ?? 1 } : {}) });

/** The most live reads one shipment ever gets. */
const MAX_CHECKS = 3;
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
  /** Never checked, or a read whose own promised recheck day has arrived. A row carrying
   *  the retired `operator_confirmed` label was never checked at all, whatever it says, so it is owed the
   *  one real reading it never got; the answer it writes back is a real state and the row is done. */
  const closed = rows.filter((r) => !!r?.page && r.verification != null && r.verification.status !== "verified" && (r.verification.recheckAfter ?? null) == null);
  const moved = closed.length === 0 ? new Map<string, OwnedPageBody>() : await (deps.readHeld ?? heldBodies)(closed.map((r) => r.page), tenantId).catch(() => new Map<string, OwnedPageBody>());
  const due = (r: ShippedChangeRecord): boolean => {
    if (r.verification == null || r.verification.status === "operator_confirmed") return true;
    const at = r.verification.recheckAfter ?? null;
    // A CLOSED READING IS REOPENED BY THE PAGE ITSELF, exactly once per capture. A row terminal since August carries a live headline equal to its applied copy byte for byte, and nothing could ever ask again. No fetch decides this: the capture already on file does, and the answer the re-read writes back is stamped later than that capture, so the same capture can never open it twice.
    if (!at) return r.verification.status !== "verified" && (moved.get(canonicalUrlKey(r.page))?.fetchedAt ?? "") > (r.verification.checkedAt ?? "");
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
  for (const shipment of due) {
    const address = canonicalUrlKey(shipment.url);
    if (unsavable.has(address)) continue;
    const verification = await verifyShipment(tenantId, shipment, { serpReads, ...deps }).catch(() => null);
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
