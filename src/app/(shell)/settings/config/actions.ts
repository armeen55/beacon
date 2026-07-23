"use server";

import { log } from "@/lib/logger";
import {
  getTenant,
  websiteOf,
  loadBusinessProfile,
  saveBusinessProfile,
  type BusinessProfile,
  type BusinessType,
} from "@/domains/account";
import { currentTenantId } from "@/lib/tenant-context";
import { revalidatePath } from "next/cache";

/** The business types the screen offers. Mirrors BusinessProfile.businessType. */
const BUSINESS_TYPES = new Set<BusinessType>([
  "local_service",
  "content_publisher",
  "ecommerce",
  "saas",
  "other",
]);

/** The canonical, editable view the settings screen renders. Website is
 *  read-only here: the Account owns the one domain. */
export type SetupView = {
  name: string;
  websiteDomain: string;
  businessType: BusinessType | "";
  geographicScopeLine: string;
  offeringsLine: string;
  competitorsLine: string;
  editorialRulesLine: string;
  bannedTermsLine: string;
};

export async function loadSetup(): Promise<SetupView> {
  const tenantId = await currentTenantId();
  const [account, profile] = await Promise.all([
    getTenant(tenantId),
    loadBusinessProfile(tenantId),
  ]);
  return {
    name: profile.name.value || account?.business_name || "",
    websiteDomain: account ? websiteOf(account).domain : "",
    businessType: profile.businessType.value ?? "",
    geographicScopeLine: profile.geographicScope.value.join(", "),
    offeringsLine: profile.offerings.value.join(", "),
    competitorsLine: profile.competitors.value.map((c) => c.name).join(", "),
    editorialRulesLine: profile.constraints.value.editorial.join("\n"),
    bannedTermsLine: profile.constraints.value.bannedTerms.join(", "),
  };
}

const splitList = (line: string, sep: RegExp): string[] =>
  line.split(sep).map((s) => s.trim()).filter(Boolean);

const confirmed = <T,>(value: T) => ({
  value,
  origin: "operator_confirmed" as const,
  confidence: 1,
  sourceUrls: [] as string[],
});

export async function saveSetup(data: {
  name: string;
  businessType?: string;
  geographicScopeLine?: string;
  offeringsLine?: string;
  competitorsLine?: string;
  editorialRulesLine?: string;
  bannedTermsLine?: string;
}): Promise<{ success: boolean; error?: string }> {
  const action = "saveSetup";
  const t0 = Date.now();
  log.info("Action started", { action });
  try {
    const tenantId = await currentTenantId();
    if (!data.name.trim()) {
      return { success: false, error: "Enter your business name." };
    }
    const current = await loadBusinessProfile(tenantId);
    const bt = (data.businessType ?? "").trim() as BusinessType;
    const patch: Parameters<typeof saveBusinessProfile>[1] = {
      name: confirmed(data.name.trim()),
      businessType: confirmed<BusinessType | null>(BUSINESS_TYPES.has(bt) ? bt : null),
      geographicScope: confirmed(splitList(data.geographicScopeLine ?? "", /,/)),
      offerings: confirmed(splitList(data.offeringsLine ?? "", /,/)),
      competitors: confirmed(
        splitList(data.competitorsLine ?? "", /,/).map((name) => ({ name, evidenceUrls: [] })),
      ),
      constraints: confirmed({
        ...current.constraints.value,
        editorial: splitList(data.editorialRulesLine ?? "", /\n/),
        bannedTerms: splitList(data.bannedTermsLine ?? "", /,/),
      }),
    };
    const saved = await saveBusinessProfile(tenantId, patch);
    if (!saved.persisted) {
      return { success: false, error: "I couldn't save your business details just now. Try again in a moment." };
    }
    revalidatePath("/", "layout");
    revalidatePath("/settings/config");
    log.info("Action completed", { action, durationMs: Date.now() - t0 });
    return { success: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", { action, durationMs: Date.now() - t0, error: err.slice(0, 500) });
    return { success: false, error: err };
  }
}
