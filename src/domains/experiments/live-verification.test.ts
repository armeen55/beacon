import { describe, it, expect } from "vitest";
import { verifyExperimentLive, normText, type FetchedPage } from "./live-verification";
import type { PlannedExperimentRecord, ExperimentLever } from "./daily-plan-types";

const PAGE = "https://site.com/source-page";

function mkExp(over: Partial<PlannedExperimentRecord> & { lever: ExperimentLever; detail: PlannedExperimentRecord["detail"] }): PlannedExperimentRecord {
  return {
    id: "p::/source-page", candidateId: "c", url: PAGE, canonicalUrl: PAGE, pageLabel: "source page",
    pageFamily: "source-page", targetQuery: "q", currentText: "", proposedText: "", placement: "",
    leaveUnchanged: [], rollbackText: "", effortMinutes: 5, risk: "low", controls: [], influencedUrls: [],
    evidenceHash: "e", currentTextHash: "h", eligibilityHash: "g", ...over,
  };
}

function pageHtml(o: { title?: string | null; meta?: string | null; metaDup?: boolean; h1?: string | null; paras?: string[] }): string {
  const head = [
    o.title === null ? "" : `<title>${o.title ?? "T"}</title>`,
    o.meta === null ? "" : `<meta name="description" content="${o.meta ?? ""}">`,
    o.metaDup ? `<meta name="description" content="duplicate desc">` : "",
  ].join("");
  const body = `<main>${o.h1 === null ? "" : `<h1>${o.h1 ?? "Heading"}</h1>`}${(o.paras ?? []).map((p) => `<p>${p}</p>`).join("")}</main>`;
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}
const fetchOk = (html: string) => async (): Promise<FetchedPage> => ({ ok: true, html, status: 200 });

describe("normText", () => {
  it("decodes entities, unifies quotes, collapses whitespace, lowercases", () => {
    expect(normText("  The  “Best”   Guide &amp; more ")).toBe('the "best" guide & more');
    expect(normText("don’t")).toBe("don't");
  });
});

describe("meta verification", () => {
  const exp = mkExp({ lever: "meta", currentText: "old meta text", proposedText: "The complete factual meta description." , detail: { kind: "meta", source: "para" } });
  it("verifies an exact (normalized) match", async () => {
    const r = await verifyExperimentLive(exp, { fetchPage: fetchOk(pageHtml({ meta: "The complete   factual meta description." })) });
    expect(r.verified).toBe(true);
  });
  it("fails when the old meta is still live", async () => {
    const r = await verifyExperimentLive(exp, { fetchPage: fetchOk(pageHtml({ meta: "old meta text" })) });
    expect(r.verified).toBe(false);
    if (!r.verified) expect(r.reason).toBe("old_text_still_present");
  });
  it("fails when meta is missing (page not a shell)", async () => {
    const r = await verifyExperimentLive(exp, { fetchPage: fetchOk(pageHtml({ meta: null, title: "Real Title", h1: "Real H1" })) });
    expect(r.verified).toBe(false);
    if (!r.verified) expect(r.reason).toBe("expected_text_missing");
  });
  it("rejects duplicate description tags", async () => {
    const r = await verifyExperimentLive(exp, { fetchPage: fetchOk(pageHtml({ meta: "The complete factual meta description.", metaDup: true })) });
    expect(r.verified).toBe(false);
    if (!r.verified) expect(r.reason).toBe("multiple_values_found");
  });
  it("treats an empty pre-hydration shell as stale (retryable), not missing", async () => {
    const r = await verifyExperimentLive(exp, { fetchPage: fetchOk(pageHtml({ title: null, meta: null, h1: null })) });
    expect(r.verified).toBe(false);
    if (!r.verified) { expect(r.reason).toBe("snapshot_stale"); expect(r.retryable).toBe(true); }
  });
  it("fails on an unreachable page", async () => {
    const r = await verifyExperimentLive(exp, { fetchPage: async () => ({ ok: false }) });
    expect(r.verified).toBe(false);
    if (!r.verified) expect(r.reason).toBe("page_unreachable");
  });
});

describe("internal-link verification", () => {
  const sentence = "This article mentions Persian jewelry in the body of the page.";
  const exp = mkExp({
    lever: "internal_link", currentText: sentence, proposedText: sentence,
    detail: { kind: "internal_link", destinationUrl: "/persian-jewelry", anchorText: "Persian jewelry", wixInstructions: "", relationship: "sibling" },
  });
  const withLink = (href: string) => pageHtml({ paras: [`This article mentions <a href="${href}">Persian jewelry</a> in the body of the page.`] });

  it("verifies anchor + resolved destination", async () => {
    const r = await verifyExperimentLive(exp, { fetchPage: fetchOk(withLink("/persian-jewelry")) });
    expect(r.verified).toBe(true);
  });
  it("fails when the anchor is absent", async () => {
    const r = await verifyExperimentLive(exp, { fetchPage: fetchOk(pageHtml({ paras: [sentence] })) });
    expect(r.verified).toBe(false);
    if (!r.verified) expect(r.reason).toBe("link_missing");
  });
  it("fails when the anchor links to the wrong destination", async () => {
    const r = await verifyExperimentLive(exp, { fetchPage: fetchOk(withLink("/totally-wrong")) });
    expect(r.verified).toBe(false);
    if (!r.verified) expect(r.reason).toBe("wrong_destination");
  });
  it("fails when the source sentence is gone", async () => {
    const r = await verifyExperimentLive(exp, { fetchPage: fetchOk(pageHtml({ paras: [`Unrelated text with a <a href="/persian-jewelry">Persian jewelry</a> link.`] })) });
    expect(r.verified).toBe(false);
    if (!r.verified) expect(r.reason).toBe("expected_text_missing");
  });
  it("REJECTS an off-domain href with the same path (false-positive guard)", async () => {
    const r = await verifyExperimentLive(exp, { fetchPage: fetchOk(withLink("https://competitor.com/persian-jewelry")) });
    expect(r.verified).toBe(false);
    if (!r.verified) expect(r.reason).toBe("wrong_destination");
  });
  it("accepts an absolute SAME-domain href (no over-rejection)", async () => {
    const r = await verifyExperimentLive(exp, { fetchPage: fetchOk(withLink("https://site.com/persian-jewelry")) });
    expect(r.verified).toBe(true);
  });
  it("REJECTS a matching anchor that lives in a nav, not the source sentence (false-positive guard)", async () => {
    const html = `<!doctype html><html><head><title>T</title></head><body><main><nav><a href="/persian-jewelry">Persian jewelry</a></nav><p>${sentence}</p></main></body></html>`;
    const r = await verifyExperimentLive(exp, { fetchPage: fetchOk(html) });
    expect(r.verified).toBe(false);
    if (!r.verified) expect(r.reason).toBe("link_missing");
  });
  it("treats a no-content read as stale, not link_missing", async () => {
    const r = await verifyExperimentLive(exp, { fetchPage: fetchOk(`<!doctype html><html><head><title>Real</title><h1>x</h1></head><body><main></main></body></html>`) });
    expect(r.verified).toBe(false);
    if (!r.verified) expect(r.reason).toBe("snapshot_stale");
  });
});

describe("answer-block hidden / chrome / substring guards", () => {
  const answer = "Chaharshanbe Suri is the Persian festival of fire celebrated on the eve before the last Wednesday of the year.";
  const exp = mkExp({ lever: "answer_block", currentText: answer, proposedText: answer, detail: { kind: "answer_block", question: "What is it?", operation: "move", exactInstruction: "x", paragraphIndex: 4 } });
  const raw = (bodyInner: string) => `<!doctype html><html><head><title>T</title></head><body>${bodyInner}</body></html>`;

  it("does NOT verify an answer that only lives in a hidden paragraph (false-positive guard)", async () => {
    const r = await verifyExperimentLive(exp, { fetchPage: fetchOk(raw(`<main><p hidden>${answer}</p><p>A visible supporting paragraph with plenty of words present here now indeed.</p></main>`)) });
    expect(r.verified).toBe(false);
    if (!r.verified) expect(r.reason).toBe("expected_text_missing");
  });
  it("a hidden leader does not bury the real visible answer (false-negative guard)", async () => {
    const r = await verifyExperimentLive(exp, { fetchPage: fetchOk(raw(`<main><p hidden>boilerplate scaffold paragraph with many words present here now indeed today</p><p>${answer}</p></main>`)) });
    expect(r.verified).toBe(true);
  });
  it("ignores header/footer chrome when there is no <main> (false-negative guard)", async () => {
    const r = await verifyExperimentLive(exp, { fetchPage: fetchOk(raw(`<header><p>Hero banner paragraph with quite a few words in it here now today.</p></header><p>${answer}</p><footer><p>Legal disclaimer paragraph with plenty of words present here now today.</p></footer>`)) });
    expect(r.verified).toBe(true);
  });
  it("does NOT verify a footer-only occurrence of the answer (false-positive guard)", async () => {
    const r = await verifyExperimentLive(exp, { fetchPage: fetchOk(raw(`<p>Real first content paragraph that is not the answer but is long enough here now.</p><footer><p>${answer}</p></footer>`)) });
    expect(r.verified).toBe(false);
    if (!r.verified) expect(r.reason).toBe("expected_text_missing");
  });
  it("does NOT verify an incidental mid-paragraph substring (substring-collision guard)", async () => {
    const short = mkExp({ lever: "answer_block", currentText: "Tehran is the capital of Iran.", proposedText: "Tehran is the capital of Iran.", detail: { kind: "answer_block", question: "q", operation: "move", exactInstruction: "x", paragraphIndex: 1 } });
    const para = "In this long opening discussion we cover many topics, and Tehran is the capital of Iran, plus a great deal of additional surrounding text that continues well beyond the sentence itself here.";
    const r = await verifyExperimentLive(short, { fetchPage: fetchOk(raw(`<main><p>${para}</p></main>`)) });
    expect(r.verified).toBe(false);
    if (!r.verified) expect(r.reason).toBe("expected_text_missing");
  });
});

describe("answer-block verification", () => {
  const answer = "Chaharshanbe Suri is the Persian festival of fire celebrated on the eve before the last Wednesday of the year.";
  const exp = mkExp({
    lever: "answer_block", currentText: answer, proposedText: answer,
    detail: { kind: "answer_block", question: "What is Chaharshanbe Suri?", operation: "move_to_top", exactInstruction: "Move below H1", paragraphIndex: 4 },
  });
  it("verifies when the answer is the first content paragraph", async () => {
    const r = await verifyExperimentLive(exp, { fetchPage: fetchOk(pageHtml({ paras: [answer, "Some other long supporting paragraph that has plenty of words in it."] })) });
    expect(r.verified).toBe(true);
  });
  it("fails when the answer is still buried deep", async () => {
    const filler = "This is a long filler paragraph with more than eight words present.";
    const r = await verifyExperimentLive(exp, { fetchPage: fetchOk(pageHtml({ paras: [filler, filler, filler, filler, answer] })) });
    expect(r.verified).toBe(false);
    if (!r.verified) expect(r.reason).toBe("answer_not_at_expected_location");
  });
  it("fails when the answer sentence is absent", async () => {
    const r = await verifyExperimentLive(exp, { fetchPage: fetchOk(pageHtml({ paras: ["A completely different paragraph that does not contain the answer text at all."] })) });
    expect(r.verified).toBe(false);
    if (!r.verified) expect(r.reason).toBe("expected_text_missing");
  });
});
