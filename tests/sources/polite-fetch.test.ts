import { expect, it } from "vitest";
import { fetchPageHtml } from "@/domains/evidence/competitor-intel/polite-fetch";

const A = "https://publisher.example/a", B = "https://other.example/b", R = "https://publisher.example/robots.txt", S = "https://other.example/robots.txt";
const ALLOW = "User-agent: *\nAllow: /", DENY_A = "User-agent: *\nDisallow: /a", DENY_B = "User-agent: *\nDisallow: /b";
type Reply = { status: number; body?: string; location?: string; contentType?: string } | "network";
const ok = (body: string) => ({ status: 200, body }), moved = (location: string) => ({ status: 302, location });
const run = (plan: Record<string, Reply>, start = A) => {
  const calls: string[] = [], inits: RequestInit[] = [], cache = new Map();
  const fetchImpl = (async (raw: string, init: RequestInit) => {
    const url = String(raw), reply = plan[url]; calls.push(url); inits.push(init);
    if (!reply || reply === "network") throw new Error("network unavailable");
    return new Response(reply.body ?? "", { status: reply.status, headers: { ...(reply.location ? { location: reply.location } : {}),
      "content-type": reply.contentType ?? (url.endsWith("robots.txt") ? "text/plain" : "text/html") } });
  }) as typeof fetch;
  return { calls, inits, read: () => fetchPageHtml(start, cache, { fetchImpl,
    resolve: async (host) => [host === "private.example" ? "10.0.0.2" : "8.8.8.8"] }) };
};

it("enforces robots, pinned destination checks, redirects and the 500 KiB parser boundary", async () => {
  const first = { [R]: ok(ALLOW), [A]: moved(B) }, absent = { [R]: { status: 404 } };
  const tooLarge = `User-agent: *\n${("#" + "x".repeat(1000) + "\n").repeat(505)}Disallow: /a`;
  const chain = Object.fromEntries([A, ...[1, 2, 3, 4, 5].map((i) => `https://publisher.example/${i}`)].map((u, i, all) => [u, moved(all[i + 1] ?? B)]));
  const cases: { name: string; plan: Record<string, Reply>; calls: string[]; outcome: object; start?: string; repeat?: boolean; skip?: string }[] = [
    { name: "absent robots", plan: { ...absent, [A]: ok("<main>Public answer</main>") }, calls: [R, A], outcome: { ok: true, html: "<main>Public answer</main>", finalUrl: A } },
    { name: "server error", plan: { [R]: { status: 503 } }, calls: [R], outcome: { ok: false, reason: "robots_blocked" }, repeat: true },
    { name: "network error", plan: { [R]: "network" }, calls: [R], outcome: { ok: false, reason: "robots_blocked" }, repeat: true },
    { name: "oversized robots", plan: { [R]: ok(tooLarge) }, calls: [R], outcome: { ok: false, reason: "robots_blocked" }, repeat: true },
    { name: "destination disallow", plan: { ...first, [S]: ok(DENY_B) }, calls: [R, A, S], outcome: { ok: false, reason: "robots_blocked" } },
    { name: "redirected robots", plan: { [R]: moved("https://other.example/rules.txt"), "https://other.example/rules.txt": { ...ok(DENY_A), contentType: "text/plain" } }, calls: [R, "https://other.example/rules.txt"], outcome: { ok: false, reason: "robots_blocked" } },
    { name: "private literal", plan: { ...first, [A]: moved("http://127.0.0.1/admin") }, calls: [R, A], outcome: { ok: false, reason: "fetch_failed" } },
    { name: "private DNS", plan: first, start: "https://private.example/a", calls: [], outcome: { ok: false } },
    { name: "public hop", plan: { ...absent, [A]: moved(B), [S]: { status: 404 }, [B]: ok("<main>Other source</main>") }, calls: [R, A, S, B], outcome: { ok: true, finalUrl: B, html: "<main>Other source</main>" } },
    { name: "loop", plan: { ...absent, [A]: moved(B), [S]: { status: 404 }, [B]: moved(A) }, calls: [R, A, S, B], outcome: { ok: false } },
    { name: "hop cap", plan: { ...absent, ...chain }, calls: [R, A, ...[1, 2, 3, 4].map((i) => `https://publisher.example/${i}`)], outcome: { ok: false }, skip: "https://publisher.example/5" },
  ];
  for (const { name, plan, calls, outcome, start, repeat, skip } of cases) {
    const caseRun = run(plan, start); expect(await caseRun.read(), name).toMatchObject(outcome);
    if (repeat) expect(await caseRun.read(), `${name} cached`).toMatchObject(outcome);
    expect(caseRun.calls, name).toEqual(calls); expect(caseRun.inits.every((init) => init.redirect === "manual"), name).toBe(true);
    if (skip) expect(caseRun.calls).not.toContain(skip);
  }
});
