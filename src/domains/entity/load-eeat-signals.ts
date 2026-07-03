/**
 * E-E-A-T signals loader (BEACON 500 P10, 2026-07-03).
 *
 * The ONE I/O boundary for the entity + author system. Reads the SHIPPED
 * Wikidata QID cache (`wikidata-entity-cache`, the store the biography-QID slice
 * populates) and joins it to the tenant's already-loaded page snapshots to
 * pre-assemble the three pure detectors' inputs:
 *
 *   1. Entity-link gaps: for each content page, which Knowledge-Graph entities
 *      does its own title / H1 / H2 name that the page does not yet link?
 *   2. Author gaps: which guide-shaped content pages carry no named author?
 *   3. Brand presence: does the site root carry Organization schema + sameAs?
 *
 * Deterministic, over data Beacon already has. NEVER calls Wikidata (only reads
 * the cache the biography path already wrote), never calls an LLM, no tenant
 * hardcoding. Fail-soft: any read failure yields empty signals, so the three
 * predicates simply abstain.
 *
 * PERF: runs on the GENERATION path (the trigger loader), not the customer
 * render. The snapshot array is passed IN (already loaded once by the trigger
 * loader), so this adds exactly one small cache read.
 */

import "server-only";

import { readStore } from "@/lib/persistence/json-store";
import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";
import {
  classifyPageType,
  isNonHtmlAsset,
} from "@/domains/recommendation-intelligence/page-classifier";

import type {
  EeatSignals,
  KnownEntity,
  AuthorPageInput,
  BrandPresenceInput,
} from "./eeat-types";
import type { EntityPageEntityJoin } from "./eeat-input-types";
import { classifyEntityLinkGaps } from "./eeat-entity-link";
import { classifyAuthorGaps, hasVisibleByline, schemaHasPerson } from "./eeat-author";
import { classifyBrandPresence } from "./eeat-brand-presence";

const WIKIDATA_CACHE_STORE = "wikidata-entity-cache";

/** The cache row shape written by src/lib/connectors/wikidata/client.ts. */
type WikidataCacheRow = {
  key: string;
  fetchedAt: string;
  match: {
    queriedName: string;
    qid: string | null;
    label: string | null;
    confidence: "high" | "needs-confirm" | "none";
    wikidataUrl: string | null;
    wikipediaUrl: string | null;
  };
};

/** Guide-shaped title/H1 tails: an article/guide/how-to page where authorship
 *  matters. A closed, vertical-neutral set of English reference/guide nouns and
 *  question openers, NOT a tenant vocabulary list. */
const GUIDE_LEADING_WORDS = new Set([
  "how", "why", "what", "when", "where", "who", "guide", "complete",
  "ultimate", "beginner", "everything",
]);
const GUIDE_TAIL_WORDS = new Set([
  "guide", "explained", "overview", "tutorial", "walkthrough", "handbook",
]);

/**
 * A content page is "guide-shaped" (authorship matters) when its own title/H1
 * reads like an article/guide/how-to: it opens with a question/guide word, ends
 * with a guide noun, or is a substantive multi-word phrase (not a bare product
 * or one-word label). Store/product pages (Product schema) are never
 * guide-shaped. Pure English shape test, tenant-neutral.
 */
function isGuideShaped(snap: PageSnapshot): boolean {
  const hasProduct = (snap.schema_types ?? []).some(
    (t) => t.trim().toLowerCase() === "product",
  );
  if (hasProduct) return false;

  const headline = (snap.h1?.trim() || snap.title?.trim() || "").toLowerCase();
  if (!headline) return false;
  // Strip a trailing " - Site Name" / " | Site Name" suffix. The separator
  // class matches a hyphen, pipe, en dash, or em dash a real page title might
  // use; the dashes are written as \u escapes so this source file carries no
  // literal dash character (the hard no-dash rule applies to source too).
  const bare =
    headline.split(/\s[|\-\u2013\u2014]\s/)[0]?.trim() ?? headline;
  const tokens = bare.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;

  const first = tokens[0]!;
  const last = tokens[tokens.length - 1]!;
  if (GUIDE_LEADING_WORDS.has(first)) return true;
  if (GUIDE_TAIL_WORDS.has(last)) return true;
  // A multi-word substantive phrase with real body text reads as an article.
  const bodyLen = (snap.body_paragraph_sample ?? []).join(" ").trim().length;
  return tokens.length >= 3 && bodyLen >= 200;
}

/** Build a lower-cased text blob from a page's naming fields (title/H1/H2/H3). */
function nameBlob(snap: PageSnapshot): string {
  return [
    snap.title ?? "",
    snap.h1 ?? "",
    ...(snap.h2_list ?? []),
    ...(snap.h3_list ?? []),
  ]
    .join("  ")
    .toLowerCase();
}

/** Whether a whole-word occurrence of `name` appears in `blob` (both lower). */
function namesEntity(blob: string, name: string): boolean {
  const n = name.trim().toLowerCase();
  if (n.length < 3) return false;
  // Whole-word-ish boundary check that tolerates punctuation around the name.
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(blob);
}

/** Read the Wikidata cache and reduce it to the known-entity list (QID present,
 *  not "none"). Fail-soft to []. */
async function loadKnownEntities(): Promise<KnownEntity[]> {
  let rows: WikidataCacheRow[] = [];
  try {
    rows = await readStore<WikidataCacheRow>(WIKIDATA_CACHE_STORE, []);
  } catch {
    return [];
  }
  const out: KnownEntity[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const m = row?.match;
    if (!m || !m.qid || m.confidence === "none") continue;
    const name = (m.label || m.queriedName || "").trim();
    if (!name) continue;
    const qid = m.qid.trim();
    const key = qid.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      qid,
      wikidataUrl: m.wikidataUrl ?? `https://www.wikidata.org/wiki/${qid}`,
      wikipediaUrl: m.wikipediaUrl,
      confidence: m.confidence,
    });
  }
  return out;
}

/** Normalize a domain-or-URL to a clean site-root URL, or null. */
function toSiteRoot(domain: string | null | undefined): string | null {
  const d = (domain ?? "").trim();
  if (!d) return null;
  const host = d
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\/+$/, "");
  if (!host || !host.includes(".")) return null;
  return `https://${host}/`;
}

/** True when a snapshot IS the site root / homepage for the configured domain. */
function isSiteRoot(snap: PageSnapshot, siteRoot: string | null): boolean {
  if (!siteRoot) return false;
  const norm = (u: string) => u.replace(/\/+$/, "/").toLowerCase();
  const su = norm(snap.url);
  return su === norm(siteRoot) || su === norm(siteRoot).replace(/\/$/, "");
}

export type LoadEeatSignalsInput = {
  tenantId: string;
  /** Already-loaded snapshots (passed by the trigger loader). */
  snapshots: ReadonlyArray<PageSnapshot>;
  businessConfig: BusinessConfig;
};

/**
 * Assemble the three E-E-A-T detectors' inputs and run them. Returns fully-
 * computed verdicts (EeatSignals) so the loader threads them straight into the
 * pure trigger predicates. Empty everywhere when there is no data.
 */
export async function loadEeatSignalsForTenant(
  input: LoadEeatSignalsInput,
): Promise<EeatSignals> {
  const { snapshots, businessConfig } = input;

  const empty: EeatSignals = {
    entityLinkGaps: [],
    authorGaps: [],
    brandPresenceGap: null,
  };

  try {
    const contentSnaps = snapshots.filter(
      (s) =>
        s != null &&
        !isNonHtmlAsset(s.url) &&
        classifyPageType(s.url, businessConfig) === "content",
    );

    // ── (1) Entity-link gaps ─────────────────────────────────────────────
    const knownEntities = await loadKnownEntities();
    const entityJoins: EntityPageEntityJoin[] = [];
    if (knownEntities.length > 0) {
      for (const snap of contentSnaps) {
        const blob = nameBlob(snap);
        const named = knownEntities.filter((e) => namesEntity(blob, e.name));
        if (named.length === 0) continue;
        entityJoins.push({
          url: snap.url,
          schemaTypes: snap.schema_types ?? [],
          // schemaBlob: combine @type strings + captured entity names so the
          // "already links this QID?" check can see a sameAs value if present
          // in schema_entity_names (rare but honest).
          schemaBlob: [
            ...(snap.schema_types ?? []),
            ...(snap.schema_entity_names ?? []),
          ].join(" "),
          extractionCertain: snap.extraction_certainty !== "uncertain",
          namedEntities: named,
          fetchedAt: snap.fetched_at,
        });
      }
    }
    const entityLinkGaps = classifyEntityLinkGaps(entityJoins);

    // ── (2) Author gaps ──────────────────────────────────────────────────
    const authorInputs: AuthorPageInput[] = contentSnaps.map((snap) => {
      const bodyText = (snap.body_paragraph_sample ?? []).join(" ");
      const hasAuthorSignal =
        schemaHasPerson(snap.schema_types ?? []) || hasVisibleByline(bodyText);
      return {
        url: snap.url,
        schemaTypes: snap.schema_types ?? [],
        extractionCertain: snap.extraction_certainty !== "uncertain",
        hasAuthorSignal,
        isGuideShaped: isGuideShaped(snap),
        fetchedAt: snap.fetched_at,
      };
    });
    const authorGaps = classifyAuthorGaps(authorInputs);

    // ── (3) Brand presence (connector-free) ──────────────────────────────
    // Honesty gate: we can only say "your homepage does not establish your
    // brand" if we ACTUALLY crawled the homepage. When no site-root snapshot
    // exists (nothing scanned yet, or the root was not in this scan), the brand
    // check abstains rather than guessing off config alone. This also keeps the
    // signal byte-identical to before P10 for any run without a homepage
    // snapshot. It IS still cold-start capable: the very first crawl always
    // includes the homepage, so the check fires on scan #1, before any
    // connector.
    const siteRoot = toSiteRoot(businessConfig.domain);
    const rootSnap =
      snapshots.find((s) => s != null && isSiteRoot(s, siteRoot)) ?? null;
    if (rootSnap == null) {
      return { entityLinkGaps, authorGaps, brandPresenceGap: null };
    }
    const rootSchema = (rootSnap?.schema_types ?? []).map((t) =>
      t.trim().toLowerCase(),
    );
    const ORG_TYPES = new Set([
      "organization",
      "localbusiness",
      "homeandconstructionbusiness",
      "professionalservice",
      "corporation",
      "onlinestore",
      "store",
    ]);
    const hasOrganizationSchema = rootSchema.some((t) => ORG_TYPES.has(t));
    const rootSameAsBlob = [
      ...(rootSnap?.schema_entity_names ?? []),
    ]
      .join(" ")
      .toLowerCase();
    // A sameAs signal: an Organization schema on the root whose captured entity
    // strings include a profile URL. Conservative: only when we can positively
    // see a linked profile. When we cannot tell (no captured strings), treat as
    // "no sameAs" so the honest nudge fires rather than silently passing.
    const hasSameAsLinks =
      hasOrganizationSchema && /https?:\/\//.test(rootSameAsBlob);

    const brandPresenceGap = classifyBrandPresence({
      brandName: businessConfig.name ?? "",
      domain: businessConfig.domain ?? "",
      hasOrganizationSchema,
      hasSameAsLinks,
      siteRootUrl: siteRoot,
      fetchedAt: rootSnap?.fetched_at ?? new Date().toISOString(),
    } satisfies BrandPresenceInput);

    return { entityLinkGaps, authorGaps, brandPresenceGap };
  } catch {
    return empty;
  }
}
