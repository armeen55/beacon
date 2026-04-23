/**
 * backfill-observation-extraction — Schema v2 Commit 4 (2026-04-24).
 *
 * Populates the three must-have-now extraction fields
 * (mention_position, citation_rank, primary_recommendation) on existing
 * Apr-22+ prompt_answer_observations rows where they're NULL.
 *
 * The native polling pipeline (Commit 4 — adapter wiring) writes these
 * fields on every NEW observation from the next poll forward. This script
 * covers the ~420 rows that landed between 2026-04-22 and today under the
 * old schema. Answer text is stored in `answer_texts` (1:1 with observations)
 * and every extractor is deterministic, so backfill is idempotent — re-runs
 * don't duplicate or churn data.
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/backfill-observation-extraction.ts            # incremental: only rows with any null field
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/backfill-observation-extraction.ts --force    # re-extract all Apr-22+ rows (idempotent; use after extractor improvements)
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/backfill-observation-extraction.ts --dry-run  # preview only
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/backfill-observation-extraction.ts --limit=50 # cap rows processed
 *
 * Env required:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Exit codes:
 *   0 — success (or no rows to backfill)
 *   1 — runtime error (query failed, etc.)
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
import {
  extractMentionPosition,
  extractCitationRank,
  rankEntitiesByFirstAppearance,
  extractPrimaryRecommendation,
  extractDescriptorWindow,
  extractCompetitorCoMentions,
  classifyCitationDomains,
  extractAnswerStructure,
} from "../src/domains/prompt-answer-observations/extraction";
import type { TrackedEntity } from "../src/domains/tracked-entities/types";

type ArgFlags = {
  dryRun: boolean;
  limit: number | null;
  /** When true, ignore "any field is null" filter and re-extract all
   *  Apr-22+ rows. Needed after extractor-logic improvements (e.g. the
   *  2026-04-24 URL-noise filter) so already-populated rows get
   *  recomputed with the new logic. Extraction is idempotent, so
   *  re-writing identical values is a no-op. */
  force: boolean;
};

function parseArgs(): ArgFlags {
  const out: ArgFlags = { dryRun: false, limit: null, force: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--force") out.force = true;
    else if (arg.startsWith("--limit=")) {
      const n = parseInt(arg.slice("--limit=".length), 10);
      if (!isNaN(n) && n > 0) out.limit = n;
    }
  }
  return out;
}

async function fetchActiveEntities(): Promise<TrackedEntity[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("tracked_entities")
    .select("*")
    .eq("is_active", true);
  if (error) throw new Error(`tracked_entities query: ${error.message}`);
  return (data ?? []) as TrackedEntity[];
}

type BackfillRow = {
  id: string;
  observed_at: string;
  citation_domains: string[] | null;
  answer_text: string | null;
};

async function fetchRowsToBackfill(
  limit: number | null,
  force: boolean,
): Promise<BackfillRow[]> {
  // Inner join prompt_answer_observations × answer_texts, filter to Apr-22+
  // observations. Supabase PostgREST doesn't let us do arbitrary inner joins
  // cleanly, so we fetch observations first then join answer_texts in a
  // second pass.
  //
  // Without --force: only rows where ANY schema-v2 / v2.1 extraction column
  // is still NULL (skips already-populated rows — normal incremental mode).
  // With --force: all Apr-22+ rows (re-extract everything; needed after
  // extractor-logic changes).
  const sb = getSupabaseAdmin();

  let obsQuery = sb
    .from("prompt_answer_observations")
    .select(
      "id, observed_at, citation_domains, mention_position, citation_rank, primary_recommendation, descriptor_window, competitor_co_mentions, citation_domain_classes, answer_structure",
    )
    .gte("observed_at", "2026-04-22T00:00:00Z")
    .order("observed_at", { ascending: true });

  if (!force) {
    obsQuery = obsQuery.or(
      "mention_position.is.null,descriptor_window.is.null,competitor_co_mentions.is.null,citation_domain_classes.is.null,answer_structure.is.null",
    );
  }

  if (limit !== null) obsQuery = obsQuery.limit(limit);

  const { data: obsRows, error: obsErr } = await obsQuery;
  if (obsErr) throw new Error(`observation query: ${obsErr.message}`);
  if (!obsRows || obsRows.length === 0) return [];

  // Chunk the answer_texts fetch — PostgREST's `.in()` URL length caps out
  // around 100+ items depending on id length. 420 ids in one query = 400 Bad
  // Request. Chunk at 100 for safety.
  const ids = obsRows.map((r) => r.id as string);
  const textByObsId = new Map<string, string>();
  const IN_CHUNK = 100;
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const { data: txtRows, error: txtErr } = await sb
      .from("answer_texts")
      .select("observation_id, body")
      .in("observation_id", chunk);
    if (txtErr) throw new Error(`answer_texts query: ${txtErr.message}`);
    for (const t of txtRows ?? []) {
      textByObsId.set(t.observation_id as string, (t.body as string) ?? "");
    }
  }

  return obsRows.map((r) => ({
    id: r.id as string,
    observed_at: r.observed_at as string,
    citation_domains: (r.citation_domains as string[] | null) ?? [],
    answer_text: textByObsId.get(r.id as string) ?? null,
  }));
}

function buildEntityContext(entities: TrackedEntity[]): {
  ownedNameVariants: string[];
  ownedDomains: Set<string>;
  competitorDomains: Set<string>;
  brandCanonicalName: string;
  ownedEntityNames: Set<string>;
  activeEntities: TrackedEntity[];
} {
  const activeEntities = entities.filter((e) => e.is_active);
  const ownedEntities = activeEntities.filter((e) => e.is_owned);
  const ownedNameVariants = ownedEntities.flatMap((e) => {
    const variants: string[] = [];
    if (e.name) variants.push(e.name);
    if (e.aliases) for (const a of e.aliases) if (a) variants.push(a);
    return variants;
  });
  const ownedDomains = new Set(
    ownedEntities
      .map((e) => e.domain?.toLowerCase())
      .filter((d): d is string => Boolean(d)),
  );
  const competitorDomains = new Set(
    activeEntities
      .filter((e) => !e.is_owned)
      .map((e) => e.domain?.toLowerCase())
      .filter((d): d is string => Boolean(d)),
  );
  const ownedEntityNames = new Set(
    ownedEntities.map((e) => e.name).filter((n): n is string => Boolean(n)),
  );
  const brandCanonicalName = ownedEntities[0]?.name ?? "";
  return {
    ownedNameVariants,
    ownedDomains,
    competitorDomains,
    brandCanonicalName,
    ownedEntityNames,
    activeEntities,
  };
}

type ExtractedFields = {
  mention_position: number | null;
  citation_rank: number | null;
  primary_recommendation: boolean;
  descriptor_window: string[];
  competitor_co_mentions: string[];
  citation_domain_classes: string[];
  answer_structure: string | null;
};

function extractForRow(
  row: BackfillRow,
  ctx: ReturnType<typeof buildEntityContext>,
): ExtractedFields {
  const answerText = row.answer_text ?? "";
  const citationDomains = row.citation_domains ?? [];

  const mentionPosition = extractMentionPosition(
    answerText,
    ctx.ownedNameVariants,
  );
  const citationRank = extractCitationRank(citationDomains, ctx.ownedDomains);
  const entitiesInOrder = rankEntitiesByFirstAppearance(
    answerText,
    ctx.activeEntities,
  );
  const primaryRecommendation = extractPrimaryRecommendation(
    answerText,
    mentionPosition,
    entitiesInOrder,
    ctx.brandCanonicalName,
  );
  // Schema v2.1 (Commit 6) — high-value-soon fields.
  const descriptorWindow = extractDescriptorWindow(
    answerText,
    mentionPosition,
    ctx.ownedNameVariants,
  );
  const competitorCoMentions = extractCompetitorCoMentions(
    entitiesInOrder,
    ctx.ownedEntityNames,
  );
  const citationDomainClasses = classifyCitationDomains(
    citationDomains,
    ctx.ownedDomains,
    ctx.competitorDomains,
  );
  const answerStructure = extractAnswerStructure(answerText);

  return {
    mention_position: mentionPosition,
    citation_rank: citationRank,
    primary_recommendation: primaryRecommendation,
    descriptor_window: descriptorWindow,
    competitor_co_mentions: competitorCoMentions,
    citation_domain_classes: citationDomainClasses,
    answer_structure: answerStructure,
  };
}

async function updateRow(id: string, fields: ExtractedFields): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("prompt_answer_observations")
    .update(fields)
    .eq("id", id);
  if (error) throw new Error(`update ${id}: ${error.message}`);
}

async function main(): Promise<number> {
  const flags = parseArgs();
  console.log(
    `backfill-observation-extraction: dry-run=${flags.dryRun}, limit=${flags.limit ?? "none"}, force=${flags.force}`,
  );

  const entities = await fetchActiveEntities();
  const ctx = buildEntityContext(entities);
  console.log(
    `Entity context: ${entities.length} active entities, ${ctx.ownedNameVariants.length} owned-brand variants, ${ctx.ownedDomains.size} owned domains, brand="${ctx.brandCanonicalName}".`,
  );

  const rows = await fetchRowsToBackfill(flags.limit, flags.force);
  console.log(`Rows to backfill: ${rows.length}`);

  if (rows.length === 0) {
    console.log("Nothing to do. Exiting.");
    return 0;
  }

  let mentioned = 0;
  let cited = 0;
  let primary = 0;
  let descriptorsEmitted = 0;
  let coMentionsEmitted = 0;
  let citationsClassified = 0;
  const structureCounts = new Map<string, number>();
  let missingText = 0;
  let updated = 0;

  for (const row of rows) {
    if (!row.answer_text) {
      missingText += 1;
      continue;
    }
    const fields = extractForRow(row, ctx);
    if (fields.mention_position !== null) mentioned += 1;
    if (fields.citation_rank !== null) cited += 1;
    if (fields.primary_recommendation) primary += 1;
    if (fields.descriptor_window.length > 0) descriptorsEmitted += 1;
    if (fields.competitor_co_mentions.length > 0) coMentionsEmitted += 1;
    if (fields.citation_domain_classes.length > 0) citationsClassified += 1;
    if (fields.answer_structure) {
      structureCounts.set(
        fields.answer_structure,
        (structureCounts.get(fields.answer_structure) ?? 0) + 1,
      );
    }

    if (!flags.dryRun) {
      try {
        await updateRow(row.id, fields);
        updated += 1;
      } catch (err) {
        console.error(`Update failed for ${row.id}: ${String(err)}`);
      }
    }
  }

  console.log(`\nSummary:`);
  console.log(`  Rows processed:            ${rows.length}`);
  console.log(`  Rows missing text:         ${missingText}`);
  console.log(`  With brand mentioned:      ${mentioned}`);
  console.log(`  With brand cited:          ${cited}`);
  console.log(`  With primary recomm.:      ${primary}`);
  console.log(`  With descriptor window:    ${descriptorsEmitted}`);
  console.log(`  With co-mentions:          ${coMentionsEmitted}`);
  console.log(`  With classified citations: ${citationsClassified}`);
  console.log(
    `  Answer structure counts:   ${[...structureCounts.entries()].map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`,
  );
  if (flags.dryRun) {
    console.log(`  (dry-run — no rows written)`);
  } else {
    console.log(`  Rows updated:              ${updated}`);
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
