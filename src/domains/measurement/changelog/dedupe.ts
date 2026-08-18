
/**
 * Edit-type tokens we extract from a change_description string.
 *
 * A CSV summary entry like "Published new landing page" and a PDF granular
 * entry like "Set title tag to …" on the same URL on the same day are duplicates
 * if the CSV's token set is a subset of the PDF's token set (CSV summarises PDF).
 */
export type EditToken =
  | "page_created"
  | "page_removed"
  | "title_change"
  | "meta_description"
  | "h1_change"
  | "faq_added"
  | "schema_added"
  | "canonical_change"
  | "hero_change"
  | "section_added"
  | "internal_links"
  | "images_added"
  | "sitemap_robots"
  | "navigation_change";

const KEYWORD_RULES: Array<{ tokens: EditToken[]; patterns: RegExp[] }> = [
  {
    tokens: ["page_created"],
    patterns: [
      /\bcreated\b.*\bpage\b/i,
      /\bpublished\b.*\b(new|landing|guide)\b.*\bpage\b/i,
      /\bpublished\s+new\b.*\bpage\b/i,
      /\blaunched\b.*\bpage\b/i,
      /\brebuilt\b.*\b(page|hub)\b/i,
      /\bnew\s+(standalone|landing)\s+page\b/i,
      /complete page reconstruction/i,
    ],
  },
  {
    tokens: ["page_removed"],
    patterns: [/removed page|deprecated page|301 redirect .* (removed|old)/i],
  },
  {
    tokens: ["title_change"],
    patterns: [/\btitle tag\b/i, /\btitle changed\b/i, /\bupdated title\b/i, /\bset title\b/i, /meta title/i],
  },
  {
    tokens: ["meta_description"],
    patterns: [/meta description/i],
  },
  {
    tokens: ["h1_change"],
    patterns: [/\bH1\b/, /hero .*(H1|heading)/i, /updated .* headline/i],
  },
  {
    tokens: ["faq_added"],
    patterns: [/\bFAQ\b/, /frequently asked/i, /added .* (question|Q&A)/i],
  },
  {
    tokens: ["schema_added"],
    patterns: [
      /JSON-?LD/i,
      /schema/i,
      /BreadcrumbList|FAQPage|Article|Service|Organization|LocalBusiness/,
    ],
  },
  {
    tokens: ["canonical_change"],
    patterns: [/canonical/i],
  },
  {
    tokens: ["hero_change"],
    patterns: [/\bhero\b/i, /new hero section/i, /updated hero/i],
  },
  {
    tokens: ["section_added"],
    patterns: [/added .* section/i, /added .* (strip|grid|card)/i, /embedded .* section/i],
  },
  {
    tokens: ["internal_links"],
    patterns: [/internal link/i, /added link to \//i, /anchor text/i],
  },
  {
    tokens: ["images_added"],
    patterns: [/added .* (image|photo|collage)/i, /image gallery/i, /alt text/i],
  },
  {
    tokens: ["sitemap_robots"],
    patterns: [/sitemap/i, /robots\.txt/i],
  },
  {
    tokens: ["navigation_change"],
    patterns: [/site navigation|nav bar|header menu|footer link/i],
  },
];

