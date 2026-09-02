import { describe, it, expect } from "vitest";
import { GAIN } from "@/domains/decision/draft-resolution";
/** CONSOLIDATION IS SEMANTIC AND SAFE, pinned on the exact counterexamples the terminal contract names: material is content and never length, negation is a contradiction and never a preservation, figures are material one by one, formatting cannot hide a subject, and only a copy the page loses nothing by may authorize a removal. Lexical overlap finds candidates; it never authorizes Ready. */
describe("what a removal may destroy", () => {
  const H = ["Overview", "Topoli (تپلی)", "Kerman rugs", "Safety notes", "Founding date"];
  const carry = (replacement: string, remains: string, headings: readonly string[] = H) => GAIN.absorption(replacement, remains, headings);
  it("refuses every carry that loses meaning, passes the faithful one, and reads a subject through whatever formatting hides it", () => {
    const lossy = carry("Topoli (تپلی): an affectionate nickname.\nKerman rugs: wool rugs from Kerman.", "Topoli (تپلی). Topoli means chubby. Kerman rugs. Kerman rugs are wool. Safety notes. The dye is safe. Founding date. Founded in 1794.");
    expect([lossy.whole, lossy.repeats.includes("Topoli"), (lossy.missing ?? "").includes("Topoli")], "a three-word meaning is material: dropping it is refused, and the section is still named as absorbed").toEqual([false, true, true]);
    const flipped = carry("Safety notes: the dye is safe for children.\nTopoli (تپلی): means chubby.", "Safety notes. The dye is not safe for children. Topoli (تپلی). Topoli means chubby.");
    expect([flipped.whole, (flipped.missing ?? "").includes("Safety notes")], "same tokens, flipped polarity: X is safe does not entail X is not safe").toEqual([false, true]);
    const nodate = carry("Founding date: the workshop was founded long ago and still runs today for visitors.\nTopoli (تپلی): means chubby.", "Founding date. The workshop was founded in 1794 and still runs. Topoli (تپلی). Topoli means chubby.");
    expect([nodate.whole, (nodate.missing ?? "").includes("1794")], "a dropped figure is lost meaning whatever the coverage ratio says").toEqual([false, true]);
    const whole = carry("Founding date: the workshop was founded in 1794 and still runs.\nSafety notes: the dye is not safe for children.", "Founding date. The workshop was founded in 1794 and still runs. Safety notes. The dye is not safe for children.");
    expect([whole.whole, whole.repeats.length >= 2], "a faithful carry passes whole, figures and polarity intact").toEqual([true, true]);
    const styled = carry("**Topoli** — means chubby, said warmly.\nKerman rugs – wool rugs from Kerman.", "Topoli (تپلی). Topoli means chubby. Kerman rugs. Kerman rugs are wool.", ["Topoli (تپلی)", "Kerman rugs"]);
    expect(styled.repeats, "NBSP, entity dashes and line breaks cannot hide a subject from the duplication read").toEqual(expect.arrayContaining(["Topoli", "Kerman rugs"])); });});
