/**
 * Section Analyzer — compares a page's H2 structure against best-in-class
 * pages of the same type to identify missing sections.
 *
 * Operator-agnostic. Works for any site with page snapshots.
 */

import type { PageSnapshot } from "@/domains/pages/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SectionGap = {
  /** Normalized section label (e.g., "faq", "comparison", "cost") */
  sectionLabel: string;
  /** Human-readable display name (e.g., "FAQ section", "Cost breakdown") */
  displayName: string;
  /** Fraction of same-type pages that have this section (0-1) */
  presentOnPct: number;
  /** The H2 text on the TARGET page to insert after, or null if insert at end */
  insertAfter: string | null;
};

type PageType = "city" | "service" | "project" | "homepage" | "other";

// ---------------------------------------------------------------------------
// Page type inference (URL-based, no hardcoded domains)
// ---------------------------------------------------------------------------

function inferPageType(url: string): PageType {
  const path = url.replace(/^https?:\/\/[^/]+/, "").toLowerCase();
  if (path === "/" || path === "") return "homepage";
  if (path.includes("/locations/")) return "city";
  if (path.includes("/services/")) return "service";
  if (path.includes("/explore-projects/") || path.includes("/project")) return "project";
  return "other";
}

// ---------------------------------------------------------------------------
// H2 normalization — strip location/brand-specific words for comparison
// ---------------------------------------------------------------------------

const STRIP_WORDS = new Set([
  // Common city names that vary between pages
  "atherton", "menlo", "park", "palo", "alto", "cupertino", "saratoga",
  "los", "altos", "hills", "emerald", "sunnyvale", "mountain", "view",
  "san", "jose", "francisco", "bay", "area", "silicon", "valley",
  "california", "ca",
  // Common brand words
  "ritz", "builders", "construction", "homes", "home", "builder",
  // Filler
  "the", "a", "an", "in", "for", "of", "and", "or", "your", "our", "my",
  "best", "top", "premier", "leading", "trusted",
]);

function normalizeH2(h2: string): string {
  return h2
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STRIP_WORDS.has(w))
    .sort()
    .join(" ")
    .trim();
}

// ---------------------------------------------------------------------------
// Section theme mapping — map normalized H2s to semantic labels
// ---------------------------------------------------------------------------

const THEME_PATTERNS: { pattern: RegExp; label: string; display: string }[] = [
  { pattern: /\bfaq\b|\bquestion|\basked\b/, label: "faq", display: "FAQ section" },
  { pattern: /\bcompar|\bvs\b|\bversus\b/, label: "comparison", display: "Comparison table" },
  { pattern: /\bcost\b|\bpric|\bbudget\b|\bestimate/, label: "cost", display: "Cost breakdown" },
  { pattern: /\bprocess\b|\bstep|\bhow\s+(?:it|we)\s+work|\btimeline\b/, label: "process", display: "Process overview" },
  { pattern: /\btestimonial|\breview|\bclient\s+stor|\bwhat\s+.*\bsay/, label: "testimonials", display: "Client testimonials" },
  { pattern: /\bgallery\b|\bphoto|\bportfolio\b|\bproject\b.*\bimage/, label: "gallery", display: "Project gallery" },
  { pattern: /\bneighborhood|\bcommunit|\barea\b.*\bserve/, label: "neighborhoods", display: "Neighborhoods section" },
  { pattern: /\bcontact\b|\bget\s+(?:in\s+)?(?:touch|started)|\brequest\b.*\bquote/, label: "cta", display: "Contact / CTA" },
  { pattern: /\bservice|\bwhat\s+we\s+(?:do|offer|build)/, label: "services", display: "Services overview" },
  { pattern: /\babout\b|\bwho\s+we\s+are|\bour\s+(?:team|story)/, label: "about", display: "About section" },
  { pattern: /\bdesign\b.*\bbuild|\barchitect/, label: "design_build", display: "Design-build overview" },
  { pattern: /\badu\b|\baccessory\s+dwelling/, label: "adu", display: "ADU section" },
  { pattern: /\bremodel|\brenovation/, label: "remodel", display: "Remodel section" },
  { pattern: /\bzoning|\bpermit|\bregulation/, label: "zoning", display: "Zoning & permits" },
  { pattern: /\bvideo\b/, label: "video", display: "Video section" },
];

function classifyH2Theme(normalizedH2: string): { label: string; display: string } | null {
  for (const theme of THEME_PATTERNS) {
    if (theme.pattern.test(normalizedH2)) {
      return { label: theme.label, display: theme.display };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyzeSectionGaps(
  target: PageSnapshot,
  allSnapshots: PageSnapshot[],
): SectionGap[] {
  const targetType = inferPageType(target.url);

  // Get all pages of the same type (excluding the target itself)
  const sameType = allSnapshots.filter(
    (s) =>
      inferPageType(s.url) === targetType &&
      s.url !== target.url &&
      s.h2_list.length >= 2, // Need enough structure to be meaningful
  );

  if (sameType.length < 2) return []; // Not enough reference pages

  // Count section theme frequency across same-type pages
  const themeCounts = new Map<string, { display: string; count: number }>();
  for (const snap of sameType) {
    const seenThemes = new Set<string>();
    for (const h2 of snap.h2_list) {
      const normalized = normalizeH2(h2);
      const theme = classifyH2Theme(normalized);
      if (theme && !seenThemes.has(theme.label)) {
        seenThemes.add(theme.label);
        const entry = themeCounts.get(theme.label) ?? { display: theme.display, count: 0 };
        entry.count++;
        themeCounts.set(theme.label, entry);
      }
    }
  }

  // Find which themes the target page HAS
  const targetThemes = new Set<string>();
  const targetH2Order: string[] = [];
  for (const h2 of target.h2_list) {
    const normalized = normalizeH2(h2);
    const theme = classifyH2Theme(normalized);
    if (theme) {
      targetThemes.add(theme.label);
      targetH2Order.push(theme.label);
    }
  }

  // Compute the most common H2 ordering across reference pages
  // (simplified: just use frequency ordering as proxy for position)
  const themeOrder = [...themeCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([label]) => label);

  // Gaps = themes present on ≥40% of same-type pages but NOT on target
  const gaps: SectionGap[] = [];
  for (const [label, { display, count }] of themeCounts) {
    const pct = count / sameType.length;
    if (pct < 0.4) continue; // Too rare to be expected
    if (targetThemes.has(label)) continue; // Target already has it

    // Determine insertAfter: find the last target theme that appears
    // BEFORE this theme in the canonical ordering
    const themeIdx = themeOrder.indexOf(label);
    let insertAfter: string | null = null;
    for (let i = themeIdx - 1; i >= 0; i--) {
      if (targetThemes.has(themeOrder[i])) {
        // Find the actual H2 text on the target page for this theme
        const matchingH2 = target.h2_list.find((h2) => {
          const theme = classifyH2Theme(normalizeH2(h2));
          return theme?.label === themeOrder[i];
        });
        if (matchingH2) {
          insertAfter = matchingH2;
          break;
        }
      }
    }

    gaps.push({
      sectionLabel: label,
      displayName: display,
      presentOnPct: Math.round(pct * 100) / 100,
      insertAfter,
    });
  }

  // Sort by frequency (most common expected sections first)
  gaps.sort((a, b) => b.presentOnPct - a.presentOnPct);

  return gaps;
}
