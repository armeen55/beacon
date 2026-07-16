import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8");

describe("server trace local-state boundary", () => {
  it("applies the exclusion to every route", () => {
    expect(source).toContain('"/**"');
  });

  it.each([
    ".data/**",
    "docs/**",
    "migrations/**",
    "scripts/**",
    "src/**",
    "supabase/**",
    "tests/**",
    "tmp/**",
  ])("keeps %s out of production server artifacts", (pattern) => {
    expect(source).toContain(`"${pattern}"`);
  });
});
