"use server";

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
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function loadSetup(): Promise<BusinessConfig> {
  return getBusinessConfig();
}
