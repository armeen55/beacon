import "server-only";

import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/**
 * Cookie-backed Supabase client for Server Components, Route Handlers, and
 * Server Actions. Distinct from `getSupabaseAdmin()` in
 * `src/lib/persistence/supabase.ts`, which uses the service role key and is
 * NOT tied to any user session. Use this one when you need `auth.getUser()`
 * or `auth.signInWithOtp()`.
 */
export async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            for (const { name, value, options } of toSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components can't set cookies — middleware covers refresh.
          }
        },
      },
    },
  );
}
