/**
 * ActivityPage (R14a, certified-fix 2026-07-20) - pins the server-side page
 * searchParam so a plain "?page=2" / "?page=3" deep link (what curl, SEO
 * crawlers, and no-JS visitors try first) actually renders the requested
 * slice server-side, instead of every page silently returning byte-identical
 * page-1 HTML. loadActivityFeed is mocked with a fixture stream so the test
 * exercises only the server component's own searchParams handling.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { ActivityEvent } from "@/domains/activity/activity-stream";

const { loadActivityFeed } = vi.hoisted(() => ({ loadActivityFeed: vi.fn() }));
vi.mock("./activity-data", () => ({ loadActivityFeed }));

import ActivityPage from "./page";

function mkEvent(i: number): ActivityEvent {
  return {
    at: new Date(Date.UTC(2026, 5, 1, 0, 0, i)).toISOString(),
    kind: "shipped",
    title: `Change live on /page-${i}`,
    sentence: `You shipped a description change on /page-${i}, and I am measuring it.`,
    href: `/results#proof-/page-${i}`,
    linkLabel: "See the result",
  };
}

async function renderAt(query: Record<string, string>): Promise<string> {
  const el = await ActivityPage({ searchParams: Promise.resolve(query) });
  return renderToStaticMarkup(el);
}

/** loadActivityFeed's real contract (composeActivityStream) always returns
 *  newest-first; pageActivityEvents only slices, it never sorts. Fixtures
 *  must honor that same newest-first order or the slice assertions below
 *  would be testing a shape the server loader never actually produces. */
function newestFirstFixture(count: number): ActivityEvent[] {
  return Array.from({ length: count }, (_, i) => mkEvent(count - 1 - i));
}

describe("ActivityPage searchParams paging (server-rendered slices)", () => {
  it("renders a different slice per ?page= value, newest first", async () => {
    const events = newestFirstFixture(120);
    loadActivityFeed.mockResolvedValue({ events, anyReadFailed: false });

    const page1 = await renderAt({});
    const page2 = await renderAt({ page: "2" });
    const page3 = await renderAt({ page: "3" });

    expect(page1).not.toBe(page2);
    expect(page2).not.toBe(page3);

    // Newest first: event 119 is newest, event 0 is oldest. 50 per page.
    expect(page1).toContain("Change live on /page-119");
    expect(page1).not.toContain("Change live on /page-69");

    expect(page2).toContain("Change live on /page-69");
    expect(page2).not.toContain("Change live on /page-119");
    expect(page2).not.toContain("Change live on /page-19");

    expect(page3).toContain("Change live on /page-19");
    expect(page3).toContain("Change live on /page-0");
    expect(page3).not.toContain("Change live on /page-69");
  });

  it("clamps an out-of-range or non-numeric ?page= to the nearest real page instead of erroring", async () => {
    const events = newestFirstFixture(120);
    loadActivityFeed.mockResolvedValue({ events, anyReadFailed: false });

    const tooHigh = await renderAt({ page: "999" });
    expect(tooHigh).toContain("Page 3 of 3, 120 entries in all.");

    const notANumber = await renderAt({ page: "banana" });
    expect(notANumber).toContain("Page 1 of 3, 120 entries in all.");
  });

  it("defaults to page 1 when no page param is present", async () => {
    const events = newestFirstFixture(120);
    loadActivityFeed.mockResolvedValue({ events, anyReadFailed: false });

    const html = await renderAt({});
    expect(html).toContain("Page 1 of 3, 120 entries in all.");
    expect(html).toContain("Change live on /page-119");
  });
});
