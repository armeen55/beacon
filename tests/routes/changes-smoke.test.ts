import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// FP4 route-name unification (2026-07-03): /changes is now the REAL ranked
// Changes list (the page formerly at /worklist) and the old URLs are permanent
// redirects that preserve query strings. This smoke pins both redirect
// contracts so a regression can never silently strand a bookmark:
//   /worklist            -> /changes             (308)
//   /worklist?status=... -> /changes?status=...  (query preserved)
//   /proof               -> /results             (308, query preserved)
// The render of the Changes list itself is covered by the (shell) page tests;
// the results timeline render stays covered by
// tests/routes/changes-v2-switcher.test.ts.
const permanentRedirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  permanentRedirect: (url: string) => permanentRedirectMock(url),
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

describe("FP4 route redirects smoke", () => {
  it("/worklist permanently redirects to /changes", async () => {
    const { default: WorklistRedirect } = await import(
      "@/app/(shell)/worklist/page"
    );
    await expect(
      WorklistRedirect({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_REDIRECT:/changes");
    expect(permanentRedirectMock).toHaveBeenCalledWith("/changes");
  });

  it("/worklist preserves its query string through the redirect", async () => {
    const { default: WorklistRedirect } = await import(
      "@/app/(shell)/worklist/page"
    );
    await expect(
      WorklistRedirect({ searchParams: Promise.resolve({ status: "ready" }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/changes?status=ready");
  });

  it("/proof permanently redirects to /results (query preserved)", async () => {
    const { default: ProofRedirect } = await import("@/app/(shell)/proof/page");
    await expect(
      ProofRedirect({ searchParams: Promise.resolve({ page: "/cheetah" }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/results?page=%2Fcheetah");
  });

  it("the /changes index is the real Changes list, not a redirect", () => {
    const src = readFileSync(
      resolve(__dirname, "../../src/app/(shell)/changes/page.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/permanentRedirect|\bredirect\(/);
    expect(src).toContain('title="Changes"');
  });
});
