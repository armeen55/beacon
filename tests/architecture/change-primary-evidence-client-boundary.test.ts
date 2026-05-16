/**
 * Architecture invariant — Section 6 C6b client boundary contract
 * (2026-05-15).
 *
 * Pins that `src/app/(shell)/changes/[id]/change-detail-v2-client.tsx`
 * keeps a narrow customer-facing prop boundary:
 *
 *   1. `ChangeDetailV2Props` includes a `primaryEvidenceLines?:` field
 *      (optional, so existing fixtures instantiating the client
 *      without the new prop still compile).
 *   2. Active (comment-stripped) source does NOT reference any C6a
 *      type names: `ChangePrimaryModeAResult`, `ChangePrimaryModeBResult`,
 *      `LoadChangePrimaryEvidenceResult`.
 *   3. Active source does NOT reference C6a identifier names that
 *      would only appear if the client started inspecting per-mode
 *      internals: `modeA`, `modeB`, `loadChangePrimaryEvidence`.
 *   4. The client does NOT import `getRepository` — presentation-only
 *      surface; tenant scope lives in the loader.
 *
 * `raw` is a common variable name throughout the codebase and is NOT
 * forbidden by this invariant (it would false-positive on unrelated
 * existing client code). The other identifier guards in this file are
 * sufficient to prevent per-mode boundary leakage.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const CLIENT_PATH =
  "src/app/(shell)/changes/[id]/change-detail-v2-client.tsx";

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ACTIVE = stripComments(read(CLIENT_PATH));

describe("Architecture — Section 6 C6b client prop boundary", () => {
  it("ChangeDetailV2Props includes an optional primaryEvidenceLines prop", () => {
    // Match the optional shape (`primaryEvidenceLines?:`).
    expect(ACTIVE).toMatch(/\bprimaryEvidenceLines\s*\?\s*:/);
  });

  it("active source does NOT reference C6a loader-result type names", () => {
    expect(ACTIVE).not.toMatch(/\bChangePrimaryModeAResult\b/);
    expect(ACTIVE).not.toMatch(/\bChangePrimaryModeBResult\b/);
    expect(ACTIVE).not.toMatch(/\bLoadChangePrimaryEvidenceResult\b/);
  });

  it("active source does NOT reference per-mode identifier names", () => {
    // `modeA` and `modeB` are the discriminator names on
    // LoadChangePrimaryEvidenceResult.raw — the client must not
    // touch them.
    expect(ACTIVE).not.toMatch(/\bmodeA\b/);
    expect(ACTIVE).not.toMatch(/\bmodeB\b/);
  });

  it("active source does NOT call the C6a loader directly", () => {
    expect(ACTIVE).not.toMatch(/\bloadChangePrimaryEvidence\b/);
  });

  it("client does NOT import getRepository (presentation-only boundary)", () => {
    expect(ACTIVE).not.toMatch(
      /import\s*\{[^}]*\bgetRepository\b[^}]*\}\s*from\s*["']@\/lib\/persistence\/repositories["']/,
    );
    expect(ACTIVE).not.toMatch(/\bgetRepository\b/);
  });
});
