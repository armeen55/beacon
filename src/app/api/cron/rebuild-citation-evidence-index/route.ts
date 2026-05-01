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

async function fetchNativeObservations(): Promise<ObservationRow[]> {
  const sb = getSupabaseAdmin();
  const PAGE = 1000;
  const out: ObservationRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("prompt_answer_observations")
      .select("id, prompt_id, observed_at, topic, platform, citation_urls")
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

async function fetchTrackedEntities(): Promise<TrackedEntity[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("tracked_entities")
    .select("*");
  if (error) throw new Error(`tracked_entities: ${error.message}`);
  return (data ?? []) as TrackedEntity[];
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
    `[/api/cron/rebuild-citation-evidence-index] starting; boundary=${NATIVE_REGIME_START}`,
  );
  try {
    const [observations, entities] = await Promise.all([
      fetchNativeObservations(),
      fetchTrackedEntities(),
    ]);

    if (observations.length === 0) {
      const elapsedMs = Date.now() - startedAt;
      console.warn(
        `[/api/cron/rebuild-citation-evidence-index] no native observations with citation_urls; nothing to rebuild (${elapsedMs}ms)`,
      );
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "no native observations with citation_urls",
        elapsedMs,
      });
    }

    const index = buildNativeCitationEvidenceIndex({
      observations,
      entities,
      nativeRegimeStart: NATIVE_REGIME_START,
    });

    const sb = getSupabaseAdmin();
    const { error: upsertErr } = await sb
      .from("citation_evidence_index")
      .upsert(
        {
          id: "current",
          built_at: index.built_at,
          total_citations_processed: index.total_citations_processed,
          by_page_and_topic: index.by_page_and_topic,
          by_topic: index.by_topic,
          page_to_topics: index.page_to_topics,
        },
        { onConflict: "id" },
      );
    if (upsertErr) {
      throw new Error(`upsert citation_evidence_index: ${upsertErr.message}`);
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[/api/cron/rebuild-citation-evidence-index] completed (${elapsedMs}ms): ` +
        `obs=${observations.length} entities=${entities.length} ` +
        `processed=${index.total_citations_processed} ` +
        `topics=${index.by_topic.length} rows=${index.by_page_and_topic.length} ` +
        `pages=${Object.keys(index.page_to_topics).length}`,
    );
    return NextResponse.json({
      ok: true,
      built_at: index.built_at,
      total_citations_processed: index.total_citations_processed,
      observations_read: observations.length,
      entities_read: entities.length,
      topics: index.by_topic.length,
      page_topic_rows: index.by_page_and_topic.length,
      pages: Object.keys(index.page_to_topics).length,
      elapsedMs,
    });
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
