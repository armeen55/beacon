import { describe, it, expect } from "vitest";
import { GAIN } from "@/domains/decision/draft-resolution";
/** CONSOLIDATION IS SEMANTIC AND SAFE, pinned on the exact counterexamples the terminal contract names: material is content and never length, negation is a contradiction and never a preservation, figures are material one by one, formatting cannot hide a subject, and only a copy the page loses nothing by may authorize a removal. Lexical overlap finds candidates; it never authorizes Ready. */
describe("what a removal may destroy", () => {
  const H = ["Overview", "Topoli (تپلی)", "Kerman rugs", "Safety notes", "Founding date"];
  it("a three-word meaning is material: deleting its section without carrying it is refused", () => {
    const remains = "Topoli (تپلی). Topoli means chubby. Kerman rugs. Kerman rugs are wool. Safety notes. The dye is safe. Founding date. Founded in 1794.";
    const lossy = "Topoli (تپلی): an affectionate nickname.\nKerman rugs: wool rugs from Kerman.";
    const r = GAIN.absorption(lossy, remains, H);
    expect(r.repeats).toContain("Topoli");
    expect(r.whole).toBe(false);
    expect(r.missing ?? "").toContain("Topoli");
  });
  it("same tokens, flipped polarity: X is safe does not entail X is not safe", () => {
    const remains = "Safety notes. The dye is not safe for children. Topoli (تپلی). Topoli means chubby.";
    const flipped = "Safety notes: the dye is safe for children.\nTopoli (تپلی): means chubby.";
    const r = GAIN.absorption(flipped, remains, H);
    expect(r.whole).toBe(false);
    expect(r.missing ?? "").toContain("Safety notes");
  });
  it("a dropped figure is lost meaning whatever the coverage ratio says", () => {
    const remains = "Founding date. The workshop was founded in 1794 and still runs. Topoli (تپلی). Topoli means chubby.";
    const nodate = "Founding date: the workshop was founded long ago and still runs today for visitors.\nTopoli (تپلی): means chubby.";
    const r = GAIN.absorption(nodate, remains, H);
    expect(r.whole).toBe(false);
    expect(r.missing ?? "").toContain("1794");
  });
  it("a faithful carry passes whole, figures and polarity intact", () => {
    const remains = "Founding date. The workshop was founded in 1794 and still runs. Safety notes. The dye is not safe for children.";
    const whole = "Founding date: the workshop was founded in 1794 and still runs.\nSafety notes: the dye is not safe for children.";
    const r = GAIN.absorption(whole, remains, H);
    expect(r.repeats.length).toBeGreaterThanOrEqual(2);
    expect(r.whole).toBe(true);
  });
  it("NBSP, entity dashes and line breaks cannot hide a subject from the duplication read", () => {
    const remains = "Topoli (تپلی). Topoli means chubby. Kerman rugs. Kerman rugs are wool.";
    const styled = "**Topoli** — means chubby, said warmly.\nKerman rugs – wool rugs from Kerman.";
    const r = GAIN.absorption(styled, remains, ["Topoli (تپلی)", "Kerman rugs"]);
    expect(r.repeats).toEqual(expect.arrayContaining(["Topoli", "Kerman rugs"]));
  });
});
