import { describe, expect, it } from "vitest";
import { isOwnedHost } from "./citation-adapter";

describe("Profound owned-host validation", () => {
  const owned = new Set(["example.com"]);

  it("accepts the owned root and its subdomains", () => {
    expect(isOwnedHost("example.com", owned)).toBe(true);
    expect(isOwnedHost("blog.example.com", owned)).toBe(true);
  });

  it("rejects lookalike suffixes", () => {
    expect(isOwnedHost("notexample.com", owned)).toBe(false);
    expect(isOwnedHost("example.com.attacker.test", owned)).toBe(false);
  });
});
