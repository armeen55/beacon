/**
 * Page Surgeon — IMPLEMENTATION-READY ARTIFACT BUNDLE (2026-06-18).
 *
 * Turns a gated PageAtomicDecision from a DIRECTIVE ("add an answer block")
 * into a FINISHED, CMS-validated, reversible artifact the operator approves by
 * eye: the literal title/meta/h1 strings (with char-limit checks), the literal
 * answer-block HTML, the literal FAQ Q&A, deterministic JSON-LD, internal links
 * resolved to real URLs, a before/after diff, rollback content, the measurement
 * plan, the gate's publishability, and an evidence receipt. Plus a rendered
 * SERP-snippet before/after.
 *
 * PURE. No I/O, no LLM. Composes only from the (cached) decision + the packet +
 * the site's known URLs. The deterministic gate remains the sole authority on
 * publishability — this layer never elevates it.
 */

import { stripBannedDashes } from "@/lib/copy/strip-dashes";
import { isCmsPlaceholder } from "@/domains/recommendation-intelligence/draft-enrichment";
import type { EvidenceConfidence, EvidencePacket } from "./contract";
import type {
  AtomicAction,
  AtomicChange,
  PageAtomicDecision,
  SourceCoverage,
  WordingResearch,
} from "./page-decision";

// SERP / CMS practical limits (truncation points Google + Wix respect).
export const CMS_LIMITS = { title: 60, meta: 160, h1: 70 } as const;

export type CmsFieldArtifact = {
  field: "title" | "meta" | "h1";
  value: string;
  charCount: number;
  limit: number;
  withinLimit: boolean;
  /** True when the value was auto-trimmed to a word boundary to fit the limit. */
  autoTrimmed: boolean;
};
export type FaqItem = { question: string; answer: string };
export type ResolvedLink = { anchor: string; targetUrl: string | null; note: string };

export type ChangeArtifact = {
  action: AtomicChange["action"];
  label: string;
  dependencyOrder: number;
  publishability: AtomicChange["publishability"];
  /** Finished content — only the relevant shape is populated. */
  cmsField?: CmsFieldArtifact;
  answerBlockHtml?: string;
  answerBlockText?: string;
  faq?: FaqItem[];
  jsonLd?: { schemaType: string; code: string };
  internalLinks?: ResolvedLink[];
  /** Dev-task instruction for non-CMS changes (section_*, ux_cta_fix, …). */
  instruction?: string;
  before: string | null;
  after: string | null;
  rollback: string;
  measurement: string;
  evidence: string;
  hypothesis: string;
  risk: string;
};

export type SnippetPreview = { title: string; url: string; meta: string };

export type ArtifactBundle = {
  pageUrl: string;
  currentTitle: string | null;
  headlineAction: AtomicAction;
  confidence: EvidenceConfidence;
  snippetBefore: SnippetPreview;
  snippetAfter: SnippetPreview;
  primary: ChangeArtifact | null;
  supporting: ChangeArtifact[];
  /** Real, gate-surviving changes held back as follow-up (keeps the ready plan
   *  to primary + ≤2 supports). Composed for visibility, not for this pass. */
  deferred: ChangeArtifact[];
  rejected: Array<{ action: string; reason: string }>;
  sourceCoverage: SourceCoverage[];
  operatorInsight: string;
  whatNormalSeoMisses: string;
  whyNotJustTitle: string;
  evidenceGaps: string[];
  /** Alternative phrasings the judge researched (grounded in GSC/SEMrush) with
   *  the best placement for each — the "senior operator did the homework" texture. */
  wordingResearch: WordingResearch[];
  decidedBy: "llm_judge" | "deterministic_fallback";
};

const ACTION_LABEL: Record<string, string> = {
  title: "Title tag", meta: "Meta description", h1: "H1 heading",
  intro_answer_block: "Intro answer block", faq: "FAQ / Q&A",
  section_add: "Add section", section_remove: "Remove section", section_reorder: "Reorder sections",
  internal_link: "Internal links", schema: "Structured data (JSON-LD)", image_alt: "Image alt text",
  ux_cta_fix: "UX / CTA fix", citation_source: "Cite a source", create_new_page: "New page",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cmsField(field: "title" | "meta" | "h1", value: string): CmsFieldArtifact {
  const limit = CMS_LIMITS[field];
  let v = value.trim();
  let autoTrimmed = false;
  if (v.length > limit) {
    // Trim to read as a FINISHED phrase: prefer the last clause/sentence
    // boundary within the limit, fall back to the last word, then strip any
    // trailing punctuation or dangling conjunction/preposition.
    const slice = v.slice(0, limit);
    const floor = Math.floor(limit * 0.55);
    const boundary = Math.max(
      slice.lastIndexOf("—"), slice.lastIndexOf("–"),
      slice.lastIndexOf(". "), slice.lastIndexOf("; "),
      slice.lastIndexOf(": "), slice.lastIndexOf(", "),
    );
    let cut = boundary >= floor ? boundary : slice.lastIndexOf(" ");
    if (cut < floor) cut = limit;
    v = slice
      .slice(0, cut)
      .replace(/[\s—–\-.;:,]+$/, "")
      .replace(/\s+(and|or|with|to|for|the|a|an|of|in|on|but|so)$/i, "")
      .trim();
    autoTrimmed = true;
  }
  return { field, value: v, charCount: v.length, limit, withinLimit: v.length <= limit, autoTrimmed };
}

/** Deterministic Article + BreadcrumbList (+ FAQPage when FAQ content exists)
 *  JSON-LD from the packet. No invented values. */
export function composeJsonLd(packet: EvidencePacket, faq: FaqItem[] | undefined): { schemaType: string; code: string } {
  const url = packet.current.pageUrl;
  // audit-wave5 #2: never assert an EMPTY or CMS-placeholder ("Page Title"/
  // "Untitled") entity name in shipped JSON-LD. A null crawl title would stamp
  // headline:"" / breadcrumb name:"" (invalid/embarrassing structured data).
  // Omit the headline when missing (Article has no required props) and drop the
  // BreadcrumbList entirely when there's no real page name.
  const rawName = (packet.crawl?.title ?? packet.current.currentText ?? "").trim();
  const name = rawName && !isCmsPlaceholder(rawName) ? rawName : null;
  const graph: Record<string, unknown>[] = [
    {
      "@type": "Article",
      ...(name ? { headline: name } : {}),
      ...(packet.crawl?.metaDescription ? { description: packet.crawl.metaDescription } : {}),
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
    },
  ];
  if (name) {
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: [{ "@type": "ListItem", position: 1, name, item: url }],
    });
  }
  if (faq && faq.length > 0) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: faq.map((f) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: { "@type": "Answer", text: f.answer },
      })),
    });
  }
  const types = graph.map((g) => g["@type"] as string).join(" + ");
  const code = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2);
  return { schemaType: types, code };
}

/** Resolve proposed internal-link anchors to REAL site URLs by token overlap
 *  with known page titles/paths. No fabrication — unresolved → targetUrl null
 *  with a note so the operator (not the tool) supplies it. */
function resolveInternalLinks(
  change: AtomicChange,
  siteUrls: Array<{ url: string; title: string | null }>,
  currentPageUrl: string,
): ResolvedLink[] {
  // Host-stripped, trailing-slash-normalized path so a page is never linked to
  // ITSELF (the old guard compared p.url to change.action — the action TYPE, not
  // a URL — so it never excluded the current page).
  const toPath = (u: string) => u.replace(/^https?:\/\/[^/]+/i, "").replace(/\/+$/, "") || "/";
  const here = toPath(currentPageUrl);
  // Anchors are quoted phrases in the change copy, else the whole instruction.
  const quoted = [...`${change.exact_change} ${change.artifact_text ?? ""}`.matchAll(/["“']([^"”']{3,60})["”']/g)].map((m) => m[1]!);
  const anchors = (quoted.length > 0 ? quoted : [change.exact_change]).slice(0, 3);
  const tok = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2));
  return anchors.map((anchor) => {
    const at = tok(anchor);
    let best: { url: string; score: number } | null = null;
    for (const p of siteUrls) {
      if (toPath(p.url) === here) continue;
      const pt = tok(`${p.title ?? ""} ${p.url}`);
      let score = 0;
      for (const w of at) if (pt.has(w)) score += 1;
      if (score > 0 && (!best || score > best.score)) best = { url: p.url, score };
    }
    return best
      ? { anchor, targetUrl: best.url, note: "resolved by topic match" }
      : { anchor, targetUrl: null, note: "no matching page found — pick a target" };
  });
}

/** A concrete rollback per action — used when the LLM's is vague/empty so an
 *  artifact always tells the operator exactly how to undo it. */
function defaultRollback(change: AtomicChange, packet: EvidencePacket): string {
  switch (change.action) {
    case "title": return packet.crawl?.title ? `Restore the previous title: "${packet.crawl.title}"` : "Restore the previous title.";
    case "meta": return packet.crawl?.metaDescription ? `Restore the previous meta description: "${packet.crawl.metaDescription}"` : "Restore the previous meta description.";
    case "h1": return packet.crawl?.h1 ? `Restore the previous H1: "${packet.crawl.h1}"` : "Restore the previous H1.";
    case "intro_answer_block": return "Remove the added intro answer block; no other content changes.";
    case "faq": return "Remove the added Q&A block.";
    case "schema": return "Remove the added JSON-LD block.";
    case "internal_link": return "Remove the added internal links.";
    case "section_add": return "Remove the added section.";
    case "section_remove": return "Re-add the removed section from version history.";
    case "section_reorder": return "Restore the previous section order.";
    case "ux_cta_fix": return "Revert the element to its previous behavior.";
    case "image_alt": return "Restore the previous alt text.";
    default: return "Revert this change.";
  }
}
/** A measurable plan per action — backfilled when the LLM's is vague/empty. */
function defaultMeasurement(change: AtomicChange, packet: EvidencePacket): string {
  if (change.action === "ux_cta_fix")
    return "Re-check this page's Microsoft Clarity dead-click and rage-click counts 14–28 days after the change.";
  const q = packet.gsc?.topQueries?.[0]?.query;
  return q
    ? `Compare this page's Google Search Console CTR and clicks for "${q}" (and sibling queries) over the 28 days after vs the 28 days before the change.`
    : "Compare this page's Google Search Console CTR and clicks over the 28 days after vs before the change.";
}
function specificRollback(change: AtomicChange, packet: EvidencePacket): string {
  const r = change.rollback?.trim() ?? "";
  return r.length >= 15 ? r : defaultRollback(change, packet);
}
function specificMeasurement(change: AtomicChange, packet: EvidencePacket): string {
  const m = change.measurement?.trim() ?? "";
  const hasMetric = /(ctr|click|impression|position|rank|conversion|engagement|dead[- ]click|rage[- ]click|citation|quickback)/i.test(m);
  const hasTime = /(\bday|\bweek|\bmonth|\d+\s*d\b)/i.test(m);
  return m.length >= 20 && (hasMetric || hasTime) ? m : defaultMeasurement(change, packet);
}
/** Make the measurement COUNTERFACTUAL: name comparable unchanged pages as
 *  diff-in-diff controls so the lift is isolated from sitewide movement. Only
 *  for GSC-measurable changes; skipped for ux_cta_fix (Clarity-measured) and
 *  when the measurement already references a control. */
function withControls(measurement: string, change: AtomicChange, controlPaths: string[]): string {
  if (change.action === "ux_cta_fix" || controlPaths.length === 0) return measurement;
  if (/\b(control|comparable|diff-in-diff|counterfactual)\b/i.test(measurement)) return measurement;
  const shown = controlPaths.slice(0, 3);
  const controls = shown.join(", ");
  const s = shown.length === 1 ? "" : "s";
  // audit-wave5 #5: controlPaths are top-demand pages, NOT verified topically
  // comparable or guaranteed unchanged — so don't assert "comparable unchanged"
  // or a precise "diff-in-diff". Frame as honest rough-control guidance.
  return `${measurement} As a rough control, also track page${s} you are NOT changing (${controls}) to gauge how much of any movement is sitewide rather than from this edit.`;
}

export function composeChangeArtifact(
  change: AtomicChange,
  packet: EvidencePacket,
  siteUrls: Array<{ url: string; title: string | null }>,
  controlPaths: string[] = [],
): ChangeArtifact {
  const base = {
    action: change.action,
    label: ACTION_LABEL[change.action] ?? change.action,
    dependencyOrder: change.dependency_order,
    publishability: change.publishability,
    rollback: specificRollback(change, packet),
    measurement: withControls(specificMeasurement(change, packet), change, controlPaths),
    evidence: change.evidence,
    hypothesis: change.hypothesis,
    risk: change.risk,
    before: change.before_after.before,
    after: change.before_after.after,
  };

  if (change.action === "title" || change.action === "meta" || change.action === "h1") {
    const value = change.exact_change.trim();
    const current =
      change.action === "title" ? packet.crawl?.title :
      change.action === "meta" ? packet.crawl?.metaDescription : packet.crawl?.h1;
    return {
      ...base,
      cmsField: cmsField(change.action, value),
      before: change.before_after.before ?? current ?? null,
      after: value,
    };
  }

  if (change.action === "intro_answer_block" || change.action === "section_add") {
    const text = (change.artifact_text ?? change.exact_change).trim();
    return {
      ...base,
      answerBlockText: text,
      answerBlockHtml: `<p>${esc(text)}</p>`,
      after: text,
    };
  }

  if (change.action === "faq") {
    const faq = (change.faq_items ?? []).filter((f) => f.question && f.answer);
    return { ...base, faq, after: faq.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n") || change.exact_change };
  }

  if (change.action === "schema") {
    const jsonLd = composeJsonLd(packet, change.faq_items ?? undefined);
    return { ...base, jsonLd, after: jsonLd.code };
  }

  if (change.action === "internal_link") {
    const links = resolveInternalLinks(change, siteUrls, packet.current.pageUrl);
    return { ...base, internalLinks: links, after: links.map((l) => `${l.anchor} → ${l.targetUrl ?? "(pick target)"}`).join("; ") };
  }

  // section_remove/reorder, ux_cta_fix, citation_source, create_new_page, image_alt:
  // a dev-task instruction, not literal CMS content.
  return { ...base, instruction: change.artifact_text ?? change.exact_change };
}

/**
 * HARD RULE: no em/en dash in any Beacon-GENERATED copy. Strips banned dashes
 * from every generated string field of an artifact (proposed `after`, cmsField
 * value, answer block, FAQ, instruction, rationale prose). `before` is left
 * untouched — it reflects the page's CURRENT live copy and must stay truthful.
 * [[feedback_no_em_dashes]]
 */
function finalizeArtifactCopy(a: ChangeArtifact): ChangeArtifact {
  const d = stripBannedDashes;
  const out: ChangeArtifact = {
    ...a,
    label: d(a.label),
    after: a.after == null ? a.after : d(a.after),
    rollback: d(a.rollback),
    measurement: d(a.measurement),
    evidence: d(a.evidence),
    hypothesis: d(a.hypothesis),
    risk: d(a.risk),
  };
  if (a.instruction != null) out.instruction = d(a.instruction);
  if (a.answerBlockText != null) out.answerBlockText = d(a.answerBlockText);
  if (a.answerBlockHtml != null) out.answerBlockHtml = d(a.answerBlockHtml);
  if (a.faq) out.faq = a.faq.map((f) => ({ question: d(f.question), answer: d(f.answer) }));
  if (a.jsonLd) out.jsonLd = { ...a.jsonLd, code: d(a.jsonLd.code) };
  if (a.internalLinks) {
    out.internalLinks = a.internalLinks.map((l) => ({ ...l, anchor: d(l.anchor), note: d(l.note) }));
  }
  if (a.cmsField) {
    const value = d(a.cmsField.value);
    out.cmsField = {
      ...a.cmsField,
      value,
      charCount: value.length,
      withinLimit: value.length <= a.cmsField.limit,
    };
  }
  return out;
}

export function composeArtifactBundle(
  decision: PageAtomicDecision,
  packet: EvidencePacket,
  siteUrls: Array<{ url: string; title: string | null }> = [],
  controlPaths: string[] = [],
): ArtifactBundle {
  const compose = (c: AtomicChange) =>
    finalizeArtifactCopy(composeChangeArtifact(c, packet, siteUrls, controlPaths));
  const primary = decision.primary_atomic_change ? compose(decision.primary_atomic_change) : null;
  const supporting = decision.supporting_atomic_changes.map(compose);
  const deferred = (decision.deferred_changes ?? []).map(compose);

  const currentTitle = packet.crawl?.title ?? packet.current.currentText ?? "";
  const currentMeta = packet.crawl?.metaDescription ?? "";
  const all = [primary, ...supporting].filter((a): a is ChangeArtifact => a != null);
  const titleArtifact = all.find((a) => a.action === "title")?.cmsField?.value;
  const metaArtifact = all.find((a) => a.action === "meta")?.cmsField?.value;

  return {
    pageUrl: decision.pageUrl,
    currentTitle,
    headlineAction: decision.recommended_atomic_action,
    confidence: decision.confidence,
    snippetBefore: { title: currentTitle, url: decision.pageUrl, meta: currentMeta },
    snippetAfter: { title: titleArtifact ?? currentTitle, url: decision.pageUrl, meta: metaArtifact ?? currentMeta },
    primary,
    supporting,
    deferred,
    rejected: decision.rejected_changes,
    sourceCoverage: decision.source_coverage,
    operatorInsight: decision.operator_insight,
    whatNormalSeoMisses: decision.what_normal_seo_misses,
    whyNotJustTitle: decision.why_not_just_title,
    evidenceGaps: decision.evidence_gaps,
    wordingResearch: decision.wording_research,
    decidedBy: decision.decided_by,
  };
}
