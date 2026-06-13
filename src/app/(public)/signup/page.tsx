/**
 * Public signup page — Gap B (2026-05-07).
 *
 * Mirrors the /login UX (magic-link). Branded as "Create your Beacon
 * account" — does not expose tenant/admin language to the visitor.
 *
 * After magic-link click, /auth/callback provisions a pending tenant
 * + tenant_members row for first-time users and redirects them to
 * /onboard/business. Existing users continue to /today.
 */
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/auth/supabase-server";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const params = await searchParams;
  if (user) {
    // Already authenticated — go to the post-auth landing decided by the
    // middleware (today's dashboard or /onboard/business if pending).
    redirect("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Create your Beacon account</h1>
          <p className="text-[12px] text-muted-foreground">
            Connect the tools you already use; Beacon finds evidence-backed
            edits to win AI citations and Google clicks, shows you the exact
            diff, and — for the ones you approve — pushes the eligible edits
            live to your site; the rest come as paste-ready steps. Magic-link
            sign-in — no password.
          </p>
        </div>
        <SignupForm sent={params.sent === "1"} error={params.error} />
        <p className="text-[12px] text-muted-foreground">
          Already have an account?{" "}
          <a href="/login" className="underline">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
