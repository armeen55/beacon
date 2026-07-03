/**
 * Provenance surface + wiring pins (BEACON_500 R13 / N3, 2026-07-03).
 *
 * Source-level pins at every consumer seam so the claim graph stays wired
 * AND stays byte-identical when empty:
 *   - daily-evidence-brief carries the optional claims field
 *   - build-today-preview attaches claim source lines additively (only when
 *     non-empty; the spread preserves every existing brief field)
 *   - the daily card renders one line per claim inside How we know
 *   - the trigger loader feeds claim conflicts through the existing pipeline
 *   - stage-change registers a shipped draft's checked facts
 *   - the store is registered (global classification + Supabase mirror)
 *   - the nightly cron rebuild is an isolated fail-soft phase
 *   - the no-dash hard rule over every touched surface block
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BRIEF = readFileSync(resolve(__dirname, "../experiments/daily-evidence-brief.ts"), "utf8");
const PREVIEW = readFileSync(resolve(__dirname, "../experiments/build-today-preview.ts"), "utf8");
const CARD = readFileSync(resolve(__dirname, "../../app/(shell)/daily-experiments-section.tsx"), "utf8");
const TRIGGER_LOADER = readFileSync(
  resolve(__dirname, "../recommendation-intelligence/load-trigger-candidates-for-tenant.ts"),
  "utf8",
);
const STAGE = readFileSync(resolve(__dirname, "../push/stage-change.ts"), "utf8");
const STORE_CLASSIFICATION = readFileSync(resolve(__dirname, "../../lib/persistence/store-classification.ts"), "utf8");
const JSON_STORE = readFileSync(resolve(__dirname, "../../lib/persistence/json-store.ts"), "utf8");
const CRON = readFileSync(resolve(__dirname, "../../lib/connectors/cron-sync.ts"), "utf8");
const COPY = readFileSync(resolve(__dirname, "../recommendation-intelligence/customer-copy-templates.ts"), "utf8");
const DIAGNOSTICS = readFileSync(resolve(__dirname, "../../app/(shell)/diagnostics/provenance/page.tsx"), "utf8");

describe("evidence brief carries the claims field", () => {
  it("DailyEvidenceBrief has an optional claims field of EvidenceClaimSource", () => {
    expect(BRIEF).toContain("claims?: EvidenceClaimSource[]");
    expect(BRIEF).toContain("export type EvidenceClaimSource");
    expect(BRIEF).toContain("fact: string");
    expect(BRIEF).toContain("sourceLine: string");
  });
});

describe("daily plan wiring (build-today-preview)", () => {
  it("reads the claim graph once per batch and matches claims per pick", () => {
    expect(PREVIEW).toContain('from "@/domains/provenance/claim-graph-loader"');
    expect(PREVIEW).toContain('from "@/domains/provenance/claim-graph"');
    expect(PREVIEW).toContain("loadClaimGraphForTenant(tenantId)");
    expect(PREVIEW).toContain("claimEvidenceForDraft(claimRecords");
  });

  it("attaches additively and ONLY when non-empty (byte-identical when the graph is empty)", () => {
    expect(PREVIEW).toContain("if (claimRecords.length > 0)");
    expect(PREVIEW).toContain("if (claimSources.length > 0)");
    expect(PREVIEW).toContain(
      "c.evidenceBrief = { ...(c.evidenceBrief ?? { keywords: [], addressableVolume: null }), claims: claimSources };",
    );
  });

  it("composes beside, does not replace, the other evidence attachments", () => {
    expect(PREVIEW).toContain("citability: { score: citabilityHint.score");
    expect(PREVIEW).toContain("staleSource: staleNote");
  });
});

describe("daily card renders one line per claim in How we know", () => {
  it("has a ClaimSources component reading evidenceBrief.claims", () => {
    expect(CARD).toContain("function ClaimSources");
    expect(CARD).toContain("e.evidenceBrief?.claims");
    expect(CARD).toContain("Fact I am relying on:");
  });

  it("is wired into the How we know section beside the other evidence lines", () => {
    const howWeKnowStart = CARD.indexOf("function HowWeKnow");
    const section = CARD.slice(howWeKnowStart, howWeKnowStart + 2200);
    expect(section).toContain("<CitabilityEvidence e={e} />");
    expect(section).toContain("<ClaimSources e={e} />");
  });
});

describe("trigger pipeline wiring (claim_conflict)", () => {
  it("the loader feeds conflicts through the existing candidate pipeline, fail-soft", () => {
    expect(TRIGGER_LOADER).toContain('from "@/domains/provenance/claim-conflict-trigger"');
    expect(TRIGGER_LOADER).toContain("loadClaimGraphForTenant(tenantId)");
    expect(TRIGGER_LOADER).toContain("findClaimConflicts(claimRecords)");
    expect(TRIGGER_LOADER).toContain("claimConflictCandidates({");
    // Byte-identical when the graph is empty.
    expect(TRIGGER_LOADER).toContain("if (claimRecords.length > 0)");
    // Fail-soft: a read failure skips the predicate, never the loader.
    expect(TRIGGER_LOADER).toContain("claim_conflict skips");
  });

  it("the copy template exists and carries the decision ask", () => {
    expect(COPY).toContain("export function claimConflictCopy(");
    expect(COPY).toContain("Two of your pages disagree about ");
    expect(COPY).toContain("Pick one and I will keep them consistent.");
  });
});

describe("ship-time registration (the N8 seam)", () => {
  it("stage-change registers a shipped draft's checked facts, fail-soft, after the push landed", () => {
    expect(STAGE).toContain('from "@/domains/provenance/claim-graph-loader"');
    expect(STAGE).toContain("await registerShippedDraftClaims({");
    expect(STAGE).toContain("}).catch(() => {});");
    // Registration happens AFTER executePush's result check, never before.
    const pushIdx = STAGE.indexOf('if (result.kind !== "pushed")');
    const regIdx = STAGE.indexOf("registerShippedDraftClaims({");
    expect(pushIdx).toBeGreaterThan(-1);
    expect(regIdx).toBeGreaterThan(pushIdx);
  });
});

describe("store registration", () => {
  it("claim-graph is a registered GLOBAL store (rows carry tenant_id)", () => {
    expect(STORE_CLASSIFICATION).toContain('"claim-graph"');
    const globalStart = STORE_CLASSIFICATION.indexOf("GLOBAL_STORES");
    expect(STORE_CLASSIFICATION.indexOf('"claim-graph"')).toBeGreaterThan(globalStart);
  });

  it("claim-graph is Supabase-mirrored so hosted prod survives lambda recycling", () => {
    const mirrorStart = JSON_STORE.indexOf("SUPABASE_MIRRORED_STORES");
    const claimIdx = JSON_STORE.indexOf('"claim-graph"');
    expect(claimIdx).toBeGreaterThan(mirrorStart);
  });
});

describe("nightly cron rebuild is an isolated fail-soft phase", () => {
  it("cron-sync rebuilds the claim graph per tenant inside its own try/catch", () => {
    expect(CRON).toContain('from "@/domains/provenance/claim-graph-loader"');
    expect(CRON).toContain("rebuildClaimGraphForTenant(t.id)");
    expect(CRON).toContain('reportPhaseError("claim-graph", t.id, e)');
    expect(CRON).toContain("skipping remaining claim-graph builds");
  });
});

describe("no em or en dashes in any touched surface block (hard rule)", () => {
  it("the preview wiring block is dash-clean", () => {
    const start = PREVIEW.indexOf("N3 (R13, 2026-07-03) - claim provenance");
    const end = PREVIEW.indexOf("Item 46 (CARRY-OVER 115)", start);
    expect(start).toBeGreaterThan(-1);
    expect(PREVIEW.slice(start, end)).not.toMatch(/[–—]/);
  });

  it("the card component block is dash-clean", () => {
    const start = CARD.indexOf("function ClaimSources");
    expect(start).toBeGreaterThan(-1);
    expect(CARD.slice(start, start + 700)).not.toMatch(/[–—]/);
  });

  it("the diagnostics page is dash-clean", () => {
    expect(DIAGNOSTICS).not.toMatch(/[–—]/);
  });

  it("the copy template block is dash-clean", () => {
    const start = COPY.indexOf("export function claimConflictCopy(");
    expect(start).toBeGreaterThan(-1);
    expect(COPY.slice(start)).not.toMatch(/[–—]/);
  });
});
