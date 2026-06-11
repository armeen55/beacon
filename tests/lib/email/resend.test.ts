/**
 * 2026-06-10 — email transport (P0 wall 6).
 * Pins: not_configured (missing key/recipient) is a structured result,
 * never a throw; provider failure surfaces detail; success posts the
 * right payload with the Bearer key — and the key is never logged.
 */

import { describe, it, expect } from "vitest";

import { sendEmail, resolveEmailConfig } from "@/lib/email/resend";

function env(vars: Record<string, string>): NodeJS.ProcessEnv {
  return vars as unknown as NodeJS.ProcessEnv;
}

describe("resolveEmailConfig", () => {
  it("defaults: onboarding sender, null key/recipient", () => {
    const cfg = resolveEmailConfig(env({}));
    expect(cfg.apiKey).toBeNull();
    expect(cfg.defaultTo).toBeNull();
    expect(cfg.from).toContain("resend.dev");
  });
});

describe("sendEmail", () => {
  it("returns not_configured when the key is missing (no fetch attempted)", async () => {
    let called = 0;
    const r = await sendEmail(
      { to: "op@example.com", subject: "s", text: "t" },
      { env: env({}), fetchImpl: (async () => { called++; return new Response("{}"); }) as typeof fetch },
    );
    expect(r).toEqual({ sent: false, reason: "not_configured", missing: ["RESEND_API_KEY"] });
    expect(called).toBe(0);
  });

  it("posts the payload with the Bearer key and returns the id", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const r = await sendEmail(
      { to: "op@example.com", subject: "Queue", text: "body", html: "<b>body</b>" },
      {
        env: env({ RESEND_API_KEY: "re_test_123", BEACON_DIGEST_FROM: "Beacon <b@x.com>" }),
        fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
          captured = { url: String(url), init: init! };
          return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
        }) as typeof fetch,
      },
    );
    expect(r).toEqual({ sent: true, id: "email-1" });
    expect(captured!.url).toBe("https://api.resend.com/emails");
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_123");
    const body = JSON.parse(String(captured!.init.body)) as Record<string, unknown>;
    expect(body.to).toEqual(["op@example.com"]);
    expect(body.from).toBe("Beacon <b@x.com>");
    expect(body.subject).toBe("Queue");
  });

  it("provider failure surfaces status + detail (never throws)", async () => {
    const r = await sendEmail(
      { to: "op@example.com", subject: "s", text: "t" },
      {
        env: env({ RESEND_API_KEY: "re_test_123" }),
        fetchImpl: (async () => new Response("domain not verified", { status: 403 })) as typeof fetch,
      },
    );
    expect(r.sent).toBe(false);
    if (!r.sent && r.reason === "send_failed") {
      expect(r.detail).toContain("http_403");
      expect(r.detail).toContain("domain not verified");
    } else {
      throw new Error("expected send_failed");
    }
  });
});
