/**
 * Phase A.2 Step 1 — cross-tenant brain env-gate behavior tests.
 *
 * Locked contract:
 *   • Both gates default OFF (env unset = false).
 *   • ONLY the literal string "1" enables a gate. Any other value
 *     ("0", "true", "TRUE", "false", "yes", empty string) leaves
 *     the gate OFF.
 *   • The two gates are independent: setting one does NOT change
 *     the other.
 *   • Gates read `process.env` at CALL time, not at module-load
 *     time — tests must be able to flip env between calls and see
 *     the new state. This is the contract the future producer
 *     (Phase A.2 Step 4) + future Today tile (Phase A.2 Step 8)
 *     depend on.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isBrainLearnedTileEnabled,
  isCrossTenantProducerEnabled,
} from "@/domains/recommendations/cross-tenant-brain/config";

const PRODUCER = "BEACON_CROSS_TENANT_BRAIN";
const TILE = "BEACON_BRAIN_LEARNED_TILE";

// Capture the original env values so we can restore them between
// tests without leaking state across the file.
let originalProducer: string | undefined;
let originalTile: string | undefined;

beforeEach(() => {
  originalProducer = process.env[PRODUCER];
  originalTile = process.env[TILE];
  // Start every case with both flags unset so the default-off path
  // is the explicit baseline.
  delete process.env[PRODUCER];
  delete process.env[TILE];
});

afterEach(() => {
  if (originalProducer === undefined) delete process.env[PRODUCER];
  else process.env[PRODUCER] = originalProducer;
  if (originalTile === undefined) delete process.env[TILE];
  else process.env[TILE] = originalTile;
});

// ─────────────────────────────────────────────────────────────────────
// isCrossTenantProducerEnabled — env-state truth table
// ─────────────────────────────────────────────────────────────────────

describe("isCrossTenantProducerEnabled", () => {
  it("returns false when BEACON_CROSS_TENANT_BRAIN is unset (default OFF)", () => {
    expect(isCrossTenantProducerEnabled()).toBe(false);
  });

  it("returns false when BEACON_CROSS_TENANT_BRAIN === '0'", () => {
    process.env[PRODUCER] = "0";
    expect(isCrossTenantProducerEnabled()).toBe(false);
  });

  it("returns TRUE only when BEACON_CROSS_TENANT_BRAIN === '1'", () => {
    process.env[PRODUCER] = "1";
    expect(isCrossTenantProducerEnabled()).toBe(true);
  });

  it("returns false for 'true' (case-sensitive strict-'1' contract)", () => {
    process.env[PRODUCER] = "true";
    expect(isCrossTenantProducerEnabled()).toBe(false);
  });

  it("returns false for 'TRUE'", () => {
    process.env[PRODUCER] = "TRUE";
    expect(isCrossTenantProducerEnabled()).toBe(false);
  });

  it("returns false for 'false'", () => {
    process.env[PRODUCER] = "false";
    expect(isCrossTenantProducerEnabled()).toBe(false);
  });

  it("returns false for empty string", () => {
    process.env[PRODUCER] = "";
    expect(isCrossTenantProducerEnabled()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// isBrainLearnedTileEnabled — env-state truth table
// ─────────────────────────────────────────────────────────────────────

describe("isBrainLearnedTileEnabled", () => {
  it("returns false when BEACON_BRAIN_LEARNED_TILE is unset (default OFF)", () => {
    expect(isBrainLearnedTileEnabled()).toBe(false);
  });

  it("returns false when BEACON_BRAIN_LEARNED_TILE === '0'", () => {
    process.env[TILE] = "0";
    expect(isBrainLearnedTileEnabled()).toBe(false);
  });

  it("returns TRUE only when BEACON_BRAIN_LEARNED_TILE === '1'", () => {
    process.env[TILE] = "1";
    expect(isBrainLearnedTileEnabled()).toBe(true);
  });

  it("returns false for 'true' (case-sensitive strict-'1' contract)", () => {
    process.env[TILE] = "true";
    expect(isBrainLearnedTileEnabled()).toBe(false);
  });

  it("returns false for 'TRUE'", () => {
    process.env[TILE] = "TRUE";
    expect(isBrainLearnedTileEnabled()).toBe(false);
  });

  it("returns false for 'false'", () => {
    process.env[TILE] = "false";
    expect(isBrainLearnedTileEnabled()).toBe(false);
  });

  it("returns false for empty string", () => {
    process.env[TILE] = "";
    expect(isBrainLearnedTileEnabled()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Gate independence
// ─────────────────────────────────────────────────────────────────────

describe("env-gate independence", () => {
  it("producer ON does not enable the customer tile", () => {
    process.env[PRODUCER] = "1";
    expect(isCrossTenantProducerEnabled()).toBe(true);
    expect(isBrainLearnedTileEnabled()).toBe(false);
  });

  it("customer tile ON does not enable the producer", () => {
    process.env[TILE] = "1";
    expect(isCrossTenantProducerEnabled()).toBe(false);
    expect(isBrainLearnedTileEnabled()).toBe(true);
  });

  it("both ON returns true for both independently", () => {
    process.env[PRODUCER] = "1";
    process.env[TILE] = "1";
    expect(isCrossTenantProducerEnabled()).toBe(true);
    expect(isBrainLearnedTileEnabled()).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Read-at-call-time contract
// ─────────────────────────────────────────────────────────────────────

describe("read-at-call-time contract (not frozen at module-load)", () => {
  it("flipping the producer flag mid-test changes the next call's result", () => {
    expect(isCrossTenantProducerEnabled()).toBe(false);
    process.env[PRODUCER] = "1";
    expect(isCrossTenantProducerEnabled()).toBe(true);
    process.env[PRODUCER] = "0";
    expect(isCrossTenantProducerEnabled()).toBe(false);
    delete process.env[PRODUCER];
    expect(isCrossTenantProducerEnabled()).toBe(false);
  });

  it("flipping the customer-tile flag mid-test changes the next call's result", () => {
    expect(isBrainLearnedTileEnabled()).toBe(false);
    process.env[TILE] = "1";
    expect(isBrainLearnedTileEnabled()).toBe(true);
    process.env[TILE] = "0";
    expect(isBrainLearnedTileEnabled()).toBe(false);
    delete process.env[TILE];
    expect(isBrainLearnedTileEnabled()).toBe(false);
  });
});
