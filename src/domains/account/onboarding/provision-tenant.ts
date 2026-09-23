import type { SupabaseClient } from "@supabase/supabase-js";

type ProvisionInput = { userId: string; email: string };
type ProvisionOutcome =
  | { ok: true; tenantId: string; created: boolean }
  | { ok: false; error: string; phase: "provision" };

const PLACEHOLDER_BUSINESS_NAME = "New Beacon Account";
const FREE_EMAIL_DOMAINS = new Set([
  "gmail", "googlemail", "yahoo", "ymail", "hotmail", "outlook", "live", "msn",
  "icloud", "me", "mac", "aol", "proton", "protonmail", "pm", "gmx", "zoho",
  "mail", "yandex", "fastmail", "hey",
]);

function derivePlaceholderBusinessName(email: string): string {
  const at = email.indexOf("@");
  if (at < 0 || at === email.length - 1) return PLACEHOLDER_BUSINESS_NAME;
  const domainPart = email.slice(at + 1).split(".")[0] ?? "";
  if (!domainPart || FREE_EMAIL_DOMAINS.has(domainPart.toLowerCase())) return PLACEHOLDER_BUSINESS_NAME;
  return domainPart.split(/[-_]/).filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ") || PLACEHOLDER_BUSINESS_NAME;
}

/** Read only. The database's one-owner indexes make this a single identity. */
export async function lookupExistingMembership(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ tenantId: string | null; error: string | null }> {
  const { data, error } = await supabase.from("tenant_members")
    .select("tenant_id,role").eq("user_id", userId).limit(2);
  if (error) return { tenantId: null, error: error.message };
  if (!data?.length) return { tenantId: null, error: null };
  if (data.length !== 1 || data[0]?.role !== "owner" || !data[0].tenant_id) {
    return { tenantId: null, error: "ambiguous account ownership" };
  }
  return { tenantId: data[0].tenant_id, error: null };
}

/** One service-role RPC owns both inserts and the retry decision in one transaction. */
export async function provisionTenantForNewUser(
  supabase: SupabaseClient,
  input: ProvisionInput,
): Promise<ProvisionOutcome> {
  try {
    const { data, error } = await supabase.rpc("provision_account_owner", {
      p_user_id: input.userId,
      p_business_name: derivePlaceholderBusinessName(input.email),
    });
    if (error) return { ok: false, error: error.message, phase: "provision" };
    const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
    const newId = `tenant-${input.userId.replace(/-/g, "").toLowerCase()}`;
    if (typeof row?.tenant_id !== "string" || !row.tenant_id.startsWith("tenant-") ||
      typeof row.created !== "boolean" || (row.created && row.tenant_id !== newId)) {
      return { ok: false, error: "invalid provisioning receipt", phase: "provision" };
    }
    return { ok: true, tenantId: row.tenant_id, created: row.created };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "provisioning failed", phase: "provision" };
  }
}
