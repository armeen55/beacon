/**
 * /onboard/business — Gap B placeholder (2026-05-07).
 *
 * After a fresh signup completes via /auth/callback, the user lands
 * here. Today this page is intentionally a minimal welcome — Gap C
 * will replace it with the real 4-step wizard (business name +
 * website → cities/services → competitors → prompt review).
 *
 * Reads the user's tenant via the middleware-injected `x-beacon-tenant`
 * header (already wired in supabase-middleware.ts). Shows the tenant
 * status if available so the operator dogfeeding this flow can
 * confirm provisioning landed correctly.
 *
 * Operator-readable, customer-safe copy. No tenant/admin language.
 * No paid APIs. No mutations.
 */

import { getSupabaseServerClient } from "@/lib/auth/supabase-server";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { lookupExistingMembership } from "@/domains/onboarding/provision-tenant";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function OnboardBusinessPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Resolve the user's tenant (best-effort; if anything errors, we
  // still render a useful welcome — this page is intentionally
  // crash-resistant during the dogfeed phase).
  let tenantStatus: string | null = null;
  let tenantSlug: string | null = null;
  if (user) {
    try {
      const admin = getSupabaseAdmin();
      const membership = await lookupExistingMembership(admin, user.id);
      if (membership.tenantId) {
        const { data: tenant } = await admin
          .from("tenants")
          .select("slug, status")
          .eq("id", membership.tenantId)
          .maybeSingle();
        tenantSlug = tenant?.slug ?? null;
        tenantStatus = tenant?.status ?? null;
      }
    } catch {
      // Swallow — we'd rather render a welcome than 500 the page on
      // a Supabase blip during the dogfeed phase.
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Welcome to Beacon</h1>
          <p className="text-[14px] text-muted-foreground">
            Next we'll set up your business profile so Beacon can start
            tracking how AI search engines describe your company.
          </p>
        </div>

        <div className="rounded-md border border-foreground/15 p-4 text-[13px] space-y-2">
          <p className="font-medium">Coming up</p>
          <ol className="list-decimal pl-5 text-muted-foreground space-y-1">
            <li>Tell us your business name + website</li>
            <li>Confirm the cities + services you focus on</li>
            <li>Pick competitors you want to track</li>
            <li>Review the questions Beacon will ask AI engines daily</li>
          </ol>
          <p className="text-[12px] text-muted-foreground pt-2">
            Your first dashboard reading lands tomorrow morning — we'll
            email when it's ready.
          </p>
        </div>

        {/* Operator dogfeed surface — confirms provisioning landed. Hidden
            once the real wizard ships (Gap C); kept for now so the
            operator can verify the flow end-to-end. */}
        {tenantSlug && tenantStatus && (
          <div className="rounded-md border border-foreground/10 bg-surface-inset/40 p-3 text-[11px] text-muted-foreground space-y-1">
            <p className="font-mono">Beacon account: {tenantSlug}</p>
            <p className="font-mono">Status: {tenantStatus}</p>
          </div>
        )}

        <p className="text-[12px] text-muted-foreground">
          The full setup wizard is coming next.{" "}
          <Link href="/login" className="underline">
            Sign out / switch account
          </Link>
        </p>
      </div>
    </div>
  );
}
