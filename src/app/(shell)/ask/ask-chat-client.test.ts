/**
 * ask-chat-client - copy-honesty guard (round 2). Source-pinning (this repo's convention
 * for interactive client components with no jsdom/@testing-library/react configured, see
 * today-moves-prepare-ux3.test.ts). Confirms the empty-state prompt never claims
 * scheduled/overnight timing - Beacon has no scheduler (vercel.json crons: []).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "ask-chat-client.tsx"), "utf8");

describe("AskChatClient - no-scheduler honesty (Beacon has no cron)", () => {
  it("never claims scheduled/overnight timing", () => {
    expect(SRC).not.toMatch(/tonight|last night|overnight|nightly/i);
  });

  it("points to today's plan, not tonight's", () => {
    expect(SRC).toContain("today's plan on Today");
  });
});
