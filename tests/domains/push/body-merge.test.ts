/**
 * BEACON_500 item 2 (2026-07-01): the body-section merge engine contract.
 * These tests pin the non-destructive discipline: prepend/append never
 * wipe the original, replace swaps exactly one heading-delimited section,
 * RICOS gets conservative paragraph-node adds only, and anything the
 * engine cannot do safely fails closed with a plain paste-it receipt.
 */

import { describe, it, expect } from "vitest";

import {
  mergeBodyContent,
  bodyMergeModeForAction,
  originalContentRetained,
  buildRicosParagraphNodes,
  unrecognizedKindReason,
  draftToHtml,
  MIN_ORIGINAL_KEEP_RATIO,
} from "@/domains/push/body-merge";
import { hasBannedDash } from "@/lib/copy/strip-dashes";

const BODY_PLAIN = [
  "Persian cats are a long-haired breed known for their calm temperament.",
  "",
  "History",
  "",
  "The breed arrived in Europe in the 1600s and became a favorite of royalty across the continent.",
  "",
  "Care",
  "",
  "Daily brushing keeps the coat healthy. Most owners groom in the morning.",
].join("\n");

const ANSWER_DRAFT =
  "Persian cats live 12 to 17 years on average. Indoor cats with regular vet care live the longest.";

const FAQ_DRAFT = [
  "Frequently asked questions",
  "How long do Persian cats live?",
  "They live 12 to 17 years on average with routine care.",
].join("\n");

function expectNoBannedDashes(s: string): void {
  expect(hasBannedDash(s)).toBe(false);
}

describe("body-merge - plain text", () => {
  it("prepend_answer puts the draft first and keeps the whole original", () => {
    const r = mergeBodyContent({ existing: BODY_PLAIN, draft: ANSWER_DRAFT, kind: "plain", mode: "prepend_answer" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.merged.startsWith(ANSWER_DRAFT)).toBe(true);
    expect(r.merged).toContain(BODY_PLAIN);
    expect(r.merged.indexOf(ANSWER_DRAFT)).toBeLessThan(r.merged.indexOf("Persian cats are a long-haired breed"));
    expectNoBannedDashes(r.summary);
  });

  it("append_faq puts the draft last and keeps the whole original", () => {
    const r = mergeBodyContent({ existing: BODY_PLAIN, draft: FAQ_DRAFT, kind: "plain", mode: "append_faq" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.merged.startsWith(BODY_PLAIN)).toBe(true);
    expect(r.merged.endsWith(FAQ_DRAFT)).toBe(true);
  });

  it("an empty existing body just becomes the draft (additive onto empty)", () => {
    const r = mergeBodyContent({ existing: "", draft: ANSWER_DRAFT, kind: "plain", mode: "prepend_answer" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.merged).toBe(ANSWER_DRAFT);
  });

  it("replace_section swaps exactly the matched section and keeps everything around it", () => {
    const draft = [
      "History",
      "",
      "Traders brought the breed to Europe in the early 1600s, where noble households prized it; written records span four centuries.",
    ].join("\n");
    const r = mergeBodyContent({
      existing: BODY_PLAIN,
      draft,
      kind: "plain",
      mode: "replace_section",
      opts: { sectionHeading: "History" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.merged).toContain("Persian cats are a long-haired breed"); // intro kept
    expect(r.merged).toContain("Daily brushing keeps the coat healthy"); // Care kept
    expect(r.merged).toContain("Traders brought the breed to Europe"); // new section in
    expect(r.merged).not.toContain("became a favorite of royalty"); // old section out
  });

  it("replace_section matches headings case-insensitively and through markdown hashes", () => {
    const body = "Intro paragraph here.\n\n## Cooking Time\n\nAbout an hour on low heat.";
    const r = mergeBodyContent({
      existing: body,
      draft: "Cooking Time\n\nAbout ninety minutes on low heat, covered.",
      kind: "plain",
      mode: "replace_section",
      opts: { sectionHeading: "cooking time" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.merged).toContain("ninety minutes");
  });

  it("replace_section fails closed when the heading is not on the page", () => {
    const r = mergeBodyContent({
      existing: BODY_PLAIN,
      draft: "Something new",
      kind: "plain",
      mode: "replace_section",
      opts: { sectionHeading: "Pricing" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("could not find");
      expect(r.reason).toContain("paste");
      expectNoBannedDashes(r.reason);
    }
  });

  it("replace_section fails closed when no heading was provided", () => {
    const r = mergeBodyContent({ existing: BODY_PLAIN, draft: "x y z", kind: "plain", mode: "replace_section" });
    expect(r.ok).toBe(false);
  });

  it("replace_section refuses a deletion-shaped replacement (tiny draft over a big section)", () => {
    const bigSection = ["Care", "", "Daily brushing keeps the coat healthy. ".repeat(20)].join("\n");
    const body = `Intro sentence for the page.\n\n${bigSection}`;
    const r = mergeBodyContent({
      existing: body,
      draft: "Care\nBrush.",
      kind: "plain",
      mode: "replace_section",
      opts: { sectionHeading: "Care" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("deletion");
  });
});

describe("body-merge - html strings", () => {
  const HTML_BODY =
    "<p>Ghormeh sabzi is a herb stew.</p>" +
    "<h2>Ingredients</h2><p>Herbs, kidney beans, dried limes, lamb.</p>" +
    "<h2>Serving</h2><p>Serve over rice.</p>";

  it("prepend wraps a plain draft in escaped <p> tags and keeps the original", () => {
    const r = mergeBodyContent({
      existing: HTML_BODY,
      draft: "Ghormeh sabzi takes 3 hours to cook & serves 4 to 6 people.",
      kind: "html",
      mode: "prepend_answer",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.merged.startsWith("<p>Ghormeh sabzi takes 3 hours to cook &amp; serves 4 to 6 people.</p>")).toBe(true);
    expect(r.merged).toContain(HTML_BODY);
  });

  it("append passes a real HTML draft through untouched", () => {
    const draftHtml = "<h2>FAQ</h2><p>How long does it keep? Three days refrigerated.</p>";
    const r = mergeBodyContent({ existing: HTML_BODY, draft: draftHtml, kind: "html", mode: "append_faq" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.merged.endsWith(draftHtml)).toBe(true);
    expect(r.merged).toContain(HTML_BODY);
  });

  it("draftToHtml turns single newlines into <br /> inside a paragraph", () => {
    expect(draftToHtml("Q: How long?\nA: Three hours.")).toBe("<p>Q: How long?<br />A: Three hours.</p>");
  });

  it("replace_section swaps from the matched <h2> to the next heading of the same level", () => {
    const r = mergeBodyContent({
      existing: HTML_BODY,
      draft: "<h2>Ingredients</h2><p>Fresh herbs, red kidney beans, dried Persian limes, and lamb shank.</p>",
      kind: "html",
      mode: "replace_section",
      opts: { sectionHeading: "Ingredients" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.merged).toContain("<p>Ghormeh sabzi is a herb stew.</p>"); // prefix kept
    expect(r.merged).toContain("<h2>Serving</h2><p>Serve over rice.</p>"); // suffix kept
    expect(r.merged).toContain("dried Persian limes");
    expect(r.merged).not.toContain("Herbs, kidney beans, dried limes, lamb.");
  });

  it("replace_section on the LAST section runs to the end of the string", () => {
    const r = mergeBodyContent({
      existing: HTML_BODY,
      draft: "<h2>Serving</h2><p>Serve hot over saffron rice with fresh herbs on the side.</p>",
      kind: "html",
      mode: "replace_section",
      opts: { sectionHeading: "Serving" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.merged).not.toContain("Serve over rice.");
    expect(r.merged).toContain("saffron rice");
  });

  it("replace_section fails closed when no heading tag matches", () => {
    const r = mergeBodyContent({
      existing: HTML_BODY,
      draft: "<h2>Nutrition</h2><p>x</p>",
      kind: "html",
      mode: "replace_section",
      opts: { sectionHeading: "Nutrition" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("paste");
  });
});

describe("body-merge - RICOS structured content", () => {
  const RICOS_DOC = JSON.stringify({
    type: "DOC",
    nodes: [
      {
        type: "PARAGRAPH",
        id: "orig-1",
        nodes: [{ type: "TEXT", id: "", nodes: [], textData: { text: "Original paragraph.", decorations: [] } }],
        paragraphData: {},
      },
    ],
    metadata: { version: 1 },
  });

  it("prepend builds minimal paragraph nodes ahead of the existing nodes", () => {
    const r = mergeBodyContent({
      existing: RICOS_DOC,
      draft: "First answer line.\nSecond answer line.",
      kind: "ricos",
      mode: "prepend_answer",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = JSON.parse(r.merged) as { nodes: Array<{ id: string; type: string; nodes: Array<{ textData?: { text: string } }> }>; metadata?: unknown };
    expect(doc.nodes).toHaveLength(3);
    expect(doc.nodes[0]!.type).toBe("PARAGRAPH");
    expect(doc.nodes[0]!.nodes[0]!.textData!.text).toBe("First answer line.");
    expect(doc.nodes[1]!.nodes[0]!.textData!.text).toBe("Second answer line.");
    expect(doc.nodes[2]!.id).toBe("orig-1"); // original preserved, in order
    expect(doc.metadata).toEqual({ version: 1 }); // doc-level fields preserved
  });

  it("append puts the new paragraph nodes after the existing ones", () => {
    const r = mergeBodyContent({ existing: RICOS_DOC, draft: "A new FAQ line.", kind: "ricos", mode: "append_faq" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = JSON.parse(r.merged) as { nodes: Array<{ id: string }> };
    expect(doc.nodes).toHaveLength(2);
    expect(doc.nodes[0]!.id).toBe("orig-1");
  });

  it("an empty existing value becomes a fresh doc with just the new nodes", () => {
    const r = mergeBodyContent({ existing: "", draft: "Only line.", kind: "ricos", mode: "append_faq" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = JSON.parse(r.merged) as { nodes: unknown[] };
    expect(doc.nodes).toHaveLength(1);
  });

  it("replace_section fails closed on RICOS (we never restructure rich content)", () => {
    const r = mergeBodyContent({
      existing: RICOS_DOC,
      draft: "x",
      kind: "ricos",
      mode: "replace_section",
      opts: { sectionHeading: "History" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("cannot safely replace");
      expect(r.reason).toContain("paste");
      expectNoBannedDashes(r.reason);
    }
  });

  it("unparseable RICOS fails closed", () => {
    const r = mergeBodyContent({ existing: "not json {", draft: "x", kind: "ricos", mode: "append_faq" });
    expect(r.ok).toBe(false);
  });

  it("a JSON array (not a doc object) fails closed", () => {
    const r = mergeBodyContent({ existing: "[1,2,3]", draft: "x", kind: "ricos", mode: "append_faq" });
    expect(r.ok).toBe(false);
  });

  it("buildRicosParagraphNodes ids are deterministic", () => {
    const a = buildRicosParagraphNodes("one\ntwo", "append_faq");
    const b = buildRicosParagraphNodes("one\ntwo", "append_faq");
    expect(a).toEqual(b);
    expect(a[0]!.id).toBe("beacon-section-1");
  });
});

describe("body-merge - fail-closed rails", () => {
  it("an unrecognized field kind fails closed with the paste receipt", () => {
    const r = mergeBodyContent({ existing: "body", draft: "x", kind: "markdown", mode: "append_faq" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe(unrecognizedKindReason("markdown"));
      expect(r.reason).toContain("I could not safely write");
      expect(r.reason).toContain("left it for you to paste");
      expectNoBannedDashes(r.reason);
    }
  });

  it("an empty draft fails closed", () => {
    const r = mergeBodyContent({ existing: "body", draft: "   ", kind: "plain", mode: "append_faq" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("nothing to apply");
  });

  it("never-wipe assertion: a merged value missing the original is rejected", () => {
    expect(originalContentRetained({ existing: "the original body", merged: "only the draft" })).toBe(false);
    expect(originalContentRetained({ existing: "the original body", merged: "draft\n\nthe original body" })).toBe(true);
    expect(originalContentRetained({ existing: "", merged: "anything" })).toBe(true); // nothing to wipe
  });

  it("never-wipe assertion: a truncated merge below the keep ratio is rejected", () => {
    const existing = "a".repeat(1000);
    const truncated = "a".repeat(900); // contains a run but is under the ratio floor
    expect(MIN_ORIGINAL_KEEP_RATIO).toBeGreaterThan(0.9);
    expect(originalContentRetained({ existing, merged: truncated })).toBe(false);
  });

  it("all failure reasons and summaries stay dash-clean and plain", () => {
    const outputs: string[] = [];
    const cases = [
      mergeBodyContent({ existing: "b", draft: "", kind: "plain", mode: "append_faq" }),
      mergeBodyContent({ existing: "b", draft: "x", kind: "weird", mode: "append_faq" }),
      mergeBodyContent({ existing: BODY_PLAIN, draft: "x", kind: "plain", mode: "replace_section", opts: { sectionHeading: "Nope" } }),
      mergeBodyContent({ existing: "{", draft: "x", kind: "ricos", mode: "append_faq" }),
      mergeBodyContent({ existing: BODY_PLAIN, draft: ANSWER_DRAFT, kind: "plain", mode: "prepend_answer" }),
    ];
    for (const c of cases) outputs.push(c.ok ? c.summary : c.reason);
    for (const o of outputs) expectNoBannedDashes(o);
  });
});

describe("body-merge - action type mapping", () => {
  it("maps the section-producing action types and nothing else", () => {
    expect(bodyMergeModeForAction("add_answer_block")).toBe("prepend_answer");
    expect(bodyMergeModeForAction("add_faq")).toBe("append_faq");
    expect(bodyMergeModeForAction("add_h2_section")).toBe("append_faq");
    // Rewrites and directives never route to a body merge implicitly: a
    // rewrite draft usually carries only the new heading, and replacing a
    // whole section with a heading would delete its body.
    expect(bodyMergeModeForAction("rewrite_h2")).toBeNull();
    expect(bodyMergeModeForAction("update_intro")).toBeNull();
    expect(bodyMergeModeForAction("edit_title")).toBeNull();
    expect(bodyMergeModeForAction("improve_meta")).toBeNull();
    expect(bodyMergeModeForAction("add_schema")).toBeNull();
  });
});
