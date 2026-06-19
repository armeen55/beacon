import "server-only";

import {
  loadGscSiteTotalsForTenant,
  loadGscPageSignalsForTenant,
  type GscPageSignal,
} from "@/domains/recommendation-intelligence/gsc-page-signals";
import { getConnectorInfo, type ConnectorProvider } from "@/lib/connector-store";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { loadOpportunityMap } from "./compute-opportunity-map";
import {
  deriveHeadline,
  type StateOfUnion,
  type StateOfUnionSource,
} from "./state-of-union";

/** The data sources the Briefing reports on, with what each unlocks. White-
 *  label: Profound is shown as "AI answers", never the vendor name. */
const SOURCE_META: { key: ConnectorProvider; label: string; unlocks: string }[] = [
  { key: "google_gsc", label: "Search (Google)", unlocks: "what people search, where you rank, and CTR leaks" },
  { key: "google_ga4", label: "Visitors (Analytics)", unlocks: "which traffic converts — page-value weighting" },
  { key: "semrush", label: "Keywords (SEMrush)", unlocks: "market demand + page-2 keyword opportunities" },
  { key: "clarity", label: "Visitor experience", unlocks: "where visitors get stuck (dead/rage clicks)" },
  { key: "wix", label: "Publishing (Wix)", unlocks: "shipping changes live (content, SEO, schema)" },
  { key: "profound", label: "AI answers", unlocks: "where AI assistants cite or ignore you" },
];

function pathTail(path: string): string {
  const seg = path.replace(/\/+$/, "").split("/").filter(Boolean).pop();
  return seg ? seg.replace(/-/g, " ") : "home";
}

function toPath(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

/** Latest-snapshot-per-URL FAQ-schema + thin-content coverage. Tenant-scoped,
 *  fail-soft. ~hundreds of rows for a content site — bounded + cheap. */
async function loadSchemaCoverage(
  tenantId: string,
): Promise<{ faqCovered: number; faqTotal: number; thinPages: number } | null> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("page_snapshots")
      .select("url, faq_schema_block_count, word_count, fetched_at")
      .eq("tenant_id", tenantId)
      .order("fetched_at", { ascending: false })
      .limit(3000);
    if (error || !data || data.length === 0) return null;
    const latest = new Map<string, { faq: number; words: number }>();
    for (const r of data as Array<{
      url: string;
      faq_schema_block_count: number | null;
      word_count: number | null;
    }>) {
      const u = canonicalizeCitationUrl(r.url) ?? r.url;
      if (latest.has(u)) continue; // first seen wins (desc by fetched_at = latest)
      latest.set(u, {
        faq: r.faq_schema_block_count ?? 0,
        words: r.word_count ?? 0,
      });
    }
    let faqCovered = 0;
    let thinPages = 0;
    for (const v of latest.values()) {
      if (v.faq > 0) faqCovered++;
      if (v.words < 300) thinPages++;
    }
    return { faqCovered, faqTotal: latest.size, thinPages };
  } catch {
    return null;
  }
}

/**
 * Build the executive State of the Union for a tenant — the Briefing hero.
 * Pure composition over already-synced signals (Opportunity Map + GSC site
 * totals + connector health + schema coverage). NO new paid pulls. Fail-soft
 * throughout: a missing source degrades its section, never the whole briefing.
 */
export async function loadStateOfUnion(
  tenantId: string,
  now: Date = new Date(),
): Promise<StateOfUnion> {
  const [totals, pageSignals, opportunities, schemaAeoGap, sources] =
    await Promise.all([
      loadGscSiteTotalsForTenant(tenantId, now).catch(() => null),
      loadGscPageSignalsForTenant(tenantId, now).catch(
        () => new Map<string, GscPageSignal>(),
      ),
      loadOpportunityMap(tenantId, now).catch(() => []),
      loadSchemaCoverage(tenantId),
      Promise.all(
        SOURCE_META.map(async (m): Promise<StateOfUnionSource> => {
          const info = await getConnectorInfo(m.key, tenantId).catch(() => null);
          const connected = info?.status === "connected";
          const lastSyncedAt = info?.last_synced_at ?? null;
          const stale = daysSince(lastSyncedAt, now);
          const note = !connected
            ? "not connected"
            : stale == null
              ? "connected — not yet synced"
              : stale <= 2
                ? "fresh"
                : `${stale} days stale`;
          return {
            key: m.key,
            label: m.label,
            connected,
            lastSyncedAt,
            daysStale: stale,
            note,
            unlocks: m.unlocks,
          };
        }),
      ),
    ]);

  const bleedingPages = opportunities
    .filter((o) => o.kinds.includes("ctr_leak") || o.kinds.includes("decay"))
    .slice(0, 6);
  const risingOpportunities = opportunities
    .filter(
      (o) => o.kinds.includes("striking_distance") || o.kinds.includes("rising"),
    )
    .slice(0, 6);
  const frictionPages = opportunities
    .filter((o) => o.kinds.includes("friction"))
    .slice(0, 5);

  const ctrLeakCount = opportunities.filter((o) =>
    o.kinds.includes("ctr_leak"),
  ).length;

  const winningClusters = [...pageSignals.values()]
    .sort((a, b) => b.clicks90d - a.clicks90d)
    .slice(0, 5)
    .map((s) => ({
      label: pathTail(toPath(s.page)),
      path: toPath(s.page),
      clicks90d: s.clicks90d,
    }));

  const nextBestActions = opportunities.slice(0, 3).map((o) => ({
    headline: o.expectedLever,
    path: o.path,
    kind: o.kind,
    estClicksAtStake: o.estClicksAtStake,
  }));

  const headline = totals
    ? deriveHeadline(
        {
          clicks28d: totals.clicks28d,
          clicksPrev28d: totals.clicksPrev28d,
          impressions90d: totals.impressions90d,
          avgPosition90d: totals.avgPosition90d,
        },
        ctrLeakCount,
      )
    : null;

  return {
    hasData: totals != null || opportunities.length > 0,
    headline,
    bleedingPages,
    risingOpportunities,
    frictionPages,
    winningClusters,
    schemaAeoGap,
    sources,
    nextBestActions,
    opportunityCount: opportunities.length,
  };
}
