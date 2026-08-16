import "server-only";

/**
 * owned-pages-store - THE durable inventory of an account's own website.
 *
 * One row per DISCOVERABLE owned URL with the state of our read of it. Discovery writes here;
 * the crawl reads its candidates from here and writes back what each read found. That is what
 * lets the product tell "known but never read" apart from "read and blocked" apart from "gone",
 * instead of a 150-URL JSON queue where an unreached page simply did not exist.
 *
 * Every operation is tenant-scoped in the query itself, never filtered after a wide read, and
 * every read is bounded and paged. FAILS CLOSED: a missing table (the pre-migration window) or a
 * failed write returns an honest empty/false with a log line naming the migration, never a
 * pretend success, because a discovery pass that silently wrote nothing would leave the crawl
 * reading an inventory that does not exist.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { reportingDay } from "@/lib/reporting-day";

const TABLE = "owned_pages";

/** How a URL became known. */
export type DiscoveredVia = "sitemap" | "robots_sitemap" | "homepage" | "nav" | "implementation";

/** One URL as discovery found it. */
export type DiscoveredPage = { url: string; via: DiscoveredVia };

/** One inventory row, in the store's own words. */
type OwnedPageRow = {
  url: string;
  discovered_via: DiscoveredVia;
  first_seen: string;
  last_seen_in_discovery: string;
  crawl_state: "uncrawled" | "crawled" | "blocked" | "unsupported" | "gone";
  http_status: number | null;
  last_crawled_at: string | null;
  /** When this same failing answer came back on a SECOND, later reporting day. Null until it has. */
  status_reconfirmed_at: string | null;
  content_hash: string | null;
  completeness: "complete" | "partial" | "unread" | "blocked" | "unsupported" | "missing" | "stale";
  blocked_until: string | null;
  redirects_to: string | null;
  is_canonical_target: boolean;
};

/** One discovery pass may write at most this many rows, in chunks of CHUNK. */
const MAX_UPSERT = 5_000;
const CHUNK = 500;
/** No single inventory read may return more than this. */
const MAX_INVENTORY_PAGE = 500;
/** A crawled page is worth re-reading after this long. */
const STALE_AFTER_MS = 30 * 86_400_000;
const DAY_MS = 86_400_000;

const COLUMNS =
  "url, discovered_via, first_seen, last_seen_in_discovery, crawl_state, http_status, last_crawled_at, status_reconfirmed_at, content_hash, completeness, blocked_until, redirects_to, is_canonical_target";

/** The table is not there yet. Told apart from a real failure so the pre-migration window reads as
 *  "apply the migration", not as an account with no website. */
function isMissingTable(error: unknown): boolean {
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  if (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST204") return true;
  return typeof e.message === "string" && /schema cache|could not find the (table|.*column)/i.test(e.message);
}

function failClosed(op: string, tenantId: string, error: unknown): void {
  const e = (error ?? {}) as { message?: unknown };
  log.warn(
    isMissingTable(error)
      ? `[owned-pages] I have no page inventory to ${op}: the owned_pages table is not there yet (apply migrations/2026-08-03_owned_pages.sql)`
      : `[owned-pages] I could not ${op} the page inventory, so nothing landed`,
    { tenant: tenantId, error: typeof e.message === "string" ? e.message.slice(0, 200) : String(error) },
  );
}

/**
 * Record what discovery found. MERGES: a URL already on file keeps its `first_seen`, its crawl
 * state and everything the crawl learned about it, and only `last_seen_in_discovery` moves. A URL
 * seen for the first time lands uncrawled. Returns how many rows were written; 0 with a log line
 * when the write could not land at all.
 */
export async function upsertDiscovery(tenantId: string, pages: readonly DiscoveredPage[]): Promise<number> {
  if (!tenantId?.trim() || pages.length === 0) return 0;
  const seen = new Set<string>();
  const rows: { tenant_id: string; url: string; discovered_via: DiscoveredVia }[] = [];
  for (const p of pages) {
    const url = (p?.url ?? "").trim();
    if (!url || seen.has(url) || rows.length >= MAX_UPSERT) continue;
    seen.add(url);
    rows.push({ tenant_id: tenantId, url, discovered_via: p.via });
  }
  const nowIso = new Date().toISOString();
  let written = 0;
  try {
    const admin = getSupabaseAdmin();
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      // Two statements on purpose. The insert IGNORES conflicts, so an existing row's first_seen and
      // crawl state are physically untouchable here; the update then moves only the one column that
      // is allowed to move on rediscovery. An upsert would have overwritten first_seen every pass.
      const ins = await admin.from(TABLE).upsert(chunk, { onConflict: "tenant_id,url", ignoreDuplicates: true });
      if (ins.error) {
        failClosed("record", tenantId, ins.error);
        return written;
      }
      const upd = await admin
        .from(TABLE)
        .update({ last_seen_in_discovery: nowIso, updated_at: nowIso })
        .eq("tenant_id", tenantId)
        .in("url", chunk.map((r) => r.url));
      if (upd.error) {
        failClosed("record", tenantId, upd.error);
        return written;
      }
      written += chunk.length;
    }
    return written;
  } catch (e) {
    failClosed("record", tenantId, e);
    return 0;
  }
}

/** One bounded page of the inventory, in URL order. Empty on any failure, with the honest log. */
export async function readInventory(
  tenantId: string,
  opts: { limit?: number; offset?: number; states?: OwnedPageRow["crawl_state"][] } = {},
): Promise<OwnedPageRow[]> {
  if (!tenantId?.trim()) return [];
  const limit = Math.max(1, Math.min(opts.limit ?? 100, MAX_INVENTORY_PAGE));
  const offset = Math.max(0, opts.offset ?? 0);
  try {
    let q = getSupabaseAdmin().from(TABLE).select(COLUMNS).eq("tenant_id", tenantId);
    if (opts.states?.length) q = q.in("crawl_state", opts.states);
    const { data, error } = await q.order("url", { ascending: true }).range(offset, offset + limit - 1);
    if (error) {
      failClosed("read", tenantId, error);
      return [];
    }
    return (data ?? []) as unknown as OwnedPageRow[];
  } catch (e) {
    failClosed("read", tenantId, e);
    return [];
  }
}

/**
 * The next URLs worth reading, in priority order: never-crawled first, then the ones whose read has
 * gone stale, then blocked pages whose retry date has passed. `gone` and `unsupported` are never
 * candidates, and a blocked page is NEVER returned before its blocked_until. Bounded by `limit`.
 */
export async function nextCrawlCandidates(
  tenantId: string,
  limit: number,
  now: Date = new Date(),
): Promise<string[]> {
  if (!tenantId?.trim()) return [];
  const want = Math.max(1, Math.min(limit, MAX_INVENTORY_PAGE));
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
  try {
    const admin = getSupabaseAdmin();
    const out: string[] = [];
    const take = async (build: (q: ReturnType<typeof buildBase>) => ReturnType<typeof buildBase>) => {
      if (out.length >= want) return;
      const { data, error } = await build(buildBase(admin, tenantId)).limit(want - out.length);
      if (error) {
        failClosed("read", tenantId, error);
        return;
      }
      // A PROMISED WAIT IS NEVER A CANDIDATE, whatever state the row is in. The blocked pass below
      // already asks the database for that; an uncrawled row backing off a transient failure keeps
      // its own retry date and is held back here, or a 500 would be re-fetched on every pass.
      for (const r of (data ?? []) as { url: string; blocked_until?: string | null }[]) {
        if (r.blocked_until && r.blocked_until > nowIso) continue;
        if (r.url && !out.includes(r.url)) out.push(r.url);
      }
    };
    await take((q) => q.eq("crawl_state", "uncrawled").order("first_seen", { ascending: true }));
    await take((q) =>
      q.eq("crawl_state", "crawled").lt("last_crawled_at", staleBefore).order("last_crawled_at", { ascending: true }));
    await take((q) =>
      q.eq("crawl_state", "blocked").lte("blocked_until", nowIso).order("blocked_until", { ascending: true }));
    return out.slice(0, want);
  } catch (e) {
    failClosed("read", tenantId, e);
    return [];
  }
}

function buildBase(admin: ReturnType<typeof getSupabaseAdmin>, tenantId: string) {
  return admin.from(TABLE).select("url, blocked_until").eq("tenant_id", tenantId);
}

/** Record a successful read: the state, the hash of the text we actually hold, and how much of the
 *  page that is. Clears any retry date, because the page answered. */
export async function markCrawled(
  tenantId: string,
  url: string,
  fields: {
    httpStatus: number;
    contentHash: string | null;
    completeness: OwnedPageRow["completeness"];
    redirectsTo?: string | null;
    isCanonicalTarget?: boolean;
  },
  now: Date = new Date(),
): Promise<boolean> {
  return await patch(tenantId, url, {
    crawl_state: "crawled",
    http_status: fields.httpStatus,
    last_crawled_at: now.toISOString(),
    content_hash: fields.contentHash,
    completeness: fields.completeness,
    blocked_until: null,
    status_reconfirmed_at: null, // the page answered, so a failure once confirmed on it is over
    redirects_to: fields.redirectsTo ?? null,
    is_canonical_target: fields.isCanonicalTarget ?? true,
  });
}

/** PURE. The same answer twice means the same CLASS of refusal twice: a 500 then a 503 is one server still
 *  failing, a 500 then a 403 is two different facts and confirms nothing. */
function sameFailureClass(previous: number | null | undefined, current: number): boolean {
  return previous != null && previous >= 300 && current >= 300 && Math.floor(previous / 100) === Math.floor(current / 100);
}

/**
 * PURE. Did this same failing answer already come back on an EARLIER reporting day? One server error is a
 * bad minute; only a second look on a second day is a fault. The day is America/Los_Angeles through
 * reporting-day, never UTC, so a 6 PM re-read is still today and a 24-hour gap is not on its own a new day.
 *
 * WHEN THE PREVIOUS LOOK WAS is read off the row. A refusal recorded as a read carries its own stamp; a
 * transient failure deliberately carries none (a failure is not a read), so it is dated from the promise it
 * left, and the retry ladder never buys less than a day, which makes blocked_until minus one day never
 * LATER than the look that set it. Erring late only ever costs a confirmation one pass.
 */
function seenAgainOnALaterDay(
  previous: { http_status: number | null; last_crawled_at: string | null; blocked_until: string | null } | null,
  httpStatus: number,
  now: Date,
): boolean {
  if (!previous || !sameFailureClass(previous.http_status, httpStatus)) return false;
  const promised = Date.parse(previous.blocked_until ?? "");
  const stamped = Date.parse(previous.last_crawled_at ?? "");
  const lookedAt = Number.isFinite(promised) ? promised - DAY_MS : stamped;
  if (!Number.isFinite(lookedAt)) return false;
  return reportingDay(lookedAt) !== reportingDay(now);
}

/**
 * PURE. The next retry date for a page that refused us: one day, then a week, then a month as the
 * ceiling. Escalation is read from the LENGTH OF THE LAST WAIT (the span between the read that was
 * refused and the date it promised), never from time remaining, because by the time we ask again
 * that wait has always just expired. A site that keeps refusing is asked less and less often.
 */
function nextBlockedUntil(
  previous: { blocked_until: string | null; last_crawled_at: string | null } | null,
  now: Date,
): string {
  const until = Date.parse(previous?.blocked_until ?? "");
  const from = Date.parse(previous?.last_crawled_at ?? "");
  const lastWaitDays = Number.isFinite(until) && Number.isFinite(from) ? Math.round((until - from) / DAY_MS) : 0;
  const nextDays = lastWaitDays >= 7 ? 30 : lastWaitDays >= 1 ? 7 : 1;
  return new Date(now.getTime() + nextDays * DAY_MS).toISOString();
}

/**
 * Record a page the site would not give us. 404 and 410 are `gone` (inventory history, never a
 * candidate again); 401, 403 and 429 are `blocked` with a bounded retry date.
 *
 * ANYTHING ELSE IS A TRANSIENT FAILURE, and a failure is not a read. It used to stamp
 * last_crawled_at, so one 500 made the page look freshly read for thirty days, or left an
 * uncrawled row a candidate again on the very next pass with no backoff at all. Now the stamp is
 * left exactly where the last real read put it, the state is untouched, and the page waits out the
 * same bounded ladder a refusal gets.
 *
 * AND THE SECOND LOOK IS RECORDED. status_reconfirmed_at is stamped when this same class of failure
 * already came back on an earlier reporting day, and cleared when the answer changes, so nothing
 * downstream may call a page dead on one bad minute or carry an old fault onto a new one.
 */
export async function markBlocked(
  tenantId: string,
  url: string,
  httpStatus: number,
  now: Date = new Date(),
): Promise<boolean> {
  const held = await readOne(tenantId, url);
  const again = seenAgainOnALaterDay(held, httpStatus, now)
    ? { status_reconfirmed_at: now.toISOString() }
    : sameFailureClass(held?.http_status, httpStatus) ? {} : { status_reconfirmed_at: null };
  if (httpStatus === 404 || httpStatus === 410) {
    return await patch(tenantId, url, {
      crawl_state: "gone",
      http_status: httpStatus,
      last_crawled_at: now.toISOString(),
      completeness: "missing",
      blocked_until: null,
      ...again,
    });
  }
  if (httpStatus !== 401 && httpStatus !== 403 && httpStatus !== 429) {
    return await patch(tenantId, url, { http_status: httpStatus, blocked_until: nextBlockedUntil(held, now), ...again });
  }
  return await patch(tenantId, url, {
    crawl_state: "blocked",
    http_status: httpStatus,
    last_crawled_at: now.toISOString(),
    completeness: "blocked",
    blocked_until: nextBlockedUntil(held, now),
    ...again,
  });
}

/** One inventory row, or null. */
async function readOne(tenantId: string, url: string): Promise<OwnedPageRow | null> {
  if (!tenantId?.trim() || !url?.trim()) return null;
  try {
    const { data, error } = await getSupabaseAdmin()
      .from(TABLE).select(COLUMNS).eq("tenant_id", tenantId).eq("url", url).limit(1);
    if (error) {
      failClosed("read", tenantId, error);
      return null;
    }
    return ((data ?? [])[0] as unknown as OwnedPageRow) ?? null;
  } catch (e) {
    failClosed("read", tenantId, e);
    return null;
  }
}

async function patch(tenantId: string, url: string, fields: Record<string, unknown>): Promise<boolean> {
  if (!tenantId?.trim() || !url?.trim()) return false;
  try {
    const { error } = await getSupabaseAdmin()
      .from(TABLE)
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("url", url);
    if (error) {
      failClosed("update", tenantId, error);
      return false;
    }
    return true;
  } catch (e) {
    failClosed("update", tenantId, e);
    return false;
  }
}
