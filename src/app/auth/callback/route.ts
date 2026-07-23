import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/auth/supabase-server";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { provisionTenantForNewUser } from "@/domains/account";

/**
 * Supabase magic-link callback. Exchanges the `code` query param for a
 * session cookie, provisions a pending tenant + tenant_members row for
 * first-time users (Gap B, 2026-05-07), then redirects:
 *   - First-time user (no prior tenant_members row) → `/onboard/business`
 *   - Existing user (membership already present)    → `next` or `/`
 *
 * Provisioning is idempotent — repeat magic-link clicks after a
 * partial failure detect the existing tenant_members row and skip
 * the inserts. See provisionTenantForNewUser() for the contract.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  // Resolve the just-authenticated user so we can decide whether to
  // provision a tenant.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Auth exchange said OK but session is empty — extremely unusual.
    // Fail closed to /login so the user can retry.
    return NextResponse.redirect(
      `${origin}/login?error=session_missing_after_exchange`,
    );
  }

  // Provision (idempotent). Use the service-role admin client so the
  // INSERT can bypass RLS deny-all on the tenants table.
  const admin = getSupabaseAdmin();
  const provision = await provisionTenantForNewUser(admin, {
    userId: user.id,
    email: user.email ?? "",
  });

  if (!provision.ok) {
    // Provisioning failed mid-flight. Surface the error on /signup so
    // the user can retry; the next attempt will detect any orphaned
    // tenant row (idempotent inserts) and resume cleanly.
    console.error("[auth/callback] provisioning failed:", {
      userId: user.id,
      phase: provision.phase,
      error: provision.error,
    });
    return NextResponse.redirect(
      `${origin}/signup?error=${encodeURIComponent(`provisioning_${provision.phase}`)}`,
    );
  }

  // First-time signup → the URL-first entry (2026-07-03 R12/T0e): one site
  // address is enough to reach a first honest scorecard; the guided wizard
  // stays one link away on that page.
  // Repeat sign-in (membership already existed) → caller's `next` or `/`.
  if (provision.created) {
    return NextResponse.redirect(`${origin}/onboard`);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
