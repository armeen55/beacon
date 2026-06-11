import "server-only";

/**
 * 2026-06-11 (night shift, inventory #24) — competitor auto-seed.
 *
 * Discovery (`discoverCompetitorUniverse`) has existed for weeks but
 * was DISPLAY-ONLY: nothing ever wrote discovered rivals into
 * `competitor_config`, so a new tenant's /competitors stayed empty no
 * matter how much co-mention data its polls produced (Iranopedia: 8
 * AI-cited rivals discovered nightly, zero persisted).
 *
 * Nightly behavior (runs inside the generation job, live mode only):
 *   • DIRECT competitors only (directories/editorial/forums are not
 *     rivals); never the tenant's own domain; never an already-
 *     configured domain.
 *   • Caps at MAX_SEEDS_PER_NIGHT new rows per tenant per night —
 *     the universe grows deliberately, not in one dump.
 *   • Rows are tagged "auto-discovered" + dated in notes, so the
 *     operator can tell machine seeds from hand-picked rivals and
 *     prune freely.
 *   • Deterministic ids (sha1 of tenant::domain) → idempotent upserts;
 *     re-running a night never duplicates.
 */

import { createHash } from "node:crypto";

import { getBusinessConfig } from "@/lib/business-config";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { getRepository } from "@/lib/persistence/repositories";
import {
  discoverCompetitorUniverse,
  type DiscoveryResult,
} from "@/domains/competitors/discover";
import { getCachedCoMentionMatrix } from "@/domains/competitors/co-mention";
import {
  activeConfiguredDomainSet,
  loadCompetitorUniverseRuntime,
} from "@/domains/competitors/universe-read";

export const MAX_SEEDS_PER_NIGHT = 8;

export type CompetitorSeedRow = {
  id: string;
  tenant_id: string;
  display_name: string;
  domain: string;
  status: "active";
  notes: string;
  tags: string[];
};

function displayNameFromDomain(domain: string): string {
  const stem = domain.replace(/^www\./, "").split(".")[0] ?? domain;
  return stem
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

/** Pure selection: which discovered domains become config rows tonight. */
export function selectSeedCandidates(args: {
  discovery: Pick<DiscoveryResult, "direct">;
  existingDomains: ReadonlySet<string>;
  ownedDomain: string;
  tenantId: string;
  now: Date;
  max?: number;
}): CompetitorSeedRow[] {
  const max = args.max ?? MAX_SEEDS_PER_NIGHT;
  const owned = args.ownedDomain.toLowerCase().replace(/^www\./, "");
  const date = args.now.toISOString().slice(0, 10);
  const out: CompetitorSeedRow[] = [];
  const ranked = [...args.discovery.direct].sort(
    (a, b) => b.citations - a.citations,
  );
  for (const d of ranked) {
    const domain = d.domain.toLowerCase().replace(/^www\./, "");
    if (domain === owned) continue;
    if (args.existingDomains.has(domain)) continue;
    out.push({
      id: `cc-${createHash("sha1").update(`${args.tenantId}::${domain}`).digest("hex").slice(0, 12)}`,
      tenant_id: args.tenantId,
      display_name: displayNameFromDomain(domain),
      domain,
      status: "active",
      notes: `Auto-seeded ${date} from AI citation/co-mention discovery (${d.citations} citations observed).`,
      tags: ["auto-discovered"],
    });
    if (out.length >= max) break;
  }
  return out;
}

export type AutoSeedResult =
  | { seeded: number; domains: string[] }
  | { seeded: 0; skipped: "no_citation_data" | "no_direct_competitors" };

export type AutoSeedDeps = {
  loadDiscovery?: (tenantId: string) => Promise<{
    discovery: DiscoveryResult;
    existingDomains: Set<string>;
    ownedDomain: string;
  } | null>;
  upsertRows?: (rows: CompetitorSeedRow[]) => Promise<void>;
  now?: Date;
  max?: number;
};

async function defaultLoadDiscovery(tenantId: string) {
  const citationIndex = await getRepository()
    .forTenant(tenantId)
    .getCitationEvidenceIndex();
  if (!citationIndex || citationIndex.by_page_and_topic.length === 0) return null;

  const businessConfig = getBusinessConfig(tenantId);
  const coMentionMatrix = await getCachedCoMentionMatrix().catch(() => null);
  const runtime = await loadCompetitorUniverseRuntime();
  const existingDomains = new Set(
    [...activeConfiguredDomainSet(runtime)].map((d) =>
      d.toLowerCase().replace(/^www\./, ""),
    ),
  );

  const discovery = discoverCompetitorUniverse({
    citationIndex,
    coMentionMatrix,
    sourceTrustIndex: null,
    ownedDomain: businessConfig.domain,
    universeDomains: existingDomains,
    directoryDomains: businessConfig.directoryDomains ?? [],
  });
  return { discovery, existingDomains, ownedDomain: businessConfig.domain };
}

async function defaultUpsertRows(rows: CompetitorSeedRow[]): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("competitor_config")
    .upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`competitor_config upsert: ${error.message}`);
}

/** Seed newly discovered direct rivals into the tenant's universe. */
export async function autoSeedCompetitorsForTenant(
  tenantId: string,
  deps: AutoSeedDeps = {},
): Promise<AutoSeedResult> {
  const loaded = await (deps.loadDiscovery ?? defaultLoadDiscovery)(tenantId);
  if (loaded === null) return { seeded: 0, skipped: "no_citation_data" };

  const rows = selectSeedCandidates({
    discovery: loaded.discovery,
    existingDomains: loaded.existingDomains,
    ownedDomain: loaded.ownedDomain,
    tenantId,
    now: deps.now ?? new Date(),
    max: deps.max,
  });
  if (rows.length === 0) return { seeded: 0, skipped: "no_direct_competitors" };

  await (deps.upsertRows ?? defaultUpsertRows)(rows);
  return { seeded: rows.length, domains: rows.map((r) => r.domain) };
}
