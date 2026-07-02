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
 * This test greps the outreach domain + its surface for every import of
 * `sendEmail` from `@/lib/email/resend` and asserts it appears in EXACTLY ONE
 * file: `send-pitch.ts` (which is itself called from exactly one server
 * action: `sendOutreachPitchAction`). If a future change adds a second call
 * site (a cron, a batch, an "auto-follow-up" path), this test fails loudly.
 */

const OUTREACH_DOMAIN_DIR = join(process.cwd(), "src/domains/outreach");
const OUTREACH_SURFACE_DIR = join(process.cwd(), "src/app/(shell)/competitors");

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

  it("the competitors surface never imports sendEmail directly (only through the action -> send-pitch chain)", () => {
    const files = tsFilesIn(OUTREACH_SURFACE_DIR);
    const callers = files.filter(importsSendEmail);
    expect(callers).toEqual([]);
  });

  it("sendOutreachPitchAction is the only server action that calls sendOutreachPitch", () => {
    const actionsFile = join(OUTREACH_SURFACE_DIR, "outreach-actions.ts");
    const src = readFileSync(actionsFile, "utf8");
    const matches = src.match(/sendOutreachPitch\(/g) ?? [];
    // exactly one call site (inside sendOutreachPitchAction's body)
    expect(matches.length).toBe(1);
    // and it must be gated by isOperatorModeServer before it can run
    const fnBody = src.slice(src.indexOf("export async function sendOutreachPitchAction"));
    expect(fnBody.indexOf("isOperatorModeServer")).toBeGreaterThanOrEqual(0);
    expect(fnBody.indexOf("isOperatorModeServer")).toBeLessThan(fnBody.indexOf("sendOutreachPitch("));
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

  it("no email/pitch text in this feature contains an em or en dash (dash guard)", () => {
    // Scope to files THIS item owns - the shared /competitors surface directory
    // also holds sibling features' files (read-queue-button.tsx etc.) that are
    // out of scope for item 57 and owned by other agents.
    const OUTREACH_SURFACE_FILES = ["outreach-actions.ts", "outreach-section.tsx"];
    const files = [
      ...tsFilesIn(OUTREACH_DOMAIN_DIR),
      ...OUTREACH_SURFACE_FILES.map((f) => join(OUTREACH_SURFACE_DIR, f)),
    ];
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
