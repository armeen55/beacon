import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..", "..");

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

describe("customer journey does not terminate in engineering diagnostics", () => {
  it.each([
    ["src/app/(shell)/diagnostics/page.tsx", "/"],
    ["src/app/(shell)/diagnostics/brain/page.tsx", "/"],
    ["src/app/(shell)/diagnostics/spikes/page.tsx", "/results"],
    ["src/app/(shell)/diagnostics/action-packs/page.tsx", "/changes"],
  ])("redirects %s to %s", (path, destination) => {
    const page = source(path);
    expect(page).toContain(`redirect("${destination}")`);
  });

  it("keeps the customer new-page continuation inside Changes", () => {
    const section = source("src/app/(shell)/today-newpages-section.tsx");
    expect(section).toContain('href="/changes#new-pages"');
    expect(section).not.toContain('href="/diagnostics/rank-revenue"');
  });
});
