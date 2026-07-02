/**
 * refresh-verify.test.ts (BEACON_500 item 56) - behavior pins for the refresh lever's
 * verify-live branch: the proposed section heading must appear as a visible h2/h3 in the
 * content region (exact normalized match, or a heading containing the proposed text), with
 * honest failures naming the headings actually observed.
 */
import { describe, expect, it } from "vitest";
import { verifyExperimentLive, type FetchedPage } from "@/domains/experiments/live-verification";
import type { PlannedExperimentRecord } from "@/domains/experiments/daily-plan-types";

const PAGE = "https://site.com/persian-cats";

function refreshExp(proposedHeading: string): PlannedExperimentRecord {
  return {
    id: "p::/persian-cats", candidateId: "c", url: PAGE, canonicalUrl: PAGE, pageLabel: "persian cats",
    pageFamily: "persian-cats", lever: "refresh", targetQuery: "persian cat price", whyNow: "fading",
    currentText: "(the page has no section answering this yet)", proposedText: proposedHeading,
    placement: "a new section (H2) in the page body", leaveUnchanged: [], rollbackText: "Remove the new section.",
    effortMinutes: 15, risk: "low", controls: [], influencedUrls: [],
    evidenceHash: "e", currentTextHash: "h", eligibilityHash: "g", draftSource: "deterministic",
    detail: { kind: "refresh_section", briefSentences: ["evidence line"], clicksLostPerMonth: 60 },
  } as unknown as PlannedExperimentRecord;
}

function html(headings: string[], paras: string[] = ["A real paragraph with more than eight words in it for content checks."]): string {
  const body = `<main><h1>Persian Cats</h1>${headings.map((h) => `<h2>${h}</h2>`).join("")}${paras.map((p) => `<p>${p}</p>`).join("")}</main>`;
  return `<!doctype html><html><head><title>Persian Cats</title><meta name="description" content="desc"></head><body>${body}</body></html>`;
}
const fetchOk = (h: string) => async (): Promise<FetchedPage> => ({ ok: true, html: h, status: 200 });

describe("verifyExperimentLive - refresh lever", () => {
  it("verifies when the exact section heading is live", async () => {
    const r = await verifyExperimentLive(refreshExp("2026 Pricing Guide"), {
      fetchPage: fetchOk(html(["History", "2026 Pricing Guide"])),
    });
    expect(r.verified).toBe(true);
    if (r.verified) expect(r.receipt.method).toBe("section-heading-exact-match");
  });

  it("verifies a heading that CONTAINS the proposed text (operator expanded it)", async () => {
    const r = await verifyExperimentLive(refreshExp("2026 Pricing"), {
      fetchPage: fetchOk(html(["2026 Pricing in Iran"])),
    });
    expect(r.verified).toBe(true);
    if (r.verified) expect(r.receipt.method).toBe("section-heading-contains");
  });

  it("fails honestly when the section is missing, naming the observed headings", async () => {
    const r = await verifyExperimentLive(refreshExp("2026 Pricing Guide"), {
      fetchPage: fetchOk(html(["History", "Grooming"])),
    });
    expect(r.verified).toBe(false);
    if (!r.verified) {
      expect(r.reason).toBe("expected_text_missing");
      expect(r.observed).toContain("History");
      expect(r.retryable).toBe(true);
    }
  });

  it("ignores hidden headings (a display:none section is not shipped)", async () => {
    const body = `<main><h1>Persian Cats</h1><h2 style="display:none">2026 Pricing Guide</h2><p>A real paragraph with more than eight words inside it.</p></main>`;
    const h = `<!doctype html><html><head><title>T</title><meta name="description" content="d"></head><body>${body}</body></html>`;
    const r = await verifyExperimentLive(refreshExp("2026 Pricing Guide"), { fetchPage: fetchOk(h) });
    expect(r.verified).toBe(false);
  });
});
