"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/auth/supabase-server";
import { sendMagicLink } from "@/lib/auth/magic-link";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { provisionTenantForNewUser } from "@/domains/account";

/**
 * requestSignupMagicLink sends a magic link for new-account signup. After
 * the user clicks it, /auth/callback exchanges the code for a session AND
 * provisions a pending tenant + tenant_members row (idempotent, so repeat
 * clicks never duplicate).
 */
export async function requestSignupMagicLink(
  email: string,
): Promise<{ error: string | null }> {
  if (!email || !/@/.test(email)) {
    return { error: "Enter a valid work email" };
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const origin = host ? `${proto}://${host}` : "http://localhost:3000";

  return sendMagicLink(email, `${origin}/auth/callback`);
}

/**
 * Re-run provisioning for the CURRENT signed-in user. This is the one escape
 * hatch for a session that authenticated but whose workspace was never
 * created: without it that user is stranded on every route. Same shape as the
 * callback (user client reads the session, admin client does the writes).
 */
export async function retryProvisioningAction(): Promise<void> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const provision = await provisionTenantForNewUser(getSupabaseAdmin(), {
    userId: user.id,
    email: user.email ?? "",
  });
  if (!provision.ok) {
    console.error("[signup] retry provisioning failed:", provision.phase, provision.error);
    redirect(`/signup?error=provisioning_${provision.phase}`);
  }
  redirect("/onboard");
}
