/**
 * Page Surgeon — AUTO-QA gate over a finished artifact bundle (2026-06-18).
 *
 * Runs BEFORE the operator sees anything: only QA-passing bundles surface; the
 * rest go to a "rejected by QA" section with reasons. Most of the adversarial
 * panel's checks are already enforced deterministically by the trust gate
 * (unsupported claims, fabricated fields, stale tactics, ranking risk, best
 * lever) — this layer VERIFIES the surviving artifacts are clean and genuinely
 * ship-ready (valid CMS copy, brand/fact-safe, measurable, internally
 * consistent), so a bad bundle can never reach the approve button.
 *
 * PURE. Deterministic. The gate stays the authority on publishability.
 */

import type { EvidencePacket } from "./contract";
import type { ArtifactBundle, ChangeArtifact } from "./artifact-bundle";
import { CMS_LIMITS } from "./artifact-bundle";
import { detectPageProblems } from "./page-decision";

export type QaCheck = { name: string; pass: boolean; detail: string; critical: boolean };
export type QaVerdict = {
  pass: boolean;
  score: number;
  checks: QaCheck[];
  failures: string[];
  /** Answer-block / FAQ content whose factual claims the crawl can't substantiate
   *  → operator must verify before publishing. Advisory (does not auto-withhold). */
  factCheckRequired?: boolean;
  factCheckNote?: string;
};

const FACT_STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "for", "to", "in", "on", "with", "how",
  "what", "is", "are", "was", "were", "your", "you", "this", "that", "these",
  "those", "from", "as", "at", "by", "it", "its", "be", "can", "will", "they",
  "their", "them", "we", "our", "us", "but", "not", "have", "has", "more",
  "most", "some", "any", "all", "also", "which", "who", "when", "where", "why",
  "into", "out", "up", "do", "does", "than", "then", "so", "such", "about",
]);
function contentTokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
    if (w.length > 2 && !FACT_STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

/** Fact-check the LITERAL answer-block / FAQ copy against what the page (crawl)
 *  and its demand (GSC queries) actually support. We can only ground content in
 *  evidence we hold, so when most of the answer's meaningful terms don't appear
 *  on the crawled page, the claims are unverifiable → flag for human fact-check.
 *  Conservative: skipped when the crawl is too thin / uncertain to judge (no
 *  crying wolf), and advisory only (the operator is the fact authority). */
/** audit-wave5 #4: pull FAQ Q&A text out of a composed JSON-LD string so an
 *  FAQPage shipped via a `schema` action is fact-checked too (not just the
 *  `faq`/`intro_answer_block` actions) — otherwise answer claims smuggled into
 *  structured data bypass the no-fabrication gate. */
function faqTextFromJsonLd(code: string | undefined): string[] {
  if (!code) return [];
  try {
    const parsed = JSON.parse(code) as unknown;
    const nodes: unknown[] = Array.isArray(parsed)
      ? parsed
      : ((parsed as Record<string, unknown>)?.["@graph"] as unknown[]) ?? [parsed];
    const out: string[] = [];
    for (const n of nodes) {
      const node = n as Record<string, unknown> | null;
      if (node && node["@type"] === "FAQPage" && Array.isArray(node.mainEntity)) {
        for (const q of node.mainEntity as Record<string, unknown>[]) {
          if (typeof q?.name === "string") out.push(q.name);
          const ans = (q?.acceptedAnswer as Record<string, unknown> | undefined)?.text;
          if (typeof ans === "string") out.push(ans);
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

function factCheck(
  changes: ChangeArtifact[],
  packet: EvidencePacket,
): { required: boolean; note: string } {
  const contentChanges = changes.filter(
    (c) =>
      c.action === "intro_answer_block" ||
      c.action === "faq" ||
      (c.action === "schema" && faqTextFromJsonLd(c.jsonLd?.code).length > 0),
  );
  if (contentChanges.length === 0) return { required: false, note: "" };

  const crawl = packet.crawl;
  const corpus = contentTokens(
    [
      crawl?.title,
      crawl?.h1,
      crawl?.metaDescription,
      ...(crawl?.h2List ?? []),
      ...(crawl?.h3List ?? []),
      ...(crawl?.faqs ?? []),
      ...(crawl?.cardTexts ?? []),
      ...(packet.gsc?.topQueries ?? []).map((q) => q.query),
    ]
      .filter((s): s is string => !!s)
      .join(" "),
  );
  // Too little to verify against (or a known-incomplete extraction) → can't judge.
  if (corpus.size < 25 || crawl?.extractionCertainty === "uncertain") {
    return { required: false, note: "" };
  }

  const novel: string[] = [];
  let total = 0;
  for (const c of contentChanges) {
    const text = [
      c.answerBlockText,
      ...(c.faq ?? []).flatMap((f) => [f.question, f.answer]),
      ...faqTextFromJsonLd(c.jsonLd?.code), // audit-wave5 #4: schema-action FAQ
    ]
      .filter((s): s is string => !!s)
      .join(" ");
    const toks = contentTokens(text);
    total += toks.size;
    for (const t of toks) if (!corpus.has(t)) novel.push(t);
  }
  if (total === 0) return { required: false, note: "" };

  const supportedRatio = (total - novel.length) / total;
  if (supportedRatio < 0.5) {
    const sample = [...new Set(novel)].slice(0, 8).join(", ");
    return {
      required: true,
      note: `Only ${Math.round(supportedRatio * 100)}% of the answer's key terms appear on the crawled page — verify these claims before publishing: ${sample}.`,
    };
  }
  return { required: false, note: "" };
}

const SNIPPET_ACTIONS = new Set(["title", "meta", "h1", "intro_answer_block", "faq"]);
const PLACEHOLDER = /\b(lorem ipsum|\binsert\b|\btodo\b|\btbd\b|example\.com|xxxx|\[[^\]]*\])/i;
const STALE_FAQ_CLAIM = /(rich result|rich snippet|serp real estate|faq schema.*ctr)/i;
/** A CMS-field change diffs against the CURRENT crawl, so a very stale crawl
 *  makes its before/after + rollback untrustworthy. */
const CMS_DIFF_ACTIONS = new Set(["title", "meta", "h1", "schema"]);
const STALE_CRAWL_DAYS = 90;

export function qaArtifactBundle(
  bundle: ArtifactBundle,
  packet: EvidencePacket,
  nowMs?: number,
): QaVerdict {
  const changes: ChangeArtifact[] = [bundle.primary, ...bundle.supporting].filter(
    (c): c is ChangeArtifact => c != null,
  );
  const problems = detectPageProblems(packet);
  const checks: QaCheck[] = [];
  const add = (name: string, pass: boolean, detail: string, critical = true) =>
    checks.push({ name, pass, detail, critical });

  const isChangeVerdict = !["keep_current", "needs_more_evidence", "needs_llm_review"].includes(bundle.headlineAction);

  // 1. Decision consistency (P4): non-change verdicts carry no change artifacts.
  add(
    "Decision consistency",
    isChangeVerdict ? bundle.primary != null : bundle.primary == null && bundle.supporting.length === 0,
    isChangeVerdict ? "A change verdict has a primary change." : "keep_current/needs_* carries no change artifacts.",
  );

  // For non-change verdicts the remaining content checks are vacuously fine.
  if (!isChangeVerdict) {
    add("Measurement possible", packet.gsc != null, packet.gsc ? "GSC demand present." : "No GSC demand.", false);
    return finalize(checks);
  }

  // 2. Every surviving change cites real evidence + is measurable.
  add(
    "Evidence present",
    changes.every((c) => c.evidence.trim().length > 0),
    "Every change carries a non-empty evidence line.",
  );
  add(
    "Measurement possible",
    packet.gsc != null && changes.every((c) => c.measurement.trim().length > 0),
    packet.gsc == null ? "No GSC demand — lift can't be measured." : "Every change has a measurement plan + GSC baseline.",
  );
  // Measurement must be SPECIFIC (a metric or a timeframe), not "monitor performance".
  add(
    "Measurement specific",
    changes.every(
      (c) =>
        /(ctr|click|impression|position|rank|conversion|engagement|dead[- ]click|rage[- ]click|citation|quickback)/i.test(c.measurement) ||
        /(\bday|\bweek|\bmonth)/i.test(c.measurement),
    ),
    "Every measurement names a metric or a timeframe.",
  );
  // Rollback must be CONCRETE (how to undo), not empty/one-word.
  add(
    "Rollback specified",
    changes.every((c) => c.rollback.trim().length >= 15),
    "Every change has a concrete rollback.",
  );

  // 3. CMS copy is valid + ship-ready.
  const cmsIssues: string[] = [];
  for (const c of changes) {
    if (c.cmsField) {
      if (c.cmsField.value.trim().length === 0) cmsIssues.push(`${c.action} is empty`);
      else if (!c.cmsField.withinLimit) cmsIssues.push(`${c.action} ${c.cmsField.charCount}>${c.cmsField.limit} chars`);
    }
    if (c.action === "intro_answer_block" && (c.answerBlockText ?? "").trim().length < 40)
      cmsIssues.push("answer block too short to be a real answer");
    if (c.action === "faq" && (!c.faq || c.faq.length === 0 || c.faq.some((f) => !f.question.trim() || !f.answer.trim())))
      cmsIssues.push("FAQ has empty question/answer");
    if (c.jsonLd) {
      try { JSON.parse(c.jsonLd.code); } catch { cmsIssues.push("JSON-LD does not parse"); }
    }
  }
  add("CMS copy valid", cmsIssues.length === 0, cmsIssues.length === 0 ? `All copy within limits (title ≤${CMS_LIMITS.title}, meta ≤${CMS_LIMITS.meta}).` : cmsIssues.join("; "));

  // 4. Brand/fact-safe copy — no placeholders / junk tokens.
  const unsafe = changes.filter((c) =>
    [c.cmsField?.value, c.answerBlockText, c.instruction, ...(c.faq ?? []).flatMap((f) => [f.question, f.answer])]
      .filter((s): s is string => !!s)
      .some((s) => PLACEHOLDER.test(s)),
  );
  add("Brand/fact-safe copy", unsafe.length === 0, unsafe.length === 0 ? "No placeholder/junk tokens in copy." : `Placeholder text in: ${unsafe.map((c) => c.action).join(", ")}`);

  // 4b. Fact-check answer-block / FAQ claims against crawl + demand evidence.
  // Advisory (critical=false): unverifiable ≠ wrong, but the operator must check.
  const fc = factCheck(changes, packet);
  add(
    "Content fact-supported",
    !fc.required,
    fc.required ? fc.note : "Answer/FAQ claims are grounded in the crawled page (or not applicable).",
    false,
  );

  // 5. No stale tactics (defense-in-depth; the gate already drops these).
  const staleHits: string[] = [];
  if (changes.some((c) => c.action === "image_alt")) staleHits.push("image_alt with no crawled image data");
  if (changes.some((c) => c.action === "schema") && (packet.crawl?.schemaTypes?.length ?? 0) > 0) staleHits.push("schema add on a page that already has schema");
  if (changes.some((c) => STALE_FAQ_CLAIM.test(`${c.evidence} ${c.hypothesis}`))) staleHits.push("FAQ justified by deprecated rich-result CTR");
  add("No stale tactics", staleHits.length === 0, staleHits.length === 0 ? "No deprecated/ungrounded tactics." : staleHits.join("; "));

  // 5b. Crawl freshness — a CMS-field change diffs against the current crawl, so
  // a very stale crawl makes the before/after + rollback untrustworthy. Only
  // enforced when the caller supplies `nowMs` (impure context); skipped otherwise.
  const fetchedAt = packet.crawl?.fetchedAt;
  const touchesCrawlDiff = changes.some((c) => CMS_DIFF_ACTIONS.has(c.action));
  if (nowMs != null && fetchedAt && touchesCrawlDiff) {
    const ageMs = nowMs - Date.parse(fetchedAt);
    const ageDays = Number.isFinite(ageMs) ? Math.floor(ageMs / 86_400_000) : null;
    add(
      "Crawl fresh enough",
      ageDays == null || ageDays <= STALE_CRAWL_DAYS,
      ageDays == null
        ? "Crawl date unparseable."
        : ageDays <= STALE_CRAWL_DAYS
          ? `Crawl is ${ageDays}d old (≤ ${STALE_CRAWL_DAYS}d).`
          : `Crawl is ${ageDays}d old — re-crawl before shipping; the before/after may not match the live page.`,
    );
  }
  // Extraction confidence — advisory: a raw fetch may have missed client-rendered
  // content, so flag (don't block) when a content change leans on an uncertain crawl.
  if (packet.crawl?.extractionCertainty === "uncertain" && touchesCrawlDiff) {
    add("Extraction confident", false, "Crawl extraction was 'uncertain' (client-rendered content may be missing) — eyeball the current page before shipping.", false);
  }

  // 6. Ranking-safe: a snippet change must have a real justification.
  const snippetChange = changes.find((c) => SNIPPET_ACTIONS.has(c.action));
  const snippetJustified = problems.snippetDeficit || problems.titleMissingDominantQuery || problems.zeroClickPage1 || problems.highValueUnservedCluster;
  add(
    "Ranking-safe",
    !snippetChange || snippetJustified,
    snippetChange && !snippetJustified ? "Snippet change on a page with no deficit — risks rankings for no gain." : "No unjustified snippet rewrite.",
  );

  // 7. Best lever (advisory): the heaviest moves should be rare.
  add("Best lever", bundle.headlineAction !== "image_alt", "Headline action is a substantive lever.", false);

  return finalize(checks, fc);
}

function finalize(checks: QaCheck[], fc?: { required: boolean; note: string }): QaVerdict {
  const critical = checks.filter((c) => c.critical);
  const passedCritical = critical.filter((c) => c.pass);
  const pass = passedCritical.length === critical.length;
  const score = Math.round((checks.filter((c) => c.pass).length / checks.length) * 100) / 100;
  const failures = checks.filter((c) => c.critical && !c.pass).map((c) => `${c.name}: ${c.detail}`);
  return {
    pass,
    score,
    checks,
    failures,
    factCheckRequired: fc?.required ?? false,
    factCheckNote: fc?.note ?? "",
  };
}
