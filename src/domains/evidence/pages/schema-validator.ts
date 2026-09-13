/** Schema.org JSON-LD shared by capture, readiness and verification.
 * Standard contexts, nested nodes, cross-script @graph/@id and ordered @list values.
 * Custom contexts and conflicting definitions stay uncertified, never guessed. */
import { load } from "cheerio";
type Node = Record<string, unknown>;
type Graph = { roots: Node[]; nodes: Node[]; unread: boolean; value: unknown };
const nodeOf = (v: unknown): Node | null => v && typeof v === "object" && !Array.isArray(v) ? v as Node : null;
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const values = (v: unknown): unknown[] => Array.isArray(v) ? v : v == null ? [] : [v];
const types = (n: Node): string[] => values(n["@type"]).filter(text).map((t) => t.replace(/^https?:\/\/schema\.org\//, ""));
const resolve = (v: unknown, nodes: readonly Node[]): Node | null => {
  const n = nodeOf(v);
  return n && text(n["@id"]) ? nodes.find((x) => x["@id"] === n["@id"]) ?? n : n;
};

function contains(want: unknown, live: unknown, nodes: readonly Node[], resolving = new Set<Node>()): boolean {
  if (want === live) return true;
  if (Array.isArray(want)) {
    if (!Array.isArray(live)) return false;
    const owners = new Map<number, number>();
    const place = (i: number, visited: Set<number>): boolean => live.some((l, j) => {
      if (visited.has(j) || !contains(want[i], l, nodes, resolving)) return false;
      visited.add(j);
      const prior = owners.get(j);
      if (prior !== undefined && !place(prior, visited)) return false;
      owners.set(j, i);
      return true;
    });
    return want.every((_, i) => place(i, new Set()));
  }
  const w = nodeOf(want), l = nodeOf(live);
  if (!w || !l) return false;
  if (text(l["@id"]) && Object.keys(l).length === 1 && Object.keys(w).length > 1) {
    const found = resolve(l, nodes);
    if (!found || found === l || resolving.has(found)) return false;
    return contains(w, found, nodes, new Set([...resolving, found]));
  }
  return Object.entries(w).every(([k, v]) => k === "@context" || (k === "@list"
    ? Array.isArray(v) && Array.isArray(l[k]) && v.length === l[k].length && v.every((item, i) => contains(item, (l[k] as unknown[])[i], nodes, resolving))
    : k === "@type" ? contains(types(w), types(l), nodes, resolving)
    : contains(v, l[k], nodes, resolving)));
}

function read(input: unknown): Graph {
  const roots: Node[] = [], nodes: Node[] = [], documents: unknown[] = [];
  let unread = false, value: unknown = input;
  if (typeof input === "string") {
    const raw = input.trim(), $ = raw.startsWith("<") ? load(raw) : null;
    const bodies = $ ? $("script").filter((_, el) => ($(el).attr("type") ?? "").trim().toLowerCase() === "application/ld+json").map((_, el) => $(el).html() ?? "").get() : raw ? [raw] : [];
    for (const body of bodies) { try { documents.push(JSON.parse(body)); } catch { unread = true; } }
    value = unread ? null : documents;
  } else documents.push(input);
  const walk = (v: unknown, context: boolean, root: boolean): void => {
    if (Array.isArray(v)) { v.forEach((n) => walk(n, context, root)); return; }
    const n = nodeOf(v);
    if (!n) { if (root) unread = true; return; }
    if (n["@context"] !== undefined) context = typeof n["@context"] === "string" && /^https?:\/\/schema\.org\/?$/.test(n["@context"]);
    if (!context) unread = true;
    if (Object.keys(n).some((k) => k.startsWith("@") && !["@context", "@type", "@id", "@graph", "@list", "@value", "@language"].includes(k))) unread = true;
    if (n["@id"] !== undefined && !text(n["@id"])) unread = true;
    if (n["@graph"] !== undefined && n["@id"] !== undefined) unread = true; // Named graphs require expansion, not pooling with the default graph.
    if (n["@type"] !== undefined && (!values(n["@type"]).length || values(n["@type"]).some((t) => !text(t)))) unread = true;
    if (n["@type"] !== undefined || text(n["@id"]) && Object.keys(n).some((k) => !k.startsWith("@"))) {
      nodes.push(n);
      if (root) roots.push(n);
    }
    for (const [k, child] of Object.entries(n)) if (k !== "@context" && child && typeof child === "object") walk(child, context, k === "@graph" && root);
  };
  documents.forEach((d) => walk(d, false, true));
  const byId = new Map<string, Node>();
  for (const n of nodes) if (text(n["@id"])) {
    const prior = byId.get(n["@id"]);
    if (!prior) byId.set(n["@id"], Object.assign(Object.create(null) as Node, n));
    else for (const [k, v] of Object.entries(n)) {
      if (k === "@context") continue;
      if (k === "@type") prior[k] = [...new Set([...values(prior[k]), ...values(v)])];
      else if (Object.hasOwn(prior, k) && !(contains(v, prior[k], []) && contains(prior[k], v, []))) unread = true;
      else prior[k] = v;
    }
  }
  const resolved = (n: Node): Node => text(n["@id"]) ? byId.get(n["@id"]) ?? n : n;
  return { roots: [...new Set(roots.map(resolved))], nodes: [...new Set(nodes.map(resolved))], unread, value };
}

function faqEntries(graph: Graph): { q: Node; a: Node }[] {
  if (graph.unread) return [];
  const out: { q: Node; a: Node }[] = [];
  for (const faq of graph.nodes.filter((n) => types(n).includes("FAQPage"))) {
    for (const v of values(faq.mainEntity)) {
      const q = resolve(v, graph.nodes), a = resolve(q?.acceptedAnswer, graph.nodes);
      if (q && a && types(q).includes("Question") && types(a).includes("Answer") && text(q.name) && text(a.text)) out.push({ q, a });
    }
  }
  return out;
}

function pairs(graph: Graph): { question: string; answer: string }[] {
  return faqEntries(graph).map(({ q, a }) => ({ question: (q.name as string).trim(), answer: (a.text as string).trim() }));
}

/** Replace only identified FAQ answers, preserving graph identity and unrelated properties. */
function rewriteFaq(input: string, held: readonly { question: string; answer: string }[]): string | null {
  const graph = read(input), entries = faqEntries(graph), replacements = new Map<Node | string, string>();
  const normalized = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
  if (!entries.length) return null;
  for (const { q, a } of entries) {
    const answers = new Set(held.filter((p) => normalized(p.question) === normalized(q.name as string)).map((p) => p.answer));
    if (answers.size !== 1) return null;
    const answer = [...answers][0]!, key = text(a["@id"]) ? a["@id"] : a;
    if (replacements.has(key) && normalized(replacements.get(key)!) !== normalized(answer)) return null;
    replacements.set(key, answer);
  }
  let changed = false;
  const copy = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(copy);
    const node = nodeOf(value);
    if (!node) return value;
    const answer = replacements.get(text(node["@id"]) ? node["@id"] : node);
    return Object.fromEntries(Object.entries(node).map(([key, value]) => {
      if (key === "text" && answer !== undefined && normalized(String(value)) !== normalized(answer)) {
        changed = true;
        return [key, answer];
      }
      return [key, copy(value)];
    }));
  };
  const documents = copy(graph.value) as unknown[];
  return changed ? JSON.stringify(documents.length === 1 ? documents[0] : documents, null, 2) : null;
}

function warnings(input: unknown): string[] {
  const graph = read(input), out: string[] = [];
  const say = (severity: "critical" | "warning" | "info", type: string, message: string): void => { out.push(`schema_${severity}:${type}: ${message}`); };
  if (graph.unread) say("critical", "UNCONFIRMED", "Malformed data, unsupported context or conflicting entity values prevent certification of this graph.");
  for (const n of graph.nodes) for (const type of types(n)) {
    const missing = (field: string, severity: "critical" | "warning" | "info" = "critical"): void => { if (!text(n[field])) say(severity, type, `${type} missing ${field}.`); };
    switch (type) {
      case "FAQPage": {
        if (!values(n.mainEntity).length) { say("critical", type, "FAQPage has no mainEntity containing its questions."); break; }
        for (const v of values(n.mainEntity)) {
          const q = resolve(v, graph.nodes), a = resolve(q?.acceptedAnswer, graph.nodes);
          if (!q || !types(q).includes("Question") || !text(q.name)) say("critical", type, "Every mainEntity must resolve to a Question with a name.");
          if (!a || !types(a).includes("Answer") || !text(a.text)) say("critical", type, "Every Question must resolve to an acceptedAnswer of type Answer with its full text.");
        }
        break;
      }
      case "HowTo": {
        missing("name");
        if (!Array.isArray(n.step) || !n.step.length) say("critical", type, "HowTo has no step[] array describing its procedure.");
        else if (n.step.some((v) => { const step = resolve(v, graph.nodes); return !step || !text(step.name) && !text(step.text); })) say("warning", type, "Some HowTo steps have no name or text.");
        break;
      }
      case "Product": {
        missing("name");
        if (!values(n.offers).length) say("warning", type, "Product missing offers block.");
        for (const v of values(n.offers)) {
          const offer = resolve(v, graph.nodes);
          if (!offer) { say("warning", type, "Product offer is not a readable entity."); continue; }
          if (!["price", "lowPrice", "highPrice"].some((k) => text(offer[k]) || typeof offer[k] === "number")) say("warning", type, "Product offer has no observed price.");
          if (!text(offer.priceCurrency)) say("warning", type, "Product offer has no observed priceCurrency.");
        }
        break;
      }
      case "Article": case "NewsArticle": case "BlogPosting": {
        missing("headline");
        if (!values(n.author).some((v) => text(v) || text(resolve(v, graph.nodes)?.name))) say("warning", type, "Article missing a named author.");
        missing("datePublished", "warning");
        break;
      }
      case "LocalBusiness": {
        missing("name");
        const address = resolve(values(n.address)[0], graph.nodes);
        if (!address) say("warning", type, "LocalBusiness missing address block.");
        else if (!text(address.streetAddress)) say("warning", type, "LocalBusiness address missing streetAddress.");
        missing("telephone", "info");
        break;
      }
      case "BreadcrumbList": {
        if (!Array.isArray(n.itemListElement) || !n.itemListElement.length) { say("critical", type, "BreadcrumbList has no itemListElement[] array."); break; }
        for (const v of n.itemListElement) {
          const item = resolve(v, graph.nodes);
          if (!item) { say("critical", type, "Breadcrumb item is not a readable entity."); continue; }
          if (typeof item.position !== "number") say("warning", type, "Breadcrumb missing position.");
          if (!text(item.name)) say("warning", type, "Breadcrumb missing name.");
          if (!text(item.item) && !nodeOf(item.item)) say("warning", type, "Breadcrumb missing item URL.");
        }
        break;
      }
      case "Service": missing("name"); if (!n.provider) say("warning", type, "Service missing provider."); break;
      case "Organization": missing("name"); missing("url", "info"); break;
    }
  }
  return [...new Set(out)];
}

export const SCHEMA = { read, contains, pairs, rewriteFaq, warnings, types };
