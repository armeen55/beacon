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
export type QaVerdict = { pass: boolean; score: number; checks: QaCheck[]; failures: string[] };

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

  return finalize(checks);
}

function finalize(checks: QaCheck[]): QaVerdict {
  const critical = checks.filter((c) => c.critical);
  const passedCritical = critical.filter((c) => c.pass);
  const pass = passedCritical.length === critical.length;
  const score = Math.round((checks.filter((c) => c.pass).length / checks.length) * 100) / 100;
  const failures = checks.filter((c) => c.critical && !c.pass).map((c) => `${c.name}: ${c.detail}`);
  return { pass, score, checks, failures };
}
