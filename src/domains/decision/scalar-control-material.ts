const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
const RAW = /^(?:script|style|noscript|textarea|title|xmp|iframe|plaintext|template|svg)$/;

/** Compare original bytes, never DOM serialization. Ambiguous or noncanonical fragments earn no continuity. */
export default function scalarControlMaterial(html: string): string | null {
  const stack: string[] = []; let out = "", end = 0, markerDepth = 0;
  for (const match of html.matchAll(/<(?:[^"<>]|"[^"]*")*>/g)) {
    if (html.slice(end, match.index).includes("<")) return null;
    let token = match[0]; const close = /^<\/([a-z][a-z0-9:-]*)>$/.exec(token);
    if (/^<!--\/?\$-->$/.test(match[0])) { markerDepth += match[0] === "<!--$-->" ? 1 : -1; if (markerDepth < 0) return null; }
    else if (close) { if (stack.pop() !== close[1]) return null; }
    else {
      const tag = /^<([a-z][a-z0-9:-]*)((?: [a-z][a-z0-9:-]*="[^"]*")*)>$/.exec(match[0]);
      if (!tag || RAW.test(tag[1]!) || tag[1] === "form") return null;
      const attributes = [...tag[2]!.matchAll(/ ([a-z][a-z0-9:-]*)="([^"]*)"/g)];
      if (new Set(attributes.map(a => a[1])).size !== attributes.length) return null;
      if (!VOID.has(tag[1]!)) stack.push(tag[1]!);
      for (const a of attributes.reverse()) if (a[1] === "data-testid" || a[1] === "data-motion-part") { const at = tag[1]!.length + 1 + a.index!; token = token.slice(0, at) + token.slice(at + a[0].length); }
    }
    out += html.slice(end, match.index) + token;
    end = match.index + match[0].length;
  }
  if (stack.length || markerDepth || html.slice(end).includes("<")) return null;
  out += html.slice(end);
  return out.replace(/<div([^<>]*)><button([^<>]*)><span([^<>]*)>([^<>]+)<\/span><\/button><\/div>/g, (whole: string, wrapper: string, button: string, span: string, label: string) => {
    const attributes = (text: string) => Object.fromEntries([...text.matchAll(/ ([a-z][a-z0-9:-]*)="([^"]*)"/g)].map(a => [a[1], a[2]]));
    const w = attributes(wrapper), b = attributes(button);
    if (label !== "Next" || b["aria-label"] !== label || / (?:on[a-z0-9:-]*|href|form|formaction|contenteditable|role)="/.test(wrapper + button + span) || b.type != null && b.type !== "button") return whole;
    if (w.tabindex != null && w.tabindex !== "-1" || / tabindex="/.test(button + span) || [w["aria-disabled"], b["aria-disabled"]].some(value => value != null && value !== "true" && value !== "false") || b.disabled != null && b.disabled !== "") return whole;
    return `<div${wrapper.replace(/ (?:tabindex|aria-disabled)="[^"<>]*"/g, "")}><button${button.replace(/ (?:disabled|aria-disabled)="[^"<>]*"/g, "")}><span${span}>${label}</span></button></div>`;
  });
}
