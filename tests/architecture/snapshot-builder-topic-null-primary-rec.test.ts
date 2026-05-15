/**
 * Architecture invariant — Section 6 C2 / H8 lock (2026-05-15).
 *
 * BOTH daily-metric-snapshot builders MUST emit topic-scope rows
 * with `primary_recommendation_count: null` AS AN EXPLICIT LITERAL
 * in source, not by accidental undefined fall-through.
 *
 * Why a source-text invariant in addition to the runtime tests:
 * the runtime tests (`build-from-observations-primary-rec.test.ts`
 * + `snapshot-builder-primary-rec.test.ts`) prove the emitted rows
 * carry null today. But TypeScript's optional `?` on the column
 * makes it easy for a future drive-by edit to silently drop the
 * explicit literal and rely on undefined → null conversion at the
 * Supabase upsert layer. That's fragile — a column-type change
 * (e.g., making the field non-optional) would silently flip
 * topic-row semantics. Source-text pin keeps the contract loud at
 * the code-review level.
 *
 * Pinned per the H8 Section 6 Decision Lock: topic-scope primary
 * share has no v1 consumer; locked NULL until a future phase
 * introduces one.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

// ─────────────────────────────────────────────────────────────────────
// Helpers — slice each builder's topic-row emit block.
// ─────────────────────────────────────────────────────────────────────

/**
 * Native builder is row-based: each scope's emit block is a
 * `rows.push({ ... scope_type: "topic" ... })` call. Slice the
 * topic-row literal from `rows.push({` (immediately before the
 * topic block) to its matching `});`.
 */
function nativeTopicEmitBlock(src: string): string {
  const startMarker = 'scope_type: "topic"';
  const startIdx = src.indexOf(startMarker);
  if (startIdx < 0) {
    throw new Error("native builder: scope_type: \"topic\" marker not found");
  }
  // Walk backward to the nearest `rows.push({`.
  const pushIdx = src.lastIndexOf("rows.push({", startIdx);
  if (pushIdx < 0) {
    throw new Error("native builder: rows.push({ before topic marker not found");
  }
  // Walk forward to the matching `});` — naive brace count works
  // because the object literal is hand-written and small.
  let depth = 0;
  let i = pushIdx;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        // Include the trailing `);`.
        const close = src.indexOf(");", i);
        return src.slice(pushIdx, close + 2);
      }
    }
  }
  throw new Error("native builder: unbalanced braces in topic block");
}

/**
 * Profound builder is accumulator-based: it emits one
 * `snapshots.push({ ... })` for every accumulator regardless of
 * scope_type, and conditionally branches the column value on
 * `acc.scope_type === "topic"`. The invariant here is the ternary
 * mapping topic → null. Slice from `snapshots.push({` to the matching
 * close.
 */
function profoundEmitBlock(src: string): string {
  const startMarker = "snapshots.push({";
  const startIdx = src.indexOf(startMarker);
  if (startIdx < 0) {
    throw new Error("profound builder: snapshots.push({ marker not found");
  }
  let depth = 0;
  let i = startIdx;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const close = src.indexOf(");", i);
        return src.slice(startIdx, close + 2);
      }
    }
  }
  throw new Error("profound builder: unbalanced braces");
}

const NATIVE_SRC = read(
  "src/domains/daily-metric-snapshots/build-from-observations.ts",
);
const PROFOUND_SRC = read("src/derivations/snapshot-builder.ts");

// ─────────────────────────────────────────────────────────────────────
// Invariant — native builder
// ─────────────────────────────────────────────────────────────────────

describe("Architecture — native snapshot builder: topic row primary_recommendation_count null (Section 6 C2 / H8)", () => {
  it("topic emit block contains an explicit literal `primary_recommendation_count: null`", () => {
    const block = nativeTopicEmitBlock(NATIVE_SRC);
    // Allow whitespace, but require the literal pair.
    expect(block).toMatch(/primary_recommendation_count\s*:\s*null/);
    // Defense: the field MUST NOT be a computed value (no `count`
    // helper invocation, no accumulator read, no ternary).
    expect(block).not.toMatch(/primary_recommendation_count\s*:\s*count/);
    expect(block).not.toMatch(/primary_recommendation_count\s*:\s*acc\./);
    expect(block).not.toMatch(
      /primary_recommendation_count\s*:\s*[A-Za-z_]\w*\s*\?/, // ternary
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// Invariant — Profound builder
// ─────────────────────────────────────────────────────────────────────

describe("Architecture — Profound importer: topic row primary_recommendation_count null (Section 6 C2 / H8)", () => {
  it("emit block routes topic-scope to null via explicit ternary", () => {
    const block = profoundEmitBlock(PROFOUND_SRC);
    // The Profound builder uses a single push() with a per-row
    // ternary on `acc.scope_type === "topic"`. Pin the exact
    // shape: there must be a ternary in the column value that
    // branches on "topic" and yields null.
    expect(block).toMatch(/primary_recommendation_count\s*:/);
    expect(block).toMatch(/acc\.scope_type\s*===\s*"topic"/);
    // The ternary's "topic" branch must yield null literal.
    expect(block).toMatch(
      /acc\.scope_type\s*===\s*"topic"\s*\?\s*null\s*:/,
    );
  });
});
