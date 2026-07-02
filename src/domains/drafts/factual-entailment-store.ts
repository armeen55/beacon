import "server-only";

/**
 * factual-entailment-store (N8, 2026-07-02), the ONE I/O helper the entailment
 * gate needs: the target page's own stored body text. Mirrors the already-proven
 * lean read in `answer-alignment-store.ts`'s `readOwnedPageBodyText` (same table,
 * same columns, same fail-soft contract) rather than duplicating a new query
 * shape, that reader is private to its module, so this is a sibling, not an
 * import, to keep this domain's ownership self-contained per N8's file scope.
 *
 * Deliberately narrower than the shared repository projection (which drops
 * body_paragraph_sample/card_texts to protect hot web-render egress, see
 * repositories/types.ts), this targets exactly ONE url per call, so the extra
 * columns are cheap. Fail-soft everywhere: entailment runs with less grounding
 * on any read failure, it never blocks the gate itself.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";

type OwnedBodyRow = {
  body_paragraph_sample: string[] | null;
  card_texts: string[] | null;
  faqs: { answer_excerpt: string }[] | null;
};

/** A `www.`/bare-host variant of the same URL - ground-truth verification
 *  against real Iranopedia data (N8, 2026-07-02) found prepared-Move target
 *  URLs stored WITHOUT `www.` (`https://iranopedia.com/...`) while
 *  page_snapshots rows are keyed WITH it (`https://www.iranopedia.com/...`),
 *  so an exact match alone silently found nothing for every real pack. Trying
 *  the toggled variant as a fallback is enough to fix the real mismatch
 *  without pulling in a full URL-canonicalization module (out of this item's
 *  ownership scope). */
function wwwVariant(url: string): string | null {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`;
    return u.toString();
  } catch {
    return null;
  }
}

async function readOneUrl(tenantId: string, url: string): Promise<OwnedBodyRow | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("page_snapshots")
    .select("body_paragraph_sample, card_texts, faqs, fetched_at")
    .eq("tenant_id", tenantId)
    .eq("url", url)
    .order("fetched_at", { ascending: false })
    .limit(1);
  if (error) {
    log.warn("[factual-entailment] page_snapshots read failed", { tenantId, url, error: error.message });
    return null;
  }
  return ((data ?? [])[0] ?? null) as OwnedBodyRow | null;
}

/** Read the latest page_snapshots body text for ONE owned URL, joined into one
 *  blob for the entailment gate. Tries the exact URL first, then its
 *  www./bare-host variant. Fail-soft -> null (never throws). */
export async function readPageBodyTextForEntailment(
  tenantId: string,
  url: string,
): Promise<string | null> {
  if (!isSupabaseConfigured() || !tenantId || !url) return null;
  try {
    let row = await readOneUrl(tenantId, url);
    if (!row) {
      const alt = wwwVariant(url);
      if (alt && alt !== url) row = await readOneUrl(tenantId, alt);
    }
    if (!row) return null;
    const parts = [
      ...(row.body_paragraph_sample ?? []),
      ...(row.card_texts ?? []),
      ...(row.faqs ?? []).map((f) => f.answer_excerpt).filter(Boolean),
    ];
    const text = parts.join(" ").trim();
    return text || null;
  } catch (e) {
    log.warn("[factual-entailment] page_snapshots read threw", {
      tenantId,
      url,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
