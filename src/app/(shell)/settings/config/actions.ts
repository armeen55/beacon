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

export async function saveSetup(data: {
  name: string;
  domain: string;
  industry: string;
  phone?: string;
  address?: string;
  yelpBusinessId?: string;
  locations: string[];
  services: string[];
  primaryCompetitors: string[];
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
    saveBusinessConfig(tenantId, {
      name: data.name,
      domain: data.domain,
      industry: data.industry,
      phone: data.phone ?? "",
      address: data.address ?? "",
      yelpBusinessId: data.yelpBusinessId?.trim() ?? "",
      locations: data.locations,
      services: data.services,
      primaryCompetitors: data.primaryCompetitors,
    });
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
