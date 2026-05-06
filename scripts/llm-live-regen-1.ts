/**
 * LLM-LiveRegen-1 (operator audit, 2026-05-05) — first live persistence
 * round-trip after the LLM-DryRun-1/2/3 cycle.
 *
 * Hard scope:
 *   • Tenant: tenant-ritz-founder
 *   • Max 3 candidates (pinned by stableKey — no auto-discovery)
 *   • $1 hard budget cap on the harness side (independent of the
 *     existing monthly cap; the harness aborts BEFORE any call that
 *     would push cumulative spend over $1 or skip its own pre-flight).
 *   • Provider: openai (gpt-5-mini)
 *   • Persistence: ALLOWED only via the existing approved
 *     `runProviderAndPersist` orchestrator. The harness MUST NOT
 *     call writeStore, persistRecommendedEditsLocal, syncRecommendedEdits,
 *     or any dual-write helper directly. Rejected edits never reach
 *     persistence — that contract lives inside runProviderAndPersist
 *     (it maps `acceptedEdits` only).
 *
 * USAGE:
 *   OPENAI_API_KEY=... \
 *   BEACON_TENANT_ID=tenant-ritz-founder \
 *   BEACON_TENANT_SLUG=ritz-builders \
 *   BEACON_LLM_PROVIDER=openai \
 *   npx tsx --require ./scripts/mock-server-only.cjs \
 *   scripts/llm-live-regen-1.ts
 *
 * Halt-on-guardrail-trip semantics:
 *   The harness runs `inspectGuardrails` on every emitted edit and
 *   stops the loop on the first sign of: UUID leak, fabricated
 *   number/timeline/cost, competitor name in public copy,
 *   placeholder, or any unclear validator behavior. Persistence of
 *   the offending bundle has already happened by that point (the
 *   validator gates run inside runProviderAndPersist), so the report
 *   is the operator's signal to roll back. Subsequent candidates are
 *   NOT processed.
 *
 * SAFETY NET (also documented in the architecture invariant
 * `tests/architecture/llm-live-regen-1-allowlist.test.ts`):
 *   • Only writes via `runProviderAndPersist` (one persistence
 *     surface).
 *   • One structured-output JSON report under tmp/.
 *   • Tenant-mismatch gate runs first inside runProviderAndPersist
 *     (Phase 7.7d).
 *   • Pre-flight asserts no low-confidence / inventory-tier /
 *     weak_evidence candidate ever enters the loop.
 */

import "server-only";

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { currentTenantId } from "@/lib/tenant-context";
import {
  loadLiveRecommendationQueue,
  buildPacketForRec,
} from "@/domains/recommendations/load-queue";
import {
  runProviderAndPersist,
  type RunProviderAndPersistResult,
} from "@/domains/recommendations/recommended-edits-persistence";
import { openaiProvider } from "@/domains/recommendations/providers/openai";
import { containsUuid } from "@/domains/recommendations/copy-sanitize";
import type {
  SpecificEdit,
  SpecificEditEvidenceRef,
} from "@/domains/recommendations/specific-edit-provider";
import type { ResolvedRecommendationCandidate } from "@/domains/recommendations/resolved-types";
import type { SpecificEditEvidencePacket } from "@/domains/recommendations/specific-edit-evidence";

// --------------------------------------------------------------------------
// Hard scope (do not widen without operator approval)
// --------------------------------------------------------------------------

const TENANT_ID = "tenant-ritz-founder";
const BUDGET_CAP_USD = 1.0;
const ESTIMATE_PER_CALL_USD = 0.05; // Worst-case headroom; DryRun-2 averaged $0.013/sample.
const RESULTS_OUTPUT_PATH = join(
  process.cwd(),
  "tmp",
  "llm-live-regen-1-output.json",
);

/**
 * The 3 candidates locked by the operator brief. Selection criteria:
 *   resolution.confidence === "medium"
 *   AND resolution.tier === "observation"
 *   AND DryRun-2 quality "ship-as-is or minor-edit."
 *
 * Atherton is included even though DryRun-2 rejected 2/3 edits on the
 * em-dash gate — those rejections are exactly the validator working as
 * designed (clean rejection with a known reason). A live regeneration
 * that exercises that branch is more informative than skipping it.
 */
const PINNED_CANDIDATES: Array<{ stableKey: string; rationale: string }> = [
  {
    stableKey: "create_cluster_page:geo:Palo Alto",
    rationale:
      "Palo Alto location expansion (medium, observation, 5 affected prompts; DryRun-2 6/6 edits accepted, $0.0157 cost)",
  },
  {
    stableKey:
      "target_competitors:prompt:e17d29c3-eab3-4278-a3ea-4bd175692b36",
    rationale:
      "Bay-Area teardown/rebuild create_new_page (medium, observation, 1 prompt; DryRun-2 3/3 edits accepted, $0.0116)",
  },
  {
    stableKey: "create_cluster_page:geo:Atherton",
    rationale:
      "Atherton location expansion (medium, observation, 3 prompts; DryRun-2 1/3 accepted with 2 em-dash-displayLabel rejections — validator works as designed)",
  },
];

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function tag(s: string): string {
  return `[llm-live-regen-1] ${s}`;
}

type GuardrailFlag = {
  candidateKey: string;
  category:
    | "UUID_LEAK"
    | "PLACEHOLDER_LEAK"
    | "FABRICATED_NUMBER_OR_TIMELINE"
    | "COMPETITOR_NAME_IN_PUBLIC_COPY"
    | "RAW_PROMPT_ID_LEAK";
  field: string;
  excerpt: string;
  actionType: string;
};

function inspectGuardrails(
  candidateKey: string,
  edits: SpecificEdit[],
  packet: SpecificEditEvidencePacket,
): GuardrailFlag[] {
  const flags: GuardrailFlag[] = [];
  const promptIds = new Set(packet.affectedPrompts.map((p) => p.promptId));
  const competitors = packet.competitorAngles.map((c) =>
    c.competitorName.toLowerCase(),
  );

  for (const edit of edits) {
    const fields: Array<{ name: string; text: string }> = [
      { name: "displayLabel", text: edit.targetElement?.displayLabel ?? "" },
      { name: "proposedText", text: edit.targetElement?.proposedText ?? "" },
      { name: "currentText", text: edit.targetElement?.currentText ?? "" },
      { name: "expectedImpact", text: edit.expectedImpact ?? "" },
      { name: "measurementPlan", text: edit.measurementPlan ?? "" },
      { name: "why", text: edit.why ?? "" },
    ];
    for (const f of fields) {
      if (!f.text) continue;
      const lower = f.text.toLowerCase();

      if (
        /^draft answer/i.test(f.text) ||
        /\bdraft answer\b/i.test(f.text) ||
        /\boperator: rewrite\b/i.test(f.text) ||
        /\boperator rewrite\b/i.test(f.text) ||
        /\banchor on:/i.test(f.text) ||
        /\bTBD\b/.test(f.text) ||
        /\[insert/i.test(f.text) ||
        /\brewrite below\b/i.test(f.text)
      ) {
        flags.push({
          candidateKey,
          category: "PLACEHOLDER_LEAK",
          field: f.name,
          excerpt: f.text.slice(0, 160),
          actionType: edit.actionType,
        });
      }

      if (containsUuid(f.text)) {
        flags.push({
          candidateKey,
          category: "UUID_LEAK",
          field: f.name,
          excerpt: f.text.slice(0, 160),
          actionType: edit.actionType,
        });
      }

      // Specific-duration / per-square-foot / dollar-amount /
      // guarantee patterns — same regex set the DryRun-2 audit used.
      if (
        /\b\d+\s*(month|months|week|weeks|day|days|hour|hours|year|years)\b/i.test(
          f.text,
        ) ||
        /\bper\s+square\s+foot\b/i.test(f.text) ||
        /\bpsf\b/i.test(f.text) ||
        /\$\d/.test(f.text) ||
        /\bguarantee[ds]?\b/i.test(f.text) ||
        /\bwarranty period\b/i.test(f.text) ||
        /\bon\s+time(?:\s+and\s+under\s+budget)?\b/i.test(f.text)
      ) {
        // Allow numbers in the `why` field — operators expect counts
        // there ("topSearchQueries include 14× this week"). Public
        // copy fields are the ones that must stay number-free.
        if (
          f.name === "proposedText" ||
          f.name === "displayLabel" ||
          f.name === "expectedImpact"
        ) {
          flags.push({
            candidateKey,
            category: "FABRICATED_NUMBER_OR_TIMELINE",
            field: f.name,
            excerpt: f.text.slice(0, 160),
            actionType: edit.actionType,
          });
        }
      }

      // Raw-prompt-id leak (UUID-shaped) inside operator-visible copy
      // when the actual promptId from the packet appears verbatim.
      if (f.name !== "evidence") {
        for (const pid of promptIds) {
          if (f.text.includes(pid)) {
            flags.push({
              candidateKey,
              category: "RAW_PROMPT_ID_LEAK",
              field: f.name,
              excerpt: f.text.slice(0, 160),
              actionType: edit.actionType,
            });
            break;
          }
        }
      }

      // Competitor name in public proposedText / displayLabel only.
      // `why` is operator-visible attribution — competitor mentions
      // there are evidence, not public copy.
      if (
        (f.name === "proposedText" || f.name === "displayLabel") &&
        competitors.length > 0
      ) {
        for (const comp of competitors) {
          if (comp.length < 4) continue;
          if (lower.includes(comp)) {
            flags.push({
              candidateKey,
              category: "COMPETITOR_NAME_IN_PUBLIC_COPY",
              field: f.name,
              excerpt: f.text.slice(0, 160),
              actionType: edit.actionType,
            });
          }
        }
      }
    }
  }
  return flags;
}

type CandidateReport = {
  stableKey: string;
  rationale: string;
  candidate: {
    action: string;
    motive: string;
    targetUrl: string;
    confidence: string;
    tier: string;
    clusterLabel: string | null;
    clusterKind: string | null;
    affectedPromptCount: number;
  };
  packet: {
    affectedPromptCount: number;
    aiSearchSignalQueries: number;
    competitorPageBlueprintCount: number;
    brandAssertionCount: number;
    evidenceHash: string;
  };
  result: {
    ok: boolean;
    bundleErrorCount: number;
    totalGenerated: number;
    acceptedCount: number;
    rejectedCount: number;
    persisted: boolean;
    persistedRowIds: string[];
    persistedRowSummaries: Array<{
      id: string;
      actionType: string;
      targetUrl: string;
      displayLabel: string | null;
      proposedTextExcerpt: string | null;
    }>;
    rejectedDetails: Array<{
      actionType: string;
      field: string;
      reason: string;
    }>;
  };
  cost: {
    bundleCostUsd: number | null;
    cumulativeUsdAfter: number;
    underCap: boolean;
  };
  guardrails: GuardrailFlag[];
  haltedAfter: boolean;
};

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function runLiveRegen(): Promise<{
  exitCode: number;
  reports: CandidateReport[];
}> {
  console.log(tag("─────────────────────────────────────────────"));
  console.log(tag("LLM-LiveRegen-1 — first live persistence round-trip"));
  console.log(tag(`Tenant target: ${TENANT_ID}`));
  console.log(tag(`Budget cap (harness): $${BUDGET_CAP_USD.toFixed(2)}`));
  console.log(tag(`Provider: openai (gpt-5-mini)`));
  console.log(tag(`Persistence path: runProviderAndPersist (file + Supabase dual-write)`));
  console.log(tag("─────────────────────────────────────────────\n"));

  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.error(tag("ABORT: OPENAI_API_KEY not set."));
    return { exitCode: 1, reports: [] };
  }

  const ctxTenantId = await currentTenantId();
  if (ctxTenantId !== TENANT_ID) {
    console.error(
      tag(
        `ABORT: tenant mismatch — currentTenantId="${ctxTenantId}" but harness scoped to "${TENANT_ID}"`,
      ),
    );
    return { exitCode: 1, reports: [] };
  }
  console.log(tag(`Tenant resolved: ${ctxTenantId} ✓`));

  // Provider env sanity. resolveLLMProvider() inside runProviderAndPersist
  // reads BEACON_LLM_PROVIDER but we ALSO pass `provider: openaiProvider`
  // explicitly so we never accidentally route to deterministic.
  const providerEnv = process.env.BEACON_LLM_PROVIDER?.trim();
  console.log(
    tag(
      `BEACON_LLM_PROVIDER env: ${providerEnv ?? "(unset; using explicit openaiProvider arg)"}`,
    ),
  );

  // ── Load queue + lock the 3 candidates ─────────────────────────────────
  console.log(tag("Loading live recommendation queue…"));
  const live = await loadLiveRecommendationQueue({ tenantId: ctxTenantId });
  if (live.errors.length > 0) {
    console.warn(
      tag(`Queue loaded with ${live.errors.length} non-fatal warnings:`),
    );
    for (const e of live.errors) console.warn(tag(`  · ${e}`));
  }

  const candidates: ResolvedRecommendationCandidate[] = live.queue
    .filter((row) => Boolean(row.resolution))
    .map((row) => row as unknown as ResolvedRecommendationCandidate);
  console.log(tag(`Total candidates in queue: ${candidates.length}`));

  // Resolve PINNED_CANDIDATES → ResolvedRecommendationCandidate.
  type Pinned = {
    pin: (typeof PINNED_CANDIDATES)[number];
    resolved: ResolvedRecommendationCandidate;
  };
  const pinned: Pinned[] = [];
  for (const pin of PINNED_CANDIDATES) {
    const found = candidates.find((c) => c.stableKey === pin.stableKey);
    if (!found) {
      console.error(
        tag(
          `ABORT: pinned candidate "${pin.stableKey}" not found in live queue. Queue layout may have shifted since DryRun-2 — re-pick before live regen.`,
        ),
      );
      return { exitCode: 1, reports: [] };
    }
    pinned.push({ pin, resolved: found });
  }

  // ── Pre-flight gate: no low-conf / inventory / weak ────────────────────
  console.log(tag(""));
  console.log(tag("PRE-FLIGHT — selected candidates:"));
  for (const p of pinned) {
    const c = p.resolved;
    console.log(tag(`  · ${c.stableKey}`));
    console.log(tag(`      rationale: ${p.pin.rationale}`));
    console.log(
      tag(
        `      action=${c.resolution.action} targetUrl=${c.resolution.targetUrl}`,
      ),
    );
    console.log(
      tag(
        `      confidence=${c.resolution.confidence} tier=${c.resolution.tier} affectedPrompts=${c.affectedPromptIds.length}`,
      ),
    );
    if (c.resolution.confidence !== "medium") {
      console.error(
        tag(
          `ABORT: candidate "${c.stableKey}" confidence is "${c.resolution.confidence}", not "medium". Pinned set contains a non-medium candidate — re-check before live regen.`,
        ),
      );
      return { exitCode: 1, reports: [] };
    }
    if (c.resolution.tier !== "observation") {
      console.error(
        tag(
          `ABORT: candidate "${c.stableKey}" tier is "${c.resolution.tier}", not "observation". Pinned set contains a non-observation candidate — re-check.`,
        ),
      );
      return { exitCode: 1, reports: [] };
    }
  }
  console.log(tag(`Pre-flight passed: ${pinned.length} candidates, all medium-conf + observation-tier ✓`));

  // ── Run loop ───────────────────────────────────────────────────────────
  const reports: CandidateReport[] = [];
  let cumulative = 0;
  let exitCode = 0;
  let halt = false;

  for (let i = 0; i < pinned.length; i += 1) {
    const { pin, resolved } = pinned[i];
    console.log(tag(""));
    console.log(tag(`────── Candidate ${i + 1}/${pinned.length} ──────`));
    console.log(tag(`stableKey=${resolved.stableKey}`));
    console.log(tag(`action=${resolved.resolution.action}`));
    console.log(tag(`confidence=${resolved.resolution.confidence}`));
    console.log(tag(`tier=${resolved.resolution.tier}`));

    // Budget pre-call
    if (cumulative + ESTIMATE_PER_CALL_USD > BUDGET_CAP_USD) {
      console.error(
        tag(
          `BUDGET_ABORT: cumulative $${cumulative.toFixed(4)} + estimate $${ESTIMATE_PER_CALL_USD.toFixed(4)} > cap $${BUDGET_CAP_USD.toFixed(2)}. Halting BEFORE next call.`,
        ),
      );
      exitCode = 1;
      halt = true;
      break;
    }

    let packet: SpecificEditEvidencePacket;
    try {
      packet = buildPacketForRec({
        rec: resolved as unknown as Parameters<typeof buildPacketForRec>[0]["rec"],
        context: live,
        pageElementInventory: [],
        tenantId: ctxTenantId,
      });
    } catch (err) {
      console.error(
        tag(
          `Failed to build packet for ${resolved.stableKey}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      exitCode = 1;
      halt = true;
      break;
    }

    console.log(
      tag(
        `Packet: prompts=${packet.affectedPrompts.length} aiSignals=${packet.aiSearchSignal.topSearchQueries.length} blueprints=${packet.competitorPageBlueprints.length} brandAssertions=${packet.brandAssertions.length} hash=${packet.evidenceHash}`,
      ),
    );

    let result: RunProviderAndPersistResult;
    try {
      result = await runProviderAndPersist({
        provider: openaiProvider,
        packet,
        // Real persistence — file + Supabase dual-write.
        dryRun: false,
      });
    } catch (err) {
      console.error(
        tag(
          `runProviderAndPersist threw on ${resolved.stableKey}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      exitCode = 1;
      halt = true;
      break;
    }

    const bundleCost = result.bundle.totalCostUsd ?? 0;
    cumulative += bundleCost;
    const flags = inspectGuardrails(
      resolved.stableKey,
      result.acceptedRows.length > 0
        ? // The accepted rows are mapped from acceptedEdits; the
          // bundle still contains the originals. Inspect both the
          // emitted bundle (full output) AND the accepted edits
          // mapped back from validation. Bundle is the broader
          // surface.
          result.bundle.recommendations
        : result.bundle.recommendations,
      packet,
    );
    if (flags.length > 0) {
      console.warn(tag(`GUARDRAIL FLAGS (${flags.length}):`));
      for (const f of flags) {
        console.warn(
          tag(
            `  ⚠ ${f.category} in ${f.actionType}.${f.field}: ${f.excerpt}`,
          ),
        );
      }
      exitCode = Math.max(exitCode, 2);
      halt = true;
    }

    console.log(
      tag(
        `Bundle: edits=${result.totalGenerated} cost=$${bundleCost.toFixed(4)} cumulative=$${cumulative.toFixed(4)}`,
      ),
    );
    console.log(
      tag(
        `Validator: accepted=${result.acceptedCount} rejected=${result.rejectedCount} bundleErrors=${result.bundleErrors.length}`,
      ),
    );
    console.log(tag(`Persisted: ${result.persisted ? "YES" : "no"}`));
    console.log(tag(`Persisted row count: ${result.acceptedRows.length}`));
    if (result.rejectedCount > 0) {
      console.log(tag(`Rejected detail:`));
      for (const r of result.rejected) {
        if (!r.result.ok) {
          console.log(
            tag(
              `  · actionType=${r.edit.actionType} field=${r.result.field} reason=${r.result.reason}`,
            ),
          );
        }
      }
    }

    const candidateReport: CandidateReport = {
      stableKey: resolved.stableKey,
      rationale: pin.rationale,
      candidate: {
        action: resolved.resolution.action,
        motive: resolved.resolution.motive,
        targetUrl: resolved.resolution.targetUrl,
        confidence: resolved.resolution.confidence,
        tier: resolved.resolution.tier,
        clusterLabel: resolved.clusterLabel ?? null,
        clusterKind: resolved.clusterKind ?? null,
        affectedPromptCount: resolved.affectedPromptIds.length,
      },
      packet: {
        affectedPromptCount: packet.affectedPrompts.length,
        aiSearchSignalQueries: packet.aiSearchSignal.topSearchQueries.length,
        competitorPageBlueprintCount: packet.competitorPageBlueprints.length,
        brandAssertionCount: packet.brandAssertions.length,
        evidenceHash: packet.evidenceHash,
      },
      result: {
        ok: result.ok,
        bundleErrorCount: result.bundleErrors.length,
        totalGenerated: result.totalGenerated,
        acceptedCount: result.acceptedCount,
        rejectedCount: result.rejectedCount,
        persisted: result.persisted,
        persistedRowIds: result.acceptedRows.map((r) => r.id),
        persistedRowSummaries: result.acceptedRows.map((r) => ({
          id: r.id,
          actionType: r.action_type,
          targetUrl: r.target_url,
          displayLabel: r.display_label,
          proposedTextExcerpt: r.proposed_text
            ? r.proposed_text.slice(0, 200) + (r.proposed_text.length > 200 ? "…" : "")
            : null,
        })),
        rejectedDetails: result.rejected
          .map((p) => {
            if (p.result.ok) return null;
            return {
              actionType: p.edit.actionType,
              field: p.result.field,
              reason: p.result.reason,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null),
      },
      cost: {
        bundleCostUsd: bundleCost,
        cumulativeUsdAfter: cumulative,
        underCap: cumulative <= BUDGET_CAP_USD,
      },
      guardrails: flags,
      haltedAfter: halt,
    };
    reports.push(candidateReport);

    if (halt) {
      console.warn(
        tag(
          `Halt-after-flag: stopping the run after this candidate. Subsequent candidates NOT processed.`,
        ),
      );
      break;
    }
  }

  console.log(tag(""));
  console.log(tag("─────────────────────────────────────────────"));
  console.log(
    tag(
      `Total cost: $${cumulative.toFixed(4)} (cap $${BUDGET_CAP_USD.toFixed(2)})`,
    ),
  );
  console.log(
    tag(
      `Candidates processed: ${reports.length} / ${pinned.length}`,
    ),
  );
  console.log(
    tag(
      `Total persisted rows: ${reports.reduce(
        (acc, r) => acc + r.result.persistedRowIds.length,
        0,
      )}`,
    ),
  );
  console.log(
    tag(
      `Total guardrail flags: ${reports.reduce(
        (acc, r) => acc + r.guardrails.length,
        0,
      )}`,
    ),
  );
  console.log(tag(`Exit code: ${exitCode}`));
  console.log(tag("─────────────────────────────────────────────"));

  try {
    writeFileSync(
      RESULTS_OUTPUT_PATH,
      JSON.stringify(
        {
          tenantId: TENANT_ID,
          budgetCapUsd: BUDGET_CAP_USD,
          totalCostUsd: cumulative,
          candidateCount: reports.length,
          exitCode,
          reports,
        },
        null,
        2,
      ),
    );
    console.log(tag(`Wrote structured output: ${RESULTS_OUTPUT_PATH}`));
  } catch (err) {
    console.warn(
      tag(
        `Could not write ${RESULTS_OUTPUT_PATH}: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }

  return { exitCode, reports };
}

runLiveRegen()
  .then(({ exitCode }) => {
    process.exit(exitCode);
  })
  .catch((err) => {
    console.error(
      tag(`fatal: ${err instanceof Error ? err.message : String(err)}`),
    );
    process.exit(1);
  });
