/**
 * LLM-LiveRegen-2 candidate discovery — read-only.
 *
 * Loads the live recommendation queue and prints every candidate with
 * stableKey, resolution, tier, affectedPromptCount, plus a hint of
 * which "slot" the candidate would fall into so the operator can pick
 * a 5–10-candidate slate that avoids the 3 LiveRegen-1 picks (Palo
 * Alto, Bay Area teardown, Atherton) and the abstention pair (Los
 * Altos low-conf, Menlo Park low-conf weak).
 *
 * USAGE:
 *   BEACON_TENANT_ID=tenant-ritz-founder \
 *     BEACON_TENANT_SLUG=ritz-builders \
 *     npx tsx --require ./scripts/mock-server-only.cjs \
 *     scripts/llm-live-regen-2-discover.ts
 *
 * No provider call. No persistence. No queue mutation. Pure read.
 */

import "server-only";

import { currentTenantId } from "@/lib/tenant-context";
import { loadLiveRecommendationQueue } from "@/domains/recommendations/load-queue";
import type { ResolvedRecommendationCandidate } from "@/domains/recommendations/resolved-types";

const LIVE_REGEN_1_KEYS = new Set([
  "create_cluster_page:geo:Palo Alto",
  "target_competitors:prompt:e17d29c3-eab3-4278-a3ea-4bd175692b36",
  "create_cluster_page:geo:Atherton",
]);

async function main(): Promise<void> {
  const tenantId = await currentTenantId();
  console.log(`[discover] Tenant: ${tenantId}`);

  const live = await loadLiveRecommendationQueue({ tenantId });
  if (live.errors.length > 0) {
    for (const e of live.errors) console.warn(`[discover] WARN ${e}`);
  }

  const candidates: ResolvedRecommendationCandidate[] = live.queue
    .filter((row) => Boolean(row.resolution))
    .map((row) => row as unknown as ResolvedRecommendationCandidate);

  console.log(`[discover] Total candidates: ${candidates.length}\n`);

  // Sort: medium-conf observation-tier first (best LiveRegen-2 candidates),
  // then everything else.
  const sorted = candidates.slice().sort((a, b) => {
    const score = (c: ResolvedRecommendationCandidate) => {
      const conf =
        c.resolution.confidence === "high"
          ? 0
          : c.resolution.confidence === "medium"
            ? 1
            : 2;
      const tier =
        c.resolution.tier === "adjudicated"
          ? 0
          : c.resolution.tier === "observation"
            ? 1
            : 2;
      return conf * 100 + tier * 10;
    };
    return score(a) - score(b);
  });

  console.log(
    `idx  | conf   | tier        | action                  | prompts | clusterKind | clusterLabel                          | stableKey`,
  );
  console.log(
    `-----+--------+-------------+-------------------------+---------+-------------+---------------------------------------+----------------------------------------------------`,
  );
  sorted.forEach((c, i) => {
    const liveRegen1 = LIVE_REGEN_1_KEYS.has(c.stableKey) ? " ✗(LR-1)" : "";
    const lowConf = c.resolution.confidence === "low" ? " ⚠(low)" : "";
    const inventory =
      c.resolution.tier === "inventory" ? " ⚠(inv)" : "";
    const flags = `${liveRegen1}${lowConf}${inventory}`.trim();
    console.log(
      [
        String(i + 1).padStart(3, " "),
        (c.resolution.confidence ?? "?").padEnd(6, " "),
        (c.resolution.tier ?? "?").padEnd(11, " "),
        (c.resolution.action ?? "?").padEnd(23, " "),
        String(c.affectedPromptIds.length).padStart(7, " "),
        (c.clusterKind ?? "—").padEnd(11, " "),
        (c.clusterLabel ?? "—").padEnd(37, " "),
        c.stableKey + (flags ? `  ${flags}` : ""),
      ].join(" | "),
    );
  });

  console.log(`\n[discover] Action-type breakdown:`);
  const byAction = new Map<string, number>();
  for (const c of candidates) {
    const a = c.resolution.action;
    byAction.set(a, (byAction.get(a) ?? 0) + 1);
  }
  for (const [action, count] of [...byAction.entries()].sort()) {
    console.log(`  · ${action}: ${count}`);
  }

  console.log(`\n[discover] Eligible for LiveRegen-2 (medium+ confidence, observation+ tier, NOT in LiveRegen-1):`);
  const eligible = candidates.filter(
    (c) =>
      c.resolution.confidence !== "low" &&
      c.resolution.tier !== "inventory" &&
      !LIVE_REGEN_1_KEYS.has(c.stableKey),
  );
  for (const c of eligible) {
    console.log(
      `  · ${c.stableKey}  (${c.resolution.confidence}/${c.resolution.tier}, action=${c.resolution.action}, prompts=${c.affectedPromptIds.length}, clusterKind=${c.clusterKind ?? "—"})`,
    );
  }
  console.log(`[discover] ${eligible.length} eligible candidates total`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[discover] fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
