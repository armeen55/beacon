/**
 * CONSTITUTION §3 — Egress boundary (protects the no-unbounded-read wedge).
 *
 * Consolidated from egress-bounded-reads-p0 + supabase-egress-windowing.
 * The Supabase Free-Plan egress incident (15.5 GB on a 213 MB DB) traced
 * to route renders paging the full ~14k-row prompt_answer_observations
 * table. These pins lock the mitigations so a "small refactor" cannot
 * re-introduce unbounded render reads:
 *   1. Route loaders pass a bounded `since` window (never bare
 *      loadFreshCanonicalData()).
 *   2. Tenant-scoped page_snapshots is capped (LIMIT 500) + column-
 *      projected (heavy payload columns dropped).
 *   3. The windowed-read API exists end-to-end (types → backend →
 *      canonical-store) and an always-on LARGE READ alarm is wired.
 *
 * The /diagnostics no-observation-read pin was dropped: that route tree
 * is being removed, and its page path must not be scanned here.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");
const strip = (s: string) =>
  s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const LOAD_QUEUE_SRC = read("src/domains/recommendations/load-queue.ts");
// Surface-collapse (2026-07-21): the /prompts list + /prompts/[id] detail pages
// and the /settings/prompts management UI were all deleted. Their bounded-window
// egress guards went with them; the surviving route-render egress surfaces
// (load-queue, today-v2-data) are still pinned below.
const TODAY_V2_DATA_SRC = read("src/app/(shell)/today-v2-data.ts");
const CANONICAL_STORE_SRC = read("src/storage/canonical-store.ts");
const SUPABASE_BACKEND_SRC = read("src/lib/persistence/repositories/supabase-backend.ts");
const REPO_TYPES_SRC = read("src/lib/persistence/repositories/types.ts");
const TENANT_REPO_SRC = read("src/lib/persistence/repositories/tenant-repo.ts");

describe("route loaders read observations bounded, never unbounded", () => {
  it("load-queue passes observationsSince + skipSnapshots + lean projection", () => {
    expect(LOAD_QUEUE_SRC).toMatch(
      /loadFreshCanonicalData\(\{[\s\S]{0,200}observationsSince[\s\S]{0,200}skipSnapshots:\s*true/,
    );
    expect(LOAD_QUEUE_SRC).not.toMatch(/loadFreshCanonicalData\(\s*\)/);
    expect(LOAD_QUEUE_SRC).toMatch(/60\s*\*\s*86_400_000/);
    expect(LOAD_QUEUE_SRC).toMatch(/leanObservations:\s*true/);
  });

  it("today-v2-data windows both observations (60d) and snapshots (120d)", () => {
    expect(TODAY_V2_DATA_SRC).toContain("60 * 86_400_000");
    expect(TODAY_V2_DATA_SRC).toContain("120 * 86_400_000");
    expect(TODAY_V2_DATA_SRC).toContain("snapshotsSince");
    expect(
      TODAY_V2_DATA_SRC.match(/loadFreshCanonicalData\(\s*\{\s*\n?\s*observationsSince/),
    ).not.toBeNull();
  });

  it("no bare loadFreshCanonicalData() across the route-render sources", () => {
    const all = [
      LOAD_QUEUE_SRC,
      TODAY_V2_DATA_SRC,
    ].join("\n");
    expect(all).not.toMatch(/loadFreshCanonicalData\(\s*\)/);
  });
});

describe("tenant-scoped page_snapshots is capped + projected", () => {
  it("caps tenant-scoped page_snapshots at LIMIT 500", () => {
    const block = SUPABASE_BACKEND_SRC.match(
      /getPageSnapshots:\s*async\s*\(\)\s*=>\s*\{[\s\S]*?\.eq\("tenant_id"[\s\S]*?\.limit\((\d+)\)/,
    );
    expect(block).toBeTruthy();
    expect(block![1]).toBe("500");
  });

  it("drops heavy payload columns from the projection (no select('*'))", () => {
    const tenantBlock = SUPABASE_BACKEND_SRC.match(
      /EGRESS-P0[\s\S]*?getPageSnapshots:\s*async\s*\(\)\s*=>\s*\{[\s\S]*?\.limit\(500\)/,
    );
    expect(tenantBlock).toBeTruthy();
    expect(tenantBlock![0]).not.toMatch(/\.select\("\*"\)/);
    const select = tenantBlock![0].match(/\.select\(\s*"([^"]+)",?\s*\)/);
    expect(select).toBeTruthy();
    const cols = select![1];
    for (const heavy of [
      "body_paragraph_sample",
      "card_texts",
      "internal_links",
      "schema_entity_names",
    ])
      expect(new RegExp(`\\b${heavy}\\b`).test(cols)).toBe(false);
  });

  it("logs egress with the projected marker (observability preserved)", () => {
    expect(SUPABASE_BACKEND_SRC).toMatch(
      /table:\s*"page_snapshots\[capped\+dedup\+projected\]"/,
    );
  });
});

describe("windowed-read API exists end-to-end + LARGE READ alarm is wired", () => {
  it("supabase-backend has an always-on large-read alarm + logEgress in the shared helpers", () => {
    expect(SUPABASE_BACKEND_SRC.includes("function logEgress")).toBe(true);
    expect(SUPABASE_BACKEND_SRC.includes("[LARGE READ]")).toBe(true);
    expect((SUPABASE_BACKEND_SRC.match(/logEgress\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("types + backend + repo thread the since window", () => {
    expect(REPO_TYPES_SRC.includes("WindowedReadOptions")).toBe(true);
    expect(
      REPO_TYPES_SRC.match(
        /getPromptAnswerObservations\(\s*\n?\s*options\?:\s*(WindowedReadOptions|ScopedObservationReadOptions)/,
      ),
    ).not.toBeNull();
    expect(SUPABASE_BACKEND_SRC.includes('sinceColumn: "observed_at"')).toBe(true);
    expect(SUPABASE_BACKEND_SRC.includes('sinceColumn: "date"')).toBe(true);
    expect(
      TENANT_REPO_SRC.match(/getPromptAnswerObservations:\s*async\s*\(options\)/),
    ).not.toBeNull();
  });

  it("canonical-store exposes the windowed options and threads them down", () => {
    expect(CANONICAL_STORE_SRC.includes("FreshCanonicalDataOptions")).toBe(true);
    expect(CANONICAL_STORE_SRC.includes("observationsSince?: string")).toBe(true);
    expect(CANONICAL_STORE_SRC.includes("snapshotsSince?: string")).toBe(true);
    expect(
      CANONICAL_STORE_SRC.includes("tenantRepo.getPromptAnswerObservations(observationsOpt)"),
    ).toBe(true);
  });
});
