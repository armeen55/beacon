/**
 * 2026-06-16 — pure mapping-suggestion engine (§Phase 2 mapper, MAX_SEO_AEO
 * audit P0 #2). Given a READ-ONLY discovered Wix collection, propose a
 * WixCollectionMapping the operator then confirms/overrides in the guided UI.
 *
 * PURE: no I/O, no Wix calls, no tenant context, NO hardcoded collection ids /
 * slugs / Iranopedia anything. Every output is a SUGGESTION derived solely from
 * the discovered field shape — the operator always has the final say on
 * /diagnostics/wix.
 *
 * The heuristics intentionally err toward LEAVING A ROLE UNSET rather than
 * guessing wrong: a confidently-matched content-field role is only included
 * when a real field key matches the known synonyms (else the mapping stays
 * "paste-ready" — those edits don't push live until the operator maps them).
 * We also never suggest a URL/slug/link-bearing field as a content role (the
 * push layer refuses such writes; don't even propose them).
 */

import { isProtectedUrlField } from "./client";
import type {
  WixCollectionMapping,
  WixDiscoveredCollection,
  WixDiscoveredField,
} from "./types";

/**
 * Slugify a collection displayName into a URL-prefix SUGGESTION, e.g.
 * "Persian Recipes" → "/persian-recipes". Lowercase, spaces/underscores → "-",
 * strip non-url chars, collapse repeats, single leading slash, no trailing
 * slash. Pure. Falls back to "/" when nothing usable remains.
 */
export function slugifyForUrlPrefix(s: string): string {
  const kebab = s
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-") // spaces + underscores → dashes
    .replace(/[^a-z0-9-]+/g, "") // drop anything not url-safe
    .replace(/-+/g, "-") // collapse runs of dashes
    .replace(/^-+|-+$/g, ""); // trim leading/trailing dashes
  return kebab === "" ? "/" : `/${kebab}`;
}

/** Case-insensitive lookup: return the REAL field key whose lowercased value
 *  is in `candidates`, in candidate-priority order (first candidate wins). */
function findFieldKeyByName(
  fields: ReadonlyArray<WixDiscoveredField>,
  candidates: ReadonlyArray<string>,
): string | undefined {
  const byLower = new Map<string, string>();
  for (const f of fields) {
    const lk = f.key.toLowerCase();
    // First field with a given lowercased key wins (stable, deterministic).
    if (!byLower.has(lk)) byLower.set(lk, f.key);
  }
  for (const cand of candidates) {
    const real = byLower.get(cand.toLowerCase());
    if (real != null) return real;
  }
  return undefined;
}

/**
 * Trust audit F (2026-06-16) — classify a discovered Wix collection as a SYSTEM
 * / private / transactional collection (form submissions, members/private data,
 * orders, inventory, variants, coupons) vs. likely page CONTENT. Wix namespaces
 * these collections by id prefix ("Forms/…", "Members/…", "Marketing/…") plus a
 * few transactional Stores subtypes — so the classifier keys on the id
 * namespace, NOT on names (no hardcoding of any tenant's collection names).
 *
 * The mapper shows CONTENT collections first and tucks SYSTEM ones behind an
 * "Advanced" toggle so a non-technical operator isn't invited to map order/
 * member/form data as if it were a page. Nothing is hidden permanently —
 * Advanced still reaches everything. Pure.
 *
 * Stores/Products + Stores/Collections are intentionally treated as CONTENT
 * (product/category pages have public URLs); only the non-page Stores subtypes
 * (Orders / InventoryItems / Variants) are system.
 */
const SYSTEM_NAMESPACE_PREFIXES = ["forms/", "members/", "marketing/"] as const;
const SYSTEM_COLLECTION_IDS: ReadonlySet<string> = new Set([
  "stores/orders",
  "stores/inventoryitems",
  "stores/variants",
  "stores/fulfillments",
  "stores/discountrules",
]);

export function isSystemWixCollection(collectionId: string): boolean {
  if (typeof collectionId !== "string") return false;
  const id = collectionId.trim().toLowerCase();
  if (id.length === 0) return false;
  if (SYSTEM_NAMESPACE_PREFIXES.some((p) => id.startsWith(p))) return true;
  if (SYSTEM_COLLECTION_IDS.has(id)) return true;
  return false;
}

/**
 * Partition discovered-collection rows into content (shown first) and system
 * (tucked behind Advanced). Stable — preserves input order within each group.
 * Generic over any row carrying `{ collection: { id } }`.
 */
export function partitionWixCollectionsBySystem<
  T extends { collection: { id: string } },
>(rows: ReadonlyArray<T>): { content: T[]; system: T[] } {
  const content: T[] = [];
  const system: T[] = [];
  for (const r of rows) {
    if (isSystemWixCollection(r.collection.id)) system.push(r);
    else content.push(r);
  }
  return { content, system };
}

/** Known field-key synonyms for each pushable content role. Matched
 *  case-insensitively against the collection's ACTUAL field keys; the
 *  suggestion maps the role to the real key. Add synonyms here, never tenant
 *  data — these are generic Wix/CMS naming conventions. */
const ROLE_SYNONYMS = {
  title: ["title", "seoTitle", "pageTitle", "name"],
  heading: ["heading", "h1", "h1Text", "mainHeading"],
  description: [
    "description",
    "metaDescription",
    "seoDescription",
    "excerpt",
    "summary",
  ],
} as const;

/** A field that looks text-ish (good label fallback). Wix text types vary by
 *  version; treat anything containing TEXT/STRING as text-ish, and never a
 *  URL/slug/link field. */
function isTextishField(f: WixDiscoveredField): boolean {
  if (isProtectedUrlField(f.key)) return false;
  const t = f.type.toUpperCase();
  return t.includes("TEXT") || t.includes("STRING") || t === "UNKNOWN";
}

/**
 * Heuristic mapping suggestion for ONE discovered collection. All outputs are
 * overridable by the operator.
 *
 * slugField — first of: a field key EXACTLY "slug"; else a "link-*"/key
 *   containing "slug"; else "title"/"name"; else the first field. (This is how
 *   the URL is derived — the operator confirms it.)
 * urlPrefix — slugify(displayName) → "/<kebab>" (SUGGESTION only).
 * labelField — first of "title", "name", else first text-ish field, else slugField.
 * contentFieldRoles — only roles whose synonyms confidently match a real field
 *   key are included (mapped to the REAL key); a role with no match is OMITTED
 *   so the mapping stays paste-ready. Never a URL/slug/link field.
 */
export function suggestCollectionMapping(
  c: WixDiscoveredCollection,
): WixCollectionMapping {
  const fields = c.fields;
  const slugField = suggestSlugField(fields);

  const labelField =
    findFieldKeyByName(fields, ["title", "name"]) ??
    fields.find(isTextishField)?.key ??
    slugField;

  const contentFieldRoles = suggestContentFieldRoles(fields);

  return {
    dataCollectionId: c.id,
    slugField,
    urlPrefix: slugifyForUrlPrefix(c.displayName),
    labelField,
    ...(contentFieldRoles != null ? { contentFieldRoles } : {}),
  };
}

function suggestSlugField(
  fields: ReadonlyArray<WixDiscoveredField>,
): string {
  // 1. an exact "slug" field (case-insensitive).
  const exactSlug = findFieldKeyByName(fields, ["slug"]);
  if (exactSlug != null) return exactSlug;
  // 2. a "link-*" field or any key containing "slug".
  const linkOrSlugish = fields.find((f) => {
    const lk = f.key.toLowerCase();
    return lk.startsWith("link-") || lk.includes("slug");
  });
  if (linkOrSlugish != null) return linkOrSlugish.key;
  // 3. "title"/"name".
  const titleOrName = findFieldKeyByName(fields, ["title", "name"]);
  if (titleOrName != null) return titleOrName;
  // 4. the first field (last resort), else "slug" placeholder for an
  //    empty-fields collection so the mapping is still well-formed.
  return fields[0]?.key ?? "slug";
}

function suggestContentFieldRoles(
  fields: ReadonlyArray<WixDiscoveredField>,
): WixCollectionMapping["contentFieldRoles"] | undefined {
  const roles: { title?: string; heading?: string; description?: string } = {};
  const title = matchContentRole(fields, ROLE_SYNONYMS.title);
  const heading = matchContentRole(fields, ROLE_SYNONYMS.heading);
  const description = matchContentRole(fields, ROLE_SYNONYMS.description);
  if (title != null) roles.title = title;
  if (heading != null) roles.heading = heading;
  if (description != null) roles.description = description;
  // Omit entirely when nothing matched → mapping stays paste-ready.
  return roles.title != null || roles.heading != null || roles.description != null
    ? roles
    : undefined;
}

/** Match one role's synonyms to a real field key, but NEVER a URL/slug/link
 *  field (the push layer refuses those — don't suggest them as a content
 *  role). */
function matchContentRole(
  fields: ReadonlyArray<WixDiscoveredField>,
  synonyms: ReadonlyArray<string>,
): string | undefined {
  const real = findFieldKeyByName(fields, synonyms);
  if (real == null) return undefined;
  if (isProtectedUrlField(real)) return undefined;
  return real;
}
