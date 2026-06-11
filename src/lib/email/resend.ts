/**
 * 2026-06-10 — minimal email transport (P0 wall 6).
 *
 * Resend HTTP API via plain fetch — no SDK dependency. Fail-soft by
 * contract: a missing key/recipient returns a structured "not_configured"
 * result (the caller decides whether that's a skip or an error); a
 * provider failure returns "send_failed" with the response detail.
 *
 * Env:
 *   RESEND_API_KEY     — WAITING FOR OPERATOR (resend.com, free tier).
 *   BEACON_DIGEST_FROM — verified sender, e.g. "Beacon <beacon@yourdomain>".
 *                        Defaults to Resend's onboarding sender, which
 *                        delivers ONLY to the account owner's address —
 *                        fine for the single-operator digest.
 *   BEACON_DIGEST_TO   — operator inbox for the morning digest.
 *
 * NEVER log the key. This module logs status + provider error text only.
 */

const RESEND_API = "https://api.resend.com/emails";
const TIMEOUT_MS = 15_000;

export type SendEmailResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: "not_configured"; missing: string[] }
  | { sent: false; reason: "send_failed"; detail: string };

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Override the env sender (rare). */
  from?: string;
};

export function resolveEmailConfig(env: NodeJS.ProcessEnv = process.env): {
  apiKey: string | null;
  from: string;
  defaultTo: string | null;
} {
  const apiKey = env.RESEND_API_KEY?.trim() || null;
  const from = env.BEACON_DIGEST_FROM?.trim() || "Beacon <onboarding@resend.dev>";
  const defaultTo = env.BEACON_DIGEST_TO?.trim() || null;
  return { apiKey, from, defaultTo };
}

export async function sendEmail(
  input: SendEmailInput,
  deps: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<SendEmailResult> {
  const cfg = resolveEmailConfig(deps.env ?? process.env);
  const missing: string[] = [];
  if (cfg.apiKey == null) missing.push("RESEND_API_KEY");
  if (input.to.trim() === "") missing.push("BEACON_DIGEST_TO");
  if (missing.length > 0) return { sent: false, reason: "not_configured", missing };

  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: input.from ?? cfg.from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        sent: false,
        reason: "send_failed",
        detail: `http_${res.status}: ${detail.slice(0, 300)}`,
      };
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { sent: true, id: body.id ?? null };
  } catch (err) {
    return {
      sent: false,
      reason: "send_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
