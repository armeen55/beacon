/**
 * Architecture invariant — A.3.b1.beta (2026-05-17).
 *
 * The GSC siteUrl (e.g. `sc-domain:ritzbuilders.com`) MUST come
 * from the `BEACON_GSC_SITE_URL` env var — never hardcoded in
 * source. Hardcoding a customer identifier in the repo is the
 * structural drift that breaks the operator-substrate posture
 * AND blocks multi-tenant onboarding.
 *
 * Negative invariants (under `src/`):
 *   • No `sc-domain:` literal in source code.
 *
 * Positive invariants:
 *   • `src/domains/indexability/load-gsc-signal.ts` references the
 *     `BEACON_GSC_SITE_URL` env var.
 *
 * Scan excludes:
 *   • `src/` test files (none — tests live under `tests/`).
 *   • Comments (stripped before scan).
 *
 * Test files are intentionally NOT scanned — they legitimately
 * reference `sc-domain:` literals as fixture data.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const SRC_ROOT = join(REPO_ROOT, "src");

function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function* walk(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      yield full;
    }
  }
}

describe("gsc — no hardcoded site URL", () => {
  it("no `sc-domain:` literal in active src/ source (comments stripped)", () => {
    const violations: Array<{ file: string; match: string }> = [];
    for (const file of walk(SRC_ROOT)) {
      const stripped = stripComments(readFileSync(file, "utf-8"));
      const match = stripped.match(/sc-domain:[a-zA-Z0-9._-]+/);
      if (match != null) {
        violations.push({
          file: relative(REPO_ROOT, file),
          match: match[0],
        });
      }
    }
    expect(
      violations,
      `GSC site URL must come from BEACON_GSC_SITE_URL env var, ` +
        `never hardcoded in source. Found violations:\n` +
        violations.map((v) => `  ${v.file}: ${v.match}`).join("\n"),
    ).toEqual([]);
  });
});

describe("gsc — BEACON_GSC_SITE_URL is the resolution path", () => {
  it("src/domains/indexability/load-gsc-signal.ts references BEACON_GSC_SITE_URL", () => {
    const adapter = readFileSync(
      join(SRC_ROOT, "domains/indexability/load-gsc-signal.ts"),
      "utf-8",
    );
    expect(/BEACON_GSC_SITE_URL/.test(adapter)).toBe(true);
  });
});
