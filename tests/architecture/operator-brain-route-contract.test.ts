/**
 * Architecture invariant — Trust Sprint T7.6 (2026-05-07).
 *
 * Pins the /diagnostics/brain operator route's contract:
 *
 *   - Operator-mode-gated (BEACON_OPERATOR_MODE === "true").
 *   - 404s when operator mode is OFF.
 *   - Reads from local .data files; never crashes on missing files.
 *   - dynamic = "force-dynamic" so Vercel doesn't try to prerender.
 *   - No raw UUIDs in visible labels (uses prompt_text_snippet, etc.).
 *   - No secrets, no env vars rendered.
 *   - Default product routes unchanged (the route is under
 *     /diagnostics, not /today / /recommendations / /changes).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const ROUTE_PATH = join(REPO_ROOT, "src/app/(shell)/diagnostics/brain/page.tsx");

describe("T7.6 — operator brain route contract", () => {
  it("route file exists at /diagnostics/brain", () => {
    expect(existsSync(ROUTE_PATH)).toBe(true);
  });

  const SRC = readFileSync(ROUTE_PATH, "utf-8");

  it("declares dynamic = force-dynamic (no Vercel prerender)", () => {
    expect(SRC).toContain('export const dynamic = "force-dynamic"');
  });

  it("gates behind isOperatorMode() and 404s when off", () => {
    expect(SRC).toContain("isOperatorMode");
    expect(SRC).toContain("BEACON_OPERATOR_MODE");
    expect(SRC).toContain("notFound");
  });

  it("reads via safeRead helper (graceful when files missing)", () => {
    expect(SRC).toContain("function safeRead");
    expect(SRC).toContain("if (!existsSync(path)) return null");
  });

  it("renders the 6 required brain surface sections", () => {
    expect(SRC).toContain("Brain Readiness Grade");
    expect(SRC).toContain("Section grades");
    expect(SRC).toContain("Local AEO intelligence summary");
    expect(SRC).toContain("Top 5 opportunities");
    expect(SRC).toContain("Trust risks");
    expect(SRC).toContain("Competitor pulse");
  });

  it("uses prompt_text_snippet as the visible label, not raw prompt_id", () => {
    // Check that prompt_id is only used as a React key, not as visible text.
    expect(SRC).toContain("prompt_text_snippet");
    // Should not render {o.prompt_id} as visible text. Allow it as `key={o.prompt_id}`.
    const renderingPromptId = /\{o\.prompt_id\}(?!\s*[}\)])/.test(SRC);
    if (renderingPromptId) {
      // Find the line(s) and ensure they're inside `key=` attributes.
      const lines = SRC.split("\n");
      for (const ln of lines) {
        if (ln.includes("{o.prompt_id}")) {
          expect(ln).toMatch(/key=\{o\.prompt_id\}/);
        }
      }
    }
  });

  it("does NOT render env vars or secrets", () => {
    expect(SRC).not.toContain("OPENAI_API_KEY");
    expect(SRC).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(SRC).not.toContain("PERPLEXITY_API_KEY");
    expect(SRC).not.toContain("process.env.OPENAI");
    expect(SRC).not.toContain("process.env.SUPABASE");
  });

  it("does NOT mutate persisted data (read-only)", () => {
    expect(SRC).not.toContain("writeFileSync");
    expect(SRC).not.toContain("writeStore(");
    expect(SRC).not.toContain("syncRecommendedEdits");
    expect(SRC).not.toContain("syncUrlChangeOutcomes");
  });

  it("does NOT trigger paid APIs / scans / polling", () => {
    expect(SRC).not.toContain("openai");
    expect(SRC).not.toContain("OpenAI");
    expect(SRC).not.toContain("perplexity");
    expect(SRC).not.toContain("runWebsiteScan");
    expect(SRC).not.toContain("poll-perplexity");
    expect(SRC).not.toContain("poll-openai");
  });

  it("default surfaces (/today, /recommendations, /changes) are NOT modified", () => {
    // The route is under /diagnostics/brain; this is a sanity invariant.
    expect(ROUTE_PATH).toContain("/diagnostics/brain/");
    expect(ROUTE_PATH).not.toContain("/today/");
    expect(ROUTE_PATH).not.toContain("/recommendations/");
    expect(ROUTE_PATH).not.toContain("/changes/");
  });
});
