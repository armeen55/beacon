/**
 * Insight layer — Diagnosis matrix (operator-OS rebuild, Phase 2, v1).
 *
 * PURE, deterministic, NO LLM and NO paid/SERP calls. Turns an already-assembled
 * EvidencePacket into a fixed grid of diagnosis dimensions so the Workbench can
 * show — at a glance — what Beacon thinks is (and isn't) wrong with one page, and
 * why. It REUSES the blessed deterministic gate (`detectPageProblems`, the same
 * authority the Page Surgeon brief uses) plus the cheap SERP guard, rather than
 * re-deriving thresholds. v1 intentionally marks dimensions it can't evaluate
 * cheaply ("unknown") instead of guessing — honesty over false precision.
 */

import type { EvidencePacket } from "@/domains/recommendation-intelligence/page-surgeon/contract";
import { detectPageProblems } from "@/domains/recommendation-intelligence/page-surgeon/page-decision";
import { deriveSerpGuard } from "./serp-guard";

export type DiagnosisDimensionKey =
  | "title"
  | "meta"
  | "h1"
  | "answer_block"
  | "section_content"
  | "qa_schema"
  | "internal_links"
  | "ux_friction"
  | "serp_presentation"
  | "cannibalization"
  | "keep_current";

/** attention = act on it · monitor = watch / verify · ok = healthy · unknown = no data to judge. */
export type DiagnosisStatus = "attention" | "monitor" | "ok" | "unknown";

export type DiagnosisRow = {
  key: DiagnosisDimensionKey;
  label: string;
  status: DiagnosisStatus;
  /** One plain-English line — cites the page's own numbers where cheap. */
  detail: string;
};

const INTERNAL_LINK_FLOOR = 3;
const THIN_WORDS = 300;

/**
 * Build the fixed 11-row diagnosis matrix for one page. Pure: pass the assembled
 * EvidencePacket; no I/O happens here. Dimensions with no signal report
 * "unknown" (e.g. a missing crawl ⇒ on-page dims are unknowable, not "fine").
 */
export function buildDiagnosisMatrix(packet: EvidencePacket): DiagnosisRow[] {
  const p = detectPageProblems(packet);
  const crawl = packet.crawl;
  const gsc = packet.gsc;
  const hasCrawl = crawl != null;
  const hasGsc = gsc != null;

  const rows: DiagnosisRow[] = [];

  // 1. Title — does the <title> serve the dominant query?
  rows.push(
    !hasCrawl
      ? row("title", "Title", "unknown", "No crawl yet — can't read the current title.")
      : p.titleMissingDominantQuery
        ? row("title", "Title", "attention", "The title omits the dominant search query for this page.")
        : crawl!.title
          ? row("title", "Title", "ok", "Title is present and covers the dominant query.")
          : row("title", "Title", "attention", "No <title> found on the crawled page."),
  );

  // 2. Meta description — promises the answer in the snippet?
  rows.push(
    !hasCrawl
      ? row("meta", "Meta description", "unknown", "No crawl yet — can't read the current meta description.")
      : !crawl!.metaDescription
        ? row("meta", "Meta description", "attention", "No meta description — Google writes its own snippet.")
        : p.snippetDeficit && !p.titleMissingDominantQuery
          ? row("meta", "Meta description", "monitor", "Snippet under-performs for its rank — the meta may not promise the answer.")
          : row("meta", "Meta description", "ok", "Meta description is present."),
  );

  // 3. H1 — the on-page headline matches intent?
  rows.push(
    !hasCrawl
      ? row("h1", "Page headline (H1)", "unknown", "No crawl yet — can't read the H1.")
      : crawl!.h1
        ? row("h1", "Page headline (H1)", "ok", "An H1 is present on the page.")
        : row("h1", "Page headline (H1)", "attention", "No H1 found — the page lacks a clear headline."),
  );

  // 4. Answer block — direct answer up top for question/zero-click demand?
  rows.push(
    !hasGsc
      ? row("answer_block", "Direct answer block", "unknown", "No Search data — can't judge answer demand.")
      : p.zeroClickPage1 && p.questionDemand
        ? row("answer_block", "Direct answer block", "attention", "Page-1 queries get impressions but few clicks, and there's question-intent demand — add a direct answer up top.")
        : p.questionDemand
          ? row("answer_block", "Direct answer block", "monitor", "There's question-intent demand — a direct answer block could help extraction.")
          : row("answer_block", "Direct answer block", "ok", "No unmet answer-extraction demand detected."),
  );

  // 5. Section / content depth.
  rows.push(
    buildDepthRow(p, crawl, hasGsc),
  );

  // 6. Visible Q&A / structured data.
  rows.push(
    !hasCrawl
      ? row("qa_schema", "Visible Q&A / structured data", "unknown", "No crawl yet — can't read structured data.")
      : p.missingSchema
        ? row("qa_schema", "Visible Q&A / structured data", "monitor", "No structured data on the page — a visible Q&A + JSON-LD can support answer extraction (support, not a guaranteed rich result).")
        : row("qa_schema", "Visible Q&A / structured data", "ok", `Structured data present (${crawl!.schemaTypes.join(", ") || "schema"}).`),
  );

  // 7. Internal links.
  rows.push(
    !hasCrawl || crawl!.internalLinkCount == null
      ? row("internal_links", "Internal links", "unknown", "No crawl / link count — can't judge internal linking.")
      : crawl!.internalLinkCount < INTERNAL_LINK_FLOOR
        ? row("internal_links", "Internal links", "attention", `Only ${crawl!.internalLinkCount} internal link(s) — weak linking for its cluster.`)
        : row("internal_links", "Internal links", "ok", `${crawl!.internalLinkCount} internal links.`),
  );

  // 8. UX friction (Clarity).
  rows.push(
    p.meaningfulFriction
      ? row("ux_friction", "UX friction", "attention", "Visitors hit dead ends here (dead/rage clicks above normal).")
      : p.claritySampleTiny
        ? row("ux_friction", "UX friction", "unknown", "Too few Clarity sessions to judge friction.")
        : packet.clarity
          ? row("ux_friction", "UX friction", "ok", "No meaningful dead-click / rage-click friction.")
          : row("ux_friction", "UX friction", "unknown", "No Clarity data for this page."),
  );

  // 9. SERP presentation — the SERP guard. A top-ranked low-CTR page may be
  //    SERP-owned; v1 has no SERP-feature data, so it CAUTIONS rather than
  //    diagnosing a title problem.
  rows.push(buildSerpRow(gsc));

  // 10. Cannibalization — needs a cross-page SEMrush scan; not run in v1.
  rows.push(
    row(
      "cannibalization",
      "Cannibalization",
      "unknown",
      "Not evaluated in v1 — needs a cross-page SEMrush scan to detect two pages competing for one query.",
    ),
  );

  // 11. Keep current — the inverse summary.
  rows.push(
    p.hasAnyProblem
      ? row("keep_current", "Keep current", "monitor", "This page has at least one actionable issue above — not a keep-current.")
      : row("keep_current", "Keep current", "ok", "Healthy for its position — monitor and revisit if rankings slip."),
  );

  return rows;
}

function buildDepthRow(
  p: ReturnType<typeof detectPageProblems>,
  crawl: EvidencePacket["crawl"],
  hasGsc: boolean,
): DiagnosisRow {
  if (p.highValueUnservedCluster) {
    return row("section_content", "Section / content depth", "attention", "There's real demand for a topic this page doesn't cover — add a section for it.");
  }
  if (crawl?.wordCount != null && crawl.wordCount < THIN_WORDS && hasGsc) {
    return row("section_content", "Section / content depth", "attention", `Thin for the demand it gets (~${crawl.wordCount} words) — expand the content.`);
  }
  if (crawl?.wordCount != null) {
    return row("section_content", "Section / content depth", "ok", `~${crawl.wordCount} words — adequate depth.`);
  }
  return row("section_content", "Section / content depth", "unknown", "No crawl / word count — can't judge depth.");
}

function buildSerpRow(gsc: EvidencePacket["gsc"]): DiagnosisRow {
  if (!gsc) {
    return row("serp_presentation", "SERP presentation", "unknown", "No Search data — can't assess SERP presentation.");
  }
  const guard = deriveSerpGuard({ position: gsc.avgPosition, serpStatus: "unknown" });
  if (guard.downgrade) {
    return row("serp_presentation", "SERP presentation", "monitor", `${guard.label}. ${guard.rationale}`);
  }
  return row(
    "serp_presentation",
    "SERP presentation",
    "unknown",
    "SERP features not verified in v1 — no SERP-feature data is connected yet.",
  );
}

function row(
  key: DiagnosisDimensionKey,
  label: string,
  status: DiagnosisStatus,
  detail: string,
): DiagnosisRow {
  return { key, label, status, detail };
}
