/**
 * Profound → proof bridge (2026-06-13 midnight shift). Loads the
 * tenant's OWNED-URL citations from the live Profound connector
 * (`profound_citation_rows`) and shapes them for
 * buildUrlCitationHistory's `profoundOwnedCitations` gap-fill pass.
 *
 * WHY: the Proof Engine's measurement loop (the category wedge —
 * "prove what each edit drove") runs on native AI-citation polling,
 * which is OpenAI-quota-blocked → starved. The operator already PAYS
 * for Profound, whose `profound_citation_rows` carry per-URL,
 * per-model, per-day AI-citation counts. Feeding the tenant's
 * own-domain rows in lets watch windows measure despite the quota
 * block — with zero double-counting (gap-fill precedence in the
 * history builder) and the engine's honesty gates unchanged.
 *
 * Own-domain classification is deterministic: a citation row whose
 * `root_domain` matches the tenant's configured domain (host-
 * normalized, www-stripped) is owned. No hardcoding — the domain
 * comes from the tenant's own business config.
 *
 * Fail-soft empty: no Profound key / no rows / table missing → [],
 * so the proof history is byte-identical to native-only.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { getBusinessConfig, hydrateBusinessConfigFromSupabase } from "@/lib/business-config";
import { log } from "@/lib/logger";

export type ProfoundOwnedCitation = {
  url: string;
  date: string;
  platform: string;
  count: number;
};

/** Host of a domain/URL, lowercased, scheme- and www-stripped. */
function hostOf(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

export async function loadProfoundOwnedCitations(
  tenantId: string,
): Promise<ProfoundOwnedCitation[]> {
  // 2026-06-26: resolve via the Supabase-backed config so a Supabase-only tenant
  // (domain in the business_config row, not the sync env/file chain) matches its
  // OWN cited domain. Citation-domain matching is the sound Profound signal on a
  // borrowed workspace (it keys on the real domain, not the tracked brand).
  const cfg = (await hydrateBusinessConfigFromSupabase(tenantId)) ?? getBusinessConfig(tenantId);
  const domain = cfg.domain?.trim();
  if (!domain) return [];
  const ownHost = hostOf(domain);
  if (!ownHost) return [];

  type Row = {
    date: string;
    model: string;
    root_domain: string;
    url: string;
    citation_count: number;
  };
  let rows: Row[] | null = null;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("profound_citation_rows")
      .select("date, model, root_domain, url, citation_count")
      .eq("tenant_id", tenantId)
      .limit(20000);
    if (error) {
      log.warn("[profound-proof] read failed", { tenantId, error: error.message });
      return [];
    }
    rows = (data ?? []) as unknown as Row[];
  } catch {
    return [];
  }
  if (rows == null || rows.length === 0) return [];

  const out: ProfoundOwnedCitation[] = [];
  for (const r of rows) {
    if (!r.url || !r.date) continue;
    // OWNED only — the root_domain (or the url's host) must be the
    // tenant's own domain. Competitor citations are not the tenant's
    // proof signal.
    const rowHost = hostOf(r.root_domain || r.url);
    if (rowHost !== ownHost) continue;
    const count = r.citation_count ?? 0;
    if (count <= 0) continue;
    out.push({
      url: r.url,
      date: r.date.slice(0, 10),
      platform: r.model || "unknown",
      count,
    });
  }
  return out;
}
