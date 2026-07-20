/**
 * ActivityList (R14a) - render pins for the /activity stream rows, the honest
 * empty state, and the paging links.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ActivityList } from "./activity-list";
import { pageActivityEvents, type ActivityEvent } from "@/domains/activity/activity-stream";

const mk = (over: Partial<ActivityEvent>): ActivityEvent => ({
  at: "2026-07-02T21:14:00.000Z",
  kind: "shipped",
  title: "Change live on /persian-cats",
  sentence: "You shipped a description change on /persian-cats, confirmed live, and I am measuring it against similar pages.",
  href: "/results#proof-/persian-cats::2026-07-02",
  linkLabel: "See the result",
  ...over,
});

describe("ActivityList (R14a)", () => {
  it("renders the honest empty state (what makes it non-empty, never a bare zero)", () => {
    const html = renderToStaticMarkup(<ActivityList paged={pageActivityEvents([], 1)} />);
    expect(html).toContain("Nothing logged yet.");
    expect(html).toContain("every action lands here with its receipt");
  });

  it("switches the empty state to a read-failure message when a load failed", () => {
    // An empty stream because a read FAILED must never read as "nothing
    // happened". Distinct, calm, no-data-lost copy with a next step.
    const html = renderToStaticMarkup(
      <ActivityList paged={pageActivityEvents([], 1)} loadFailed />,
    );
    expect(html).toContain("I could not load your activity just now. Nothing is lost.");
    expect(html).toContain("Refreshing usually fixes this");
    expect(html).toContain("retry on my next background pass");
    expect(html).not.toContain("Nothing logged yet.");
    expect(html).not.toMatch(/[‒–—―]/);
  });

  it("keeps the healthy empty state when loadFailed is false", () => {
    const html = renderToStaticMarkup(
      <ActivityList paged={pageActivityEvents([], 1)} loadFailed={false} />,
    );
    expect(html).toContain("Nothing logged yet.");
    expect(html).not.toContain("could not load your activity");
  });

  it("ignores loadFailed once there are rows to show", () => {
    const html = renderToStaticMarkup(
      <ActivityList paged={pageActivityEvents([mk({})], 1)} loadFailed />,
    );
    expect(html).toContain("Change live on /persian-cats");
    expect(html).not.toContain("could not load your activity");
  });

  it("renders when + what + one plain sentence + the deep link per row", () => {
    const html = renderToStaticMarkup(<ActivityList paged={pageActivityEvents([mk({})], 1)} />);
    expect(html).toContain("2026-07-02");
    expect(html).toContain("Change live on /persian-cats");
    expect(html).toContain("and I am measuring it against similar pages.");
    expect(html).toContain("See the result");
    expect(html).toContain("#proof-/persian-cats::2026-07-02");
    expect(html).not.toMatch(/[‒–—―]/);
  });

  it("pages at 50 with honest Newer/Older links and a total", () => {
    const events = Array.from({ length: 120 }, (_, i) =>
      mk({ at: new Date(Date.UTC(2026, 5, 1, 0, 0, i)).toISOString(), title: `t${i}` }),
    );
    const page2 = renderToStaticMarkup(<ActivityList paged={pageActivityEvents(events, 2)} />);
    expect(page2).toContain("Page 2 of 3, 120 entries in all.");
    expect(page2).toContain('href="/activity?p=1"');
    expect(page2).toContain('href="/activity?p=3"');
    const page1 = renderToStaticMarkup(<ActivityList paged={pageActivityEvents(events, 1)} />);
    expect(page1).not.toContain('href="/activity?p=0"');
  });
});
