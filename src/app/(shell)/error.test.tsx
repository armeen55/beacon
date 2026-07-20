/**
 * ShellError - the (shell) route error boundary that catches /today and its
 * siblings. A bare "Reference: 2022542289" once meant nothing to a customer.
 * These pins keep the support code dynamic but reframe it as calm, on-my-side
 * recovery copy, and never leak the raw exception message.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import ShellError from "./error";

const noop = () => {};

describe("ShellError boundary", () => {
  it("reframes the failure as on-my-side, keeps the support code dynamic", () => {
    const err = Object.assign(new Error("Supabase query failed on changelog_entries"), {
      digest: "2022542289",
    });
    const html = renderToStaticMarkup(<ShellError error={err} reset={noop} />);
    expect(html).toContain("This page hit a snag on my side.");
    expect(html).toContain("Your data is safe and nothing was published.");
    expect(html).toContain("If it keeps happening, mention code 2022542289 to support.");
    // The digest is dynamic, not a hard-coded string.
    const other = Object.assign(new Error("boom"), { digest: "999" });
    expect(renderToStaticMarkup(<ShellError error={other} reset={noop} />)).toContain(
      "mention code 999 to support.",
    );
    // Never the bare, meaningless label, and never the raw exception message.
    expect(html).not.toContain("Reference: 2022542289");
    expect(html).not.toContain("Supabase");
    expect(html).not.toMatch(/[‒–—―]/);
  });

  it("shows no support line when there is no digest", () => {
    const html = renderToStaticMarkup(
      <ShellError error={new Error("no digest here")} reset={noop} />,
    );
    expect(html).not.toContain("mention code");
  });
});
