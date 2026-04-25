import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { buildSpecificEditEvidencePacket } from "../specific-edit-evidence";
import type { SpecificEditEvidencePacket } from "../specific-edit-evidence";
import {
  deterministicProvider,
  openaiProvider,
  anthropicProvider,
  PROVIDERS,
  getProvider,
} from "./index";
import {
  emptyBundleFor,
  type SpecificEditBundle,
  type SpecificEdit,
  type SpecificEditProvider,
} from "../specific-edit-provider";
import {
  NOT_IMPLEMENTED_MESSAGE as OPENAI_NOT_IMPL,
} from "./openai";
import {
  NOT_IMPLEMENTED_MESSAGE as ANTHROPIC_NOT_IMPL,
} from "./anthropic";

// ---------------------------------------------------------------------------
// Sprint 6A.1 Phase 8 — provider interface + 3 implementations.
//
// Phase 8 ships the SHELL only:
//   - deterministic: returns empty bundle (Phase 6A.1.9 fills in
//     generators)
//   - openai / anthropic: stubs that throw not_implemented so any
//     premature caller hits a loud failure
// ---------------------------------------------------------------------------

// ── Fixture: minimal valid packet ─────────────────────────────────────────

const FROZEN_NOW = new Date("2026-04-24T12:00:00Z");

function makePacket(
  overrides: Partial<SpecificEditEvidencePacket> = {},
): SpecificEditEvidencePacket {
  const base = buildSpecificEditEvidencePacket({
    tenantId: "tenant-test",
    recId: "rec-2026-04-24-1",
    clusterLabel: "neutral cluster",
    clusterKind: "topic",
    affectedPromptIds: [],
    promptOpportunities: [],
    trackedPrompts: [],
    primarySummaries: [],
    ownedPageInventory: [],
    pageElementInventory: [],
    now: FROZEN_NOW,
  });
  return { ...base, ...overrides };
}

// ── Interface contract: name + signature ──────────────────────────────────

describe("Phase 6A.1.8 — SpecificEditProvider interface contract", () => {
  it.each([
    ["deterministic", deterministicProvider],
    ["openai", openaiProvider],
    ["anthropic", anthropicProvider],
  ] as const)(
    "%s provider exposes correct name + async generate signature",
    (expectedName, provider) => {
      expect(provider.name).toBe(expectedName);
      expect(typeof provider.generate).toBe("function");
      // The interface contract: generate() returns a Promise.
      const packet = makePacket();
      const result = provider.generate(packet);
      // Every provider — even the stubs — returns a thenable. Stubs
      // reject; the deterministic provider resolves.
      expect(result).toBeInstanceOf(Promise);
      // Catch the stub rejection so vitest doesn't flag unhandled.
      result.catch(() => {});
    },
  );

  it("PROVIDERS registry covers every SpecificEditProviderName key", () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual([
      "anthropic",
      "deterministic",
      "openai",
    ]);
  });

  it("getProvider returns the registry entry", () => {
    expect(getProvider("deterministic")).toBe(deterministicProvider);
    expect(getProvider("openai")).toBe(openaiProvider);
    expect(getProvider("anthropic")).toBe(anthropicProvider);
  });
});

// ── Deterministic provider behavior ───────────────────────────────────────

describe("Phase 6A.1.8 — deterministic provider shell", () => {
  it("returns a valid bundle with empty recommendations (Phase 9 will fill)", async () => {
    const packet = makePacket();
    const bundle = await deterministicProvider.generate(packet);
    expect(bundle.schemaVersion).toBe("specific-edit-bundle/v1");
    expect(bundle.providerName).toBe("deterministic");
    expect(bundle.recommendations).toEqual([]);
    expect(bundle.totalCostUsd).toBe(0);
  });

  it("threads tenantId / recId / evidenceHash from the packet to the bundle", async () => {
    const packet = makePacket();
    const bundle = await deterministicProvider.generate(packet);
    expect(bundle.tenantId).toBe(packet.tenantId);
    expect(bundle.recId).toBe(packet.recId);
    expect(bundle.evidenceHash).toBe(packet.evidenceHash);
  });

  it("does not mutate the input packet", async () => {
    const packet = makePacket();
    const before = JSON.stringify(packet);
    await deterministicProvider.generate(packet);
    const after = JSON.stringify(packet);
    expect(after).toBe(before);
  });

  it("output is JSON-serializable + round-trips losslessly", async () => {
    const packet = makePacket();
    const bundle = await deterministicProvider.generate(packet);
    const json = JSON.stringify(bundle);
    const parsed = JSON.parse(json) as SpecificEditBundle;
    expect(parsed).toEqual(bundle);
  });

  it("output contains no functions, no Date/Map/Set/class instances, no undefined values", async () => {
    const packet = makePacket();
    const bundle = await deterministicProvider.generate(packet);
    const offenders: string[] = [];
    walk(bundle, "$");
    expect(offenders).toEqual([]);

    function walk(value: unknown, path: string): void {
      if (value === null) return;
      if (value === undefined) {
        offenders.push(`${path}: undefined`);
        return;
      }
      const t = typeof value;
      if (t === "function") {
        offenders.push(`${path}: function`);
        return;
      }
      if (t === "string" || t === "number" || t === "boolean") return;
      if (t === "symbol" || t === "bigint") {
        offenders.push(`${path}: ${t}`);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${path}[${i}]`));
        return;
      }
      if (t === "object") {
        const proto = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null) {
          const ctor =
            (value as { constructor?: { name?: string } }).constructor?.name ??
            "unknown";
          offenders.push(`${path}: non-plain-object (${ctor})`);
          return;
        }
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          walk(v, `${path}.${k}`);
        }
        return;
      }
    }
  });
});

// ── OpenAI stub behavior ──────────────────────────────────────────────────

describe("Phase 6A.1.8 — openai provider stub", () => {
  it("throws not_implemented when generate() is called", async () => {
    await expect(openaiProvider.generate(makePacket())).rejects.toThrow(
      OPENAI_NOT_IMPL,
    );
  });

  it("the not_implemented message references Sprint 6A.2 (the activation milestone)", () => {
    expect(OPENAI_NOT_IMPL).toMatch(/6A\.2/i);
  });
});

// ── Anthropic stub behavior ───────────────────────────────────────────────

describe("Phase 6A.1.8 — anthropic provider stub", () => {
  it("throws not_implemented when generate() is called", async () => {
    await expect(anthropicProvider.generate(makePacket())).rejects.toThrow(
      ANTHROPIC_NOT_IMPL,
    );
  });

  it("the not_implemented message references Sprint 6A.2 (the activation milestone)", () => {
    expect(ANTHROPIC_NOT_IMPL).toMatch(/6A\.2/i);
  });
});

// ── emptyBundleFor helper ─────────────────────────────────────────────────

describe("Phase 6A.1.8 — emptyBundleFor helper", () => {
  it("threads packet metadata + provider identity into a fresh bundle skeleton", () => {
    const packet = makePacket();
    const bundle = emptyBundleFor(packet, "openai", FROZEN_NOW);
    expect(bundle.providerName).toBe("openai");
    expect(bundle.tenantId).toBe(packet.tenantId);
    expect(bundle.recId).toBe(packet.recId);
    expect(bundle.evidenceHash).toBe(packet.evidenceHash);
    expect(bundle.generatedAt).toBe(FROZEN_NOW.toISOString());
    expect(bundle.recommendations).toEqual([]);
    expect(bundle.totalCostUsd).toBe(0);
  });

  it("returns a fresh object — generators may mutate the recommendations array", () => {
    const packet = makePacket();
    const a = emptyBundleFor(packet, "deterministic", FROZEN_NOW);
    const b = emptyBundleFor(packet, "deterministic", FROZEN_NOW);
    expect(a).not.toBe(b);
    expect(a.recommendations).not.toBe(b.recommendations);
  });
});

// ── Output type-shape sanity ──────────────────────────────────────────────

describe("Phase 6A.1.8 — SpecificEdit type shape", () => {
  it("a fully-populated SpecificEdit fixture is JSON-serializable + round-trips", () => {
    const fixture: SpecificEdit = {
      actionType: "edit_title",
      targetUrl: "https://example.com/services/braces",
      targetElement: {
        elementKey: "title[0]:hash-aaa",
        displayLabel: "Title",
        currentText: "Braces · Acme",
        proposedText: "Teen Braces in Burbank · Acme Orthodontics",
      },
      why: "Title misses both cluster terms (teens + Burbank) cited by AI.",
      evidence: [
        { type: "prompt", promptId: "p-1" },
        {
          type: "element",
          elementKey: "title[0]:hash-aaa",
          url: "https://example.com/services/braces",
        },
        { type: "competitor", competitorName: "AcmeOrtho" },
      ],
      expectedImpact: "Recover top-of-answer citations on 3 affected prompts.",
      difficulty: "low",
      confidence: "medium",
      measurementPlan: "Re-poll 3 prompts at T+7 / T+14.",
      risks: ["Title length may exceed 60 chars on mobile."],
      source: "deterministic",
      providerName: "deterministic",
      model: null,
      costUsd: null,
    };
    const json = JSON.stringify(fixture);
    const parsed = JSON.parse(json) as SpecificEdit;
    expect(parsed).toEqual(fixture);
  });

  it("a page-level lifecycle SpecificEdit (create_page) fixture allows null targetElement", () => {
    const fixture: SpecificEdit = {
      actionType: "create_page",
      targetUrl: "needs_new_page",
      targetElement: null,
      why: "No owned page covers this cluster.",
      evidence: [{ type: "prompt", promptId: "p-1" }],
      expectedImpact: null,
      difficulty: "high",
      confidence: "low",
      measurementPlan: null,
      risks: [],
      source: "deterministic",
      providerName: "deterministic",
      model: null,
      costUsd: null,
    };
    expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture);
  });
});

// ── Source-scan invariants ────────────────────────────────────────────────

function walkSync(dir: string, predicate: (p: string) => boolean): string[] {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = readdirSync(cur);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(cur, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(full);
      else if (st.isFile() && predicate(full)) out.push(full);
    }
  }
  return out;
}

const PROVIDERS_DIR = resolve(__dirname);
const APP_DIR = resolve(__dirname, "../../../app");

describe("Phase 6A.1.8 — provider source-scan invariants", () => {
  it("provider files do NOT import the openai SDK or @anthropic-ai/sdk (Phase 8 stays SDK-free)", () => {
    const providerFiles = walkSync(PROVIDERS_DIR, (p) =>
      /\.(ts)$/.test(p) && !p.endsWith(".test.ts"),
    );
    expect(providerFiles.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of providerFiles) {
      const src = readFileSync(file, "utf8");
      // Match any import / require of openai or @anthropic-ai/sdk.
      if (
        /from\s+["']openai["']/.test(src) ||
        /require\(["']openai["']\)/.test(src) ||
        /from\s+["']@anthropic-ai\/sdk["']/.test(src) ||
        /require\(["']@anthropic-ai\/sdk["']\)/.test(src)
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no app route page.tsx or route.ts imports any provider", () => {
    const matches = walkSync(
      APP_DIR,
      (p) => p.endsWith("/page.tsx") || p.endsWith("/route.ts"),
    );
    const offenders: string[] = [];
    for (const file of matches) {
      const src = readFileSync(file, "utf8");
      if (
        /from\s+["'][^"']*recommendations\/providers/.test(src) ||
        /from\s+["'][^"']*recommendations\/specific-edit-provider["']/.test(
          src,
        ) ||
        /\bdeterministicProvider\b/.test(src) ||
        /\bopenaiProvider\b/.test(src) ||
        /\banthropicProvider\b/.test(src) ||
        /\bgetProvider\b/.test(src)
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("provider files have NOT added any new top-level dep to package.json (no openai / @anthropic-ai/sdk)", () => {
    const pkgPath = resolve(__dirname, "../../../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    expect(all["openai"]).toBeUndefined();
    expect(all["@anthropic-ai/sdk"]).toBeUndefined();
  });
});

// ── Provider interface uses SpecificEditEvidencePacket ────────────────────

describe("Phase 6A.1.8 — interface accepts SpecificEditEvidencePacket", () => {
  it("a packet built by Phase 7's buildSpecificEditEvidencePacket flows through every provider's generate()", async () => {
    const packet = makePacket();
    // deterministic: must succeed.
    const detBundle = await deterministicProvider.generate(packet);
    expect(detBundle.evidenceHash).toBe(packet.evidenceHash);
    // stubs: must reject (we already covered the message; here we
    // assert the call EVEN COMPILES against the SpecificEditEvidencePacket
    // type).
    await expect(
      (openaiProvider as SpecificEditProvider).generate(packet),
    ).rejects.toThrow();
    await expect(
      (anthropicProvider as SpecificEditProvider).generate(packet),
    ).rejects.toThrow();
  });
});
