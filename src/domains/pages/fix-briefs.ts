/**
 * Fix Brief engine.
 *
 * Generates execution-ready fix briefs from guardrail alerts by joining:
 * - scanner snapshot data (raw HTML structure)
 * - render check results (rendered DOM comparison)
 * - changelog/scorecard history (intended changes)
 * - citation evidence (page importance)
 */

import type { PageSnapshot } from "./types";
import type { GuardrailAlert } from "./guardrails";
import type { RenderCheckResult } from "./render-check";
import { stripSiteOrigin } from "@/lib/site-config";

export type FixBrief = {
  alertCategory: string;
  alertSeverity: string;
  pageUrl: string;
  pagePath: string;
  issueSummary: string;
  expectedState: string[];
  observedState: string[];
  likelyCauses: string[];
  verificationChecklist: string[];
  bestNextMove: string;
  relatedChangelog: { id: string; date: string; name: string; description: string }[];
  intentConflict: boolean;
  intentDetail: string | null;
  citationCount: number;
};

export function generateFixBrief(
  alert: GuardrailAlert,
  snapshot: PageSnapshot | null,
  renderCheck: RenderCheckResult | null,
  changelog: { id: string; timestamp: string; asset_name: string; change_description: string; url: string }[],
  citationCount: number
): FixBrief {
  const path = stripSiteOrigin(alert.url) || "/";

  const relatedChanges = findRelatedChangelog(path, changelog);

  const hasIntendedSchemaWork = relatedChanges.some(
    (c) =>
      c.description.toLowerCase().includes("schema") ||
      c.description.toLowerCase().includes("json-ld") ||
      c.description.toLowerCase().includes("faq") ||
      c.description.toLowerCase().includes("aeo")
  );

  switch (alert.category) {
    case "weak_structure_high_citations":
      return buildWeakStructureBrief(alert, snapshot, relatedChanges, hasIntendedSchemaWork, citationCount, path);
    case "render_mismatch":
      return buildRenderMismatchBrief(alert, snapshot, renderCheck, relatedChanges, hasIntendedSchemaWork, citationCount, path);
    case "noindex":
      return buildNoindexBrief(alert, snapshot, relatedChanges, citationCount, path);
    case "canonical_mismatch":
      return buildCanonicalBrief(alert, snapshot, relatedChanges, citationCount, path);
    case "faq_lost":
    case "schema_lost":
      return buildRegressionBrief(alert, snapshot, relatedChanges, hasIntendedSchemaWork, citationCount, path);
    default:
      return buildGenericBrief(alert, snapshot, relatedChanges, citationCount, path);
  }
}

function buildWeakStructureBrief(
  alert: GuardrailAlert,
  snapshot: PageSnapshot | null,
  relatedChanges: FixBrief["relatedChangelog"],
  hasIntendedWork: boolean,
  citationCount: number,
  path: string
): FixBrief {
  const observedState: string[] = [];
  if (snapshot) {
    observedState.push(`Raw HTML: ${snapshot.faqs.length} FAQs, ${snapshot.schema_types.length > 0 ? snapshot.schema_types.join(", ") : "no schema"}`);
    observedState.push(`${snapshot.word_count.toLocaleString()} words, ${snapshot.internal_link_count} internal links`);
    observedState.push(`Title: "${snapshot.title ?? "none"}"`);
    observedState.push(`H1: "${snapshot.h1 ?? "none"}"`);
  } else {
    observedState.push("Page not yet scanned for structure details");
  }

  const expectedState = [
    `${citationCount} citations — AI platforms are actively referencing this page`,
    "Should have FAQ schema (FAQPage JSON-LD) for common questions",
    "Should have structured data matching page type and content",
  ];

  const likelyCauses: string[] = [];
  if (hasIntendedWork) {
    likelyCauses.push("Changelog shows intended FAQ/schema work, but raw HTML has none — change may not have shipped to production");
    likelyCauses.push("Schema may have been added in a dev/staging environment but not deployed");
    likelyCauses.push("A subsequent deploy may have overwritten the changes");
  } else {
    likelyCauses.push("FAQ/schema was never added to this page template");
    likelyCauses.push("This page may be using a generic template that lacks structured data components");
  }

  return {
    alertCategory: alert.category,
    alertSeverity: alert.severity,
    pageUrl: alert.url,
    pagePath: path,
    issueSummary: `${citationCount} citations but no FAQ or schema — ${hasIntendedWork ? "changelog says this should have been fixed" : "never had structured data"}`,
    expectedState,
    observedState,
    likelyCauses,
    verificationChecklist: [
      "View page source — check for <script type=\"application/ld+json\"> blocks",
      "Check for FAQPage schema in any JSON-LD blocks",
      "Inspect page component/template for FAQ and schema output",
      "If FAQ/schema exists in code but not in production HTML, check build/deploy pipeline",
      "After fix: re-scan this page in Beacon to confirm guardrail clears",
    ],
    bestNextMove: hasIntendedWork
      ? `Investigate why the intended FAQ/schema changes from ${relatedChanges[0]?.date ?? "recent changelog"} did not reach production HTML. Check the deploy pipeline and page template.`
      : `Add FAQPage JSON-LD schema and FAQ content to this page. With ${citationCount} citations, structured data will directly strengthen AI platform coverage.`,
    relatedChangelog: relatedChanges,
    intentConflict: hasIntendedWork,
    intentDetail: hasIntendedWork
      ? `Changelog entry "${relatedChanges[0]?.name}" (${relatedChanges[0]?.date}) describes FAQ/schema/AEO work for this page, but raw HTML shows none present.`
      : null,
    citationCount,
  };
}

function buildRenderMismatchBrief(
  alert: GuardrailAlert,
  snapshot: PageSnapshot | null,
  renderCheck: RenderCheckResult | null,
  relatedChanges: FixBrief["relatedChangelog"],
  hasIntendedWork: boolean,
  citationCount: number,
  path: string
): FixBrief {
  const observedState: string[] = [];
  if (snapshot && renderCheck) {
    observedState.push(`Raw HTML: ${snapshot.faqs.length} FAQs, ${snapshot.schema_types.join(", ") || "no schema"}`);
    observedState.push(`Rendered DOM: ${renderCheck.rendered_faq_count} FAQs, ${renderCheck.rendered_schema_count} schema types`);
    for (const m of renderCheck.mismatches) {
      observedState.push(`${m.field}: raw="${m.raw}" → rendered="${m.rendered}"`);
    }
  } else if (snapshot) {
    observedState.push(`Raw HTML: ${snapshot.faqs.length} FAQs, ${snapshot.schema_types.join(", ") || "no schema"}`);
    observedState.push("Rendered DOM: mismatch detected (details in render check)");
  }

  const expectedState = [
    "Raw HTML and rendered DOM should contain identical FAQ/schema structures",
    `${citationCount} citations — this page is actively referenced by AI platforms`,
    "JSON-LD scripts should survive client-side hydration intact",
    "FAQ components should render in both server and client contexts",
  ];

  const likelyCauses = [
    "React/Next.js hydration is stripping JSON-LD <script> tags during client-side takeover",
    "FAQ component may be conditionally rendered (e.g., useEffect/client-only) instead of server-rendered",
    "Client-side JavaScript may be replacing the server-rendered HTML with a version that lacks structured data",
    "JSON-LD scripts may be inserted via a component that doesn't persist across hydration boundary",
    "A content management system or page builder may be injecting FAQ/schema only in the initial SSR pass",
  ];

  if (hasIntendedWork) {
    likelyCauses.unshift(
      `Changelog confirms FAQ/schema was intentionally added — the raw HTML confirms it exists. The issue is specifically in the client-side render lifecycle.`
    );
  }

  return {
    alertCategory: alert.category,
    alertSeverity: alert.severity,
    pageUrl: alert.url,
    pagePath: path,
    issueSummary: `FAQ/schema present in raw HTML but stripped during client render — likely hydration or conditional rendering issue`,
    expectedState,
    observedState,
    likelyCauses,
    verificationChecklist: [
      "Open browser DevTools on the live page",
      "Check Elements panel for <script type=\"application/ld+json\"> — if missing, hydration is stripping it",
      "Check Network tab initial HTML response — if JSON-LD is there, the issue is client-side",
      "Look for FAQ React component — check if it uses useEffect or client-only conditionals",
      "Test with JavaScript disabled — if FAQ/schema appears, confirms JS is removing it",
      "After fix: re-scan this page in Beacon and verify render check passes",
    ],
    bestNextMove: `Open DevTools on ${alert.url} and check if JSON-LD scripts survive hydration. The raw HTML has the data — the client is removing it. Fix the component rendering lifecycle so structured data persists.`,
    relatedChangelog: relatedChanges,
    intentConflict: hasIntendedWork,
    intentDetail: hasIntendedWork
      ? `Changelog confirms FAQ/schema was added intentionally. Raw HTML confirms it shipped. But the rendered DOM shows it disappearing — this is a client-side rendering issue, not a missing-content issue.`
      : null,
    citationCount,
  };
}

function buildNoindexBrief(
  alert: GuardrailAlert, snap: PageSnapshot | null,
  changes: FixBrief["relatedChangelog"], citations: number, path: string
): FixBrief {
  return {
    alertCategory: alert.category, alertSeverity: alert.severity,
    pageUrl: alert.url, pagePath: path,
    issueSummary: "Page has noindex — preventing search engine and AI platform indexing",
    expectedState: ["Page should be indexable for search and AI platform discovery"],
    observedState: [
      `robots meta: ${snap?.robots_meta ?? "unknown"}`,
      ...(citations > 0 ? [`${citations} citations exist despite noindex — removing it would strengthen visibility`] : []),
    ],
    likelyCauses: [
      "noindex meta tag was left from staging/development",
      "CMS or page builder has noindex enabled for this page",
      "Global noindex rule is affecting this page unintentionally",
    ],
    verificationChecklist: [
      "Check page source for <meta name=\"robots\" content=\"noindex\">",
      "Check CMS/builder settings for this page's indexing configuration",
      "After removing: re-scan in Beacon to confirm guardrail clears",
    ],
    bestNextMove: "Remove the noindex directive from this page so it can be properly indexed.",
    relatedChangelog: changes, intentConflict: false, intentDetail: null, citationCount: citations,
  };
}

function buildCanonicalBrief(
  alert: GuardrailAlert, snap: PageSnapshot | null,
  changes: FixBrief["relatedChangelog"], citations: number, path: string
): FixBrief {
  return {
    alertCategory: alert.category, alertSeverity: alert.severity,
    pageUrl: alert.url, pagePath: path,
    issueSummary: "Canonical URL does not match page URL — may cause indexing confusion",
    expectedState: [`Canonical should point to ${alert.url}`],
    observedState: [`Canonical points to ${snap?.canonical_url ?? "unknown"}`],
    likelyCauses: [
      "Canonical tag is pointing to wrong URL variant (trailing slash, www, http vs https)",
      "Canonical was set to a different page during migration",
      "CMS generated incorrect canonical automatically",
    ],
    verificationChecklist: [
      "Check page source for <link rel=\"canonical\" href=\"...\">",
      "Ensure canonical URL matches the sitemap URL exactly",
      "After fix: re-scan in Beacon to confirm",
    ],
    bestNextMove: `Fix the canonical tag to point to ${alert.url}.`,
    relatedChangelog: changes, intentConflict: false, intentDetail: null, citationCount: citations,
  };
}

function buildRegressionBrief(
  alert: GuardrailAlert, snap: PageSnapshot | null,
  changes: FixBrief["relatedChangelog"], hasIntendedWork: boolean, citations: number, path: string
): FixBrief {
  return {
    alertCategory: alert.category, alertSeverity: alert.severity,
    pageUrl: alert.url, pagePath: path,
    issueSummary: `${alert.message} — structure regression detected between scans`,
    expectedState: ["Page should retain previously present FAQ/schema content"],
    observedState: [alert.detail],
    likelyCauses: [
      "A deploy removed or overwrote the FAQ/schema content",
      "Page template was changed and lost the structured data component",
      "Content update inadvertently removed the FAQ block",
    ],
    verificationChecklist: [
      "Compare current page source with previous version",
      "Check recent deploys that touched this page",
      "After restoring: re-scan in Beacon to confirm",
    ],
    bestNextMove: "Review recent changes to this page and restore the lost FAQ/schema content.",
    relatedChangelog: changes, intentConflict: hasIntendedWork, intentDetail: null, citationCount: citations,
  };
}

function buildGenericBrief(
  alert: GuardrailAlert, snap: PageSnapshot | null,
  changes: FixBrief["relatedChangelog"], citations: number, path: string
): FixBrief {
  return {
    alertCategory: alert.category, alertSeverity: alert.severity,
    pageUrl: alert.url, pagePath: path,
    issueSummary: alert.message,
    expectedState: [alert.detail],
    observedState: snap ? [`${snap.word_count} words, ${snap.faqs.length} FAQs, ${snap.schema_types.join(", ") || "no schema"}`] : [],
    likelyCauses: ["See alert detail"],
    verificationChecklist: ["Inspect the page and fix the identified issue", "Re-scan in Beacon to confirm"],
    bestNextMove: "Investigate and resolve the issue, then re-scan.",
    relatedChangelog: changes, intentConflict: false, intentDetail: null, citationCount: citations,
  };
}

function findRelatedChangelog(
  path: string,
  changelog: { id: string; timestamp: string; asset_name: string; change_description: string; url: string }[]
): FixBrief["relatedChangelog"] {
  const normPath = path.replace(/\/+$/, "").toLowerCase();
  return changelog
    .filter((c) => {
      const cUrl = (c.url || "").toLowerCase().replace(/\/+$/, "");
      return (
        cUrl === normPath ||
        cUrl.endsWith(normPath) ||
        (normPath === "/" && cUrl.includes("homepage")) ||
        (normPath === "/" && cUrl === "/")
      );
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 5)
    .map((c) => ({
      id: c.id,
      date: c.timestamp.slice(0, 10),
      name: c.asset_name,
      description: c.change_description.slice(0, 200),
    }));
}
