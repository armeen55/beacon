/**
 * Sprint 6A.2e (2026-04-26) — CLI flag tests for `build-edits-for-queue.ts`.
 *
 * Pure tests over the exported `parseFlags` / `resolveProviderFlag`.
 * The script's `main()` is gated behind `process.env.VITEST !== "true"`
 * so importing this module here does NOT run the CLI.
 *
 * NO real network calls. NO real persistence. NO openai SDK touched.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  parseFlags,
  resolveProviderFlag,
} from "../../scripts/build-edits-for-queue";

describe("parseFlags — Sprint 6A.2e", () => {
  it("default flags have provider=null + limit=null + dry-run", () => {
    const flags = parseFlags([]);
    expect(flags.providerRaw).toBeNull();
    expect(flags.limit).toBeNull();
    expect(flags.write).toBe(false);
  });

  it("--provider=deterministic captured as raw value", () => {
    const flags = parseFlags(["--provider=deterministic"]);
    expect(flags.providerRaw).toBe("deterministic");
  });

  it("--provider=openai captured as raw value", () => {
    const flags = parseFlags(["--provider=openai"]);
    expect(flags.providerRaw).toBe("openai");
  });

  it("--provider=anthropic captured (validation happens in resolver)", () => {
    const flags = parseFlags(["--provider=anthropic"]);
    expect(flags.providerRaw).toBe("anthropic");
  });

  it("--limit=5 parsed as integer", () => {
    const flags = parseFlags(["--limit=5"]);
    expect(flags.limit).toBe(5);
  });

  it("--limit=0 captured as -1 sentinel (main reports invalid)", () => {
    const flags = parseFlags(["--limit=0"]);
    expect(flags.limit).toBe(-1);
  });

  it("--limit=abc captured as -1 sentinel", () => {
    const flags = parseFlags(["--limit=abc"]);
    expect(flags.limit).toBe(-1);
  });

  it("composes with existing flags (--all + --provider + --limit)", () => {
    const flags = parseFlags([
      "--all",
      "--provider=openai",
      "--limit=1",
    ]);
    expect(flags.all).toBe(true);
    expect(flags.providerRaw).toBe("openai");
    expect(flags.limit).toBe(1);
  });

  it("--rec-id alongside --provider", () => {
    const flags = parseFlags([
      "--rec-id=create_cluster_page:geo:Atherton",
      "--provider=openai",
    ]);
    expect(flags.recId).toBe("create_cluster_page:geo:Atherton");
    expect(flags.providerRaw).toBe("openai");
  });
});

describe("resolveProviderFlag — Sprint 6A.2e", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("null (unset) → ok deterministic", () => {
    const r = resolveProviderFlag(null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.name).toBe("deterministic");
      expect(r.provider.name).toBe("deterministic");
    }
  });

  it("'deterministic' → ok deterministic (no API key required)", () => {
    const r = resolveProviderFlag("deterministic");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.name).toBe("deterministic");
    }
  });

  it("'openai' with OPENAI_API_KEY → ok openai", () => {
    process.env.OPENAI_API_KEY = "sk-test-fixture";
    const r = resolveProviderFlag("openai");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.name).toBe("openai");
      expect(r.provider.name).toBe("openai");
    }
  });

  it("'openai' without OPENAI_API_KEY → error naming the env var", () => {
    delete process.env.OPENAI_API_KEY;
    const r = resolveProviderFlag("openai");
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toMatch(/OPENAI_API_KEY/);
    }
  });

  it("'openai' with whitespace OPENAI_API_KEY → error", () => {
    process.env.OPENAI_API_KEY = "   ";
    const r = resolveProviderFlag("openai");
    expect(r.kind).toBe("error");
  });

  it("'anthropic' → error with Sprint 6A.2 reference + suggested fallbacks", () => {
    process.env.OPENAI_API_KEY = "sk-test-fixture";
    const r = resolveProviderFlag("anthropic");
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toMatch(/Sprint 6A\.2/);
      expect(r.message).toMatch(/deterministic/);
      expect(r.message).toMatch(/openai/);
    }
  });

  it("invalid name → error with allowed-values list", () => {
    const r = resolveProviderFlag("totally-bogus");
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toMatch(/Invalid --provider/);
      expect(r.message).toMatch(/deterministic/);
      expect(r.message).toMatch(/openai/);
    }
  });

  it("empty string treated as default (deterministic)", () => {
    const r = resolveProviderFlag("");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.name).toBe("deterministic");
    }
  });
});
