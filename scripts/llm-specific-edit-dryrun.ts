/**
 * LLM specific-edit dry-run harness (operator-scoped, 2026-05-05).
 *
 * Originally landed for LLM-DryRun-1; re-used unchanged for LLM-DryRun-2
 * (validator + SYSTEM_PROMPT tightening) and any future iteration. The
 * harness is dry-run-only by construction — it calls
 * `openaiProvider.generate(packet)` against representative packets, runs
 * `validateSpecificEditBundle`, prints the raw output for human scoring,
 * and writes a structured JSON report. It NEVER persists generated
 * edits to the queue or to Supabase.
 *
 * USAGE:
 *   OPENAI_API_KEY=$OPENAI_API_KEY \
 *     BEACON_TENANT_ID=tenant-ritz-founder \
 *     BEACON_TENANT_SLUG=ritz-builders \
 *     npx tsx --require ./scripts/mock-server-only.cjs \
 *     scripts/llm-specific-edit-dryrun.ts
 *
 * Optionally set `BEACON_DRYRUN_OUTPUT` to override the structured-output
 * path (default: tmp/llm-specific-edit-dryrun-output.json).
 *
 * HARD RULES (locked by code, not just convention):
 *   - Calls openaiProvider.generate() ONLY. Never runProviderAndPersist.
 *     Never writeStore. Never syncRecommendedEdits. Never mutates the
 *     queue. Never touches Supabase outside the read path the queue
 *     loader already uses. Pinned by
 *     `tests/architecture/llm-dryrun-harness-no-persistence.test.ts`.
 *   - Budget: hard cap $3 total. Aborts BEFORE any call that would
 *     push the projected total over $3.
 *   - Selection: 5 candidates matching:
 *       1. resolution.action === "create_new_page"
 *       2. resolution.action === "add_section_or_faq" (H2 / FAQ)
 *       3. packet.allowedActionTypes includes "add_schema" / "fix_schema"
 *       4. clusterKind === "geo" (location-page expansion)
 *       5. WEAK evidence — affectedPromptIds.length <= 1 OR resolution
 *          tier === "deterministic_only" (should abstain)
 *     If fewer than 5 distinct slots match, the report says so honestly.
 *
 * SAFETY NET:
 *   - Process exits 0 even if OpenAI rejects a packet — the dry-run is
 *     a read-only experiment; failures are data, not errors.
 *   - Process exits 1 on missing API key or budget abort BEFORE the
 *     first call.
 *   - Process exits 2 on a guardrail-trip during validation (placeholder
 *     leak, UUID leak, etc.) so CI / operator can see the safety
 *     signal.
 */

import "server-only";

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { currentTenantId } from "@/lib/tenant-context";
import {
  loadLiveRecommendationQueue,
  buildPacketForRec,
} from "@/domains/recommendations/load-queue";
import { openaiProvider } from "@/domains/recommendations/providers/openai";
import { validateSpecificEditBundle } from "@/domains/recommendations/specific-edit-validator";
import { containsUuid } from "@/domains/recommendations/copy-sanitize";
import type {
  SpecificEditBundle,
  SpecificEdit,
} from "@/domains/recommendations/specific-edit-provider";
import type { ResolvedRecommendationCandidate } from "@/domains/recommendations/resolved-types";
import type { SpecificEditEvidencePacket } from "@/domains/recommendations/specific-edit-evidence";

// Default budget cap; can be tightened (never widened) via
// BEACON_DRYRUN_BUDGET_CAP_USD env var. LLM-DryRun-3 (2026-05-05) runs
// at $1 per operator brief; the default $3 is for full 5-slot runs.
const DEFAULT_BUDGET_CAP_USD = 3.0;
const BUDGET_CAP_USD = (() => {
  const raw = process.env.BEACON_DRYRUN_BUDGET_CAP_USD?.trim();
  if (!raw) return DEFAULT_BUDGET_CAP_USD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BUDGET_CAP_USD;
  // Never allow a wider cap than the default — the env var is a
  // tightener, not a bypass.
  return Math.min(parsed, DEFAULT_BUDGET_CAP_USD);
})();
const RESULTS_OUTPUT_PATH =
  process.env.BEACON_DRYRUN_OUTPUT?.trim() ||
  join(process.cwd(), "tmp", "llm-specific-edit-dryrun-output.json");
// Optional slot filter: comma-separated list of slot names. When set,
// only those slots are picked. Used by LLM-DryRun-3 to re-run just the
// two abstention candidates (`location_geo,weak_evidence`).
const SLOT_FILTER: ReadonlySet<string> | null = (() => {
  const raw = process.env.BEACON_DRYRUN_ONLY_SLOTS?.trim();
  if (!raw) return null;
  const tokens = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return tokens.length > 0 ? new Set(tokens) : null;
})();

type SlotName =
  | "create_page"
  | "h2_or_faq"
  | "schema_or_technical"
  | "location_geo"
  | "weak_evidence";

type SlotSelection = {
  slot: SlotName;
  // `LiveRecQueueItem` extends `PrioritizedRecommendation & { engineConfidence }`.
  // The .resolution field is attached by the resolver upstream; for slot
  // picking we only need the candidate-shape fields + .resolution.
  candidate: ResolvedRecommendationCandidate;
  why: string;
};

type SampleResult = {
  slot: SlotName;
  why: string;
  candidate: {
    stableKey: string;
    clusterLabel: string | null;
    clusterKind: string | null;
    action: string;
    motive: string;
    targetUrl: string;
    confidence: string;
    affectedPromptCount: number;
    tier: string;
  };
  packetSummary: {
    affectedPromptCount: number;
    ownedPageCandidateCount: number;
    targetPageElementCount: number;
    competitorAngleCount: number;
    aiSearchSignalCount: number;
    competitorPageBlueprintCount: number;
    brandAssertionCount: number;
    allowedActionTypes: string[];
    allowedTargetUrls: string[];
    evidenceHash: string;
  };
  bundle: {
    providerName: string;
    model: string | null;
    totalCostUsd: number | null;
    editCount: number;
  };
  edits: Array<{
    actionType: string;
    targetUrl: string;
    elementKey: string | null;
    displayLabel: string | null;
    proposedText: string | null;
    currentText: string | null;
    why: string;
    expectedImpact: string | null;
    measurementPlan: string | null;
    confidence: string;
    difficulty: string;
    evidenceCount: number;
    evidenceTypes: string[];
  }>;
  validator: {
    accepted: number;
    rejected: number;
    bundleErrors: number;
    rejectedDetails: Array<{
      actionType: string;
      field: string;
      reason: string;
    }>;
  };
  guardrailFlags: string[];
};

function tag(s: string): string {
  return `[llm-specific-edit-dryrun] ${s}`;
}

function pickFiveSlots(
  candidates: ResolvedRecommendationCandidate[],
): SlotSelection[] {
  const pickedKeys = new Set<string>();
  const picks: SlotSelection[] = [];

  // Slot 1: create_new_page
  const createCandidate = candidates.find(
    (c) =>
      c.resolution.action === "create_new_page" &&
      !pickedKeys.has(c.stableKey),
  );
  if (createCandidate) {
    picks.push({
      slot: "create_page",
      candidate: createCandidate,
      why: 'resolution.action === "create_new_page"',
    });
    pickedKeys.add(createCandidate.stableKey);
  }

  // Slot 2: H2 or FAQ — action is `add_section_or_faq` or
  // `expand_existing_page` (which often emits add_h2_section)
  const h2Candidate = candidates.find(
    (c) =>
      (c.resolution.action === "add_section_or_faq" ||
        c.resolution.action === "expand_existing_page" ||
        c.resolution.action === "strengthen_existing_page") &&
      !pickedKeys.has(c.stableKey),
  );
  if (h2Candidate) {
    picks.push({
      slot: "h2_or_faq",
      candidate: h2Candidate,
      why: `resolution.action === "${h2Candidate.resolution.action}"`,
    });
    pickedKeys.add(h2Candidate.stableKey);
  }

  // Slot 3: schema/technical — find a candidate with NEEDS_NEW_PAGE or
  // an owned page that's a brand/policy page (often where schema live).
  // Heuristically pick one that's not already chosen and falls under
  // strengthen / expand for an existing page.
  const schemaCandidate = candidates.find(
    (c) =>
      !pickedKeys.has(c.stableKey) &&
      (c.resolution.targetUrl.includes("/about") ||
        c.resolution.targetUrl.includes("/services") ||
        c.resolution.targetUrl === "/" ||
        c.resolution.targetUrl.includes("/locations")),
  );
  if (schemaCandidate) {
    picks.push({
      slot: "schema_or_technical",
      candidate: schemaCandidate,
      why: `targetUrl=${schemaCandidate.resolution.targetUrl} (brand / policy / service / locations page — natural schema candidate)`,
    });
    pickedKeys.add(schemaCandidate.stableKey);
  }

  // Slot 4: geo cluster
  const geoCandidate = candidates.find(
    (c) => c.clusterKind === "geo" && !pickedKeys.has(c.stableKey),
  );
  if (geoCandidate) {
    picks.push({
      slot: "location_geo",
      candidate: geoCandidate,
      why: `clusterKind === "geo" (label="${geoCandidate.clusterLabel ?? ""}")`,
    });
    pickedKeys.add(geoCandidate.stableKey);
  }

  // Slot 5: weak/thin evidence
  const weakCandidate = candidates.find(
    (c) =>
      !pickedKeys.has(c.stableKey) &&
      (c.affectedPromptIds.length <= 1 ||
        c.resolution.tier === "deterministic_only" ||
        c.resolution.confidence === "low"),
  );
  if (weakCandidate) {
    picks.push({
      slot: "weak_evidence",
      candidate: weakCandidate,
      why: `affectedPromptIds=${weakCandidate.affectedPromptIds.length}, tier=${weakCandidate.resolution.tier}, confidence=${weakCandidate.resolution.confidence}`,
    });
    pickedKeys.add(weakCandidate.stableKey);
  }

  // Apply slot filter (BEACON_DRYRUN_ONLY_SLOTS) AFTER full picking so
  // each slot still selects against the same candidate pool it would
  // have otherwise — the picks are identical, we just emit a subset.
  // This matters for reproducibility: re-running DryRun-3 on slots 4+5
  // must select the EXACT same Los Altos + Menlo Park candidates that
  // DryRun-2 picked, even though slots 1-3 are skipped.
  if (SLOT_FILTER) {
    return picks.filter((p) => SLOT_FILTER.has(p.slot));
  }

  return picks;
}

function inspectGuardrails(
  edits: SpecificEdit[],
  packet: SpecificEditEvidencePacket,
): string[] {
  const flags: string[] = [];

  // Build promptId set + competitor name set for cross-checks
  const promptIds = new Set(packet.affectedPrompts.map((p) => p.promptId));
  const competitors = packet.competitorAngles.map((c) =>
    c.competitorName.toLowerCase(),
  );

  for (const edit of edits) {
    const visibleStrings: string[] = [
      edit.targetElement?.proposedText ?? "",
      edit.targetElement?.currentText ?? "",
      edit.targetElement?.displayLabel ?? "",
      edit.expectedImpact ?? "",
      edit.measurementPlan ?? "",
      edit.why ?? "",
    ];

    for (const txt of visibleStrings) {
      if (!txt) continue;
      const lower = txt.toLowerCase();

      // Placeholder leak
      if (
        /^draft answer/i.test(txt) ||
        /\bdraft answer\b/i.test(txt) ||
        /\boperator: rewrite\b/i.test(txt) ||
        /\boperator rewrite\b/i.test(txt) ||
        /\banchor on:/i.test(txt) ||
        /\bTBD\b/.test(txt) ||
        /\[insert/i.test(txt) ||
        /\brewrite below\b/i.test(txt)
      ) {
        flags.push(`PLACEHOLDER_LEAK in ${edit.actionType}: ${txt.slice(0, 120)}`);
      }

      // Raw UUID leak
      if (containsUuid(txt)) {
        flags.push(`UUID_LEAK in ${edit.actionType}: ${txt.slice(0, 120)}`);
      }

      // Raw prompt-id leak (non-UUID prefixed forms like cl-mogXXX)
      if (
        /\b(cl|prompt)[-:]\s*[a-z0-9]{6,}/i.test(txt) &&
        !/prompt:\s*"/.test(txt) // exclude sanitized snippet form
      ) {
        // Check if any actual prompt id from this packet appears verbatim
        for (const pid of promptIds) {
          if (txt.includes(pid)) {
            flags.push(
              `RAW_PROMPT_ID_LEAK in ${edit.actionType}: ${pid} found in copy: ${txt.slice(0, 120)}`,
            );
            break;
          }
        }
      }

      // Competitor name in proposedText / displayLabel (operator-visible)
      // — competitor names are EVIDENCE, not public copy.
      if (
        edit.targetElement?.proposedText &&
        txt === edit.targetElement.proposedText
      ) {
        for (const comp of competitors) {
          if (comp.length < 4) continue; // skip very-short tokens
          if (lower.includes(comp)) {
            flags.push(
              `COMPETITOR_NAME_IN_PUBLIC_COPY in ${edit.actionType}: "${comp}" appears in proposedText: ${txt.slice(0, 120)}`,
            );
          }
        }
      }
    }
  }

  return flags;
}

function summarizeEdits(edits: SpecificEdit[]): SampleResult["edits"] {
  return edits.map((e) => ({
    actionType: e.actionType,
    targetUrl: e.targetUrl,
    elementKey: e.targetElement?.elementKey ?? null,
    displayLabel: e.targetElement?.displayLabel ?? null,
    proposedText: e.targetElement?.proposedText ?? null,
    currentText: e.targetElement?.currentText ?? null,
    why: e.why,
    expectedImpact: e.expectedImpact ?? null,
    measurementPlan: e.measurementPlan ?? null,
    confidence: e.confidence,
    difficulty: e.difficulty,
    evidenceCount: e.evidence.length,
    evidenceTypes: [...new Set(e.evidence.map((r) => r.type))],
  }));
}

async function runDryRun(): Promise<{ exitCode: number; samples: SampleResult[] }> {
  console.log(tag("─────────────────────────────────────────────"));
  console.log(tag("Controlled OpenAI dry-run — 5 representative packets"));
  console.log(tag("Hard cap: $" + BUDGET_CAP_USD.toFixed(2) + " total"));
  console.log(tag("Persistence: NONE (provider.generate only)"));
  console.log(tag("─────────────────────────────────────────────\n"));

  // Sanity check: API key + provider env.
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.error(
      tag(
        "ABORT: OPENAI_API_KEY not set. Operator brief said: 'If OPENAI_API_KEY is not available locally, stop and report. Do not fake it with deterministic.'",
      ),
    );
    return { exitCode: 1, samples: [] };
  }

  const tenantId = await currentTenantId();
  console.log(tag(`Tenant: ${tenantId}`));

  // Load the live recommendation queue.
  console.log(tag("Loading live recommendation queue…"));
  const live = await loadLiveRecommendationQueue({ tenantId });
  if (live.errors.length > 0) {
    console.warn(tag(`Queue loaded with ${live.errors.length} non-fatal warnings:`));
    for (const e of live.errors) console.warn(tag(`  · ${e}`));
  }

  // `live.queue` items extend `PrioritizedRecommendation` which extends
  // `RecommendationCandidate`, with the resolver's `.resolution` field
  // attached when present. We only consume rows that actually carry a
  // resolution (the resolver runs before the prioritizer, so all
  // production rows do).
  const candidates: ResolvedRecommendationCandidate[] = live.queue
    .filter((row) => Boolean(row.resolution))
    .map((row) => row as unknown as ResolvedRecommendationCandidate);
  console.log(tag(`Total candidates in queue: ${candidates.length}`));

  const slots = pickFiveSlots(candidates);
  console.log(tag(`Matched ${slots.length} of 5 slots:`));
  for (const s of slots) {
    console.log(tag(`  · slot=${s.slot} key=${s.candidate.stableKey}`));
    console.log(tag(`      why=${s.why}`));
  }
  if (slots.length < 5) {
    console.warn(
      tag(
        `Only ${slots.length} of 5 slots matched — proceeding with what we have. Operator brief: "If fewer than 5 match, report exactly what matched. Do not pad."`,
      ),
    );
  }

  const samples: SampleResult[] = [];
  let cumulativeCost = 0;
  let exitCode = 0;

  for (const sel of slots) {
    console.log(tag(""));
    console.log(tag(`────── ${sel.slot} ──────`));
    console.log(tag(`stableKey=${sel.candidate.stableKey}`));
    console.log(tag(`action=${sel.candidate.resolution.action}`));
    console.log(tag(`motive=${sel.candidate.resolution.motive}`));
    console.log(tag(`targetUrl=${sel.candidate.resolution.targetUrl}`));
    console.log(tag(`confidence=${sel.candidate.resolution.confidence}`));
    console.log(tag(`tier=${sel.candidate.resolution.tier}`));

    let packet: SpecificEditEvidencePacket;
    try {
      packet = buildPacketForRec({
        // The candidate is the queue row itself; buildPacketForRec wants
        // a PrioritizedRecommendation which our row already is.
        rec: sel.candidate as unknown as Parameters<
          typeof buildPacketForRec
        >[0]["rec"],
        // The context is the full LiveRecommendationQueue we just loaded.
        context: live,
        pageElementInventory: [],
        tenantId,
      });
    } catch (err) {
      console.error(
        tag(
          `Failed to build packet for ${sel.candidate.stableKey}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      continue;
    }

    console.log(
      tag(
        `Packet: prompts=${packet.affectedPrompts.length} pages=${packet.ownedPageCandidates.length} ` +
          `targetElements=${packet.targetPageElements.length} competitors=${packet.competitorAngles.length} ` +
          `aiSignals=${packet.aiSearchSignal.topSearchQueries.length} blueprints=${packet.competitorPageBlueprints.length} ` +
          `brandAssertions=${packet.brandAssertions.length} hash=${packet.evidenceHash}`,
      ),
    );

    // Budget gate: estimate worst-case cost (~$0.05 per packet at gpt-5-mini).
    const estimatePerPacket = 0.05;
    if (cumulativeCost + estimatePerPacket > BUDGET_CAP_USD) {
      console.error(
        tag(
          `BUDGET_ABORT: cumulative cost $${cumulativeCost.toFixed(4)} + estimate $${estimatePerPacket.toFixed(4)} > cap $${BUDGET_CAP_USD.toFixed(2)}`,
        ),
      );
      exitCode = 1;
      break;
    }

    let bundle: SpecificEditBundle;
    try {
      bundle = await openaiProvider.generate(packet);
    } catch (err) {
      console.error(
        tag(
          `OpenAI generate threw on ${sel.candidate.stableKey}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      continue;
    }

    cumulativeCost += bundle.totalCostUsd ?? 0;
    console.log(
      tag(
        `Bundle: edits=${bundle.recommendations.length} cost=$${(bundle.totalCostUsd ?? 0).toFixed(4)} (cumulative $${cumulativeCost.toFixed(4)})`,
      ),
    );

    // Validator
    const validation = validateSpecificEditBundle(bundle, packet);
    const accepted = validation.perEdit.filter((p) => p.result.ok);
    const rejected = validation.perEdit.filter((p) => !p.result.ok);
    console.log(
      tag(
        `Validator: accepted=${accepted.length} rejected=${rejected.length} bundleErrors=${validation.bundleErrors.length}`,
      ),
    );

    // Guardrail manual sweep (placeholder, UUID, competitor in copy).
    const flags = inspectGuardrails(bundle.recommendations, packet);
    if (flags.length > 0) {
      console.warn(tag(`Guardrail flags (${flags.length}):`));
      for (const f of flags) console.warn(tag(`  ⚠ ${f}`));
      exitCode = Math.max(exitCode, 2);
    }

    // Print full edit details for human scoring.
    bundle.recommendations.forEach((edit, i) => {
      console.log(tag(`  Edit ${i + 1}/${bundle.recommendations.length}:`));
      console.log(tag(`    actionType=${edit.actionType}`));
      console.log(tag(`    targetUrl=${edit.targetUrl}`));
      console.log(tag(`    elementKey=${edit.targetElement?.elementKey ?? "(none)"}`));
      console.log(tag(`    displayLabel=${edit.targetElement?.displayLabel ?? "(none)"}`));
      const pt = edit.targetElement?.proposedText;
      console.log(
        tag(
          `    proposedText=${pt ? JSON.stringify(pt.slice(0, 600)) + (pt.length > 600 ? "…" : "") : "(none)"}`,
        ),
      );
      console.log(tag(`    confidence=${edit.confidence} difficulty=${edit.difficulty}`));
      console.log(tag(`    why=${JSON.stringify(edit.why.slice(0, 300))}`));
      console.log(
        tag(
          `    expectedImpact=${edit.expectedImpact ? JSON.stringify(edit.expectedImpact.slice(0, 200)) : "(none)"}`,
        ),
      );
      console.log(tag(`    evidence=${edit.evidence.length} refs`));
    });

    samples.push({
      slot: sel.slot,
      why: sel.why,
      candidate: {
        stableKey: sel.candidate.stableKey,
        clusterLabel: sel.candidate.clusterLabel ?? null,
        clusterKind: sel.candidate.clusterKind ?? null,
        action: sel.candidate.resolution.action,
        motive: sel.candidate.resolution.motive,
        targetUrl: sel.candidate.resolution.targetUrl,
        confidence: sel.candidate.resolution.confidence,
        affectedPromptCount: sel.candidate.affectedPromptIds.length,
        tier: sel.candidate.resolution.tier,
      },
      packetSummary: {
        affectedPromptCount: packet.affectedPrompts.length,
        ownedPageCandidateCount: packet.ownedPageCandidates.length,
        targetPageElementCount: packet.targetPageElements.length,
        competitorAngleCount: packet.competitorAngles.length,
        aiSearchSignalCount: packet.aiSearchSignal.topSearchQueries.length,
        competitorPageBlueprintCount: packet.competitorPageBlueprints.length,
        brandAssertionCount: packet.brandAssertions.length,
        allowedActionTypes: packet.allowedActionTypes,
        allowedTargetUrls: packet.allowedTargetUrls,
        evidenceHash: packet.evidenceHash,
      },
      bundle: {
        providerName: bundle.providerName,
        // SpecificEditBundle has model on the per-edit level, not the
        // bundle. Surface the first edit's model for the report.
        model: bundle.recommendations[0]?.model ?? null,
        totalCostUsd: bundle.totalCostUsd ?? null,
        editCount: bundle.recommendations.length,
      },
      edits: summarizeEdits(bundle.recommendations),
      validator: {
        accepted: accepted.length,
        rejected: rejected.length,
        bundleErrors: validation.bundleErrors.length,
        rejectedDetails: rejected
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
      guardrailFlags: flags,
    });
  }

  console.log(tag(""));
  console.log(tag("─────────────────────────────────────────────"));
  console.log(
    tag(
      `Total cost: $${cumulativeCost.toFixed(4)} (cap $${BUDGET_CAP_USD.toFixed(2)})`,
    ),
  );
  console.log(tag(`Samples generated: ${samples.length} / ${slots.length}`));
  console.log(tag(`Exit code: ${exitCode}`));
  console.log(tag("─────────────────────────────────────────────"));

  // Write structured output for the report.
  try {
    writeFileSync(
      RESULTS_OUTPUT_PATH,
      JSON.stringify(
        { totalCostUsd: cumulativeCost, sampleCount: samples.length, samples },
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

  return { exitCode, samples };
}

runDryRun()
  .then(({ exitCode }) => {
    process.exit(exitCode);
  })
  .catch((err) => {
    console.error(
      tag(`fatal: ${err instanceof Error ? err.message : String(err)}`),
    );
    process.exit(1);
  });
