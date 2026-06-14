/**
 * Section 6 C6a (2026-05-15) — server loader for the Changes detail
 * primary-recommendation evidence sub-line.
 *
 * Pipeline:
 *
 *   1. Dedup `recommendedEdit.evidence` prompt refs into a set of
 *      `affectedPromptIds` (R2 Blocker 3 lock).
 *   2. Short-circuit when `recommendedEdit.live_at == null` — return a
 *      silent default WITHOUT calling `getRepository()`. Pinned by the
 *      loader runtime test.
 *   3. Otherwise wrap the rest in `unstable_cache`:
 *        key:        ["change-primary-evidence:v1", tenantId, recommendedEdit.id,
 *                     recommendedEdit.live_at ?? "no-live"]
 *        revalidate: 60 * 60 * 6   (6h TTL per H7)
 *        tags:       [`recommended_edits:${tenantId}`]
 *   4. Inside the cache body: bind the tenant-scoped repo, read post-
 *      `live_at` observations + snapshots from `live_at - 14d`, invoke
 *      the three pure helpers, return composite result.
 *
 * Tenant isolation: this module IS the tenant-binding boundary. The
 * pure helpers stay free of `getRepository`; this loader holds the
 * single `getRepository().forTenant(tenantId)` call. Architecture
 * invariant `tests/architecture/change-primary-evidence-loader-tenant-scope.test.ts`
 * pins the import + the binding pattern + the cache-key shape.
 *
 * Note on `now`: NOT included in the cache key. The 6h TTL bounds the
 * staleness window. Adding `now` would defeat the cache entirely
 * (every request gets a fresh timestamp). Tests pass `now` for
 * determinism but only inside the (mocked) cache body.
 */

import { unstable_cache } from "next/cache";
import { getRepository } from "@/lib/persistence/repositories";
import { computeChangePrimaryModeA } from "./change-primary-mode-a";
import {
  computeChangePrimaryModeB,
  type ChangePrimaryModeBPerPlatformResult,
  type ChangePrimaryModeBResult,
} from "./change-primary-mode-b";
import {
  renderChangePrimaryCopy,
  type RenderChangePrimaryCopyResult,
} from "./change-primary-evidence-copy";
import type { ChangePrimaryModeAResult } from "./change-primary-mode-a";
import type { LifecycleStage } from "./lifecycle-stage";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

const MS_PER_DAY = 86_400_000;
const PRE_WINDOW_DAYS = 14;

export type LoadChangePrimaryEvidenceArgs = {
  tenantId: string;
  recommendedEdit: RecommendedEditRow;
  brandName: string;
  lifecycleStage: LifecycleStage | null;
  now?: Date | string;
};

export type LoadChangePrimaryEvidenceResult = {
  available: boolean;
  lines: string[] | null;
  raw: {
    modeA: ChangePrimaryModeAResult;
    modeB: ChangePrimaryModeBResult;
  };
};

function toUtcDateString(input: Date | string | null | undefined): string | null {
  if (input == null) return null;
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function addUtcDays(dateIso: string, days: number): string {
  const baseMs = Date.UTC(
    Number(dateIso.slice(0, 4)),
    Number(dateIso.slice(5, 7)) - 1,
    Number(dateIso.slice(8, 10)),
  );
  return new Date(baseMs + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function silentModeAResult(): ChangePrimaryModeAResult {
  return {
    status: "silent",
    cited_here_count: 0,
    primary_count: 0,
    primary_share_pct: null,
  };
}

function silentModeBPerPlatform(): ChangePrimaryModeBPerPlatformResult {
  return {
    status: "silent",
    pre_count: 0,
    pre_total: 0,
    pre_share_pct: null,
    post_count: 0,
    post_total: 0,
    post_share_pct: null,
    delta_pp: null,
  };
}

function silentModeBResult(): ChangePrimaryModeBResult {
  return {
    per_platform: {
      chatgpt: silentModeBPerPlatform(),
      perplexity: silentModeBPerPlatform(),
    },
  };
}

/** Pull deduped affected prompt IDs from a recommended edit's evidence refs. */
function deriveAffectedPromptIds(
  recommendedEdit: RecommendedEditRow,
): string[] {
  const ids = new Set<string>();
  for (const ref of recommendedEdit.evidence) {
    if (ref.type === "prompt" && typeof ref.promptId === "string") {
      ids.add(ref.promptId);
    }
  }
  return Array.from(ids);
}

export async function loadChangePrimaryEvidence(
  args: LoadChangePrimaryEvidenceArgs,
): Promise<LoadChangePrimaryEvidenceResult> {
  const { tenantId, recommendedEdit, brandName, lifecycleStage } = args;
  const now = args.now ?? new Date();

  // 1. Dedup affected prompt IDs (R2 Blocker 3).
  const affectedPromptIds = deriveAffectedPromptIds(recommendedEdit);

  // 2. live_at null short-circuit — no repo call at all.
  if (recommendedEdit.live_at == null) {
    return {
      available: false,
      lines: null,
      raw: {
        modeA: silentModeAResult(),
        modeB: silentModeBResult(),
      },
    };
  }

  // 3. Cached fetch + compute.
  const cacheKey = [
    "change-primary-evidence:v1",
    tenantId,
    recommendedEdit.id,
    recommendedEdit.live_at ?? "no-live",
    // audit #21 (2026-06-14): lifecycleStage is an INPUT to the computed
    // copy but was absent from the key, so a page that gets its first
    // citation while cached as "stuck" served stale null-evidence copy for
    // the whole TTL. Key on it so a stage transition busts the cache.
    lifecycleStage ?? "no-stage",
  ];

  const cached = unstable_cache(
    async () => {
      const repo = getRepository().forTenant(tenantId);

      const liveAtDateIso = toUtcDateString(recommendedEdit.live_at);
      const pre14DateIso =
        liveAtDateIso != null
          ? addUtcDays(liveAtDateIso, -PRE_WINDOW_DAYS)
          : null;

      const [obs, snaps] = await Promise.all([
        repo.getPromptAnswerObservations(
          liveAtDateIso ? { since: liveAtDateIso } : undefined,
        ),
        repo.getDailyMetricSnapshots(
          pre14DateIso ? { since: pre14DateIso } : undefined,
        ),
      ]);

      const modeA = computeChangePrimaryModeA({
        recommendedEdit,
        promptAnswerObservations: obs,
        now,
      });
      const modeB = computeChangePrimaryModeB({
        recommendedEdit,
        affectedPromptIds,
        snapshots: snaps,
        now,
      });
      const copy: RenderChangePrimaryCopyResult | null =
        renderChangePrimaryCopy({
          modeA,
          modeB,
          brandName,
          lifecycleStage,
        });
      return {
        modeA,
        modeB,
        lines: copy?.lines ?? null,
      };
    },
    cacheKey,
    {
      // H7 6h TTL pinned inline so the source-text invariant
      // (`change-primary-evidence-loader-tenant-scope.test.ts`) can
      // detect future drift without name aliasing.
      revalidate: 60 * 60 * 6,
      tags: [`recommended_edits:${tenantId}`],
    },
  );

  const result = await cached();
  return {
    available: result.lines != null,
    lines: result.lines,
    raw: { modeA: result.modeA, modeB: result.modeB },
  };
}
