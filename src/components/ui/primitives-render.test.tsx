/**
 * primitives-render (FP6a) - render-shape tests for the design-system
 * primitives. Repo convention: no jsdom/@testing-library; components are
 * rendered with react-dom/server renderToStaticMarkup and asserted on the
 * emitted markup (see worklist-session-strip.test.tsx).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Card } from "./card";
import { Pill, type PillIntent } from "./pill";
import { SectionHeader } from "./section-header";
import { EmptyState } from "./empty-state";
import { PageShell } from "./page-shell";

const BANNED_DASH = /[‒–—―]/;

describe("Card", () => {
  it("renders the default variant on tokens with md padding", () => {
    const html = renderToStaticMarkup(<Card>Body copy</Card>);
    expect(html).toContain('data-slot="card"');
    expect(html).toContain("bg-card");
    expect(html).toContain("border-border");
    expect(html).toContain("rounded-xl");
    expect(html).toContain("p-4");
    expect(html).toContain("Body copy");
  });

  it("quiet variant uses the raised surface and subtle border", () => {
    const html = renderToStaticMarkup(<Card variant="quiet">x</Card>);
    expect(html).toContain("bg-surface-raised");
    expect(html).toContain("border-border-subtle");
    expect(html).toContain('data-variant="quiet"');
  });

  it("alert variant uses the danger status tokens", () => {
    const html = renderToStaticMarkup(<Card variant="alert">x</Card>);
    expect(html).toContain("bg-status-danger-bg");
    expect(html).toContain("border-status-danger/30");
  });

  it("padding scale works and custom classes merge", () => {
    expect(renderToStaticMarkup(<Card padding="none">x</Card>)).toContain("p-0");
    expect(renderToStaticMarkup(<Card padding="lg">x</Card>)).toContain("p-6");
    expect(
      renderToStaticMarkup(<Card className="mt-2">x</Card>)
    ).toContain("mt-2");
  });
});

describe("Pill", () => {
  const expected: Record<PillIntent, string> = {
    live: "text-status-success",
    waiting: "text-status-warning",
    measuring: "text-status-info",
    won: "bg-status-success",
    attention: "text-status-danger",
    neutral: "text-status-neutral",
  };

  it("renders all five intents plus neutral on status tokens", () => {
    for (const [intent, cls] of Object.entries(expected) as Array<
      [PillIntent, string]
    >) {
      const html = renderToStaticMarkup(<Pill intent={intent}>Live</Pill>);
      expect(html, `intent=${intent}`).toContain(cls);
      expect(html).toContain(`data-intent="${intent}"`);
      expect(html).toContain("rounded-full");
      expect(html).toContain("text-meta");
    }
  });

  it("won is the only filled treatment", () => {
    const won = renderToStaticMarkup(<Pill intent="won">Won</Pill>);
    expect(won).toContain("bg-status-success ");
    const live = renderToStaticMarkup(<Pill intent="live">Live</Pill>);
    expect(live).toContain("bg-status-success-bg");
    expect(live).not.toContain("bg-status-success ");
  });

  it("defaults to neutral", () => {
    expect(renderToStaticMarkup(<Pill>3 pages</Pill>)).toContain(
      'data-intent="neutral"'
    );
  });
});

describe("SectionHeader", () => {
  it("renders an h2 at text-section by default", () => {
    const html = renderToStaticMarkup(<SectionHeader title="Live changes" />);
    expect(html).toContain("<h2");
    expect(html).toContain("text-section");
    expect(html).toContain("Live changes");
  });

  it("renders an h3 at text-sub for subsections", () => {
    const html = renderToStaticMarkup(
      <SectionHeader level="h3" title="This week" />
    );
    expect(html).toContain("<h3");
    expect(html).toContain("text-sub");
    expect(html).not.toContain("text-section");
  });

  it("shows count, sub line, and the action slot when provided", () => {
    const html = renderToStaticMarkup(
      <SectionHeader
        title="Moves"
        count={12}
        sub="Ranked by expected clicks."
        action={<button type="button">See all</button>}
      />
    );
    expect(html).toContain(">12</span>");
    expect(html).toContain("Ranked by expected clicks.");
    expect(html).toContain("See all");
  });

  it("omits count when not a number (no bare parens, no phantom zero)", () => {
    const html = renderToStaticMarkup(<SectionHeader title="Moves" />);
    expect(html).not.toContain("tabular-nums");
  });
});

describe("EmptyState", () => {
  it("renders headline and next step with no icon markup", () => {
    const html = renderToStaticMarkup(
      <EmptyState
        headline="No changes are measuring yet."
        nextStep="Ship a move from the worklist and it will show up here."
      />
    );
    expect(html).toContain("No changes are measuring yet.");
    expect(html).toContain("Ship a move from the worklist");
    expect(html).toContain("border-dashed");
    expect(html).not.toContain("<svg");
  });

  it("headline alone renders without an empty next-step node", () => {
    const html = renderToStaticMarkup(<EmptyState headline="Nothing here." />);
    expect(html).toContain("Nothing here.");
    expect((html.match(/<p/g) ?? []).length).toBe(1);
  });
});

describe("PageShell", () => {
  it("renders one h1 at text-page inside the standard column", () => {
    const html = renderToStaticMarkup(
      <PageShell title="Results">
        <p>child</p>
      </PageShell>
    );
    expect(html).toContain("max-w-5xl");
    expect((html.match(/<h1/g) ?? []).length).toBe(1);
    expect(html).toContain("text-page");
    expect(html).toContain("Results");
    expect(html).toContain("child");
  });

  it("renders description and actions when provided", () => {
    const html = renderToStaticMarkup(
      <PageShell
        title="Results"
        description="Every change we shipped and what it did."
        actions={<button type="button">Refresh</button>}
      >
        <p>child</p>
      </PageShell>
    );
    expect(html).toContain("Every change we shipped and what it did.");
    expect(html).toContain("Refresh");
  });
});

describe("primitives emit no em/en dashes", () => {
  it("rendered output of every primitive is dash-clean", () => {
    const html = renderToStaticMarkup(
      <PageShell title="Results" description="What happened this week.">
        <SectionHeader title="Live changes" count={4} sub="Measuring now." />
        <Card variant="quiet">
          <Pill intent="measuring">Measuring</Pill>
        </Card>
        <EmptyState headline="Nothing here." nextStep="Connect a source." />
      </PageShell>
    );
    expect(BANNED_DASH.test(html)).toBe(false);
  });
});
