import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { buildNativeCitationEvidenceIndex } from "@/domains/pages/citation-index";
import { NATIVE_REGIME_START } from "@/domains/product/url-citation-history";
import type { TrackedEntity } from "@/domains/tracked-entities/types";

/**
 * POST /api/cron/rebuild-citation-evidence-index — Phase v4 Commit 7B (2026-04-30).
 *
 * Hosted trigger to rebuild `citation_evidence_index` (id='current') from
 * native `prompt_answer_observations` with non-null `citation_urls`.
 * Mirrors `scripts/rebuild-citation-evidence-index-native.ts` but runs on
 * Vercel so GitHub Actions can fire it post-poll without needing the
 * Supabase service role key in repo secrets.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` header. Same secret as the
 * native poll cron.
 *
 * On Vercel the lambda FS is read-only, so this only writes Supabase.
 * Local-dev disk parity is handled by the CLI script (also writes
 * `.data/tenants/{slug}/citation-evidence-index.json` via writeDotDataJson).
 */

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type ObservationRow = {
  id: string;
  prompt_id: string;
  observed_at: string;
  topic: string;
  platform: string;
  citation_urls: string[] | null;
};

// Night-shift fix (2026-06-11): ALL fetches are tenant-scoped. The
// pre-fix route blended every tenant's observations into ONE global
// index row served to everyone — a cross-tenant bleed that activated
// the moment tenant #2 started polling. The table now keys on
// (tenant_id, id) and this route rebuilds one row per active tenant.
async function fetchNativeObservations(tenantId: string): Promise<ObservationRow[]> {
  const sb = getSupabaseAdmin();
  const PAGE = 1000;
  const out: ObservationRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("prompt_answer_observations")
      .select("id, prompt_id, observed_at, topic, platform, citation_urls")
      .eq("tenant_id", tenantId)
      .gte("observed_at", `${NATIVE_REGIME_START}T00:00:00Z`)
      .not("citation_urls", "is", null)
      .order("observed_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`observations page ${from}: ${error.message}`);
    const rows = (data ?? []) as ObservationRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function fetchTrackedEntities(tenantId: string): Promise<TrackedEntity[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("tracked_entities")
    .select("*")
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`tracked_entities: ${error.message}`);
  return (data ?? []) as TrackedEntity[];
}

async function fetchActiveTenantIds(): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("tenants")
    .select("id, status")
    .eq("status", "active");
  if (error) throw new Error(`tenants: ${error.message}`);
  return ((data ?? []) as Array<{ id: string }>).map((t) => t.id);
}

export async function POST(req: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on the server" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  console.log(
    `[/api/cron/rebuild-citation-evidence-index] starting (per-tenant); boundary=${NATIVE_REGIME_START}`,
  );
  try {
    const tenantIds = await fetchActiveTenantIds();
    if (tenantIds.length === 0) {
      return NextResponse.json(
        { error: "no active tenants" },
        { status: 500 },
      );
    }

    const sb = getSupabaseAdmin();
    const perTenant: Array<Record<string, unknown>> = [];
    const failures: Array<{ tenantId: string; message: string }> = [];

    for (const tenantId of tenantIds) {
      try {
        const [observations, entities] = await Promise.all([
          fetchNativeObservations(tenantId),
          fetchTrackedEntities(tenantId),
        ]);

        if (observations.length === 0) {
          perTenant.push({ tenantId, skipped: true, reason: "no native observations with citation_urls" });
          continue;
        }

        const index = buildNativeCitationEvidenceIndex({
          observations,
          entities,
          nativeRegimeStart: NATIVE_REGIME_START,
        });

        const { error: upsertErr } = await sb
          .from("citation_evidence_index")
          .upsert(
            {
              id: "current",
              tenant_id: tenantId,
              built_at: index.built_at,
              total_citations_processed: index.total_citations_processed,
              by_page_and_topic: index.by_page_and_topic,
              by_topic: index.by_topic,
              page_to_topics: index.page_to_topics,
            },
            { onConflict: "tenant_id,id" },
          );
        if (upsertErr) {
          throw new Error(`upsert citation_evidence_index: ${upsertErr.message}`);
        }

        console.log(
          `[/api/cron/rebuild-citation-evidence-index] ${tenantId}: ` +
            `obs=${observations.length} processed=${index.total_citations_processed} ` +
            `topics=${index.by_topic.length} rows=${index.by_page_and_topic.length}`,
        );
        perTenant.push({
          tenantId,
          observations_read: observations.length,
          total_citations_processed: index.total_citations_processed,
          topics: index.by_topic.length,
          page_topic_rows: index.by_page_and_topic.length,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(
          `[/api/cron/rebuild-citation-evidence-index] ${tenantId} FAILED: ${message}`,
        );
        failures.push({ tenantId, message });
      }
    }

    const elapsedMs = Date.now() - startedAt;
    if (failures.length > 0) {
      // Partial failure is a FAILURE (the workflow must alert) but the
      // per-tenant detail shows which tenants still rebuilt cleanly.
      return NextResponse.json(
        { error: "rebuild failed for some tenants", failures, perTenant, elapsedMs },
        { status: 500 },
      );
    }
    console.log(
      `[/api/cron/rebuild-citation-evidence-index] completed (${elapsedMs}ms): tenants=${tenantIds.length}`,
    );
    return NextResponse.json({ ok: true, tenants: perTenant, elapsedMs });
  } catch (e) {
    const elapsedMs = Date.now() - startedAt;
    const message = e instanceof Error ? e.message : String(e);
    console.error(
      `[/api/cron/rebuild-citation-evidence-index] error (${elapsedMs}ms): ${message}`,
    );
    return NextResponse.json(
      { error: "rebuild failed", message, elapsedMs },
      { status: 500 },
    );
  }
}
