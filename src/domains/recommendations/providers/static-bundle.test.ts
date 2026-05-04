/**
 * W3 Step 3.10 (2026-05-03) — static-bundle provider tests.
 *
 * Pin the operator-locked replay contract:
 *   - generate() returns the saved bundle verbatim.
 *   - tenantId / recId / evidenceHash mismatch → throws (operator
 *     loaded the wrong bundle for this rec).
 *   - looksLikeSpecificEditBundle catches malformed JSON.
 *   - The provider's `name` mirrors the bundle's `providerName` so
 *     telemetry shows the original source.
 */

import { describe, expect, it } from "vitest";
import {
  looksLikeSpecificEditBundle,
  staticBundleProvider,
  STATIC_BUNDLE_PROVIDER_TAG,
} from "./static-bundle";
import type {
  SpecificEditBundle,
  SpecificEditProvider,
} from "../specific-edit-provider";
import type { SpecificEditEvidencePacket } from "../specific-edit-evidence";

// ── Fixture builders ───────────────────────────────────────────────────

function makePacket(
  overrides: Partial<SpecificEditEvidencePacket> = {},
): SpecificEditEvidencePacket {
  const base: SpecificEditEvidencePacket = {
    schemaVersion: "specific-edit/v1",
    generatedAt: "2026-05-03T00:00:00Z",
    tenantId: "ritz-builders",
    recId: "rec-test",
    clusterId: null,
    clusterLabel: "Whole Home Renovation Builders",
    clusterKind: "topic",
    affectedPrompts: [],
    ownedPageCandidates: [],
    targetPageElements: [],
    competitorAngles: [],
    priorOutcomes: [],
    allowedTargetUrls: ["https://example.com/services/whole-home-remodel"],
    allowedActionTypes: ["add_h2_section"],
    aiSearchSignal: {
      topSearchQueries: [],
      topDescriptors: [],
      topCompetitorCoMentions: [],
      caps: {
        maxSearchQueries: 10,
        maxDescriptors: 12,
        maxCompetitorCoMentions: 8,
      },
    },
    competitorPageBlueprints: [],
    crossTenantPatterns: [],
    brandAssertions: [],
    evidenceHash: "deadbeef00000000",
  };
  return { ...base, ...overrides };
}

function makeBundle(
  overrides: Partial<SpecificEditBundle> = {},
): SpecificEditBundle {
  const base: SpecificEditBundle = {
    schemaVersion: "specific-edit-bundle/v1",
    generatedAt: "2026-05-03T00:00:00Z",
    tenantId: "ritz-builders",
    recId: "rec-test",
    evidenceHash: "deadbeef00000000",
    providerName: "openai",
    recommendations: [
      {
        actionType: "add_h2_section",
        targetUrl: "https://example.com/services/whole-home-remodel",
        targetElement: {
          elementKey: "h2[new]:abc12345",
          displayLabel: "Architect-led design-build advantage",
          currentText: null,
          proposedText:
            "Ritz Builders emphasizes an architect-led design-build approach. Our team coordinates architecture, engineering, and permitting from concept through completion.",
        },
        why: "evidence-grounded reasoning",
        evidence: [],
        expectedImpact: null,
        difficulty: "low",
        confidence: "medium",
        measurementPlan: null,
        risks: [],
        source: "openai",
        providerName: "openai",
        model: "gpt-5-mini",
        costUsd: 0.005,
      },
    ],
    totalCostUsd: 0.005,
  };
  return { ...base, ...overrides };
}

// ── Provider behavior ─────────────────────────────────────────────────

describe("staticBundleProvider", () => {
  it("returns the saved bundle verbatim when packet matches", async () => {
    const bundle = makeBundle();
    const packet = makePacket();
    const provider: SpecificEditProvider = staticBundleProvider(bundle);
    const result = await provider.generate(packet);
    // Same reference (no clone).
    expect(result).toBe(bundle);
    expect(result.recommendations.length).toBe(1);
    expect(result.providerName).toBe("openai");
  });

  it("provider.name mirrors the bundle's providerName ('openai')", () => {
    const bundle = makeBundle({ providerName: "openai" });
    const provider = staticBundleProvider(bundle);
    expect(provider.name).toBe("openai");
  });

  it("provider.name mirrors deterministic bundles too", () => {
    const bundle = makeBundle({ providerName: "deterministic" });
    const provider = staticBundleProvider(bundle);
    expect(provider.name).toBe("deterministic");
  });

  it("throws on tenantId mismatch (operator loaded the wrong bundle)", async () => {
    const bundle = makeBundle({ tenantId: "other-tenant" });
    const packet = makePacket({ tenantId: "ritz-builders" });
    const provider = staticBundleProvider(bundle);
    await expect(provider.generate(packet)).rejects.toThrow(
      /tenantId mismatch/,
    );
  });

  it("throws on recId mismatch", async () => {
    const bundle = makeBundle({ recId: "different-rec" });
    const packet = makePacket({ recId: "rec-test" });
    const provider = staticBundleProvider(bundle);
    await expect(provider.generate(packet)).rejects.toThrow(/recId mismatch/);
  });

  it("throws on evidenceHash mismatch (live evidence has shifted)", async () => {
    const bundle = makeBundle({ evidenceHash: "0000000000000000" });
    const packet = makePacket({ evidenceHash: "deadbeef00000000" });
    const provider = staticBundleProvider(bundle);
    await expect(provider.generate(packet)).rejects.toThrow(
      /evidenceHash mismatch/,
    );
  });

  it("error message includes ALL mismatched fields when multiple are off", async () => {
    const bundle = makeBundle({
      tenantId: "wrong-tenant",
      recId: "wrong-rec",
      evidenceHash: "0000000000000000",
    });
    const packet = makePacket({
      tenantId: "ritz-builders",
      recId: "rec-test",
      evidenceHash: "deadbeef00000000",
    });
    const provider = staticBundleProvider(bundle);
    try {
      await provider.generate(packet);
      throw new Error("expected throw");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toMatch(/tenantId mismatch/);
      expect(msg).toMatch(/recId mismatch/);
      expect(msg).toMatch(/evidenceHash mismatch/);
    }
  });

  it("STATIC_BUNDLE_PROVIDER_TAG is 'static' (diagnostic constant)", () => {
    expect(STATIC_BUNDLE_PROVIDER_TAG).toBe("static");
  });

  // ── W3 §3.12 — allowEvidenceHashDrift (rec-id-override path) ─────────

  it("allowEvidenceHashDrift=true relaxes the evidenceHash check while still enforcing tenantId + recId", async () => {
    const bundle = makeBundle({ evidenceHash: "saved-hash-1234" });
    const packet = makePacket({ evidenceHash: "live-hash-5678" });
    const provider = staticBundleProvider(bundle, {
      allowEvidenceHashDrift: true,
    });
    const result = await provider.generate(packet);
    // The returned bundle's evidenceHash is grafted to the live
    // packet's hash so downstream cache + telemetry use the current
    // packet's identity.
    expect(result.evidenceHash).toBe("live-hash-5678");
    // Original bundle reference is NOT mutated.
    expect(bundle.evidenceHash).toBe("saved-hash-1234");
    // Recommendations carry through verbatim.
    expect(result.recommendations).toEqual(bundle.recommendations);
  });

  it("allowEvidenceHashDrift=true STILL throws on tenantId mismatch", async () => {
    const bundle = makeBundle({
      tenantId: "other-tenant",
      evidenceHash: "saved-hash",
    });
    const packet = makePacket({
      tenantId: "ritz-builders",
      evidenceHash: "live-hash",
    });
    const provider = staticBundleProvider(bundle, {
      allowEvidenceHashDrift: true,
    });
    await expect(provider.generate(packet)).rejects.toThrow(
      /tenantId mismatch/,
    );
  });

  it("allowEvidenceHashDrift=true STILL throws on recId mismatch (the override pre-grafts recId; mismatch here means a real mistake)", async () => {
    const bundle = makeBundle({
      recId: "different-rec",
      evidenceHash: "saved-hash",
    });
    const packet = makePacket({
      recId: "rec-test",
      evidenceHash: "live-hash",
    });
    const provider = staticBundleProvider(bundle, {
      allowEvidenceHashDrift: true,
    });
    await expect(provider.generate(packet)).rejects.toThrow(/recId mismatch/);
  });

  it("default (allowEvidenceHashDrift omitted) keeps the §3.10 strict equality contract", async () => {
    const bundle = makeBundle({ evidenceHash: "saved-hash" });
    const packet = makePacket({ evidenceHash: "live-hash" });
    const provider = staticBundleProvider(bundle); // no options
    await expect(provider.generate(packet)).rejects.toThrow(
      /evidenceHash mismatch/,
    );
  });

  it("recId-override pre-graft pattern + allowEvidenceHashDrift = clean replay (no model call)", async () => {
    // Simulate the CLI path: operator passes --rec-id-override; the
    // script grafts bundle.recId in memory + opts the provider into
    // hash drift. The exact saved-bytes recommendations[] flow
    // through unchanged.
    const savedBundle = makeBundle({
      recId: "create_single:prompt:7130b218-...", // original
      evidenceHash: "saved-hash",
    });
    const overrideRecId = "create_cluster_page:geo:Cupertino";
    const livePacket = makePacket({
      recId: overrideRecId,
      evidenceHash: "live-hash-after-cluster-promotion",
    });
    // Script-side graft (in-memory only).
    const grafted = { ...savedBundle, recId: overrideRecId };
    const provider = staticBundleProvider(grafted, {
      allowEvidenceHashDrift: true,
    });
    const result = await provider.generate(livePacket);
    expect(result.recId).toBe(overrideRecId);
    expect(result.evidenceHash).toBe("live-hash-after-cluster-promotion");
    // The exact saved bytes (recommendations + costUsd + provenance)
    // ride through.
    expect(result.recommendations).toEqual(savedBundle.recommendations);
    expect(result.totalCostUsd).toBe(savedBundle.totalCostUsd);
    expect(result.providerName).toBe(savedBundle.providerName);
  });
});

// ── Type guard ─────────────────────────────────────────────────────────

describe("looksLikeSpecificEditBundle", () => {
  it("accepts a well-formed bundle", () => {
    expect(looksLikeSpecificEditBundle(makeBundle())).toBe(true);
  });

  it("rejects null / undefined / non-objects", () => {
    expect(looksLikeSpecificEditBundle(null)).toBe(false);
    expect(looksLikeSpecificEditBundle(undefined)).toBe(false);
    expect(looksLikeSpecificEditBundle("string")).toBe(false);
    expect(looksLikeSpecificEditBundle(42)).toBe(false);
    expect(looksLikeSpecificEditBundle([])).toBe(false);
  });

  it("rejects objects missing schemaVersion", () => {
    const b = makeBundle() as unknown as Record<string, unknown>;
    delete b.schemaVersion;
    expect(looksLikeSpecificEditBundle(b)).toBe(false);
  });

  it("rejects wrong schemaVersion", () => {
    const b = makeBundle() as unknown as Record<string, unknown>;
    b.schemaVersion = "specific-edit-bundle/v0";
    expect(looksLikeSpecificEditBundle(b)).toBe(false);
  });

  it("rejects bundles missing tenantId / recId / evidenceHash / providerName", () => {
    for (const k of ["tenantId", "recId", "evidenceHash", "providerName"]) {
      const b = makeBundle() as unknown as Record<string, unknown>;
      delete b[k];
      expect(looksLikeSpecificEditBundle(b)).toBe(false);
    }
  });

  it("rejects bundles missing recommendations array", () => {
    const b = makeBundle() as unknown as Record<string, unknown>;
    delete b.recommendations;
    expect(looksLikeSpecificEditBundle(b)).toBe(false);
  });

  it("rejects bundles where recommendations is not an array", () => {
    const b = makeBundle() as unknown as Record<string, unknown>;
    b.recommendations = "oops";
    expect(looksLikeSpecificEditBundle(b)).toBe(false);
  });

  it("rejects bundles where totalCostUsd isn't a number", () => {
    const b = makeBundle() as unknown as Record<string, unknown>;
    b.totalCostUsd = "0.005";
    expect(looksLikeSpecificEditBundle(b)).toBe(false);
  });

  it("accepts a bundle with empty recommendations array (legitimate empty result)", () => {
    expect(
      looksLikeSpecificEditBundle(makeBundle({ recommendations: [] })),
    ).toBe(true);
  });
});
