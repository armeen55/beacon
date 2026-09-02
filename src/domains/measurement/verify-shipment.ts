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
 * WHY IT IS NOT A LOOP. A verification is written ONCE per shipment, so a page that refuses me is never
 * refetched on the next visit, or the one after that. That is the promise the owned-read retry memory
 * makes, kept by a simpler mechanism: the shipment stops being due. The single exception is a site that
 * did not answer at all, which is a fact about the transport and not about the change, so it earns ONE
 * retry on a later day and then stands. Bounded to three shipments per pass on top of that, and to one
 * read per address inside a pass whose answers are not landing.
 */

import { loadBusinessProfile } from "@/domains/account";
import { fetchPageHtml } from "@/domains/evidence/competitor-intel/polite-fetch";
import { extractPageSnapshot } from "@/domains/evidence/pages/extractor";
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

/** What verification needs off a Shipment, named STRUCTURALLY: Measurement never imports Decision, so a
 *  component arrives as a kind and the exact copy the operator was handed, nothing else. `after` is the
 *  proposal (the copy, or the exact structural instruction). */
type VerifiableShipment = {
  id: string;
  url: string;
  components: Array<{ kind: string; after: string; anchorAfter?: string | null; redirectTo?: string | null }>;
  /** This is the ONE retry a site that did not answer earns. A recheck's own answer is final either way. */
  recheck?: boolean;
  /** How many live reads this shipment has already had, so the differs recheck loop stays bounded. */
  priorChecks?: number;
};

type VerifyDeps = {
  fetchPage?: typeof fetchPageHtml;
  loadProfile?: (tenantId: string) => Promise<Awaited<ReturnType<typeof loadBusinessProfile>> | null>;
  writeOwnedPage?: (snapshot: PageSnapshot, tenantId: string) => Promise<void>;
  /** The Shipment store's own reads and writes, injected in tests and nowhere else. */
  loadShipments?: (tenantId: string) => Promise<ShippedChangeRecord[]>;
  record?: (tenantId: string, shipmentId: string, verification: ShipmentVerification) => Promise<boolean>;
  now?: () => number;
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

const norm = (s: string): string => s.toLowerCase().replace(/[‘’“”]/g, "'").replace(/[^a-z0-9']+/g, " ").trim();
/** The claim's own opening words, which is how much of a proposal I can honestly expect to find verbatim. */
const opener = (s: string, words = 12): string => norm(s).split(" ").filter(Boolean).slice(0, words).join(" ");
const firstLine = (s: string): string => s.split(/\r?\n/).map((l) => l.trim()).find((l) => !!l) ?? "";
const urlIn = (s: string): string | null => s.match(/https?:\/\/[^\s"'<>)\]]+|(?:^|\s)\/[a-z0-9][a-z0-9\-/_]*/i)?.[0]?.trim() ?? null;
const judged = (state: ComponentState, note: string): { state: ComponentState; note: string } => ({ state, note });

/** What the live page says, reduced to the facts a component can be checked against. `text` is the page's
 *  own words: the extractor's main-content capture PLUS the raw body stripped of markup, so a paragraph far
 *  below the fold is still found and "I did not see it" means I really did look at the whole page. */
/** `sitemap` is the account's own sitemap as it reads right now, fetched ONLY when a change asked to be
 *  listed in it and null when there was none to read: no read of the PAGE can answer whether it is on that list. */
type LiveRead = { snap: PageSnapshot; text: string; finalUrl: string | null; requestedUrl: string; sitemap: string | null };

function liveTextOf(snap: PageSnapshot, html: string): string {
  const captured = [snap.title, snap.h1, ...(snap.h2_list ?? []), ...(snap.h3_list ?? []),
    ...(snap.body_paragraph_sample ?? []), ...(snap.card_texts ?? [])].filter(Boolean).join(" ");
  return norm(`${captured} ${html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")}`);
}

/** ONE component, judged against the page as it stands right now. Pure. */
function classify(component: { kind: string; after: string; anchorAfter?: string | null; redirectTo?: string | null }, live: LiveRead): { state: ComponentState; note: string } {
  const { snap } = live, proposed = component.after ?? "";
  // NO COPY, NO CLAIM. Some kinds are visible without any wording at all (the address forwards, the page
  // asks to be left out of search, the page exists). Every other kind needs the exact wording that was
  // applied, and when I do not hold it I say so rather than checking the page against a guess.
  if (!norm(proposed) && !COPY_FREE_KINDS.has(component.kind)) {
    return judged("unverifiable", "The exact wording that was applied here is not on file, so this one is not called either way.");
  }
  const field = (value: string | null, what: string) =>
    !value?.trim() ? judged("not_verified", `Your page has no ${what} at all.`)
      : norm(value) === norm(proposed) ? judged("verified", `Your ${what} matches the prepared wording exactly.`)
        : judged("changed_differently", `Your ${what} is live, and it is not the prepared wording.`);
  const headings = [...(snap.h2_list ?? []), ...(snap.h3_list ?? [])].map(norm).filter(Boolean);
  const wanted = opener(firstLine(proposed), 8);
  const wantedWords = wanted.split(" ").filter(Boolean);
  // A HEADING VERIFIES A SECTION ONLY IF IT COVERS IT. Either the proposed heading is on the page in full,
  // or the live heading carries at least half of its words and never fewer than three. Measured by chars,
  // a two word fragment ("our prices") passed for a nine word section, so a page that answered almost none
  // of what was asked for read as verified.
  const covers = (h: string): boolean => {
    if (h.includes(wanted)) return true;
    const words = new Set(h.split(" ").filter(Boolean));
    const shared = wantedWords.filter((w) => words.has(w)).length;
    return shared >= Math.max(3, Math.ceil(wantedWords.length / 2));
  };
  const headingHit = !!wanted && headings.some(covers);
  // A link is compared as an ADDRESS, never as a string: a relative href on the page and an absolute one in
  // the proposal are the same link, and www or a trailing slash is not a difference.
  const absolute = (href: string): string => { try { return new URL(href, live.requestedUrl).toString(); } catch { return href; } };
  // THE ADDRESS THE CHANGE NAMED, off the change itself. Picking the first url-shaped word out of the
  // instruction picked the address being MOVED, so a correct forward read as one that went elsewhere. The
  // sentence is the last resort now, kept for rows on file that carry no destination of their own.
  const target = (component.redirectTo ?? "").trim() || urlIn(proposed);
  const targetKey = target ? canonicalUrlKey(absolute(target)) : null;
  const linkHit = !!targetKey && (snap.internal_links ?? []).some((l) => canonicalUrlKey(absolute(l.href)) === targetKey);

  switch (component.kind) {
    case "title": return field(snap.title, "page title");
    case "meta": return field(snap.meta_description, "search description");
    case "h1": return field(snap.h1, "headline");
    case "opening_answer": {
      const sample = norm((snap.body_paragraph_sample ?? []).join(" "));
      const want = opener(proposed);
      if (!sample) return judged("unverifiable", "The opening of your page could not be read, so this one is not called either way.");
      return sample.includes(want) ? judged("verified", "Your page opens with the prepared answer.")
        : judged("changed_differently", "Your page opens with different words than the prepared ones.");
    }
    case "section": case "section_add": case "section_rewrite": case "restructure": case "table_or_list_add":
      return headingHit ? judged("verified", "The section this change asked for is on the page.")
        : !wanted ? judged("unverifiable", "This change names no heading to look for.")
          : judged("not_verified", "Every heading on your page was read, and this section is not one of them.");
    case "section_remove":
      return !wanted ? judged("unverifiable", "This change names no heading to look for.")
        : headingHit ? judged("not_verified", "That section is still on the page.") : judged("verified", "That section is gone.");
    // A RENAMED LINK IS CHECKED ON ITS WORDS, NEVER ON ITS ADDRESS. The swap renames a link that already
    // exists, so asking whether a link to that address is on the page answered yes the moment the change was
    // written: it read verified without anything having happened. What changed is the wording, so the wording
    // is what I read, off the live link itself, and if the exact new words did not travel I say so.
    case "anchor_text": {
      const want = norm(component.anchorAfter ?? "");
      if (!want) return judged("unverifiable", "The exact words that link was meant to read are not on file, so this one is not called either way.");
      if (snap.internal_links == null) return judged("unverifiable", "The links on your page could not be read this time.");
      const onTarget = targetKey ? snap.internal_links.filter((l) => canonicalUrlKey(absolute(l.href)) === targetKey) : snap.internal_links;
      const links = onTarget.length > 0 ? onTarget : snap.internal_links;
      return links.some((l) => norm(l.anchor_text ?? "").includes(want))
        ? judged("verified", "That link now reads the way this change asked.")
        : judged("not_verified", "That link is on your page, and it still does not read the way this change asked.");
    }
    case "internal_links": case "internal_link_add":
      return !target ? judged("unverifiable", "This change names no address to look for.")
        : snap.internal_links == null ? judged("unverifiable", "The links on your page could not be read this time.")
          : linkHit ? judged("verified", "The link this change asked for is on the page.") : judged("not_verified", "That link is not on the page yet.");
    // A SITEMAP EDIT IS READ IN THE SITEMAP. This looked for a link on the PAGE, which no edit to
    // sitemap.xml can ever put there, so every one of them read as work the operator had not done.
    case "navigation": {
      if (live.sitemap == null) return judged("unverifiable", `No sitemap answered at ${SITEMAP_PATH} on your site, so this one is not called either way. Publish your sitemap at that address and the next check reads it.`);
      if (/<sitemapindex/i.test(live.sitemap)) return judged("unverifiable", `Your ${SITEMAP_PATH} lists other sitemap files rather than pages, so it cannot say whether this page is on one.`);
      const listed = [...live.sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!);
      if (listed.length === 0) return judged("unverifiable", `Your ${SITEMAP_PATH} answered and lists no readable addresses, so this one is not called either way.`);
      const here = canonicalUrlKey(live.requestedUrl);
      return listed.some((u) => canonicalUrlKey(absolute(u)) === here)
        ? judged("verified", "Your sitemap now lists this page.")
        : judged("not_verified", `Your sitemap lists ${listed.length} ${listed.length === 1 ? "address" : "addresses"}, and this page is not one of them.`);
    }
    case "internal_link_remove":
      return !target || snap.internal_links == null ? judged("unverifiable", "That link on your page could not be checked this time.")
        : linkHit ? judged("not_verified", "That link is still on the page.") : judged("verified", "That link is gone.");
    case "schema": {
      const types = snap.schema_types ?? [], named = (snap.schema_entity_names ?? []).length > 0;
      const askedFor = types.find((t) => norm(proposed).includes(norm(t)));
      if (askedFor) return judged("verified", `Your page carries ${askedFor} structured data.`);
      if (types.length > 0 || named) return judged("unverifiable", "Your page carries structured data, and none of it matches this change.");
      return snap.extraction_certainty === "uncertain"
        ? judged("unverifiable", "Your page builds its content in the browser, so its structured data cannot be read from the outside.")
        : judged("not_verified", "No structured data is on your page.");
    }
    case "canonical":
      return !target ? judged("unverifiable", "This change names no address to look for.")
        : !snap.canonical_url ? judged("not_verified", "Your page names no preferred address.")
          : canonicalUrlKey(snap.canonical_url) === canonicalUrlKey(target) ? judged("verified", "Your page points at the address this change asked for.")
            : judged("changed_differently", "Your page points at a different address than the one this change asked for.");
    case "redirect": case "consolidation": {
      if (!live.finalUrl) return judged("unverifiable", "Where that address ended up could not be seen.");
      const moved = canonicalUrlKey(live.finalUrl) !== canonicalUrlKey(live.requestedUrl);
      if (!moved) return judged("not_verified", "That address still serves its own page, so nothing is forwarding yet.");
      // MOVED IS NOT ARRIVED. A forward with no destination named could be landing anywhere, a login wall
      // included, so it is honestly unknown rather than a pass I cannot stand behind.
      if (!targetKey) {
        return judged("unverifiable", "It forwards somewhere, and the change named no destination, so there is nothing to confirm it against.");
      }
      return canonicalUrlKey(live.finalUrl) === targetKey
        ? judged("verified", "That address now forwards visitors on.")
        : judged("changed_differently", "That address forwards somewhere other than where this change asked.");
    }
    case "noindex":
      return snap.robots_meta == null ? judged("unverifiable", "This setting cannot be seen from outside your page.")
        : /noindex/i.test(snap.robots_meta) ? judged("verified", "Your page now asks search engines to leave it out.")
          : judged("changed_differently", "Your page still asks search engines to keep it.");
    case "new_page":
      return snap.word_count >= THIN_PAGE_WORDS ? judged("verified", "The new page is live and has real content on it.")
        : judged("changed_differently", `The address answers, and only ${snap.word_count} words are on it.`);
    default: {
      const want = opener(proposed);
      return !want ? judged("unverifiable", "This change names no wording to look for.")
        : live.text.includes(want) ? judged("verified", "This wording is on your page.")
          : judged("not_verified", "Your whole page was read, and this wording is not on it.");
    }
  }
}

/** Every component unverifiable, for the cases where the page itself could not be read. */
const allUnknown = (shipment: VerifiableShipment, note: string) =>
  shipment.components.map((c) => ({ kind: c.kind, state: "unverifiable" as ComponentState, note }));

/**
 * VERIFY ONE SHIPMENT against the live page. One fetch, on the free owned-page path, and the answer is
 * whatever I could actually see. The page snapshot is persisted on the way through (the same row every
 * other read of the account's own pages writes) so the next read of that page is served from what I already
 * hold instead of going back out to the customer's website.
 */
export async function verifyShipment(tenantId: string, shipment: VerifiableShipment, deps: VerifyDeps = {}): Promise<ShipmentVerification> {
  const now = deps.now ?? Date.now, checkedAt = new Date(now()).toISOString();
  const requested = /^https?:\/\//i.test(shipment.url) ? shipment.url : `https://${shipment.url}`;
  const fetchPage = deps.fetchPage ?? fetchPageHtml;
  // THE ONE ANSWER THAT IS NOT FINAL. A site that did not answer at all says nothing about the change, so
  // it earns exactly one retry on a LATER day. Every other ending is written once: a robots denial is the
  // site's standing instruction, a missing page and a difference are facts about the page itself.
  const checks = (shipment.priorChecks ?? 0) + 1;
  const transportBlocked = (note: string): ShipmentVerification => ({
    status: "blocked", checkedAt, components: allUnknown(shipment, note), checks,
    recheckAfter: shipment.recheck === true ? null : reportingDay(now() + 86_400_000),
  });
  let res: Awaited<ReturnType<typeof fetchPageHtml>>;
  try { res = await fetchPage(requested, new Map(), {}); }
  catch { return transportBlocked("Your website did not answer, so this change could not be checked."); }
  if (!res.ok) {
    if (/^http_(404|410)$/.test(res.detail ?? "")) {
      // NOT_FOUND INSIDE THE PUBLISH LAG IS THE SAME LAG (operator, 2026-08-29): Mark Done means applied in the editor and the site may be published once at the end of the session, so a page not there yet is re-read on the same bounded schedule rather than buried on read one.
      return { status: "not_found", checkedAt, checks, components: allUnknown(shipment, "There is no page at that address right now."), recheckAfter: checks < MAX_CHECKS ? reportingDay(now() + 2 * 86_400_000) : null };
    }
    return res.reason === "robots_blocked"
      ? { status: "blocked", checkedAt, checks, components: allUnknown(shipment, "Your site's robots rules ask for this page not to be read, so it was not.") }
      : transportBlocked("Your website did not answer, so this change could not be checked.");
  }
  const profile = deps.loadProfile ? await deps.loadProfile(tenantId).catch(() => null) : await loadBusinessProfile(tenantId).catch(() => null);
  const snap = extractPageSnapshot(res.html, requested, pageIdFor(canonicalUrlKey(shipment.url)), tenantId, res.status, profile ?? undefined); // ONE PAGE IDENTITY (operator, 2026-09-01): the raw address minted a second page id for eight pages beside the crawler's canonical one
  // Fail-soft on purpose: the verification I just computed is the evidence, and a snapshot row I could not
  // save changes nothing about what I read with my own eyes.
  await (deps.writeOwnedPage ?? ((s: PageSnapshot, t: string) => syncPageSnapshots([s], t)))(snap, tenantId).catch(() => {});
  // ONE extra read, only when a change asked to be listed in the sitemap, and never a second time.
  let sitemap: string | null = null;
  if (shipment.components.some((c) => c.kind === "navigation")) {
    const got = await fetchPage(`${new URL(requested).origin}${SITEMAP_PATH}`, new Map(), {}).catch(() => null);
    sitemap = got?.ok ? got.html : null;
  }
  const live: LiveRead = { snap, text: liveTextOf(snap, res.html), finalUrl: res.finalUrl ?? null, requestedUrl: requested, sitemap };
  const components = shipment.components.map((c) => ({ kind: c.kind, ...classify(c, live) }));
  const seen = components.filter((c) => c.state !== "unverifiable");
  const status: ShipmentVerification["status"] =
    seen.length === 0 ? "blocked"
      : seen.every((c) => c.state === "verified") ? "verified"
        : seen.some((c) => c.state === "verified") ? "partially_verified"
          : "differs";
  // A DIFFERENCE INSIDE THE PUBLISH LAG IS RE-READ, NEVER BURIED. CMSes serve the old page through caches
  // and build queues for hours after a paste, so the first read routinely differs and that one reading used
  // to stand as final: three of eight real shipments sat "differs" for good. Up to MAX_CHECKS bounded reads,
  // two days apart; a verified answer is final on any read, and the last read's answer stands whatever it is.
  const again = (status === "differs" || status === "partially_verified") && checks < MAX_CHECKS;
  return { status, checkedAt, checks, components, recheckAfter: again ? reportingDay(now() + 2 * 86_400_000) : null };
}

/** WHAT THE OPERATOR SAID THEY APPLIED, with the exact copy WHERE I HOLD IT. A Shipment names the
 *  components that were applied; the wording it stores is the change's own before/after, so a single
 *  component carries its copy and the others carry none. A component whose copy I do not hold is checked
 *  anyway when its kind can be seen without copy (a redirect, a noindex, structured data) and is honestly
 *  UNKNOWN when it cannot. Inventing wording to check against would be worse than saying I cannot tell. */
function componentsOf(r: ShippedChangeRecord): VerifiableShipment["components"] {
  const copy = (r.after ?? "").trim();
  const applied = (r.componentsApplied ?? []) as Array<{ kind: string; after?: string | null; anchorAfter?: string | null; redirectTo?: string | null }>;
  if (applied.length === 0) return copy || r.actionType ? [{ kind: r.actionType || "content", after: copy }] : [];
  const lone = applied.length === 1;
  return applied.map((c) => ({ kind: c.kind, anchorAfter: c.anchorAfter ?? null, redirectTo: c.redirectTo ?? null,
    after: (c.after ?? "").trim() || (lone || c.kind === r.actionType ? copy : "") }));
}

/** One Shipment row, as verification reads it. A row that already holds an answer is only ever here as
 *  the one retry a silent site earns, and it is told so, because a recheck's answer is final. */
const toVerifiable = (r: ShippedChangeRecord): VerifiableShipment =>
  ({ id: r.id, url: r.page, components: componentsOf(r), ...(r.verification != null ? { recheck: true, priorChecks: r.verification.checks ?? 1 } : {}) });

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
  // on the 4th when today came off a UTC instant, so the one retry a silent site earns was taken a day early
  // and its answer, taken before the site had a chance, stood as final.
  const today = reportingDay(deps.now ? deps.now() : Date.now());
  /** Never checked, or a site that did not answer whose one promised retry day has arrived. A row carrying
   *  the retired `operator_confirmed` label was never checked at all, whatever it says, so it is owed the
   *  one real reading it never got; the answer it writes back is a real state and the row is done. */
  const due = (r: ShippedChangeRecord): boolean => {
    if (r.verification == null || r.verification.status === "operator_confirmed") return true;
    const at = r.verification.recheckAfter ?? null;
    return !!at && today >= at;
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
  const due = (await shipmentsAwaitingVerification(tenantId, only ? TARGET_SCAN_BOUND : MAX_VERIFICATIONS_PER_PASS, deps)).filter((s) => !only || only(s)).slice(0, MAX_VERIFICATIONS_PER_PASS); let written = 0;
  const unsavable = new Set<string>(); // BOUNDED IN-RUN SKIP, carried on the pass and nowhere else: an answer that could not be SAVED means the shipment is still due, so a second shipment at the SAME address would send me back to the customer's website inside one pass for a result I already know I cannot store
  for (const shipment of due) {
    const address = canonicalUrlKey(shipment.url);
    if (unsavable.has(address)) continue;
    const verification = await verifyShipment(tenantId, shipment, deps).catch(() => null);
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
