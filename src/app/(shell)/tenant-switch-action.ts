"use server";

/**
 * 2026-06-11 (night shift, inventory #119) — tenant switcher action.
 *
 * The middleware has honored a `beacon_tenant` cookie preference since
 * the multi-membership fix (audit #13), but NOTHING ever set it — an
 * operator who owns three businesses could only ever see the earliest
 * one. This action is the cookie's first writer.
 *
 * Fail-closed: the target tenant must be one the CURRENT USER is a
 * member of (same source of truth the middleware checks). A non-member
 * target changes nothing.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getSupabaseServerClient } from "@/lib/auth/supabase-server";

export const TENANT_COOKIE = "beacon_tenant";
const COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;

/** Pure membership check (exported for tests). */
export async function canSwitchToTenant(
  memberships: ReadonlyArray<{ tenant_id: string }>,
  target: string,
): Promise<boolean> {
  return target.length > 0 && memberships.some((m) => m.tenant_id === target);
}

export async function switchTenantFromForm(formData: FormData): Promise<void> {
  const target = String(formData.get("tenant_id") ?? "").trim();
  if (target === "") redirect("/");

  const supabase = await getSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) redirect("/login");

  const { data: memberships, error } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", user.id);
  if (error || !(await canSwitchToTenant(memberships ?? [], target))) {
    // Not a member (or lookup failed) — change nothing.
    redirect("/");
  }

  const cookieStore = await cookies();
  cookieStore.set(TENANT_COOKIE, target, {
    path: "/",
    maxAge: COOKIE_MAX_AGE_S,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  redirect("/");
}
