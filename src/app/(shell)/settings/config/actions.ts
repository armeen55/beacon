"use server";

import { log } from "@/lib/logger";
import {
  saveBusinessConfig,
  getBusinessConfigForCurrentTenant,
  type BusinessConfig,
} from "@/lib/business-config";
import {
  getYelpConnectorToken,
  updateConnectorToken,
} from "@/lib/connector-store";
import { currentTenantId } from "@/lib/tenant-context";
import { revalidatePath } from "next/cache";

/** The business types the config screen offers. Mirrors BusinessConfig.businessType. */
const BUSINESS_TYPES = new Set([
  "local_service",
  "content_publisher",
  "ecommerce",
  "saas",
  "other",
]);

export async function saveSetup(data: {
  name: string;
  domain: string;
  industry: string;
  /** Operator-confirmed business type. Ignored if not a known value. */
  businessType?: string;
  phone?: string;
  address?: string;
  yelpBusinessId?: string;
  locations: string[];
  services: string[];
  primaryCompetitors: string[];
  /** North-star onboarding (2026-06-11) — self-serve content guardrails
   *  (e.g. "Call the language Persian, never Farsi."). flaggedTerms are
   *  HARD-REJECTED by the factory validator. */
  contentRules?: string[];
  flaggedTerms?: string[];
  /** Wave 2A (2026-07-10): the tenant's monthly-visits revival goal. A positive
   *  integer sets it, null clears it, undefined leaves it untouched. Graded ONLY
   *  from reconciled analytics, never from clicks. */
  monthlyVisitGoal?: number | null;
}): Promise<{ success: boolean; error?: string }> {
  const action = "saveSetup";
  const t0 = Date.now();
  log.info("Action started", {
    action,
    params: {
      domainLength: data.domain.length,
      locationCount: data.locations.length,
      serviceCount: data.services.length,
    },
  });
  try {
    // MT-3A (2026-05-22) — tenant-aware save (operator settings action).
    const tenantId = await currentTenantId();
    // Works-for-ANY-business profile engine (2026-07-06): a valid operator-
    // picked business type is PERSISTED and thereby PINNED — the nightly
    // self-heal only fills EMPTY holes, so this value survives re-derivation.
    // When the operator flags a content publisher we also set contentSiteMode
    // so their pages classify as content (mirrors the derived path); we never
    // turn contentSiteMode OFF here (that stays an explicit operator decision).
    const patch: Partial<BusinessConfig> = {
      name: data.name,
      domain: data.domain,
      industry: data.industry,
      phone: data.phone ?? "",
      address: data.address ?? "",
      yelpBusinessId: data.yelpBusinessId?.trim() ?? "",
      locations: data.locations,
      services: data.services,
      primaryCompetitors: data.primaryCompetitors,
      contentRules: data.contentRules ?? [],
      flaggedTerms: data.flaggedTerms ?? [],
    };
    const bt = (data.businessType ?? "").trim();
    if (bt && BUSINESS_TYPES.has(bt)) {
      patch.businessType = bt as BusinessConfig["businessType"];
      if (bt === "content_publisher") patch.contentSiteMode = true;
    }
    // Wave 2A - monthly-visits goal. undefined = leave untouched; null = clear;
    // a value must be a positive integer (validated defensively even though the form
    // validates too). Graded only from reconciled analytics, never from clicks.
    if (data.monthlyVisitGoal !== undefined) {
      if (data.monthlyVisitGoal === null) {
        patch.monthlyVisitGoal = null;
      } else {
        const goal = Number(data.monthlyVisitGoal);
        if (!Number.isInteger(goal) || goal <= 0) {
          return { success: false, error: "Enter a whole number of visits above zero, or leave it blank." };
        }
        patch.monthlyVisitGoal = goal;
      }
    }
    saveBusinessConfig(tenantId, patch);
    const yelpBid = (data.yelpBusinessId ?? "").trim();
    const yelp = await getYelpConnectorToken();
    if (yelp) {
      await updateConnectorToken("yelp", { business_id: yelpBid });
    }
    revalidatePath("/", "layout");
    revalidatePath("/settings/connectors");
    log.info("Action completed", { action, durationMs: Date.now() - t0 });
    return { success: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: err.slice(0, 500),
    });
    return { success: false, error: err };
  }
}

export async function loadSetup(): Promise<BusinessConfig> {
  return await getBusinessConfigForCurrentTenant();
}

/**
 * Item 3 (2026-07-01) - save the operator's unit economics. The nightly
 * revenue pass multiplies this rate by real GA4 traffic to produce honest
 * dollar rows (always labeled "your rate x real traffic"). kind "off"
 * clears the model and the pass goes dormant again.
 */
export async function saveRevenueModel(data: {
  kind: "rpm" | "per_lead" | "off";
  rate?: number;
}): Promise<{ success: boolean; error?: string }> {
  const action = "saveRevenueModel";
  const t0 = Date.now();
  try {
    const tenantId = await currentTenantId();
    if (data.kind === "off") {
      saveBusinessConfig(tenantId, { revenueModel: undefined });
    } else {
      const rate = Number(data.rate);
      if (!Number.isFinite(rate) || rate <= 0) {
        return { success: false, error: "Enter a dollar amount above zero." };
      }
      saveBusinessConfig(tenantId, {
        revenueModel:
          data.kind === "rpm"
            ? { kind: "rpm", rpmUsd: rate }
            : { kind: "per_lead", dollarsPerLead: rate },
      });
    }
    revalidatePath("/settings/config");
    revalidatePath("/", "layout");
    log.info("Action completed", { action, durationMs: Date.now() - t0 });
    return { success: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: err.slice(0, 500),
    });
    return { success: false, error: err };
  }
}
