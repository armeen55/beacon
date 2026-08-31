"use server";

import { headers } from "next/headers";
import { sendMagicLink } from "@/lib/auth/magic-link";
import { getSupabaseServerClient } from "@/lib/auth/supabase-server";

/**
 * THE PRIMARY WAY IN. A magic link needs an email to be delivered, and the provider's send limit is
 * reached long before an operator's working day is: the link route stayed the only door and the account
 * became unreachable for hours at a time. A password sign-in sends nothing and asks nobody for delivery.
 *
 * It grants no authority of its own: the session lands in the SAME cookie the rest of auth already reads,
 * so membership resolution, the one-account rule and every owner gate downstream are untouched. Nothing
 * is provisioned here, because this door is for an account that already exists.
 *
 * The password is never logged, never returned and never stored by Beacon; the provider's own words never
 * reach the browser, and one generic refusal covers a wrong password and an unknown email alike, so this
 * form cannot be used to discover who has an account.
 */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<{ error: string | null }> {
  if (!email || !/@/.test(email) || !password) {
    return { error: "Enter your email and your password." };
  }
  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Machine-readable signal only: a raw provider message on this form reads as a bug report, and
      // its detail can say whether an address exists. The password itself is never part of this record.
      console.error("[password-login] refused", {
        status: (error as { status?: number }).status,
        code: (error as { code?: string }).code,
      });
      return { error: "That email and password do not match an account." };
    }
    return { error: null };
  } catch (e) {
    console.error("[password-login] threw:", e instanceof Error ? e.message : String(e));
    return { error: "Signing in could not finish just now. Try again in a moment." };
  }
}

export async function requestMagicLink(
  email: string,
  next?: string,
): Promise<{ error: string | null }> {
  if (!email || !/@/.test(email)) {
    return { error: "Enter a valid email" };
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const origin = host ? `${proto}://${host}` : "http://localhost:3000";

  const redirectTo = `${origin}/auth/callback${
    next ? `?next=${encodeURIComponent(next)}` : ""
  }`;

  return sendMagicLink(email, redirectTo);
}
