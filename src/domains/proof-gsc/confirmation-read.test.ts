import { describe, expect, it } from "vitest";
import { decideConfirmationRead } from "./confirmation-read";

describe("confirmation read decisions", () => {
  it("56 days can demote a win that did not hold", () => {
    expect(decideConfirmationRead({ day: 56, primaryVerdict: "won", readVerdict: "lost" })).toEqual({
      role: "demote_only",
      readVerdict: "lost",
      verdictAfterRead: "inconclusive",
      demoted: true,
      provisional: true,
    });
  });

  it("56 days never upgrades a non-win", () => {
    expect(decideConfirmationRead({ day: 56, primaryVerdict: "lost", readVerdict: "won" }).verdictAfterRead).toBe("lost");
    expect(decideConfirmationRead({ day: 56, primaryVerdict: "inconclusive", readVerdict: "won" }).verdictAfterRead).toBe("inconclusive");
  });

  it("84 days is context only and never changes the primary verdict", () => {
    const read = decideConfirmationRead({ day: 84, primaryVerdict: "won", readVerdict: "lost" });
    expect(read.role).toBe("context");
    expect(read.verdictAfterRead).toBe("won");
    expect(read.demoted).toBe(false);
  });
});
