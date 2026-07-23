/**
 * first-reading-state — Gap F.1 (2026-05-07).
 *
 * Pure detector for the "newly launched, no observations yet" state.
 * Used by /today's data resolver to decide whether to render the
 * waiting-state card instead of the regular dashboard.
 *
 * Triggers when ALL three conditions hold:
 *   - tenant.status === 'active' (i.e., onboarding Launch fired)
 *   - tenant has at least 1 active tracked prompt
 *   - tenant has zero prompt_answer_observations
 *
 * Pure function — no I/O, no env, no Supabase, no Next.js. Easy to
 * test, safe to import on the server.
 *
 * Customer-safe: the returned `nextReadingDescription` uses honest
 * on-demand phrasing ("once you refresh your connected data"). Beacon
 * has no automatic schedule — data updates when the customer refreshes
 * their connected sources. Never mentions cron, GitHub Actions,
 * Supabase, or any internal infrastructure.
 */

import type { Account } from "@/domains/account/tenants/types";

export type FirstReadingContext = {
  /** Customer's business name as saved during onboarding. */
  businessName: string;
  /** Customer's website domain (normalized). */
  domain: string;
  /** Number of active tracked prompts queued for the next reading. */
  promptCount: number;
  /**
   * Human-readable description of when the first reading lands.
   * Customer-safe — no infrastructure terms.
   */
  nextReadingDescription: string;
  /**
   * North-star onboarding (2026-06-11) — minute-one value: what Beacon
   * derived from the customer's own site at launch. All optional; the
   * card renders the block only when something was derived.
   */
  derived?: {
    industry: string | null;
    locations: string[];
    serviceCount: number;
    keyPageCount: number;
  };
};

export type FirstReadingDetection =
  | { isFirstReading: false }
  | { isFirstReading: true; context: FirstReadingContext };

export type FirstReadingDetectorInput = {
  /**
   * The current tenant's row (or null if unresolvable). Only the
   * status / provisional_name / domain fields are read.
   */
  tenant: Pick<
    Account,
    "status" | "provisional_name" | "domain"
  > | null;
  /**
   * Count of `is_active=true` tracked_prompts for this tenant.
   */
  activePromptCount: number;
  /**
   * Count of prompt_answer_observations for this tenant.
   */
  observationCount: number;
};

/**
 * Decide whether /today should render the first-reading waiting state.
 *
 * Reasoning:
 *   - non-active tenants (`pending_onboarding`, `paused`, `cancelled`):
 *     should never see the waiting-state card. `pending_onboarding`
 *     belongs in /onboard/*; `paused`/`cancelled` need operator
 *     intervention, not a "preparing" message.
 *   - zero active prompts: the customer hasn't completed onboarding
 *     enough for there to be anything to wait for.
 *   - any observations exist: the regular /today dashboard has data
 *     to render; the existing UI handles it.
 */
export function detectFirstReadingState(
  input: FirstReadingDetectorInput,
  /** Optional derived-profile facts from the per-tenant config. */
  derived?: FirstReadingContext["derived"],
): FirstReadingDetection {
  const { tenant, activePromptCount, observationCount } = input;

  if (!tenant) return { isFirstReading: false };
  if (tenant.status !== "active") return { isFirstReading: false };
  if (!Number.isFinite(activePromptCount) || activePromptCount <= 0) {
    return { isFirstReading: false };
  }
  if (!Number.isFinite(observationCount) || observationCount > 0) {
    return { isFirstReading: false };
  }

  return {
    isFirstReading: true,
    context: {
      businessName: (tenant.provisional_name ?? "").trim() || "your business",
      domain: (tenant.domain ?? "").trim(),
      promptCount: activePromptCount,
      // Customer-safe phrasing. NEVER mention cron / UTC / GitHub /
      // Supabase / poll. Beacon has no schedule — the first reading
      // lands once the customer refreshes their connected data.
      nextReadingDescription: "once you refresh your connected data",
      ...(derived ? { derived } : {}),
    },
  };
}
