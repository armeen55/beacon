/**
 * Profound topic-gap signal loader (2026-06-14) — the I/O layer for the
 * `profound-aeo-gap` trigger. Reads the tenant's ALREADY-SYNCED
 * `profound_visibility_rows` (the nightly Profound pull — this module
 * NEVER calls the Profound API) and aggregates them into one signal per
 * Profound topic (category): the tenant's own answer-engine presence vs
 * the strongest competitor's, plus how many AI answers were observed.
 *
 * Mirrors gsc-page-signals.ts: this module
 * does the Supabase read; the predicate (triggers/profound-aeo-gap.ts)
 * stays pure over the pre-loaded signal (pinned by
 * `recommendation-trigger-predicates-purity`).
 *
 * WHAT THE SYNC GIVES US (migrations/2026-06-12_profound_rows.sql):
 *   profound_visibility_rows(tenant_id, category_id, date, model,
 *     asset_name, visibility_score, share_of_voice, mentions_count,
 *     executions, pulled_at) — PK (tenant,category,date,model,asset).
 *   `asset_name` is a BRAND display name and covers BOTH the tenant's
 *   own brand AND its competitors inside each category (topic). So a
 *   topic where competitor assets carry mentions while the tenant's own
 *   asset is absent/near-zero — over a meaningful number of observed AI
 *   answers (`executions`) — is a clean, sourced AEO gap.
 *
 * Own-asset identification is deterministic and config-driven (no
 * hardcoding): an asset_name is "owned" when its normalized form
 * matches the tenant's BusinessConfig brand name (or its first word, or
 * the domain host) — the SAME ownership-by-brand-name convention the
 * Profound import + today visibility read-model already use. Passed in
 * as `ownAliases` so this module needs no business-config import.
 *
 * Fail-soft: missing table / no rows / Supabase error → empty Map. No
 * key connected simply means the predicate never fires.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";

/** One Profound topic (category) rolled up over the synced window. */
export type ProfoundTopicSignal = {
  /** Profound category id (stable topic key; also the dedupe key). */
  categoryId: string;
  /** AI answers observed for the topic over the window (max across the
   *  competing assets — `executions` is per-asset in the source). The
   *  presence floor: don't emit on a topic with thin observation. */
  executions: number;
  /** The tenant's own brand mentions across the topic (0 when absent). */
  ownMentions: number;
  /** The tenant's own share-of-voice (0–1 fraction) across the topic. */
  ownShareOfVoice: number;
  /** Distinct AI models the topic was observed on (evidence breadth). */
  modelCount: number;
  /** The strongest NON-owned asset on the topic by mentions, or null. */
  topCompetitor: {
    assetName: string;
    mentions: number;
    shareOfVoice: number;
  } | null;
};

/** Bounded read — a tenant's 3-day visibility window is at most
 *  categories × models × assets × 3 rows; small. The cap is a safety
 *  net, paged so nothing truncates silently. */
const MAX_ROWS = 50_000;
const PAGE_SIZE = 1_000;

/** Normalize a brand/asset name for owned-vs-not comparison: lowercase,
 *  collapse whitespace, strip surrounding punctuation. Pure. */
function normName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, " ")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

/**
 * Build the normalized owned-alias set the loader uses to classify
 * each `asset_name`. Pure; mirrors the import-orchestrator's union of
 * (brand name, first word) — extended with the domain host so a Profound
 * asset rendered as a domain ("iranopedia.com") still classifies owned.
 */
export function buildOwnAliasSet(args: {
  brandName: string | null | undefined;
  domain: string | null | undefined;
}): Set<string> {
  const out = new Set<string>();
  const add = (s: string) => {
    const n = normName(s);
    if (n.length >= 3) out.add(n);
  };
  if (args.brandName) {
    add(args.brandName);
    const first = args.brandName.trim().split(/\s+/)[0];
    if (first && first !== args.brandName) add(first);
  }
  if (args.domain) {
    const host = args.domain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "");
    if (host) {
      add(host);
      // bare label before the TLD ("iranopedia" from "iranopedia.com")
      const label = host.split(".")[0];
      if (label && label !== host) add(label);
    }
  }
  return out;
}

/** Is this asset the tenant's own brand? Exact normalized match against
 *  any owned alias (substring matching would over-claim ownership). Pure. */
function isOwnedAsset(assetName: string, ownAliases: ReadonlySet<string>): boolean {
  return ownAliases.has(normName(assetName));
}

type Row = {
  category_id: string;
  model: string;
  asset_name: string;
  share_of_voice: number;
  mentions_count: number;
  executions: number;
};

/** Per-asset accumulator within a topic. */
type AssetAcc = { mentions: number; sovWeighted: number; sovWeight: number };

/**
 * Aggregate the tenant's synced visibility rows into per-topic signals.
 * `ownAliases` is the normalized owned-brand alias set (see
 * buildOwnAliasSet) — passed in so this module stays business-config-free.
 * Tenant-scoped: every read is filtered by `tenant_id`.
 */
export async function loadProfoundTopicSignalsForTenant(
  tenantId: string,
  ownAliases: ReadonlySet<string>,
): Promise<Map<string, ProfoundTopicSignal>> {
  const out = new Map<string, ProfoundTopicSignal>();

  const rows: Row[] = [];
  try {
    const sb = getSupabaseAdmin();
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await sb
        .from("profound_visibility_rows")
        .select("category_id, model, asset_name, share_of_voice, mentions_count, executions")
        .eq("tenant_id", tenantId)
        .order("category_id")
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        log.warn("[profound-topic-signals] read failed", {
          tenantId,
          offset,
          error: error.message,
        });
        break;
      }
      const batch = (data ?? []) as unknown as Row[];
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
  } catch {
    return out;
  }
  if (rows.length === 0) return out;

  // Roll up: per topic → per asset (mentions + impressions-weighted SoV),
  // plus the topic's executions (max across assets/models — executions is
  // the per-asset "answers observed" count) and distinct model set.
  type TopicAgg = {
    executions: number;
    models: Set<string>;
    assets: Map<string, AssetAcc>;
  };
  const byTopic = new Map<string, TopicAgg>();
  for (const r of rows) {
    if (!r.category_id) continue;
    let t = byTopic.get(r.category_id);
    if (!t) {
      t = { executions: 0, models: new Set(), assets: new Map() };
      byTopic.set(r.category_id, t);
    }
    const exec = Number(r.executions) || 0;
    if (exec > t.executions) t.executions = exec;
    if (r.model) t.models.add(r.model);
    const name = r.asset_name ?? "";
    if (!name) continue;
    let a = t.assets.get(name);
    if (!a) {
      a = { mentions: 0, sovWeighted: 0, sovWeight: 0 };
      t.assets.set(name, a);
    }
    const mentions = Number(r.mentions_count) || 0;
    const sov = Number(r.share_of_voice) || 0;
    a.mentions += mentions;
    // SoV is a per-row fraction; weight by executions so a topic seen on
    // many answers dominates a one-off. Fall back to unit weight when a
    // row reports no executions, so SoV is never silently dropped.
    const w = exec > 0 ? exec : 1;
    a.sovWeighted += sov * w;
    a.sovWeight += w;
  }

  for (const [categoryId, t] of byTopic) {
    let ownMentions = 0;
    let ownSov = 0;
    let topCompetitor: ProfoundTopicSignal["topCompetitor"] = null;
    for (const [assetName, a] of t.assets) {
      const sov = a.sovWeight > 0 ? a.sovWeighted / a.sovWeight : 0;
      if (isOwnedAsset(assetName, ownAliases)) {
        ownMentions += a.mentions;
        ownSov = Math.max(ownSov, sov);
        continue;
      }
      if (topCompetitor == null || a.mentions > topCompetitor.mentions) {
        topCompetitor = { assetName, mentions: a.mentions, shareOfVoice: sov };
      }
    }
    out.set(categoryId, {
      categoryId,
      executions: t.executions,
      ownMentions,
      ownShareOfVoice: ownSov,
      modelCount: t.models.size,
      topCompetitor,
    });
  }

  return out;
}
