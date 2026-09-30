/** A complete glossary can answer a bare collection search through its entries, without a redundant summary paragraph. */
import { load } from "cheerio"; import { FURNITURE_LABEL } from "@/domains/evidence/relevance-gate";
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

collectionCoverage.rosters = (capture: { complete: boolean; mainHtml: string } | undefined, text: string | undefined, promise: string): { heading: string; entries: { heading: string; text: string }[] }[] => {
  const captured = capture?.complete && text ? load(capture.mainHtml) : null;
  const full = captured && captured.root().text().replace(/\s+/g, " ").trim() === text!.replace(/\s+/g, " ").trim() ? captured : null;
  const rosters: { heading: string; entries: { heading: string; text: string }[] }[] = []; let owner = "";
  if (full) full("h1,h2,h3,h4,h5,h6,ul,ol,[role=list]").each((_, node) => {
    const element = full(node); if (/^h[1-6]$/.test(node.tagName)) { owner = element.text().replace(/\s+/g, " ").trim(); return; }
    const items = element.children("li,article,[role=listitem],.wixui-repeater__item");
    if (!owner || FURNITURE_LABEL.test(owner) || items.length < 2 || items.length !== element.children().length || element.parents("ul,ol,[role=list]").length) return;
    const entries = items.toArray().map(item => { const held = full(item), name = held.find("h1,h2,h3,h4,h5,h6,p").first().text().replace(/\s+/g, " ").trim(), text = held.text().replace(/\s+/g, " ").trim(); return { heading: name, text: text.startsWith(name) ? text.slice(name.length).trim() : "" }; });
    if (entries.every(e => e.heading && e.heading.length <= 90 && !/[.!?:]/.test(e.heading.replace(/(?:^|\s)\p{Lu}\.(?=\s|$)/gu, " ")) && !FURNITURE_LABEL.test(e.heading))) rosters.push({ heading: owner, entries });
  });
  const aliases = [...promise.matchAll(/(\p{L}+)\s*\((\p{L}+)\)/gu)];
  const scope = (heading: string): string => aliases.reduce((text, [, a, b]) => text.replace(new RegExp(`\\b(?:${a}|${b})\\b`, "gi"), `${a} ${b}`), heading);
  return rosters.map(row => ({ ...row, heading: scope(row.heading) }));
};
