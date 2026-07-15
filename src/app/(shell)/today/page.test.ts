import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Today compatibility route", () => {
  it("keeps /today as a redirect to the canonical Today route", () => {
    const source = readFileSync(join(process.cwd(), "src/app/(shell)/today/page.tsx"), "utf8");
    expect(source).toContain('redirect("/")');
  });
});
