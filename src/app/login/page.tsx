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
  if (user) {
    redirect(params.next || "/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Sign in to Beacon</h1>
          <p className="text-[12px] text-muted-foreground">
            Magic-link sign-in. Single-user dogfood.
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
