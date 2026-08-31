import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/auth/supabase-server";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; sent?: string; error?: string }>;
}) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const params = await searchParams;
  // An authenticated user with an error param is the stranded case: bouncing
  // them to "/" just sends them straight back here. Render the mapped message
  // so they read words and get a next step instead of ping-ponging.
  if (user && !params.error) {
    // Same-origin paths only: "//host" or "https://…" in next must never
    // become an off-site redirect (mirrors safeNext in the auth callback).
    const next = params.next;
    redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Sign in to Beacon</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Beacon shows you the exact website changes that help more people
            find you on Google and in AI search. Nothing changes on your live
            site unless you approve it. Sign in with your email and password.
          </p>
        </div>
        <LoginForm
          next={params.next}
          sent={params.sent === "1"}
          error={params.error}
        />
      </div>
    </div>
  );
}
