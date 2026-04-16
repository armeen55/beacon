"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { opportunities } from "@/lib/seed-data.server";
import { writeStore } from "@/lib/persistence/json-store";
import { generateId, now } from "@/lib/actions";
import type { Opportunity } from "@/domains/opportunities/types";
import type { OpportunityCandidate } from "./types";

export async function promoteToOpportunity(
  candidate: OpportunityCandidate
): Promise<{ success: boolean; opportunityId?: string; error?: string }> {
  const action = "promoteToOpportunity";
  const t0 = Date.now();
  log.info("Action started", {
    action,
    params: {
      opportunityType: candidate.opportunityType,
      confidence: candidate.confidence,
    },
  });
  const exists = opportunities.some(
    (o) =>
      o.title.toLowerCase() === candidate.label.toLowerCase() ||
      o.query_text.toLowerCase() === candidate.queryTemplate.toLowerCase()
  );

  if (exists) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "duplicate opportunity",
    });
    return {
      success: false,
      error: "An opportunity with this title or query already exists",
    };
  }

  const timestamp = now();
  const id = generateId("opp");

  const opp: Opportunity = {
    id,
    title: candidate.label,
    description: candidate.reasoning,
    query_text: candidate.queryTemplate,
    platforms: candidate.targetPlatform === "all" ? [] : [candidate.targetPlatform as "chatgpt" | "google_aio" | "perplexity" | "gemini" | "claude" | "all"],
    intent_type: "informational",
    city: candidate.targetCity,
    topic: candidate.targetTopic,
    tags: [
      `pattern:${candidate.sourcePatternLabel}`,
      `type:${candidate.opportunityType}`,
    ],
    current_status: "new",
    priority: candidate.confidence === "high" ? "high" : candidate.confidence === "medium" ? "medium" : "low",
    estimated_impact: candidate.confidence === "high" ? "high" : "medium",
    effort: "medium",
    confidence: candidate.confidence,
    source: "ai_suggestion",
    baseline_position: null,
    target_position: null,
    target_url: null,
    competitor_ids: [],
    primary_competitor_id: null,
    linked_brief_ids: [],
    linked_changelog_ids: [],
    related_opportunity_ids: [],
    identified_at: timestamp,
    activated_at: null,
    captured_at: null,
    lost_at: null,
    last_verified_at: null,
    assessed_at: null,
    deferred_at: null,
    deferred_until: null,
    closed_at: null,
    close_reason: null,
    regressed_at: null,
    notes: [
      `Auto-generated from pattern "${candidate.sourcePatternLabel}"`,
      `Opportunity type: ${candidate.opportunityType}`,
      `Confidence: ${candidate.confidence}`,
      "",
      "Evidence:",
      ...candidate.supportingEvidence.map((e) => `• ${e}`),
      "",
      "Caveats:",
      ...candidate.caveats.map((c) => `⚠ ${c}`),
    ].join("\n"),
    created_at: timestamp,
    updated_at: timestamp,
    source_system: "beacon-expansion",
    import_batch_id: undefined,
    tenant_id: "",
  };

  opportunities.push(opp);

  const isImported = (o: Opportunity) =>
    o.source_system === "workbook" ||
    o.source_system === "beacon-workbook" ||
    o.source_system === "ritz-workbook" ||
    o.source_system === "beacon-expansion" ||
    Boolean(o.import_batch_id);
  await writeStore(
    "imported-opportunities",
    opportunities.filter(isImported)
  );

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true, opportunityId: id };
}
