import { describe, it, expect, vi } from "vitest";

// IA consolidation (2026-06-23): /changes index merged INTO Results (/proof).
// The index is now a thin redirect; the timeline lives on /proof via
// <ResultsTimeline/>. This smoke asserts the redirect contract. The render of
// the actual timeline is covered by tests/routes/results-timeline-smoke.test.ts.
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

describe("Changes route smoke", () => {
  it("the /changes index redirects to /proof (Results is the one results page)", async () => {
    const { default: ChangesIndexRedirect } = await import(
      "@/app/(shell)/changes/page"
    );
    expect(() => ChangesIndexRedirect()).toThrow("NEXT_REDIRECT:/proof");
    expect(redirectMock).toHaveBeenCalledWith("/proof");
  });
});
