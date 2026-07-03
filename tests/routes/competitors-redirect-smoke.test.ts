import { describe, it, expect, vi } from "vitest";

// FP10b (2026-07-02): /competitors retired as a top-level destination - its
// real intelligence ("who AI recommends instead of you") now lives on
// /prompts (competitor-rivals-section.tsx), fed by the same
// loadCompetitorIntel data this page used to render. This is now a thin
// redirect so old bookmarks and links keep working. This smoke asserts the
// redirect contract; Next.js turns a called redirect() into a 307 response
// at the framework level.
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

describe("Competitors route smoke", () => {
  it("/competitors redirects to /prompts (the real competitor intelligence lives there)", async () => {
    const { default: CompetitorsPageRedirect } = await import(
      "@/app/(shell)/competitors/page"
    );
    expect(() => CompetitorsPageRedirect()).toThrow("NEXT_REDIRECT:/prompts");
    expect(redirectMock).toHaveBeenCalledWith("/prompts");
  });
});
