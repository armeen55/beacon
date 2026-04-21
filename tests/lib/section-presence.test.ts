import { describe, it, expect } from "vitest";
import {
  classifySectionPresence,
  formatSectionPresenceLog,
  parseAddSectionHeadline,
  type SectionPresenceInput,
} from "@/lib/section-presence";

function page(overrides: Partial<SectionPresenceInput> = {}): SectionPresenceInput {
  return {
    h2_list: [],
    h3_list: [],
    title: null,
    h1: null,
    meta_description: null,
    body_paragraph_sample: [],
    card_texts: [],
    schema_entity_names: [],
    faqs: [],
    ...overrides,
  };
}

describe("parseAddSectionHeadline", () => {
  it("parses 'Add X section on /path'", () => {
    expect(
      parseAddSectionHeadline("Add neighborhoods section on /locations/atherton"),
    ).toEqual({ concept: "neighborhoods", path: "/locations/atherton" });
  });

  it("parses without the 'section' word", () => {
    expect(
      parseAddSectionHeadline("Add cost breakdown on /services/whole-home-remodel"),
    ).toEqual({ concept: "cost breakdown", path: "/services/whole-home-remodel" });
  });

  it("parses quoted concept", () => {
    expect(
      parseAddSectionHeadline('Add "Custom Homes in Atherton" on /locations/atherton'),
    ).toEqual({
      concept: "Custom Homes in Atherton",
      path: "/locations/atherton",
    });
  });

  it("returns null for non-add headlines", () => {
    expect(
      parseAddSectionHeadline("Best current page for \"X\": /our-difference"),
    ).toBeNull();
    expect(
      parseAddSectionHeadline("\"X\" is missing from /path"),
    ).toBeNull();
    expect(
      parseAddSectionHeadline("Close competitive gap for \"X\""),
    ).toBeNull();
  });
});

// ─── state: exists_signposted (H2/H3 only) ─────────────────────────────────

describe("exists_signposted — H2/H3 only", () => {
  it("H2 containing the concept → suppress", () => {
    const p = page({
      h2_list: ["Neighborhoods We Serve", "About Us"],
    });
    const r = classifySectionPresence(p, "neighborhoods");
    expect(r.state).toBe("exists_signposted");
    expect(r.matchedField).toBe("h2_list[0]");
  });

  it("H3 containing the concept → suppress", () => {
    const p = page({
      h2_list: ["Our Process"],
      h3_list: ["Palo Alto Neighborhoods"],
    });
    const r = classifySectionPresence(p, "neighborhoods");
    expect(r.state).toBe("exists_signposted");
    expect(r.matchedField).toBe("h3_list[0]");
  });

  it("signpost precedence beats substance — body also contains concept", () => {
    const p = page({
      h2_list: ["Neighborhoods"],
      body_paragraph_sample: ["We build in multiple neighborhoods across the peninsula."],
    });
    const r = classifySectionPresence(p, "neighborhoods");
    expect(r.state).toBe("exists_signposted");
    expect(r.matchedField).toBe("h2_list[0]");
  });
});

// ─── state: exists_weakly_signposted ───────────────────────────────────────

describe("exists_weakly_signposted — content present, no H2/H3 heading", () => {
  it("body paragraph mentions concept, no H2/H3 → weakly signposted", () => {
    const p = page({
      h2_list: ["About Us", "Contact"],
      body_paragraph_sample: [
        "We build across multiple neighborhoods in Atherton, Menlo Park, and Palo Alto.",
      ],
    });
    const r = classifySectionPresence(p, "neighborhoods");
    expect(r.state).toBe("exists_weakly_signposted");
    expect(r.matchedField).toBe("body_paragraph_sample[0]");
  });

  it("card_texts mentions concept → weakly signposted", () => {
    const p = page({
      h2_list: ["About"],
      card_texts: [
        "Old Palo Alto neighborhood — period homes from the 1900s.",
        "Crescent Park neighborhood — modern lots near the creek.",
      ],
    });
    const r = classifySectionPresence(p, "neighborhoods");
    expect(r.state).toBe("exists_weakly_signposted");
    expect(r.matchedField).toMatch(/card_texts/);
  });

  it("FAQ question mentions concept → weakly signposted", () => {
    const p = page({
      h2_list: ["Our Process"],
      faqs: [
        { question: "Which neighborhoods do you serve?" },
        { question: "How long does a custom build take?" },
      ],
    });
    const r = classifySectionPresence(p, "neighborhoods");
    expect(r.state).toBe("exists_weakly_signposted");
    expect(r.matchedField).toBe("faqs[0].question");
  });

  it("title mentions concept but no H2/H3 → weakly signposted (NOT suppressed)", () => {
    // KEY rule: title is substance, not signpost. A page title that names the
    // concept should not be enough to suppress — the H2 may still need to
    // change to signpost the section properly.
    const p = page({
      title: "Neighborhoods We Build In — Atherton Custom Homes",
      h2_list: ["Our Process", "About Us"],
    });
    const r = classifySectionPresence(p, "neighborhoods");
    expect(r.state).toBe("exists_weakly_signposted");
    expect(r.matchedField).toBe("title");
  });

  it("H1 mentions concept but no H2/H3 → weakly signposted (NOT suppressed)", () => {
    const p = page({
      h1: "Our Neighborhoods",
      h2_list: ["Contact"],
    });
    const r = classifySectionPresence(p, "neighborhoods");
    expect(r.state).toBe("exists_weakly_signposted");
    expect(r.matchedField).toBe("h1");
  });

  it("schema entity name mentions concept but no H2/H3 → weakly signposted", () => {
    const p = page({
      h2_list: ["About"],
      schema_entity_names: ["Neighborhoods Collection"],
    });
    const r = classifySectionPresence(p, "neighborhoods");
    expect(r.state).toBe("exists_weakly_signposted");
    expect(r.matchedField).toBe("schema_entity_names[0]");
  });

  it("meta_description mentions concept → weakly signposted", () => {
    const p = page({
      meta_description: "Custom home builder serving neighborhoods across the peninsula.",
      h2_list: ["About"],
    });
    const r = classifySectionPresence(p, "neighborhoods");
    expect(r.state).toBe("exists_weakly_signposted");
    expect(r.matchedField).toBe("meta_description");
  });
});

// ─── state: absent ─────────────────────────────────────────────────────────

describe("absent — concept not mentioned anywhere", () => {
  it("no field contains the concept → absent", () => {
    const p = page({
      title: "Atherton Luxury Custom Homes",
      h1: "Atherton Builder",
      h2_list: ["What We Build", "Our Process"],
      h3_list: ["Design Phase", "Build Phase"],
      body_paragraph_sample: ["We specialize in luxury construction."],
      card_texts: ["Fine craftsmanship."],
      faqs: [{ question: "When did you start?" }],
    });
    const r = classifySectionPresence(p, "neighborhoods");
    expect(r.state).toBe("absent");
    expect(r.matchedField).toBeNull();
  });

  it("empty page → absent", () => {
    const r = classifySectionPresence(page(), "neighborhoods");
    expect(r.state).toBe("absent");
  });
});

// ─── edge cases ────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("empty concept → unknown", () => {
    const r = classifySectionPresence(page({ h2_list: ["X"] }), "");
    expect(r.state).toBe("unknown");
  });

  it("singular/plural fold — 'neighborhood' matches 'Neighborhoods We Serve'", () => {
    const p = page({ h2_list: ["Neighborhoods We Serve"] });
    const r = classifySectionPresence(p, "neighborhood");
    expect(r.state).toBe("exists_signposted");
  });

  it("contiguous-match discipline — scattered tokens do not match", () => {
    // Body contains "neighborhood" AND "old" but not "old neighborhood" as a
    // phrase. Should NOT classify as covered.
    const p = page({
      body_paragraph_sample: [
        "The neighborhood varies from modern homes to old Victorian architecture.",
      ],
    });
    const r = classifySectionPresence(p, "old neighborhood");
    expect(r.state).toBe("absent");
  });

  it("pre-A+B1 snapshots (no new fields) still classify", () => {
    // Only legacy fields populated.
    const p: SectionPresenceInput = {
      title: "Atherton Custom Home Builder",
      h1: "Atherton Builder",
      h2_list: ["About Us"],
    };
    const r = classifySectionPresence(p, "neighborhoods");
    expect(r.state).toBe("absent");
  });
});

// ─── log format ─────────────────────────────────────────────────────────────

describe("formatSectionPresenceLog", () => {
  it("emits one readable line with state and matched field", () => {
    const line = formatSectionPresenceLog("neighborhoods", "/locations/atherton", {
      state: "exists_weakly_signposted",
      matchedField: "body_paragraph_sample[0]",
      matchedText: "We build across multiple neighborhoods",
    });
    expect(line).toContain("[section-presence]");
    expect(line).toContain("\"neighborhoods\"");
    expect(line).toContain("/locations/atherton");
    expect(line).toContain("exists_weakly_signposted");
    expect(line).toContain("matched=body_paragraph_sample[0]");
  });

  it("omits match info when absent", () => {
    const line = formatSectionPresenceLog("foo", "/bar", {
      state: "absent",
      matchedField: null,
      matchedText: null,
    });
    expect(line).toContain("absent");
    expect(line).not.toContain("matched=");
  });
});
