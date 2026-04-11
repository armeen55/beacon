/**
 * Founder Authority — minimal person-entity tracking.
 *
 * Supports optional configured founder identity and checks for
 * mentions in AI answer data. Does NOT invent authority scores
 * or claim reputational influence without evidence.
 *
 * Configuration: Set BEACON_FOUNDER_NAMES as a comma-separated
 * list in .env.local (e.g. "Jane Smith,John Doe").
 */

import "server-only";

import { readStore } from "@/lib/persistence/json-store";
import type { FounderProfile, FounderAuthorityResult, FounderPresenceStatus } from "./founder-types";

const MIN_FOR_REPEATED = 5;
const MIN_FOR_LIGHT = 1;

function getConfiguredFounders(): string[] {
  const raw = process.env.BEACON_FOUNDER_NAMES?.trim();
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Assess founder presence from AI answer mention data.
 */
export function assessFounderAuthority(): FounderAuthorityResult {
  const configuredNames = getConfiguredFounders();

  if (configuredNames.length === 0) {
    return {
      computed_at: new Date().toISOString(),
      founders: [],
      has_configured_founder: false,
      data_note: "No founder names configured. Set BEACON_FOUNDER_NAMES in .env.local to enable founder tracking.",
    };
  }

  const paoStore = readStore<{
    id: string;
    mentions: string[];
  }>("prompt-answer-observations");

  // Count mentions for each configured founder
  const founders: FounderProfile[] = configuredNames.map((name) => {
    const nameLower = name.toLowerCase();
    let mentionCount = 0;
    const mentionSources = new Set<string>();

    for (const pao of paoStore) {
      for (const mention of pao.mentions ?? []) {
        if (mention.toLowerCase().includes(nameLower) || nameLower.includes(mention.toLowerCase())) {
          mentionCount++;
          mentionSources.add("answer_mention");
          break;
        }
      }
    }

    let status: FounderPresenceStatus;
    let assessment: string;

    if (mentionCount >= MIN_FOR_REPEATED) {
      status = "observed_repeatedly";
      assessment = `"${name}" appears in ${mentionCount} AI answer${mentionCount !== 1 ? "s" : ""}. Consistent presence suggests some personal authority signal in AI training data.`;
    } else if (mentionCount >= MIN_FOR_LIGHT) {
      status = "observed_lightly";
      assessment = `"${name}" appears in ${mentionCount} AI answer${mentionCount !== 1 ? "s" : ""}. Light presence — may increase with native querying data.`;
    } else {
      status = "configured_not_observed";
      assessment = `"${name}" is configured but not observed in current AI answer data. This may change with native querying or broader prompt coverage.`;
    }

    return {
      name,
      configured: true,
      mention_count: mentionCount,
      mention_sources: [...mentionSources],
      presence_status: status,
      assessment,
    };
  });

  return {
    computed_at: new Date().toISOString(),
    founders,
    has_configured_founder: true,
    data_note: `Checked ${paoStore.length} AI answers for ${configuredNames.length} configured founder${configuredNames.length !== 1 ? "s" : ""}.`,
  };
}
