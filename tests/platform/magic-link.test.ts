import { describe, expect, it, vi } from "vitest";
const otp = vi.fn();
vi.mock("@/lib/auth/supabase-server", () => ({ getSupabaseServerClient: async () => ({ auth: { signInWithOtp: otp } }) }));
const { sendMagicLink } = await import("@/lib/auth/magic-link");
const TO = "https://x/auth/callback";
const BUSY = "Sign-in email could not be sent just now. Nothing is wrong with your account. Try again in a few minutes.";
describe("magic link sending never shows provider text", () => {
  it("a thrown HTML-not-JSON failure, a returned provider error, a rate limit and a success each land on their one honest answer, with exactly one send per request", async () => {
    otp.mockRejectedValueOnce(new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"));
    const thrown = await sendMagicLink("a@b.com", TO);
    otp.mockResolvedValueOnce({ error: { message: 'AuthApiError: FATAL: role "authenticator" does not exist', status: 500 } });
    const returned = await sendMagicLink("a@b.com", TO);
    otp.mockResolvedValueOnce({ error: { message: "email rate limit exceeded", status: 429, code: "over_email_send_rate_limit" } });
    const limited = await sendMagicLink("a@b.com", TO);
    otp.mockResolvedValueOnce({ error: null });
    expect([thrown.error, returned.error, limited.error, (await sendMagicLink("a@b.com", TO)).error]).toEqual([
      BUSY, BUSY, "Sign-in email could not be sent right now. Use your password, or try the email option later.", null]); // a rate limit now points at the door that always answers, and never predicts when the email returns
    for (const r of [thrown, returned, limited]) expect(r.error).not.toMatch(/DOCTYPE|Unexpected token|AuthApiError|FATAL|[{<]/);
    expect(otp).toHaveBeenCalledTimes(4); // one provider call per request: no automatic retry, so never a duplicate sign-in email
  });});
