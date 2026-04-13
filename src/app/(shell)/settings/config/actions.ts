"use server";

import { log } from "@/lib/logger";
import { saveBusinessConfig, getBusinessConfig, type BusinessConfig } from "@/lib/business-config";
import { revalidatePath } from "next/cache";

export async function saveSetup(data: {
  name: string;
  domain: string;
  industry: string;
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
    saveBusinessConfig({
      name: data.name,
      domain: data.domain,
      industry: data.industry,
      locations: data.locations,
      services: data.services,
      primaryCompetitors: data.primaryCompetitors,
    });
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

export async function loadSetup(): Promise<BusinessConfig> {
  return getBusinessConfig();
}
