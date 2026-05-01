/**
 * rebuild-citation-evidence-index-native — Commit 7B (2026-04-24, refreshed 2026-04-30).
 *
 * Rebuilds the `citation_evidence_index` row (id='current') from native
 * `prompt_answer_observations` with non-null `citation_urls`. Overwrites
 * the Profound-era index that's been frozen since 2026-04-15.
 *
 * Flip semantics: /pages, /competitors, /topics (and the EvidenceFreshness
 * Banner Commit 2 added) all read `id='current'`. After this script runs,
 * those surfaces show current native-era rankings with a fresh built_at
 * timestamp; the banner's "9d ago" warning collapses.
 *
 * 2026-04-30 update: also writes the local-disk `.data/tenants/{slug}/citation-evidence-index.json`
 * via writeDotDataJson so DATA_SOURCE=file dev/test runs see the same
 * fresh data the hosted (DATA_SOURCE=supabase) deploy reads. Without
 * this, local /pages, /competitors, /topics keep reading the stale Apr-20
 * file even after Supabase is refreshed.
 *
 * INVARIANT (per Commit 7 design note): one observation → at most 1 count
 * per (page_url, topic) key. Enforced inside buildNativeCitationEvidenceIndex;
 * tested in citation-index.test.ts.
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/rebuild-citation-evidence-index-native.ts           # rebuild + write
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/rebuild-citation-evidence-index-native.ts --dry-run # preview only
 *
 * Env required:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   BEACON_TENANT_ID, BEACON_TENANT_SLUG (for routed disk path)
 *
 * Exit codes:
 *   0 — success
 *   1 — runtime error
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

import { getSupabaseAdmin } from "../src/lib/persistence/supabase";
import { writeDotDataJson } from "../src/lib/persistence/dotdata-json";
import { buildNativeCitationEvidenceIndex } from "../src/domains/pages/citation-index";
import { NATIVE_REGIME_START } from "../src/domains/product/url-citation-history";
import type { TrackedEntity } from "../src/domains/tracked-entities/types";

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
  // Page through all native-era observations with citation_urls populated.
  // Volume is small (~420 today, growing by ~200/day) but we page defensively.
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

async function writeIndex(
  index: Awaited<ReturnType<typeof buildNativeCitationEvidenceIndex>>,
): Promise<void> {
  // 1. Local disk write — DATA_SOURCE=file readers (local dev, tests) see fresh data.
  //    No-ops on Vercel (read-only FS); hosted relies on the Supabase write below.
  await writeDotDataJson("citation-evidence-index", index);

  // 2. Supabase write — DATA_SOURCE=supabase readers (hosted Vercel deploy) see fresh data.
  const sb = getSupabaseAdmin();
  const row = {
    id: "current",
    built_at: index.built_at,
    total_citations_processed: index.total_citations_processed,
    by_page_and_topic: index.by_page_and_topic,
    by_topic: index.by_topic,
    page_to_topics: index.page_to_topics,
  };
  const { error } = await sb
    .from("citation_evidence_index")
    .upsert(row, { onConflict: "id" });
  if (error) throw new Error(`upsert citation_evidence_index: ${error.message}`);
}

async function main(): Promise<number> {
  const dryRun = process.argv.includes("--dry-run");
  console.log(
    `rebuild-citation-evidence-index-native: dry-run=${dryRun}, boundary=${NATIVE_REGIME_START}`,
  );

  const [observations, entities] = await Promise.all([
    fetchNativeObservations(),
    fetchTrackedEntities(),
  ]);
  console.log(
    `Fetched: ${observations.length} native observations with citation_urls, ${entities.length} tracked entities.`,
  );

  if (observations.length === 0) {
    console.log("No native observations with citation_urls yet. Nothing to rebuild.");
    return 0;
  }

  const index = buildNativeCitationEvidenceIndex({
    observations,
    entities,
    nativeRegimeStart: NATIVE_REGIME_START,
  });

  console.log(`\nBuilt index:`);
  console.log(`  built_at:                   ${index.built_at}`);
  console.log(`  total_citations_processed:  ${index.total_citations_processed}`);
  console.log(`  distinct page×topic rows:   ${index.by_page_and_topic.length}`);
  console.log(`  distinct topics:            ${index.by_topic.length}`);
  console.log(`  distinct pages:             ${Object.keys(index.page_to_topics).length}`);

  // Top-5 topics by total citations — sanity check.
  const topTopics = [...index.by_topic]
    .sort((a, b) => b.total_citations - a.total_citations)
    .slice(0, 5);
  console.log(`\nTop 5 topics by total citations:`);
  for (const t of topTopics) {
    console.log(
      `  ${t.total_citations.toString().padStart(4, " ")} · ${t.topic} (owned=${t.owned_citations}, comp=${t.competitor_citations}, dir=${t.directory_citations})`,
    );
  }

  if (!dryRun) {
    await writeIndex(index);
    console.log(`\nWrote citation_evidence_index id='current' to Supabase.`);
  } else {
    console.log(`\n(dry-run — no write)`);
  }

  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("Unhandled error:", err);
    process.exit(1);
  },
);
