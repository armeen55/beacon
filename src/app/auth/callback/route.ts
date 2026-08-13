import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/auth/supabase-server";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { provisionTenantForNewUser, resolveAccountAccess } from "@/domains/account";

/**
 * Supabase magic-link callback. Exchanges the `code` query param for a
 * session cookie, provisions a pending tenant + tenant_members row for
 * first-time users, then routes by lifecycle:
 *   - First-time user (no prior tenant_members row) → `/onboard`
 *   - Returning user, onboarding unfinished         → `/onboard`
 *   - Returning user, onboarding done               → `next` or `/`
 *
 * Provisioning is idempotent: a repeat magic-link click after a partial
 * failure detects the existing tenant_members row and skips the inserts.
 */

/** Only same-origin app paths may be honored. A protocol-relative "//evil.com"
 *  is a real open redirect, so anything that is not a single-slash path is
 *  dropped back to "/". */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // THE PROVIDER'S OWN WORDS NEVER TRAVEL IN THE URL. "AuthApiError: invalid flow state, no valid flow state
    // found" rendered on the sign-in screen reads as a bug report and tells the customer nothing to do. The
    // detail is logged where support can read it; the customer gets one known code with one next step.
    console.error("[auth/callback] code exchange failed:", error.message);
    return NextResponse.redirect(`${origin}/login?error=link_invalid`);
  }

  // Resolve the just-authenticated user so we can decide whether to
  // provision a tenant.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Auth exchange said OK but session is empty, which is extremely unusual.
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
    // Provisioning failed mid-flight. Surface the error on /signup, which
    // renders a "Try again" card for the signed-in user; the retry detects any
    // orphaned tenant row (idempotent inserts) and resumes cleanly.
    console.error("[auth/callback] provisioning failed:", {
      userId: user.id,
      phase: provision.phase,
      error: provision.error,
    });
    return NextResponse.redirect(
      `${origin}/signup?error=${encodeURIComponent(`provisioning_${provision.phase}`)}`,
    );
  }

  // First-time signup → the URL-first entry: one site address is enough to
  // reach a first honest scorecard, and the guided wizard stays one link away.
  if (provision.created) {
    return NextResponse.redirect(`${origin}/onboard`);
  }

  // Repeat sign-in. Routing on `created` alone stranded anyone who quit
  // onboarding halfway: they landed on "/" with no way back to /onboard. Read
  // the lifecycle instead. A transient read failure falls through to `next` so
  // a slow database never blocks a valid sign-in.
  try {
    const access = await resolveAccountAccess(provision.tenantId);
    if (access.kind === "incomplete") {
      return NextResponse.redirect(`${origin}/onboard${access.step ? `?step=${access.step}` : ""}`);
    }
  } catch (e) {
    console.error("[auth/callback] lifecycle read failed:", e);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
