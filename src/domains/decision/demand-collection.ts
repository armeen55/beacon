/** A complete glossary can answer a bare collection search through its entries, without a redundant summary paragraph. */
type Unit = { id: string; heading: string | null; text: string };
const FURNITURE = /^(?:frequently asked questions|faqs?|explore more|related (?:posts|articles)|references|sources)$/i;
const INTRO = /^(?:introduction|overview|about (?:these|this)|how to use (?:these|this))$/i;
const means = (text: string): boolean => /\bmeaning\s*:\s*\S.{8,}/i.test(text);

/** Null means this capture cannot establish a collection; missing names an entry without its own meaning. */
export function collectionCoverage(bare: boolean, titleNamesTopic: boolean, h2: readonly string[], units: readonly Unit[]): { missing: string | null } | null {
  if (!bare || !titleNamesTopic || h2.length === 0 || units.length === 0) return null;
  const headings = new Set(h2.map((h) => h.trim().toLowerCase()));
  const sections = new Map<string, { heading: string; text: string }>();
  for (const unit of units) {
    const key = unit.id.replace(/#\d+$/, "");
    if (!unit.heading || !headings.has(unit.heading.trim().toLowerCase())) continue;
    const old = sections.get(key);
    sections.set(key, { heading: unit.heading, text: `${old?.text ?? ""} ${/#0$/.test(unit.id) ? "" : unit.text}`.trim() });
  }
  const entries: { heading: string; text: string }[] = [];
  for (const section of sections.values()) {
    if (FURNITURE.test(section.heading)) break; // FAQs and onward are not glossary entries
    if (!INTRO.test(section.heading)) entries.push(section);
  }
  if (entries.length < 2 || !entries.some((entry) => means(entry.text))) return null;
  return { missing: entries.find((entry) => !means(entry.text))?.heading ?? null };
}
