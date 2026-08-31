import "server-only";

import { getSupabaseServerClient } from "@/lib/auth/supabase-server";

/** The three things a send can be. Raw provider prose never leaves this module: a broken auth
 *  provider once returned a Cloudflare HTML page, the JSON parse of it threw inside the server
 *  action, and the browser rendered the exception text on the sign-in form. */
type MagicLinkSend = "success" | "rate_limited" | "temporarily_unavailable";

const COPY: Record<Exclude<MagicLinkSend, "success">, string> = {
  // "Wait a minute" was a promise nobody could keep: the provider's send window is its own and ran for
  // hours, so the customer retried on Beacon's advice and was refused every time. The password is the
  // door that always answers, so the honest sentence points there and never predicts the email's return.
  rate_limited: "Sign-in email could not be sent right now. Use your password, or try the email option later.",
  temporarily_unavailable:
    "Sign-in email could not be sent just now. Nothing is wrong with your account. Try again in a few minutes.",
};

/**
 * Send one magic link. Returns null on success, otherwise plain customer copy. Never throws, never
 * retries (a retry can send duplicate sign-in emails), never returns provider text: the raw detail
 * goes to the server log only. Rate limiting is recognized from the provider's machine-readable
 * signal (HTTP 429 or the stable over_email_send_rate_limit code), never from message prose.
 */
export async function sendMagicLink(email: string, redirectTo: string): Promise<{ error: string | null }> {
  let kind: MagicLinkSend;
  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
    });
    if (error == null) {
      kind = "success";
    } else {
      const status = (error as { status?: number }).status;
      const code = (error as { code?: string }).code;
      console.error("[magic-link] provider returned an error", { status, code, message: error.message });
      kind = status === 429 || code === "over_email_send_rate_limit" ? "rate_limited" : "temporarily_unavailable";
    }
  } catch (e) {
    console.error("[magic-link] send threw:", e instanceof Error ? e.message : String(e));
    kind = "temporarily_unavailable";
  }
  return { error: kind === "success" ? null : COPY[kind] };
}
