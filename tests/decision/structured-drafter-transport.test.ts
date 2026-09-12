/** structured-drafter strict-gateway transport: the seam returns parsed VALUES (no prose recovery), a refusal fails closed with no artifact, retry is bounded and paid for, and a cache hit costs $0. */
import { describe, it, expect, vi } from "vitest";
const BILLED = vi.hoisted(() => ({ usd: [] as number[] })); // Budget is not this file's subject (see llm-budget-isolation.test.ts): keep the transport hermetic with an always-allowed budget seam that RECORDS what it was told to bill.
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({
  checkBudget: async () => ({ allowed: true, remaining: 10 }),
  recordSpend: async (usd: number) => { BILLED.usd.push(usd); },}));
import { callStructuredLLM, draftAtomicEditStructured, type CompleteFn } from "@/domains/decision/llm/structured-drafter";
import type { CacheImpl, LlmCallCacheEntry } from "@/domains/decision/llm/call-cache";
const VALID_ATOMIC_EDIT = { // A schema-valid AtomicEditDraft value (the simplest kind, no source-verify / word-count / superlative machinery in the way of the transport assertions).
  field: "title", before: "Nowruz", after: "Nowruz Traditions: Persian New Year Customs and Haft-Seen", rationale: "The current title is one word and misses the customs searchers ask about.",
  evidenceRefs: [{ source: "gsc", detail: "strong impressions for nowruz traditions with a low click rate" }], confidence: "high", risks: ["keep the title concise"],
  operatorSteps: ["Replace the page title field with the new value"], proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "comparable unchanged pages" },};
const REQ = {
  kind: "atomic_edit" as const, tenantId: "tenant-fixture",
  system: "You improve one on-page field. Return the field, before, after, rationale, evidenceRefs, confidence, risks, operatorSteps, proofPlan.",
  user: "Page: Nowruz. Field to edit: title. Current title: Nowruz.",
  grounded: "nowruz traditions persian new year customs haft-seen",};
/** A `complete` double that replays a queue and counts how many times it ran. */
function seam(responses: Array<{ value: unknown } | { error: string; retryable: boolean; costUsd?: number }>): { complete: CompleteFn; calls: () => number } {
  let i = 0, calls = 0; const complete: CompleteFn = async () => { calls += 1; return responses[Math.min(i++, responses.length - 1)]!; };
  return { complete, calls: () => calls };}
describe("structured-drafter strict transport", () => {
  it("normalizes publishable punctuation without changing literal anchors, replaced text or addresses", async () => {
    const exact = { ...VALID_ATOMIC_EDIT, before: "Nowruz—Customs", after: "Nowruz—Persian New Year Customs", placementAnchor: "Stored—heading", operatorSteps: ["Open https://docs.example/a—b"] }, out = await callStructuredLLM({ ...REQ, complete: seam([{ value: exact }]).complete });
    expect(out.status === "drafted" && [out.value.before, out.value.after, out.value.placementAnchor, out.value.operatorSteps]).toEqual([exact.before, "Nowruz - Persian New Year Customs", exact.placementAnchor, exact.operatorSteps]);
    for (const [after, count, status] of [["Nowruz Customs: 14 Traditions", 3157, "validation_failed"], ["Nowruz Customs: 3157 Traditions", 3157, "validation_failed"], [VALID_ATOMIC_EDIT.after, 3157, "drafted"], [VALID_ATOMIC_EDIT.after, 9999, "validation_failed"]] as const) { const value = { ...VALID_ATOMIC_EDIT, after, evidenceRefs: [{ source: "gsc", detail: `${count} impressions` }] }, judged = await callStructuredLLM({ ...REQ, observationGrounded: "GSC recorded 3157 impressions", complete: seam([{ value }]).complete }); expect(judged.status, "observed traffic may support a diagnostic ref, never a factual count in paste copy, and a fabricated diagnostic count is refused too").toBe(status); } });
  it("refuses a draft argued from analytics alone, and takes the same draft once it also cites a search", async () => {
    const refs = (r: unknown[]) => ({ value: { ...VALID_ATOMIC_EDIT, evidenceRefs: r } }); const clarity = [{ source: "clarity", detail: "people stop scrolling about halfway down the page" }];
    const bad = await callStructuredLLM({ ...REQ, complete: seam([refs(clarity), refs(clarity)]).complete }); // both attempts, still nothing about a search
    expect([bad.status, bad.status === "validation_failed" && bad.reason.startsWith("evidenceRefs: analytics alone")]).toEqual(["validation_failed", true]);
    const good = await callStructuredLLM({ ...REQ, complete: seam([refs([...clarity, { source: "gsc", detail: "strong impressions with a low click rate" }])]).complete });
    expect(good.status).toBe("drafted"); }); // ga4 and clarity are welcome BESIDE evidence of the search, never instead of it
  /** AND SAYING SO IS NOT ENOUGH (live, 2026-08-31). The link brief forbade marking the anchor in the plainest words available, and the writer still returned "[Zanjan Rug]", so the placeholder firewall refused both attempts and the candidate bought nothing twice. The words were right and the punctuation around them was the model's own, so code takes the punctuation off rather than paying again to ask nicely. */
  it("takes the writer's markup off an anchor that is otherwise exactly right, and still refuses a real placeholder", async () => {
    const drive = async (after: string) => callStructuredLLM({ kind: "atomic_edit" as const, tenantId: "t", system: "s", user: "u", unmarkPhrase: "Zanjan Rug", grounded: "Zanjan rugs run 100 to 150 knots per square inch and the page earns 1400 impressions in 90 days", complete: seam([{ value: { ...VALID_ATOMIC_EDIT, after } }]).complete });
    for (const marked of ["Kashan knot counts run higher than the [Zanjan Rug], which sits between 100 and 150.", "Kashan knot counts run higher than the **Zanjan Rug**, which sits between 100 and 150.", "Kashan knot counts run higher than the [Zanjan Rug](/persian-rugs/zanjan-rug), which sits between 100 and 150."]) {
      const out = await drive(marked);
      expect([out.status, out.status === "drafted" && (out.value as { after: string }).after], `the words survive and only the writer's own markup comes off: ${marked.slice(30, 60)}`)
        .toEqual(["drafted", "Kashan knot counts run higher than the Zanjan Rug, which sits between 100 and 150."]); }
    const holes = await drive("Kashan knot counts run higher than the [insert rug name], which sits between 100 and 150.");
    expect([holes.status, holes.status === "validation_failed" && holes.reason.includes("placeholder")], "an unfilled hole is not markup around the right words, and is refused exactly as before").toEqual(["validation_failed", true]);
    const edit = await callStructuredLLM({ kind: "atomic_edit" as const, tenantId: "t", system: "s", user: "u", grounded: "Zanjan Rug knot density", unmarkPhrase: "Zanjan Rug", // AND A LINK IS DRAFTED THROUGH THE ATOMIC EDITOR, not the older link kind, which is why the first repair fired on nothing: only the caller knows which words are the anchor, so it says so, and every field is cleaned rather than one.
      complete: seam([{ value: { ...VALID_ATOMIC_EDIT, after: "Kashan pile is denser than the [Zanjan Rug] weave.", operatorSteps: ["Link the words **Zanjan Rug** in that sentence"] } }]).complete });
    expect([edit.status, edit.status === "drafted" && (edit.value as { after: string }).after, edit.status === "drafted" && (edit.value as { operatorSteps: string[] }).operatorSteps[0]], "the anchor the caller resolved is unwrapped in the copy AND in the steps, because the firewall reads both").toEqual(["drafted", "Kashan pile is denser than the Zanjan Rug weave.", "Link the words Zanjan Rug in that sentence"]);
    const banked = { ...VALID_ATOMIC_EDIT, after: "Kashan pile is denser than the [Zanjan Rug] weave." } as unknown as LlmCallCacheEntry["value"]; // A HIT RETURNS BEFORE THE FIREWALLS, so a draft banked under an older prompt version would serve the brackets the fresh path takes off: what the customer reads may not depend on which door the answer came through.
    const served = await callStructuredLLM({ kind: "atomic_edit" as const, tenantId: "t", system: "s", user: "u", grounded: "Zanjan Rug", unmarkPhrase: "Zanjan Rug", complete: seam([{ error: "should-never-run", retryable: false }]).complete,
      cacheImpl: { read: async () => ({ value: banked } as LlmCallCacheEntry), write: async () => {}, recentTexts: async () => [] } });
    expect([served.status, served.status === "drafted" && served.cached, served.status === "drafted" && (served.value as { after: string }).after],
      "the cached answer is cleaned exactly like a fresh one, and still costs nothing").toEqual(["drafted", true, "Kashan pile is denser than the Zanjan Rug weave."]); });
  it("drafts a VALUE, retries a recoverable answer once and no more, and never pays twice for one answer", async () => {
    const one = seam([{ value: VALID_ATOMIC_EDIT }]); // a parsed value, no text parsing, on one call
    const first = await callStructuredLLM({ ...REQ, complete: one.complete }); expect(first.status === "drafted" && [(first.value as { after: string }).after.includes("Nowruz Traditions"), one.calls()]).toEqual([true, 1]);
    BILLED.usd.length = 0; // A CALL THAT BOUGHT NOTHING IS BILLED NOTHING. Two attempts died with no usage receipt; the drafter used to substitute an ESTIMATE and record it against the cap, so a throttled minute read back as real money and could later block a working account on spend that never happened.
    const boom = await callStructuredLLM({ ...REQ, complete: seam([{ error: "network boom", retryable: true }]).complete }); expect([boom.status === "validation_failed" && boom.costUsd, BILLED.usd]).toEqual([0, []]);
    BILLED.usd.length = 0; // and a real receipt is billed exactly once, exactly as it was issued
    const paid = await callStructuredLLM({ ...REQ, complete: seam([{ error: "incomplete", retryable: false, costUsd: 0.0042 }]).complete }); expect([paid.status === "validation_failed" && paid.costUsd, BILLED.usd]).toEqual([0.0042, [0.0042]]);
    const again = seam([{ value: {} }, { value: VALID_ATOMIC_EDIT }]); // a rejection CAN recover
    const out = await callStructuredLLM({ ...REQ, complete: again.complete }); expect(out.status === "drafted" && [out.retried, again.calls()]).toEqual([true, 2]);
    const refused = await callStructuredLLM({ ...REQ, complete: seam([{ error: "refusal", retryable: false, costUsd: 0.0123 }]).complete });
    expect(refused.status === "validation_failed" && refused.costUsd).toBe(0.0123); // no retry on a refusal, its real cost
    const now = new Date("2026-07-23T00:00:00Z").toISOString();
    const entry = { key: "ignored-key-is-derived", tenantId: "tenant-fixture", kind: "atomic_edit", promptId: "draft.atomic_edit",
      promptVersion: 1, value: VALID_ATOMIC_EDIT, primaryText: VALID_ATOMIC_EDIT.after, createdAt: now, lastUsedAt: now } as LlmCallCacheEntry;
    const cacheImpl: CacheImpl = { read: async () => entry, write: async () => {}, recentTexts: async () => [] }; const hit = seam([{ error: "should-never-run", retryable: false }]);
    const cached = await callStructuredLLM({ ...REQ, complete: hit.complete, cacheImpl }); // served before any call
    expect(cached.status === "drafted" && [cached.cached, cached.costUsd, hit.calls()]).toEqual([true, 0, 0]); const blocked = seam([{ error: "blocked_budget", retryable: false }]);
    const stopped = await callStructuredLLM({ ...REQ, complete: blocked.complete }); // a budget block fired no call
    expect(stopped.status === "validation_failed" && [stopped.costUsd, blocked.calls()]).toEqual([0, 1]); }); });
/** A DESCRIPTION IS ABOUT THE PAGE'S SUBJECT, AND A PAGE'S QUESTION RAIL IS NOT ITS SUBJECT. `Page covers:` renders the stored headings verbatim, so on a product page whose first headings are its FAQ the model was told, truthfully, that the page covers shipping and returns, and it sold those: "Iran Shir o Khorshid Vertical Stripe Shirt with FAQs on shipping, returns, waterproofing, and gift-ready details on the page". A heading shaped as a question is the page ASKING something, not being about it. Only a description drops them; every other field still reads the whole outline. */
describe("a description names the subject, never the page's own furniture", () => {
  const ask = async (field: "meta" | "title") => { let seen = { system: "", user: "" }; const capture: CompleteFn = async (r) => { seen = { system: r.system, user: r.user }; return { error: "refusal", retryable: false }; };
    await draftAtomicEditStructured({ query: "shir o khorshid shirt", pageLabel: "Shir o Khorshid Shirt", field, currentValue: null, tenantId: "t",
      outline: ["Shir o Khorshid Vertical Stripe Shirt", "Does this ship internationally?", "What is the return policy?", "Cotton, mid-weight, regular fit"] }, { complete: capture });
    return seen; };
  it("tells the retry which text was rejected, and never asks a kind for a field its own schema lacks", async () => {
    let second = ""; // LIVE on the fact judge: a Wikipedia reference marker like "[ 1 ]" inside a quoted passage trips the
    const capture: CompleteFn = async (r) => { second = r.system;
      return { value: { ...VALID_ATOMIC_EDIT, rationale: "The title misses what searchers ask [ 1 ] about." } }; };
    await callStructuredLLM({ ...REQ, complete: capture });
    expect(second, "the retry is shown the exact offending text").toContain("[ 1 ]");
    expect(second).toContain("evidenceRefs"); // atomic_edit DOES carry evidenceRefs, so the instruction still belongs on this kind.
    let judgeRetry = "";
    const judge: CompleteFn = async (r) => { judgeRetry = r.system; return { value: { verdict: "not a valid judgement [ 2 ]" } }; };
    await callStructuredLLM({ kind: "fact_claim_judgement", tenantId: "t", system: "You judge one claim.",
      user: "Judge it.", grounded: "a passage", complete: judge } as never);
    expect(judgeRetry, "a judgement has no evidenceRefs field, so it is never asked for one").not.toContain("evidenceRefs");
    const VERDICT = { verdict: "page_correct", confidence: "likely", proposed: "", literal: "light", usage: "given name", note: 'the page quotes its source as "light [ 1 ]"', supporting: [], subjects: [] }; // A VERDICT IS NOT A PAGE (live, 2026-08-30): the judge quotes the page's own citation markers, so a schema-valid judgement carrying "[ 1 ]" DRAFTS; the bracket rule guards only copy a customer could paste (the atomic_edit above still refuses it).
    const ruled = await callStructuredLLM({ kind: "fact_claim_judgement", tenantId: "t", system: "You judge one claim.", user: "Judge it.", grounded: "a passage", complete: seam([{ value: VERDICT }]).complete } as never);
    expect(ruled.status, "a citation marker in a verdict is data, never an unfilled placeholder").toBe("drafted"); });

  it("keeps the questions out of a meta and leaves every other field alone", async () => {
    const meta = await ask("meta"), title = await ask("title");
    expect(meta.user).toContain("Cotton, mid-weight, regular fit"); // the real attribute survives
    expect(meta.user).not.toMatch(/ship internationally|return policy/); // the question rail never becomes the subject
    expect(meta.system).toContain("DESCRIBE THE THING THE PAGE IS ABOUT, NEVER THE PAGE");
    expect(title.user).toContain("Does this ship internationally?"); // a title still reads the whole outline
    expect(title.system).not.toContain("DESCRIBE THE THING THE PAGE IS ABOUT"); });});
/** MARKUP AROUND RIGHT WORDS IS THE WRITER'S PUNCTUATION (operator, 2026-08-31, the bracketed-anchor rule again). A real comedians section arrived opening "### Iranian comedy names to know" and a numerals section arrived wrapped in h2 and p tags; the canon rightly refused both, and the words were right. The heading travels typed in naturalHeading, so code takes the markup off in the ONE normalizer every acceptance path runs through, instead of paying for a redraft. */
import { withoutCta } from "@/domains/decision/drafted-copy";
describe("the writer's markdown and HTML come off finished copy", () => {
  it("strips a leading heading line and block tags, and touches no words", () => {
    expect(withoutCta("### Iranian comedy names to know\nIranian comedians include Max Amini and Omid Djalili.\nMax Amini is known for stand-up tours.", "section"), "the markdown heading goes, the sentences stay word for word")
      .toBe("Iranian comedians include Max Amini and Omid Djalili.\nMax Amini is known for stand-up tours.");
    expect(withoutCta("<h2>How Persian numerals work</h2>\n<p>Persian numbers use the same decimal system used worldwide.</p><p>The digits for 4, 5, and 6 have distinct Persian forms.</p>", "section"), "h2 and p wrapping goes, the prose stays with its line structure")
      .toBe("Persian numbers use the same decimal system used worldwide.\nThe digits for 4, 5, and 6 have distinct Persian forms.");
    expect(withoutCta("Plain copy stays exactly as written here today.", "section"), "clean copy is untouched").toBe("Plain copy stays exactly as written here today."); });
});
