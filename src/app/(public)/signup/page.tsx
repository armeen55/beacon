/**
 * Public signup page. Mirrors the /login UX (magic link) and never exposes
 * tenant/admin language to the visitor.
 *
 * It is also the RECOVERY surface: an authenticated user whose workspace was
 * never created is sent here with an error param, and gets a "Try again" card
 * instead of the form. Redirecting them to "/" unconditionally was what left
 * a half-provisioned account with nowhere to go.
 */
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/auth/supabase-server";
import { SignupForm } from "./signup-form";
import { retryProvisioningAction } from "./actions";

export const dynamic = "force-dynamic";

function RecoveryCard() {
  return (
    <div className="space-y-3 rounded-md border border-foreground/15 p-4">
      <h1 className="text-base font-semibold">I could not finish setting up your account.</h1>
      <p className="text-[12px] text-muted-foreground">
        Your sign in worked, but I hit a problem creating your workspace. Try
        again below; if it keeps failing, sign out and use a fresh sign in link.
      </p>
      <div className="flex items-center gap-3">
        <form action={retryProvisioningAction}>
          <button
            type="submit"
            className="rounded-md bg-foreground px-4 py-2 text-[13px] font-semibold text-background"
          >
            Try again
          </button>
        </form>
        <form action="/auth/signout" method="post">
          <button type="submit" className="text-[12px] text-muted-foreground underline">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

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
  if (user && !params.error) {
    // Already authenticated and nothing went wrong, so the middleware decides
    // the post-auth landing.
    redirect("/");
  }
  if (user) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <RecoveryCard />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Create your Beacon account</h1>
          <p className="text-[12px] text-muted-foreground">
            Beacon shows you the exact website changes that get you recommended
            by AI assistants and found on Google. I write the exact copy; you
            paste it into your site and mark it done, then I measure what it
            did. Instead of a password, I email you a secure one time sign in
            link.
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
