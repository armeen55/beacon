/** THE PRIMARY DOOR. A magic link cannot be the only way in: the provider's send limit is reached long before an operator's day is, and the account then has no door at all. Password sign-in sends nothing, so it cannot be rate limited into silence. It grants no authority of its own: the session lands in the SAME cookie the middleware already reads, so the one-account membership rule (middleware-tenant-injection.test.ts) still decides which tenant is resolved and nothing is provisioned here. */
import { describe, it, expect, vi } from "vitest";
const seen = vi.hoisted(() => ({ logged: [] as string[] }));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("@/lib/auth/magic-link", () => ({ sendMagicLink: async () => ({ error: null }) }));
vi.mock("@/lib/auth/supabase-server", () => ({
  getSupabaseServerClient: async () => ({
    auth: { signInWithPassword: async (c: { password: string }) => (c.password === "the-real-one"
      ? { error: null }
      : { error: Object.assign(new Error("Invalid login credentials"), { status: 400, code: "invalid_credentials" }) }) },
  }) }));
import { signInWithPassword } from "@/app/login/actions";
describe("the operator signs in with a password, and the refusal tells an attacker nothing", () => {
  it("takes the right password, refuses the wrong one in Beacon's own words, and never repeats the secret anywhere", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { seen.logged.push(a.map((x) => JSON.stringify(x)).join(" ")); });
    expect(await signInWithPassword("owner@example.com", "the-real-one"), "a correct password is simply taken").toEqual({ error: null });
    const bad = await signInWithPassword("owner@example.com", "not-the-one");
    // ONE generic refusal for a wrong password AND an unknown address, or this form becomes a way to discover who has an account. The provider's own sentence never travels to the browser.
    expect(bad.error).toBe("That email and password do not match an account.");
    expect(`${bad.error}`).not.toMatch(/invalid login credentials|supabase|gotrue|400/i);
    expect(await signInWithPassword("not-an-email", "x"), "the shape is checked before the provider is asked").toEqual({ error: "Enter your email and your password." });
    expect(await signInWithPassword("owner@example.com", ""), "an empty password never reaches the provider").toEqual({ error: "Enter your email and your password." });
    // THE SECRET IS NEVER PART OF THE RECORD: not in the returned copy, not in the diagnostic line.
    expect(seen.logged.join(" "), "no server log may carry the password").not.toContain("not-the-one");
    expect(seen.logged.join(" "), "the diagnostic keeps only machine-readable signal").toMatch(/invalid_credentials|400/);
    spy.mockRestore(); });
});
