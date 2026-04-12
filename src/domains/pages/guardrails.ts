/**
 * Page guardrail classification.
 *
 * Deterministic rules that classify page snapshots + diffs into
 * operator-meaningful alerts: regressions, improvements, warnings, and critical issues.
 */

import type { PageSnapshot, PageSnapshotDiff } from "./types";

export type GuardrailSeverity = "critical" | "regression" | "warning" | "improvement" | "info";

export type GuardrailAlert = {
  page_id: string;
  url: string;
  severity: GuardrailSeverity;
  category: string;
  message: string;
  detail: string;
  /** Present when alert was emitted during a crawl that recorded an observation run. */
  observation_run_id?: string;
};

export function classifyGuardrails(
  snapshot: PageSnapshot,
  diff: PageSnapshotDiff | null,
  citationCount?: number
): GuardrailAlert[] {
  const alerts: GuardrailAlert[] = [];
  const base = { page_id: snapshot.page_id, url: snapshot.url };

  // ── Critical: indexability issues ──

  if (snapshot.robots_meta?.toLowerCase().includes("noindex")) {
    alerts.push({
      ...base,
      severity: "critical",
      category: "noindex",
      message: "Page has noindex",
      detail: `robots meta: ${snapshot.robots_meta}`,
    });
  }

  if (snapshot.has_canonical_mismatch) {
    alerts.push({
      ...base,
      severity: "critical",
      category: "canonical_mismatch",
      message: "Canonical URL mismatch",
      detail: `canonical points to ${snapshot.canonical_url ?? "unknown"} instead of ${snapshot.url}`,
    });
  }

  if (snapshot.http_status !== 200) {
    alerts.push({
      ...base,
      severity: "critical",
      category: "http_error",
      message: `HTTP ${snapshot.http_status}`,
      detail: `Page returned non-200 status`,
    });
  }

  // ── Regressions: things that got worse ──

  if (diff) {
    if (diff.faq_count_changed) {
      const prevCount = estimatePrevFaqCount(snapshot, diff);
      if (snapshot.faqs.length < prevCount) {
        alerts.push({
          ...base,
          severity: "regression",
          category: "faq_lost",
          message: `Lost ${prevCount - snapshot.faqs.length} FAQ${prevCount - snapshot.faqs.length !== 1 ? "s" : ""}`,
          detail: `Was ${prevCount}, now ${snapshot.faqs.length}`,
        });
      }
    }

    if (diff.schema_changed && snapshot.schema_types.length === 0) {
      alerts.push({
        ...base,
        severity: "regression",
        category: "schema_lost",
        message: "Schema removed",
        detail: "Page had structured data, now has none",
      });
    }

    if (diff.title_changed && !snapshot.title) {
      alerts.push({
        ...base,
        severity: "regression",
        category: "title_removed",
        message: "Title removed",
        detail: "Page no longer has a <title> tag",
      });
    }

    if (diff.h1_changed && !snapshot.h1) {
      alerts.push({
        ...base,
        severity: "regression",
        category: "h1_removed",
        message: "H1 removed",
        detail: "Page no longer has an <h1> heading",
      });
    }

    // ── Improvements ──

    if (diff.faq_count_changed) {
      const prevCount = estimatePrevFaqCount(snapshot, diff);
      if (snapshot.faqs.length > prevCount) {
        alerts.push({
          ...base,
          severity: "improvement",
          category: "faq_added",
          message: `Added ${snapshot.faqs.length - prevCount} FAQ${snapshot.faqs.length - prevCount !== 1 ? "s" : ""}`,
          detail: `Was ${prevCount}, now ${snapshot.faqs.length}`,
        });
      }
    }

    if (diff.schema_changed && snapshot.schema_types.length > 0) {
      const isNew = diff.changed;
      if (isNew) {
        alerts.push({
          ...base,
          severity: "improvement",
          category: "schema_added",
          message: `Schema updated: ${snapshot.schema_types.join(", ")}`,
          detail: "Structured data was added or changed",
        });
      }
    }

    if (diff.content_changed) {
      alerts.push({
        ...base,
        severity: "info",
        category: "content_changed",
        message: "Content changed",
        detail: diff.summary,
      });
    }
  }

  // ── Warnings: structure issues (static, no diff needed) ──

  const highCitations = (citationCount ?? 0) >= 50;

  if (highCitations && snapshot.faqs.length === 0 && snapshot.schema_types.length === 0) {
    alerts.push({
      ...base,
      severity: "warning",
      category: "weak_structure_high_citations",
      message: `${citationCount} citations but no detected FAQ content or schema markup`,
      detail: "High citation count with no FAQ or structured data detected in crawled HTML. If the live page has visible FAQ sections, re-run the scan to update extraction.",
    });
  } else if (highCitations && snapshot.faqs.length === 0) {
    alerts.push({
      ...base,
      severity: "info",
      category: "no_faq_high_citations",
      message: `${citationCount} citations, no FAQ content detected (has schema: ${snapshot.schema_types.join(", ")})`,
      detail: "Schema markup present but no FAQ content found in crawled HTML.",
    });
  } else if (highCitations && snapshot.schema_types.length === 0) {
    alerts.push({
      ...base,
      severity: "info",
      category: "no_schema_high_citations",
      message: `${citationCount} citations, has ${snapshot.faqs.length} FAQ${snapshot.faqs.length !== 1 ? "s" : ""} but no schema markup`,
      detail: "FAQ content detected but no JSON-LD structured data. Adding FAQPage schema could strengthen structured visibility.",
    });
  }

  if (snapshot.word_count < 200 && highCitations) {
    alerts.push({
      ...base,
      severity: "warning",
      category: "thin_content_high_citations",
      message: `Only ${snapshot.word_count} words with ${citationCount} citations`,
      detail: "Very thin page content for a highly-cited page",
    });
  }

  return alerts;
}

function estimatePrevFaqCount(snap: PageSnapshot, diff: PageSnapshotDiff): number {
  if (!diff.faq_count_changed) return snap.faqs.length;
  return snap.faqs.length;
}

export type ScanRunMeta = {
  run_id: string;
  started_at: string;
  completed_at: string;
  pages_scanned: number;
  pages_changed: number;
  pages_with_errors: number;
  guardrail_alerts: number;
  critical_count: number;
  regression_count: number;
  improvement_count: number;
};
