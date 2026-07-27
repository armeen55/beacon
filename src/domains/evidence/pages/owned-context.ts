import "server-only";

/**
 * pages/owned-context - the TARGETED read of what my own page actually says.
 *
 * A diagnosis cannot be written from a title and a word count. `page_snapshots`
 * already persists the body sample, card text, schema entity names and internal
 * links captured on the SAME crawl, but the shared projection deliberately omits
 * those heavy columns (5-15KB a row) because no whole-site surface needs them.
 * This reader is the narrow exception: an EXPLICIT tenant plus a HANDFUL of
 * canonical URLs, newest snapshot per URL, every field bounded, no new store, no
 * table, no migration, and no site-wide hydration. A wider ask is REFUSED rather
 * than fanned out, and any failure fails closed to an EMPTY map so a missing body
 * reads as "I do not have the page text", never as an empty page.
 */

import { log } from "@/lib/logger";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";

/** What my own page says, in its own words. `fetchedAt` is carried so the caller
 *  can judge staleness itself (a 46-day-old body is evidence with a date on it,
 *  never silently current). */
export type OwnedPageBody = {
  url: string;
  title: string | null;
  metaDescription: string | null;
  openingSample: string | null;
  cardTexts: string[];
  entityNames: string[];
  internalLinks: { href: string; anchorText: string }[];
  fetchedAt: string | null;
};

/** Three pages is the intended ask (one investigation's own pages). A wider ask is
 *  refused outright: this reader exists BECAUSE the whole-site read is too heavy. */
const MAX_URLS = 3;
/** An opening sample is a sample, not a page. */
const MAX_SAMPLE_CHARS = 1200;
const MAX_PARAGRAPHS = 8;
const MAX_TITLE_CHARS = 200;
const MAX_META_CHARS = 320;
const MAX_CARDS = 8;
const MAX_ITEM_CHARS = 160;
const MAX_ENTITIES = 12;
const MAX_LINKS = 12;
/** A page keeps a snapshot history, so read a few rows per URL newest-first and
 *  keep the newest one; the bound stays tiny either way. */
const MAX_ROWS = MAX_URLS * 8;

type Row = {
  url?: string | null;
  title?: string | null;
  meta_description?: string | null;
  fetched_at?: string | null;
  body_paragraph_sample?: unknown;
  card_texts?: unknown;
  schema_entity_names?: unknown;
  internal_links?: unknown;
};

const cap = (value: unknown, chars: number): string | null => {
  const s = typeof value === "string" ? value.trim() : "";
  return s ? s.slice(0, chars) : null;
};

const items = (value: unknown, max: number, chars: number): string[] =>
  (Array.isArray(value) ? value : [])
    .map((x) => cap(x, chars))
    .filter((x): x is string => !!x)
    .slice(0, max);

/** The page's own OPENING WORDS, from body paragraphs ONLY. A heading is a label
 *  for text, never the text, so headings can never stand in for a body here. */
function openingOf(row: Row): string | null {
  const paragraphs = items(row.body_paragraph_sample, MAX_PARAGRAPHS, MAX_SAMPLE_CHARS);
  if (paragraphs.length === 0) return null;
  return cap(paragraphs.join(" ").replace(/\s+/g, " "), MAX_SAMPLE_CHARS);
}

/** Every spelling of one page, so a stored trailing slash or a `www.` host cannot
 *  hide the row. Production stores `https://www.host/path` while the decision path
 *  asks for `https://host/path`, and matching on the ask alone found NOTHING: the
 *  reader returned an empty map on every real call while the body sat in the table. */
function variantsOf(urls: string[]): string[] {
  const out = new Set<string>();
  for (const raw of urls) {
    const hosts = [raw, /^https?:\/\/www\./i.test(raw) ? raw.replace(/^(https?:\/\/)www\./i, "$1") : raw.replace(/^(https?:\/\/)/i, "$1www.")];
    for (const u of hosts) out.add(u.endsWith("/") ? u.replace(/\/+$/, "") : `${u}/`), out.add(u.replace(/\/+$/, ""));
  }
  return [...out];
}

function bodyOf(row: Row): OwnedPageBody {
  return {
    url: typeof row.url === "string" ? row.url : "",
    title: cap(row.title, MAX_TITLE_CHARS),
    metaDescription: cap(row.meta_description, MAX_META_CHARS),
    openingSample: openingOf(row),
    cardTexts: items(row.card_texts, MAX_CARDS, MAX_ITEM_CHARS),
    entityNames: items(row.schema_entity_names, MAX_ENTITIES, MAX_ITEM_CHARS),
    internalLinks: (Array.isArray(row.internal_links) ? row.internal_links : [])
      .slice(0, MAX_LINKS)
      .map((l) => {
        const link = (l ?? {}) as { href?: unknown; anchor_text?: unknown };
        return { href: cap(link.href, MAX_ITEM_CHARS) ?? "", anchorText: cap(link.anchor_text, MAX_ITEM_CHARS) ?? "" };
      })
      .filter((l) => l.href),
    fetchedAt: typeof row.fetched_at === "string" ? row.fetched_at : null,
  };
}

/**
 * The newest persisted body for each of `urls`, keyed by canonicalUrlKey. Scoped
 * to `tenantId` in the query itself (never filtered after a wide read). An empty
 * map means "I have no page text for you", which is exactly what the caller must
 * say out loud.
 */
export async function loadOwnedPageBodies(tenantId: string, urls: string[]): Promise<Map<string, OwnedPageBody>> {
  const out = new Map<string, OwnedPageBody>();
  const asked = (urls ?? []).map((u) => (typeof u === "string" ? u.trim() : "")).filter(Boolean);
  if (!tenantId?.trim() || asked.length === 0) return out;
  if (asked.length > MAX_URLS) {
    log.warn("[owned-context] refused a page-body read wider than its bound", { asked: asked.length, max: MAX_URLS });
    return out;
  }
  const wanted = new Set(asked.map(canonicalUrlKey).filter(Boolean));
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("page_snapshots")
      .select("url, title, meta_description, fetched_at, body_paragraph_sample, card_texts, schema_entity_names, internal_links")
      .eq("tenant_id", tenantId)
      .in("url", variantsOf(asked))
      .order("fetched_at", { ascending: false })
      .limit(MAX_ROWS);
    if (error) return out;
    for (const row of (data ?? []) as Row[]) {
      const key = canonicalUrlKey(typeof row.url === "string" ? row.url : "");
      if (!key || !wanted.has(key)) continue;
      const body = bodyOf(row);
      const prev = out.get(key);
      if (prev && (prev.fetchedAt ?? "") >= (body.fetchedAt ?? "")) continue;
      out.set(key, body);
    }
    return out;
  } catch (e) {
    log.warn("[owned-context] page-body read failed (fail-closed to no bodies)", {
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    return new Map();
  }
}
