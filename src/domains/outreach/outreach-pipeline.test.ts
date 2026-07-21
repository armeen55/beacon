import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * outreach-pipeline (BEACON_500 item 57, 2026-07-02) - ARCHITECTURE PIN.
 *
 * CRITICAL SAFETY RULE: every outreach email send is an explicit operator
 * click. Beacon NEVER auto-sends, and follow-ups are queued as ready-to-send
 * drafts the operator must also click Send on.
 *
 * This test greps the outreach domain for every import of `sendEmail` from
 * `@/lib/email/resend` and asserts it appears in EXACTLY ONE file:
 * `send-pitch.ts`. If a future change adds a second call site (a cron, a
 * batch, an "auto-follow-up" path), this test fails loudly.
 *
 * 2026-07-20 diagnostics amputation: the operator-only surface this feature
 * lived on (`/diagnostics/competitor-intel` - outreach-actions.ts,
 * outreach-section.tsx, which called `sendOutreachPitchAction`) was deleted
 * along with the rest of the /diagnostics web product. A repo-wide search
 * turns up no remaining caller of `sendOutreachPitchAction` or
 * `sendOutreachPitch` anywhere in src/app - the send-pitch path is currently
 * UNREACHABLE from any live UI. Outreach is a phase-2 deletion candidate.
 * The domain-level invariants below (sendEmail has one caller, markSent has
 * one caller) still hold against live domain files, so this file keeps those
 * and drops the cases that only had meaning against the deleted surface
 * directory.
 */

const OUTREACH_DOMAIN_DIR = join(process.cwd(), "src/domains/outreach");

function tsFilesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"))
    .map((f) => join(dir, f));
}

function importsSendEmail(filePath: string): boolean {
  const src = readFileSync(filePath, "utf8");
  return /from\s+["']@\/lib\/email\/resend["']/.test(src) && /\bsendEmail\b/.test(src);
}

describe("architecture pin - sendEmail has exactly one caller in the outreach feature", () => {
  it("only send-pitch.ts imports sendEmail from resend.ts in the outreach domain", () => {
    const files = tsFilesIn(OUTREACH_DOMAIN_DIR);
    const callers = files.filter(importsSendEmail).map((f) => f.split("/").pop());
    expect(callers).toEqual(["send-pitch.ts"]);
  });

  it("markSent (the only status='sent' setter) is called from exactly one place in the outreach domain", () => {
    const files = tsFilesIn(OUTREACH_DOMAIN_DIR);
    const callers: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // count call sites, not the export declaration itself
      const callSites = (src.match(/\bmarkSent\(/g) ?? []).length;
      const isDeclaration = /export async function markSent\(/.test(src);
      if (callSites > (isDeclaration ? 0 : 0) && !f.endsWith("outreach-store.ts")) {
        if (callSites > 0) callers.push(f.split("/").pop()!);
      }
    }
    expect(callers).toEqual(["send-pitch.ts"]);
  });

  it("no email/pitch text in the outreach domain contains an em or en dash (dash guard)", () => {
    const files = tsFilesIn(OUTREACH_DOMAIN_DIR);
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // scan only string literal content roughly - skip code structure chars
      const stringLiterals = src.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? [];
      for (const lit of stringLiterals) {
        if (/[–—]/.test(lit)) offenders.push(`${f.split("/").pop()}: ${lit.slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
