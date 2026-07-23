import "server-only";

/**
 * citations-daily (FINAL PREMIUM PLAN item 9) - your OWN domain's AI citations per day from
 * profound_citation_rows, for the AI-visibility mini-scoreboard next to the Google chart.
 * One bounded tenant-scoped read filtered to the own domain in SQL (ilike), aggregated to
 * date -> citations. Fail-soft -> empty (the band self-hides).
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";

export type CitationsByDay = { daily: Array<{ date: string; clicks: number }>; total: number };

export async function loadOwnCitationsByDay(
  tenantId: string,
  ownNeedle: string,
  days = 30,
): Promise<CitationsByDay> {
  const empty: CitationsByDay = { daily: [], total: 0 };
  const needle = (ownNeedle ?? "").trim().toLowerCase();
  if (!tenantId || needle.length < 3) return empty;
  try {
    const sb = getSupabaseAdmin();
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await sb
      .from("profound_citation_rows")
      .select("date, citation_count")
      .eq("tenant_id", tenantId)
      .ilike("root_domain", `%${needle}%`)
      .gte("date", since)
      .limit(5000);
    if (error || !Array.isArray(data)) return empty;
    const byDate = new Map<string, number>();
    let total = 0;
    for (const r of data as Array<{ date: string; citation_count: number | string | null }>) {
      if (!r.date) continue;
      const n = Math.max(1, Number(r.citation_count) || 1);
      byDate.set(r.date, (byDate.get(r.date) ?? 0) + n);
      total += n;
    }
    const daily = [...byDate.entries()].map(([date, clicks]) => ({ date, clicks })).sort((a, b) => a.date.localeCompare(b.date));
    return { daily, total };
  } catch {
    return empty;
  }
}
