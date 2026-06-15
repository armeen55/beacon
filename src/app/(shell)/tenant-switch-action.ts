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

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { getSupabaseServerClient } from "@/lib/auth/supabase-server";
import {
  TENANT_COOKIE,
  TENANT_COOKIE_MAX_AGE_S,
  canSwitchToTenant,
} from "@/lib/tenant-cookie";

/**
 * #263 — where to send the operator after a successful switch.
 *
 * The switcher form posts only `tenant_id`, so without this the action
 * always dumped you back to "/", losing your place. We read the Referer
 * and redirect back to its PATHNAME — but ONLY when the Referer is
 * same-origin (its host matches the request host) and the path is a
 * safe in-app path. Anything external, malformed, or protocol-relative
 * falls back to "/" so we can never be tricked into redirecting to an
 * attacker-controlled URL.
 */
function safeReturnPathFromReferer(
  referer: string | null,
  host: string | null,
): string {
  if (!referer || !host) return "/";
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return "/"; // not an absolute URL — don't trust it
  }
  // Same-origin check: the Referer's host must equal the request host.
  if (url.host !== host) return "/";
  // Only redirect to in-app paths. `URL` already normalizes the
  // pathname (always starts with "/"), so a protocol-relative or
  // absolute target can't slip through here. Guard against "//host"
  // style paths defensively anyway.
  const path = url.pathname;
  if (!path.startsWith("/") || path.startsWith("//")) return "/";
  // Don't bounce back into auth/onboarding flows — home is safer there.
  if (path === "/login" || path.startsWith("/auth")) return "/";
  // Preserve the query string so e.g. /changes?tab=needs_review survives.
  return `${path}${url.search}`;
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
  if (error || !canSwitchToTenant(memberships ?? [], target)) {
    // Not a member (or lookup failed) — change nothing.
    redirect("/");
  }

  const cookieStore = await cookies();
  cookieStore.set(TENANT_COOKIE, target, {
    path: "/",
    maxAge: TENANT_COOKIE_MAX_AGE_S,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });

  // #263 — keep the operator on the page they were on (same-origin,
  // validated) instead of always dumping them at "/".
  const h = await headers();
  const dest = safeReturnPathFromReferer(h.get("referer"), h.get("host"));
  redirect(dest);
}
