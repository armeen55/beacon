import "server-only";

/**
 * decision/producers/page-understanding - THE DURABLE RECORD OF WHAT EACH PAGE IS FOR.
 *
 * One row per (account, canonical page), independent of the shared call cache.
 * The fingerprint covers the exact selected extract and its reading contract (prompt and schema).
 * Equal means this identification is reusable; changed means stale, refreshed within the normal pool.
 * This is page identification, NOT a whole-page reading or a diagnosis of absent information.
 *
 * FAILS CLOSED, SOFT. A missing table, an unconfigured database or a failed write returns empty or
 * false with one honest log line naming the migration. Nothing here throws, and no caller may read an
 * empty answer as "this page has no job": that is the difference between not knowing and knowing
 * nothing, and page-job.ts keeps the two apart with a typed reason.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import type { PageJob } from "@/domains/decision/llm/schemas";

const TABLE = "page_understanding";
const CURSOR_TABLE = "page_job_cursor";
/** One read never returns more than this, and one batch never asks for more addresses than this. */
const MAX_ROWS = 500;
const COLUMNS = "page_key, url, content_fingerprint, job, page_type, audience, topics, commercial, promise, sells, read_at, source_extract_at";

/** One page's reading, as the store holds it. */
export type PageUnderstanding = PageJob & {
  /** The address the reading was taken for. */
  url: string;
  /** Hash of the exact extract the reading was taken from. */
  contentFingerprint: string;
  readAt: string;
  sourceExtractAt: string | null;
};

type Row = {
  page_key: string; url: string; content_fingerprint: string; job: string; page_type: string;
  audience: string; topics: string[] | null; commercial: boolean; read_at: string; source_extract_at: string | null;
  /** Legacy rows can lack a promise or named conversion actions. */ promise: string | null; sells: string[] | null;
};

/** The table is not there yet, told apart from a real failure so the pre-migration window reads as
 *  "apply the migration" rather than as a site nobody has ever read. */
function isMissingTable(error: unknown): boolean {
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  if (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST204") return true;
  return typeof e.message === "string" && /schema cache|could not find the (table|.*column)/i.test(e.message);
}

function failClosed(op: string, tenantId: string, error: unknown): void {
  const e = (error ?? {}) as { message?: unknown };
  log.warn(
    isMissingTable(error)
      ? `[page-understanding] nothing to ${op}: the page_understanding tables are not there yet (apply migrations/2026-08-12_page_understanding.sql)`
      : `[page-understanding] could not ${op} what these pages are for, so nothing landed`,
    { tenant: tenantId, error: typeof e.message === "string" ? e.message.slice(0, 200) : String(error) },
  );
}

const decode = (r: Row): PageUnderstanding => ({
  url: r.url, contentFingerprint: r.content_fingerprint, job: r.job,
  pageType: r.page_type as PageJob["pageType"], audience: r.audience,
  topics: (r.topics ?? []).map((t) => t.toLowerCase()), commercial: !!r.commercial, promise: r.promise ?? "", sells: r.sells ?? [],
  readAt: r.read_at, sourceExtractAt: r.source_extract_at,
});

/**
 * The readings on file for these addresses, keyed by canonical address. ONE query for the whole batch,
 * so a pass that asks about four hundred pages pays for one round trip and no dollars at all. Empty on
 * any failure, with the honest log line.
 */
async function readPageUnderstanding(
  tenantId: string,
  urls: readonly string[],
): Promise<Map<string, PageUnderstanding>> {
  const out = new Map<string, PageUnderstanding>();
  const keys = [...new Set((urls ?? []).map((u) => canonicalUrlKey(u)).filter(Boolean))].slice(0, MAX_ROWS);
  if (!tenantId?.trim() || keys.length === 0 || !isSupabaseConfigured()) return out;
  try {
    const { data, error } = await getSupabaseAdmin()
      .from(TABLE).select(COLUMNS).eq("tenant_id", tenantId).in("page_key", keys).limit(MAX_ROWS);
    if (error) {
      failClosed("read", tenantId, error);
      return out;
    }
    for (const r of (data ?? []) as unknown as Row[]) if (r?.page_key) out.set(r.page_key, decode(r));
    return out;
  } catch (e) {
    failClosed("read", tenantId, e);
    return out;
  }
}

/**
 * Record what one page is for. ONE upsert on the primary key, never a read then a write, so two passes
 * reading two pages at the same moment cannot overwrite each other and two readings of the SAME page
 * settle by write completion, not source recency. A changed extract updates the row in place, which
 * is what keeps exactly one current row per page. False when the write could not land.
 */
async function savePageUnderstanding(tenantId: string, reading: PageUnderstanding): Promise<boolean> {
  const key = canonicalUrlKey(reading?.url);
  if (!tenantId?.trim() || !key || !reading.contentFingerprint || !isSupabaseConfigured()) return false;
  try {
    const { error } = await getSupabaseAdmin().from(TABLE).upsert({
      tenant_id: tenantId, page_key: key, url: reading.url, content_fingerprint: reading.contentFingerprint,
      job: reading.job, page_type: reading.pageType, audience: reading.audience,
      topics: reading.topics, commercial: reading.commercial, promise: reading.promise, sells: reading.sells,
      read_at: reading.readAt, source_extract_at: reading.sourceExtractAt, updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id,page_key" });
    if (error) {
      failClosed("record", tenantId, error);
      return false;
    }
    return true;
  } catch (e) {
    failClosed("record", tenantId, e);
    return false;
  }
}

/**
 * Where rotating coverage left off, and where it should resume. Called with no second argument this
 * reads the stored cursor; called with one it writes that page and hands it back. One function because
 * it is one fact with one owner, and one row per account because that is all a resume point is.
 */
async function jobCursor(tenantId: string, next?: string | null): Promise<string | null> {
  if (!tenantId?.trim() || !isSupabaseConfigured()) return null;
  try {
    const admin = getSupabaseAdmin();
    if (next === undefined) {
      const { data, error } = await admin.from(CURSOR_TABLE).select("page_key").eq("tenant_id", tenantId).limit(1);
      if (error) {
        failClosed("read", tenantId, error);
        return null;
      }
      return ((data ?? [])[0] as { page_key: string | null } | undefined)?.page_key ?? null;
    }
    const key = next ? canonicalUrlKey(next) : null;
    const { error } = await admin.from(CURSOR_TABLE)
      .upsert({ tenant_id: tenantId, page_key: key, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
    if (error) {
      failClosed("record", tenantId, error);
      return null;
    }
    return key;
  } catch (e) {
    failClosed("read", tenantId, e);
    return null;
  }
}

/** THE STORE, as one thing. Handed around as a whole so a test can stand a whole store in for it and so no
 *  caller ever holds half of it: reading a page, recording a page and remembering where the rotation stopped
 *  are one durable record with one owner. */
export const pageStore = { read: readPageUnderstanding, save: savePageUnderstanding, cursor: jobCursor };
