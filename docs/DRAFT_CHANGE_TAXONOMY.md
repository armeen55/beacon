# DRAFT change taxonomy (auto-generated)

_Generated 2026-04-20 by `scripts/draft-change-taxonomy.ts`. This is a draft — redline it._

## Sources

- **`.data/imported-changes.json`** — 303 changelog entries (excluding archived)
- **`.data/scan-findings.json`** — 85 scan findings (pending + orphan-accepted; excluded rejected/ignored/already-linked-accepted)
- **Total events analyzed:** 388
- **Classified into 47 taxonomy buckets:** 290 events (74.7%)
- **Unclassified (needs redline):** 98 events (25.3%)

## How to redline this file

1. Read each bucket below. If the `id` is wrong, rewrite it. If the `description` is wrong, rewrite it.
2. If two buckets should be merged, note `MERGE with <other-id>` inline.
3. If a bucket should be split (too broad), note `SPLIT: <sub-id-1>, <sub-id-2>`.
4. For every entry in the **UNCLASSIFIED** section: either propose a new bucket id or mark `NOT A CHANGE` if it's operational noise.
5. When done, tell me "taxonomy redlined" and I'll generate `src/domains/attribution/change-taxonomy.ts` from your edits.

## Taxonomy buckets (by frequency)

### 1. `content.faq.add` — Visible FAQ block added (Q&A copy on the page, separate from JSON-LD).
**Count:** 31

**Examples:**
- `cl-real-12` · 2026-03-02 · /explore-projects/riverside-way · _changelog_ — Added 5-question FAQ section in crawlable HTML covering design-build vs separate, lot purchase checks, budget control, timeline, and starting a build (Riverside Way) Cupertino Custom Home Builder
- `cl-real-22` · 2026-03-04 · /locations/saratoga · _changelog_ — Added 9 anchor IDs for internal section linking (#saratoga-realities, #new-home-construction, #process, #home-remodeling, #adus, #neighborhoods, #cost, #FAQ, #cta) (Saratoga) Custom Home Builder Sarat
- `cl-real-30` · 2026-03-04 · /locations/saratoga · _changelog_ — Added Section 8 FAQ with 5 Saratoga-specific questions covering tree permits, arborist review, stormwater C.3, design review timeline, WUI fire codes (Saratoga) Custom Home Builder Saratoga
- _…and 28 more._

### 2. `schema.invalid.detected` — Scanner flagged JSON-LD as invalid for Google rich-result requirements.
**Count:** 27

**Examples:**
- `schema_invalid-/services-obs-1776401069172` · 2026-04-17 · https://ritzbuilders.com/services · _finding:schema_invalid_ — /services: schema issues — schema_critical:UNPARSEABLE: JSON-LD block did not parse as valid JSON. · now: schema_critical:UNPARSEABLE: JSON-LD block did not parse as valid JSON.
- `schema_invalid-/custom-home-builder-bay-area-obs-1776401069172` · 2026-04-17 · https://ritzbuilders.com/custom-home-builder-bay-area · _finding:schema_invalid_ — /custom-home-builder-bay-area: schema issues — schema_warning:Article: Article missing author — E-E-A-T signal lost.; schema_warning:Article: Article missing datePublished — freshness signal lost. · n
- `schema_invalid-/luxury-home-builder-bay-area-obs-1776401069172` · 2026-04-17 · https://ritzbuilders.com/luxury-home-builder-bay-area · _finding:schema_invalid_ — /luxury-home-builder-bay-area: schema issues — schema_warning:Article: Article missing datePublished — freshness signal lost.; schema_critical:Service: Service missing name. · now: schema_warning:Arti
- _…and 24 more._

### 3. `schema.missing-for-page-type` — Scanner flagged a page missing the expected schema for its asset type.
**Count:** 27

**Examples:**
- `schema_missing_for_page_type-/available-homes-obs-1776707470145` · 2026-04-20 · https://ritzbuilders.com/available-homes · _finding:schema_missing_for_page_type_ — /available-homes: hub page is missing 2 required schema types — BreadcrumbList, (one of) CollectionPage | ItemList · was: schema_types: [(none)] · now: missing_required: [BreadcrumbList, (one of) Coll
- `schema_missing_for_page_type-/explore-projects-obs-1776707470145` · 2026-04-20 · https://ritzbuilders.com/explore-projects · _finding:schema_missing_for_page_type_ — /explore-projects: hub page is missing 2 required schema types — BreadcrumbList, (one of) CollectionPage | ItemList · was: schema_types: [(none)] · now: missing_required: [BreadcrumbList, (one of) Col
- `schema_missing_for_page_type-/our-partners-obs-1776707470145` · 2026-04-20 · https://ritzbuilders.com/our-partners · _finding:schema_missing_for_page_type_ — /our-partners: brand page is missing 2 required schema types — FAQPage, BreadcrumbList · was: schema_types: [(none)] · now: missing_required: [FAQPage, BreadcrumbList]
- _…and 24 more._

### 4. `content.cta.modify` — Call-to-action button / link copy modified.
**Count:** 20

**Examples:**
- `cl-real-2` · 2026-03-02 · /explore-projects · _changelog_ — Removed all 'Explore' buttons from placeholder project cards on /explore-projects parent page, leaving only Riverside Way as active clickable card (Explore Projects) Custom Home Builder Bay Area
- `cl-real-8` · 2026-03-02 · /explore-projects/riverside-way · _changelog_ — Added hero section with full-width image, overlay H1, sub-headline, and two CTA buttons (Request Private Consultation + View Home Gallery) (Riverside Way) Cupertino Custom Home Builder
- `cl-real-21` · 2026-03-04 · /locations/saratoga · _changelog_ — Added hero section with H1, hero image with alt text, two CTA buttons, and short description about architect-led design-build (Saratoga) Custom Home Builder Saratoga
- _…and 17 more._

### 5. `content.title.modify` — <title> tag modified.
**Count:** 15

**Examples:**
- `cl-real-1` · 2026-03-02 · /explore-projects · _changelog_ — Updated hero card on /explore-projects grid: set title to 'Modern Contemporary Single-Family Residence' with subtitle and Explore button linking to /explore-projects/riverside-way (Explore Projects) C
- `cl-real-4` · 2026-03-02 · /explore-projects/riverside-way · _changelog_ — Set title tag to 'Luxury Modern Contemporary Home in Cupertino' (Riverside Way) Cupertino Custom Home Builder
- `cl-real-16` · 2026-03-04 · /locations/saratoga · _changelog_ — Set title tag to 'Luxury Custom Home Builder Saratoga CA | Design Build' (Saratoga) Custom Home Builder Saratoga
- _…and 12 more._

### 6. `metadata.canonical.modify` — <link rel=canonical> modified.
**Count:** 13

**Examples:**
- `cl-real-7` · 2026-03-02 · /explore-projects/riverside-way · _changelog_ — Set robots to index,follow and self-referencing canonical URL (Riverside Way) Cupertino Custom Home Builder
- `cl-real-45` · 2026-03-10 · /luxury-home-builder-bay-area · _changelog_ — Set Open Graph title, description, and canonical URL (Luxury Home Builder Bay Area) Luxury Home Builder Bay Area
- `cl-real-102` · 2026-03-13 · /available-homes/princeton-residence-menlo-park · _changelog_ — Set robots index,follow, self-referencing canonical, removed inherited noindex (Princeton Residence Menlo Park) Luxury Home Builder Bay Area
- _…and 10 more._

### 7. `content.h3.modify` — H3 added or modified.
**Count:** 12

**Examples:**
- `cl-real-32` · 2026-03-09 · /about-us · _changelog_ — Added 8-question FAQ section to /about-us with H3 headings covering founder, location, services, Ritzom, in-house teams, specialties, core values, contact info (About Us) Custom Home Builder Bay Area
- `cl-real-34` · 2026-03-09 · /design-studio · _changelog_ — Added 7-question FAQ section to /design-studio with H3 headings covering services, approach, quality, uniqueness, design+construction, customization, starting (Design Studio) Custom Home Builder Bay A
- `cl-real-36` · 2026-03-09 · /our-process · _changelog_ — Added 8-question FAQ section to /our-process with H3 headings covering first step, budgeting, permitting, Ritzom, communication, construction, delivery, post-completion (Our Process) Custom Home Build
- _…and 9 more._

### 8. `metadata.meta-description.modify` — <meta name=description> modified.
**Count:** 11

**Examples:**
- `cl-real-5` · 2026-03-02 · /explore-projects/riverside-way · _changelog_ — Set meta description targeting Cupertino luxury modern contemporary home designed and built by Ritz Builders (Riverside Way) Cupertino Custom Home Builder
- `cl-real-17` · 2026-03-04 · /locations/saratoga · _changelog_ — Set meta description targeting Saratoga architect-led design-build with tree permits, net-site slope, stormwater C.3, and WUI fire requirements (Saratoga) Custom Home Builder Saratoga
- `cl-real-44` · 2026-03-10 · /luxury-home-builder-bay-area · _changelog_ — Set meta description targeting Bay Area luxury home builder comparison for 2026 (Luxury Home Builder Bay Area) Luxury Home Builder Bay Area
- _…and 8 more._

### 9. `ops.guardrail.cleared` — A guardrail condition was cleared.
**Count:** 10

**Examples:**
- `guardrail_cleared-https://ritzbuilders.com/custom-home-builder-bay-area-obs-1776185665750` · 2026-04-14 · https://ritzbuilders.com/custom-home-builder-bay-area · _finding:guardrail_cleared_ — Issue resolved on /custom-home-builder-bay-area: duplicate_faq_schema · was: 2 duplicate FAQPage JSON-LD blocks
- `guardrail_cleared-https://ritzbuilders.com/luxury-home-builder-bay-area-obs-1776185665750` · 2026-04-14 · https://ritzbuilders.com/luxury-home-builder-bay-area · _finding:guardrail_cleared_ — Issue resolved on /luxury-home-builder-bay-area: duplicate_faq_schema · was: 2 duplicate FAQPage JSON-LD blocks
- `guardrail_cleared-https://ritzbuilders.com/explore-projects/austin-avenue-los-altos-obs-1776185665750` · 2026-04-14 · https://ritzbuilders.com/explore-projects/austin-avenue-los-altos · _finding:guardrail_cleared_ — Issue resolved on /explore-projects/austin-avenue-los-altos: duplicate_faq_schema · was: 2 duplicate FAQPage JSON-LD blocks
- _…and 7 more._

### 10. `content.h2.add.service-name` — H2 added that mentions a service (remodel, custom home, adu, etc.).
**Count:** 8

**Examples:**
- `cl-real-23` · 2026-03-04 · /locations/saratoga · _changelog_ — Added Section 1 Hook with H2 about Saratoga regulation complexity covering tree regulations, hillside net-site/slope reductions, and WUI fire-area construction standards (Saratoga) Custom Home Builder
- `cl-real-24` · 2026-03-04 · /locations/saratoga · _changelog_ — Added Section 2 New Construction with H2 and 'What we build in Saratoga' list covering 5 service types (ground-up homes, whole-home modernization, vertical expansions, kitchens/wellness suites, ADUs) 
- `cl-real-26` · 2026-03-04 · /locations/saratoga · _changelog_ — Added Section 4 Remodel Capture with H2 about Saratoga home remodels plus Kitchen Remodeling Saratoga and Bathroom Remodeling Saratoga H3 subsections (Saratoga) Custom Home Builder Saratoga
- _…and 5 more._

### 11. `structure.footer.modify` — Global footer modified (links, attribution, contact block).
**Count:** 7

**Examples:**
- `cl-real-64` · 2026-03-10 · (site-wide) · _changelog_ — Added 'Bay Area Luxury Builder Guide' link to global footer (Luxury Guide Creation) Luxury Home Builder Bay Area
- `cl-real-145` · 2026-03-18 · (site-wide) · _changelog_ — Added 'Our Services' to main navigation and footer (Services Hub Batch) Design Build Firm Bay Area
- `cl-real-154` · 2026-03-19 · (site-wide) · _changelog_ — Added Custom Home Builder Guide link to footer only (Mar 19 Batch) Custom Home Builder Bay Area
- _…and 4 more._

### 12. `content.table.add` — Comparison / data table added to a page.
**Count:** 7

**Examples:**
- `cl-real-123` · 2026-03-14 · /locations/cupertino-custom-home-builder · _changelog_ — Added builder comparison table with 4 builders (Ritz, Element Homes, Golden Gate Group, Fernandez Designs) (Cupertino Custom Home Builder) Cupertino Custom Home Builder
- `cl-real-194` · 2026-04-06 · /custom-home-builder-bay-area/ · _changelog_ — Added Architect-Led Design-Build definition and comparison table (/custom-home-builder-bay-area/) Custom Home Builder Bay Area
- `cl-real-203` · 2026-04-07 · /locations/menlo-park/ · _changelog_ — Added condensed 5-factor cost table (/locations/menlo-park/) Menlo Park Custom Home Builder
- _…and 4 more._

### 13. `media.image.add` — Image added.
**Count:** 6

**Examples:**
- `cl-real-11` · 2026-03-02 · /explore-projects/riverside-way · _changelog_ — Added 22-image gallery section in cinematic sequence with unique SEO-optimized alt tags containing 'Ritz Builders' and 'Cupertino' for each image (Riverside Way) Cupertino Custom Home Builder
- `cl-real-53` · 2026-03-10 · /luxury-home-builder-bay-area · _changelog_ — Added 4-image editorial photo collage with SEO-optimized alt text (Luxury Home Builder Bay Area) Luxury Home Builder Bay Area
- `cl-real-207` · 2026-03-06 · houzz.com · _changelog_ — Created new Houzz profile with description, services, service areas, projects, photos, founder, contact, cost range, social links (houzz.com) Custom Home Builder Bay Area
- _…and 3 more._

### 14. `content.list.add` — Bulleted / numbered list added.
**Count:** 6

**Examples:**
- `cl-real-20` · 2026-03-04 · /locations/saratoga · _changelog_ — Added visible breadcrumbs with BreadcrumbList schema: Home > Locations > Saratoga (Saratoga) Custom Home Builder Saratoga
- `cl-real-58` · 2026-03-10 · /luxury-home-builder-bay-area · _changelog_ — Added 'How to Evaluate and Select Your Estate Home Builder' section with 8-point numbered checklist (Luxury Home Builder Bay Area) Luxury Home Builder Bay Area
- `cl-real-61` · 2026-03-10 · /luxury-home-builder-bay-area · _changelog_ — Added Ritz Builders CTA section with headline, body copy, advantage list, and two CTA buttons (Luxury Home Builder Bay Area) Luxury Home Builder Bay Area
- _…and 3 more._

### 15. `content.section.add.process` — Process / workflow section added (n-step process, how we work).
**Count:** 6

**Examples:**
- `cl-real-25` · 2026-03-04 · /locations/saratoga · _changelog_ — Added Section 3 Process with 6-step Saratoga-specific process content (feasibility, architecture, permitting, preconstruction, construction, final delivery) (Saratoga) Custom Home Builder Saratoga
- `cl-real-57` · 2026-03-10 · /luxury-home-builder-bay-area · _changelog_ — Embedded 6-step process strip from homepage with heading changed to 'Steps to a Custom Luxury Home in the Bay Area' (Luxury Home Builder Bay Area) Luxury Home Builder Bay Area
- `cl-real-76` · 2026-03-11 · /locations/atherton · _changelog_ — Added 6-step Ritz Builders Process section with Atherton-specific content (Atherton) Atherton Custom Home Builder
- _…and 3 more._

### 16. `schema.faqpage.add` — FAQPage JSON-LD added to a page.
**Count:** 6

**Examples:**
- `cl-real-33` · 2026-03-09 · /about-us · _changelog_ — Added FAQPage JSON-LD schema matching visible FAQ content on /about-us (About Us) Custom Home Builder Bay Area
- `cl-real-35` · 2026-03-09 · /design-studio · _changelog_ — Added FAQPage JSON-LD schema matching visible FAQ content on /design-studio (Design Studio) Custom Home Builder Bay Area
- `cl-real-37` · 2026-03-09 · /our-process · _changelog_ — Added FAQPage JSON-LD schema matching visible FAQ content on /our-process (Our Process) Custom Home Builder Bay Area
- _…and 3 more._

### 17. `structure.sitemap.modify` — Sitemap updated.
**Count:** 6

**Examples:**
- `cl-real-46` · 2026-03-10 · /luxury-home-builder-bay-area · _changelog_ — Page not added to site navigation but included in XML sitemap (Luxury Home Builder Bay Area) Luxury Home Builder Bay Area
- `cl-real-144` · 2026-03-18 · /sitemap.xml · _changelog_ — Added Austin Avenue, Louis Road, Cupertino, /services, /services/build-on-your-lot, /services/architect-provided-plans to XML sitemap (Sitemap.Xml) Custom Home Builder Bay Area
- `cl-real-161` · 2026-03-19 · /sitemap.xml · _changelog_ — Added Custom Home Builder Guide, Our Awards, and Design-Build to sitemap (Sitemap.Xml) Custom Home Builder Bay Area
- _…and 3 more._

### 18. `content.section.add` — Generic content section added (catch-all — 'Added Section N' / 'Added X section').
**Count:** 6

**Examples:**
- `cl-real-77` · 2026-03-11 · /locations/atherton · _changelog_ — Added Home Remodeling & Major Renovations section (Atherton) Atherton Custom Home Builder
- `cl-real-91` · 2026-03-12 · /locations/palo-alto · _changelog_ — Added Hook section covering FAR, lot-coverage, height caps, setbacks, tree ordinance, and flood zones (Palo Alto) Palo Alto Custom Home Builder
- `cl-real-119` · 2026-03-14 · /locations/cupertino-custom-home-builder · _changelog_ — Added Project Spotlight section for Rivera Residence with 3 award details and link to /riverside-way (Cupertino Custom Home Builder) Cupertino Custom Home Builder
- _…and 3 more._

### 19. `content.h2.add.city-name` — H2 added that mentions a city name.
**Count:** 5

**Examples:**
- `cl-real-13` · 2026-03-02 · /explore-projects/riverside-way · _changelog_ — Added final CTA section with H2 'Request a Private Consultation' and global form embed (Riverside Way) Cupertino Custom Home Builder
- `cl-real-54` · 2026-03-10 · /luxury-home-builder-bay-area · _changelog_ — Added 'Bay Area Sub-Markets' H2 section with 7 market cards (Atherton, Palo Alto, Los Altos/Hills, Hillsborough, Saratoga, Los Gatos/Monte Sereno, Marin) (Luxury Home Builder Bay Area) Luxury Home Bui
- `cl-real-74` · 2026-03-11 · /locations/atherton · _changelog_ — Added 'Why Building in Atherton Is So Difficult' H2 section covering one-acre zoning, FAR limits, heritage tree protections, and design review (Atherton) Atherton Custom Home Builder
- _…and 2 more._

### 20. `ops.unexpected-change` — Scanner flagged a change without a matching changelog entry.
**Count:** 5

**Examples:**
- `unexpected_change-/locations/palo-alto-obs-1776441635904` · 2026-04-17 · https://ritzbuilders.com/locations/palo-alto · _finding:unexpected_change_ — Unexpected changes on /locations/palo-alto — no matching changelog entry · now: Changes detected but no matching changelog entry
- `unexpected_change-/explore-projects/riverside-way-obs-1776441635904` · 2026-04-17 · https://ritzbuilders.com/explore-projects/riverside-way · _finding:unexpected_change_ — Unexpected changes on /explore-projects/riverside-way — no matching changelog entry · now: Changes detected but no matching changelog entry
- `unexpected_change-/our-process-obs-1776451686288` · 2026-04-17 · https://ritzbuilders.com/our-process · _finding:unexpected_change_ — Unexpected changes on /our-process — no matching changelog entry · now: Changes detected but no matching changelog entry
- _…and 2 more._

### 21. `structure.page.add.location` — New city / location page created.
**Count:** 4

**Examples:**
- `cl-real-14` · 2026-03-04 · /locations/saratoga · _changelog_ — Created new city page at /locations/saratoga with full multi-section layout (9 content sections) (Saratoga) Custom Home Builder Saratoga
- `cl-real-67` · 2026-03-11 · /locations/atherton · _changelog_ — Created new city page at /locations/atherton with full 11-section layout (Atherton) Atherton Custom Home Builder
- `cl-real-87` · 2026-03-12 · /locations/palo-alto · _changelog_ — Created new city page at /locations/palo-alto with full multi-section layout (Palo Alto) Palo Alto Custom Home Builder
- _…and 1 more._

### 22. `content.section.add.neighborhoods` — Neighborhoods / micro-markets section added (city-specific area descriptions).
**Count:** 4

**Examples:**
- `cl-real-28` · 2026-03-04 · /locations/saratoga · _changelog_ — Added Section 6 Neighborhoods with 5 Saratoga neighborhood descriptions (Golden Triangle, Quito Hills/Parker Ranch, Saratoga Village, West Saratoga/Foothill) (Saratoga) Custom Home Builder Saratoga
- `cl-real-79` · 2026-03-11 · /locations/atherton · _changelog_ — Added Atherton Micro-Markets section with 4 neighborhood descriptions (West Atherton, Lindenwood, Menlo Circus Club, Atherton Avenue Corridor) (Atherton) Atherton Custom Home Builder
- `cl-real-96` · 2026-03-12 · /locations/palo-alto · _changelog_ — Added Neighborhoods section with 6 descriptions (Old PA, Professorville, Midtown, Crescent Park, Barron Park, Downtown North) (Palo Alto) Palo Alto Custom Home Builder
- _…and 1 more._

### 23. `link-graph.internal.add` — Internal link added to a page.
**Count:** 4

**Examples:**
- `cl-real-50` · 2026-03-10 · /luxury-home-builder-bay-area · _changelog_ — Added internal link to /our-difference with anchor text 'what makes Ritz different' (Luxury Home Builder Bay Area) Luxury Home Builder Bay Area
- `cl-real-52` · 2026-03-10 · /luxury-home-builder-bay-area · _changelog_ — Added internal links within Ritz blurb to /explore-projects and /about-us and 'Ritz Builders' to /contact-us (Luxury Home Builder Bay Area) Luxury Home Builder Bay Area
- `cl-real-65` · 2026-03-10 · /about-us · _changelog_ — Added internal link from /about-us body copy pointing to /luxury-home-builder-bay-area (About Us) Luxury Home Builder Bay Area
- _…and 1 more._

### 24. `schema.other.add` — Other structured-data type added (catch-all for typed schema; also matches 'JSON-LD schema' text when structured field is empty).
**Count:** 4

**Examples:**
- `cl-real-63` · 2026-03-10 · /luxury-home-builder-bay-area · _changelog_ — Added Article + Service + FAQPage + BreadcrumbList JSON-LD schemas (Luxury Home Builder Bay Area) Luxury Home Builder Bay Area
- `cl-real-135` · 2026-03-14 · /explore-projects/louis-road-palo-alto · _changelog_ — Added VideoObject + FAQPage + BreadcrumbList + ImageGallery JSON-LD schemas (Louis Road Palo Alto) Palo Alto Custom Home Builder
- `cl-real-139` · 2026-03-18 · /services · _changelog_ — Added 5-question FAQ with FAQPage JSON-LD schema (Services) Design Build Firm Bay Area
- _…and 1 more._

### 25. `content.section.add.cost` — Cost / pricing / $per-sqft section added.
**Count:** 4

**Examples:**
- `cl-real-73` · 2026-03-11 · /locations/atherton · _changelog_ — Added Quick Facts section with 5 data points (1-acre min lot, 18% FAR, $600-1200+/sqft cost, design review, 6K-12K sqft estate size) (Atherton) Atherton Custom Home Builder
- `cl-real-80` · 2026-03-11 · /locations/atherton · _changelog_ — Added Custom Home Cost section with $600-1200+/sqft data and soft cost percentages (Atherton) Atherton Custom Home Builder
- `cl-real-97` · 2026-03-12 · /locations/palo-alto · _changelog_ — Added Cost section with $600-1200+/sqft data (Palo Alto) Palo Alto Custom Home Builder
- _…and 1 more._

### 26. `schema.single-family-residence.add` — SingleFamilyResidence JSON-LD (listing schema for available homes) added.
**Count:** 4

**Examples:**
- `cl-real-103` · 2026-03-13 · /available-homes/princeton-residence-menlo-park · _changelog_ — Added SingleFamilyResidence JSON-LD schema with address, bedrooms, bathrooms, floor size, and Offer ($9,995,000) (Princeton Residence Menlo Park) Luxury Home Builder Bay Area
- `cl-real-109` · 2026-03-13 · /available-homes/kiner-residence-willow-glen · _changelog_ — Added SingleFamilyResidence JSON-LD schema with address, bedrooms, bathrooms, stories, floor size, and Offer ($3,995,000) (Kiner Residence Willow Glen) Luxury Home Builder Bay Area
- `schema_missing_for_page_type-/available-homes/kiner-residence-willow-glen-obs-1776707470145` · 2026-04-20 · https://ritzbuilders.com/available-homes/kiner-residence-willow-glen · _finding:schema_missing_for_page_type_ — /available-homes/kiner-residence-willow-glen: project page is missing 2 required schema types — Article, BreadcrumbList · was: schema_types: [FAQPage, SingleFamilyResidence] · now: missing_required: [
- _…and 1 more._

### 27. `metadata.robots.modify` — robots.txt or meta-robots modified.
**Count:** 3

**Examples:**
- `cl-real-19` · 2026-03-04 · /locations/saratoga · _changelog_ — Set robots to index,follow on Saratoga page (Saratoga) Custom Home Builder Saratoga
- `cl-real-70` · 2026-03-11 · /locations/atherton · _changelog_ — Set Open Graph tags and robots index,follow on Atherton page (Atherton) Atherton Custom Home Builder
- `cl-real-232` · 2026-04-05 · (site-wide) · _changelog_ — Reviewed robots.txt, server logs, and server settings to ensure AI crawlers are not blocked or rate-limited (Bot Access Check) Custom Home Builder Bay Area

### 28. `content.section.add.service-area` — Service-area grid / cities-served list added.
**Count:** 3

**Examples:**
- `cl-real-55` · 2026-03-10 · /luxury-home-builder-bay-area · _changelog_ — Added service-area grid with 28+ city names in 2-3 columns (Luxury Home Builder Bay Area) Luxury Home Builder Bay Area
- `cl-33-2026-03-13` · 2026-03-13 · Homepage + Bay Area pages · _changelog_ — Converted the Cities Served table into a reusable global component for future multi-page deployment and centralized link management. (Cities Served table) Custom Home Builder Bay Area
- `cl-34-2026-03-13` · 2026-03-13 · Homepage + Bay Area pages · _changelog_ — Published revised city list for the reusable Cities Served component while retaining active hyperlinks for cities that remained live. (Cities Served city list revision) Custom Home Builder Bay Area

### 29. `content.section.add.trust-strip` — Trust strip / credibility markers section added.
**Count:** 2

**Examples:**
- `cl-real-9` · 2026-03-02 · /explore-projects/riverside-way · _changelog_ — Added proof strip section with imported award logos and project specifications (Type: New Construction / Style: Modern Contemporary / 3,494 SF / 7,770 SF lot / 4 bed 1 office 4.5 bath) (Riverside Way)
- `cl-real-48` · 2026-03-10 · /luxury-home-builder-bay-area · _changelog_ — Added trust strip section with 6 credibility markers (award-winning, architect-led, Bay Area focus, custom homes, feasibility-first, consultation) (Luxury Home Builder Bay Area) Luxury Home Builder Ba

### 30. `content.h2.add` — H2 added (generic).
**Count:** 2

**Examples:**
- `cl-real-51` · 2026-03-10 · /luxury-home-builder-bay-area · _changelog_ — Added 'Top-Rated Luxury Home Builders in Bay Area for 2026' H2 section with 5-builder comparison table (Ritz, De Mattei, Craftsmen's Guild, Kasten, ICB) and blurbs (Luxury Home Builder Bay Area) Luxur
- `cl-real-56` · 2026-03-10 · /luxury-home-builder-bay-area · _changelog_ — Added 'Cost & Timeline Considerations' H2 section with cost factors list and project timeline phases (Luxury Home Builder Bay Area) Luxury Home Builder Bay Area

### 31. `content.section.add.adu` — ADU / accessory dwelling section added.
**Count:** 2

**Examples:**
- `cl-real-78` · 2026-03-11 · /locations/atherton · _changelog_ — Added ADUs and Guest Houses section with 3 feature blocks (topographic placement, natural integration, finish quality) (Atherton) Atherton Custom Home Builder
- `cl-real-95` · 2026-03-12 · /locations/palo-alto · _changelog_ — Added ADU section with 3 feature blocks (Palo Alto) Palo Alto Custom Home Builder

### 32. `structure.page.add.available-home` — New available-home listing page created.
**Count:** 2

**Examples:**
- `cl-real-100` · 2026-03-13 · /available-homes/princeton-residence-menlo-park · _changelog_ — Created new available home page for Princeton Residence at /available-homes/princeton-residence-menlo-park (Princeton Residence Menlo Park) Luxury Home Builder Bay Area
- `cl-real-106` · 2026-03-13 · /available-homes/kiner-residence-willow-glen · _changelog_ — Created new available home page for Kiner Residence at /available-homes/kiner-residence-willow-glen (Kiner Residence Willow Glen) Luxury Home Builder Bay Area

### 33. `structure.redirect.add` — 301 / 302 redirect added between URLs.
**Count:** 2

**Examples:**
- `cl-real-104` · 2026-03-13 · /details/2 · _changelog_ — Implemented permanent 301 redirect from /details/2 to /available-homes/princeton-residence-menlo-park (2) Luxury Home Builder Bay Area
- `cl-real-110` · 2026-03-13 · /details/1 · _changelog_ — Implemented permanent 301 redirect from /details/1 to /available-homes/kiner-residence-willow-glen (1) Luxury Home Builder Bay Area

### 34. `structure.header.modify` — Global header / top nav modified.
**Count:** 2

**Examples:**
- `cl-real-184` · 2026-04-02 · (site-wide) · _changelog_ — Removed FAQ, Ritzom, and Privacy & Terms from navigation menu (Apr 02 Batch) Custom Home Builder Bay Area
- `cl-73-2026-04-02` · 2026-04-02 · Sitewide navigation · _changelog_ — Reordered the main navigation to the updated priority sequence and removed FAQ, Ritzom, and Privacy & Terms from the navigation menu. (Main navigation reorder and cleanup) Custom Home Builder Bay Area

### 35. `schema.breadcrumb.add` — BreadcrumbList JSON-LD added.
**Count:** 2

**Examples:**
- `cl-mo36nr20crq6w8` · 2026-04-17 · https://ritzbuilders.com/explore-projects/riverside-way · _changelog_ — Schema changed: FAQPage → Article, BreadcrumbList, FAQPage (/explore-projects/riverside-way)
- `cl-mo36nzsjee1rrp` · 2026-04-17 · https://ritzbuilders.com/locations/palo-alto · _changelog_ — Schema changed: FAQPage → BreadcrumbList, FAQPage, HomeAndConstructionBusiness, WebPage (/locations/palo-alto)

### 36. `structure.page.add.project` — New project / portfolio page created.
**Count:** 1

**Examples:**
- `cl-real-3` · 2026-03-02 · /explore-projects/riverside-way · _changelog_ — Created new project page at /explore-projects/riverside-way for Riverside Way Cupertino project (Riverside Way) Cupertino Custom Home Builder

### 37. `content.h1.modify.city-service` — H1 modified; new H1 includes a city + service combo.
**Count:** 1

**Examples:**
- `cl-real-6` · 2026-03-02 · /explore-projects/riverside-way · _changelog_ — Set H1 to 'Riverside Way - Cupertino New Home Construction' (Riverside Way) Cupertino Custom Home Builder

### 38. `content.section.add.description-block` — Narrative description / project copy block added.
**Count:** 1

**Examples:**
- `cl-real-10` · 2026-03-02 · /explore-projects/riverside-way · _changelog_ — Added description block section with Riverside Way project narrative copy (Riverside Way) Cupertino Custom Home Builder

### 39. `structure.route.ensure` — Parent route ensured to return 200 (sitemap / routing hygiene).
**Count:** 1

**Examples:**
- `cl-real-15` · 2026-03-04 · /locations/ · _changelog_ — Ensured /locations/ parent route exists and returns 200 status (/locations/) Custom Home Builder Bay Area

### 40. `metadata.open-graph.modify` — Open Graph meta tags (og:title, og:description, og:image, og:url, og:type) set or modified.
**Count:** 1

**Examples:**
- `cl-real-18` · 2026-03-04 · /locations/saratoga · _changelog_ — Set Open Graph tags (og:title, og:description, og:type, og:url) on Saratoga page (Saratoga) Custom Home Builder Saratoga

### 41. `structure.page.add.landing` — New standalone landing / comparison page created.
**Count:** 1

**Examples:**
- `cl-real-42` · 2026-03-10 · /luxury-home-builder-bay-area · _changelog_ — Created new standalone landing page at /luxury-home-builder-bay-area (Luxury Home Builder Bay Area) Luxury Home Builder Bay Area

### 42. `content.testimonial.add` — Customer testimonial / quote block added.
**Count:** 1

**Examples:**
- `cl-real-60` · 2026-03-10 · /luxury-home-builder-bay-area · _changelog_ — Added client/partner testimonials slider with 3 anonymized testimonials before CTA section (Luxury Home Builder Bay Area) Luxury Home Builder Bay Area

### 43. `content.section.add.comparison` — Comparison / builder-vs-builder section added.
**Count:** 1

**Examples:**
- `cl-real-86` · 2026-03-12 · /locations/menlo-park · _changelog_ — Added individual builder blurb descriptions for all 5 builders in the Menlo Park comparison section (Menlo Park) Menlo Park Custom Home Builder

### 44. `content.body.rewrite` — Body copy substantially rewritten.
**Count:** 1

**Examples:**
- `cl-real-179` · 2026-04-01 · /our-process · _changelog_ — Reconstructed /our-process page with updated metadata, rewritten hero/section copy, architect-led comparison section, replaced process content, updated FAQs and schema (Our Process) Design Build Firm 

### 45. `media.alt-text.add` — Alt text added to images.
**Count:** 1

**Examples:**
- `cl-43-2026-03-17` · 2026-03-17 · /locations/cupertino-custom-home-builder · _changelog_ — Built and published the Cupertino custom home builder page with the specified H-tag hierarchy, entity-first copy, image mapping, alt text, comparison table, and internal links. (Cupertino city page) C

### 46. `schema.howto.add` — HowTo JSON-LD added.
**Count:** 1

**Examples:**
- `cl-mo379g359dd298` · 2026-04-17 · https://ritzbuilders.com/our-process · _changelog_ — Schema changed: FAQPage → FAQPage, HowTo (/our-process)

### 47. `ops.guardrail.new` — Scanner flagged a new guardrail condition.
**Count:** 1

**Examples:**
- `new_guardrail-/locations/palo-alto-obs-1776452862023` · 2026-04-17 · https://ritzbuilders.com/locations/palo-alto · _finding:new_guardrail_ — New issue on /locations/palo-alto: Content changed · now: info: Content changed

## UNCLASSIFIED (98 events)

These did not match any heuristic rule. Most common reasons:

- Vague description ("updated page", "copy refresh") — needs either a new bucket or rejection as noise.
- Edit type the heuristic doesn't know about yet — propose a new bucket id.
- Non-change event (measurement, notes, pure-metric row) — mark `NOT A CHANGE`.

- `cl-real-41` · 2026-03-09 · (site-wide) · _changelog_ — Normalized FAQ answer styling across all city pages to match the strongest existing FAQ answer pattern (Faq Sitewide Batch) Custom Home Builder Bay Area
- `cl-real-113` · 2026-03-13 · /locations/saratoga · _changelog_ — Added individual builder blurb descriptions for all 5 Saratoga comparison builders (Saratoga) Custom Home Builder Saratoga
- `cl-real-115` · 2026-03-13 · /locations/los-altos · _changelog_ — Added individual builder blurb descriptions for all 5 Los Altos comparison builders (Los Altos) Los Altos Custom Home Builder
- `cl-real-131` · 2026-03-14 · /explore-projects · _changelog_ — Added Austin Avenue as 2nd active card on /explore-projects grid (Explore Projects) Los Altos Custom Home Builder
- `cl-real-132` · 2026-03-14 · /explore-projects · _changelog_ — Updated Riverside Way card title to include 'in Cupertino' (Explore Projects) Cupertino Custom Home Builder
- `cl-real-136` · 2026-03-14 · /explore-projects · _changelog_ — Added Louis Road as 3rd active card on /explore-projects grid (Explore Projects) Palo Alto Custom Home Builder
- `cl-real-146` · 2026-03-18 · /explore-projects · _changelog_ — Restructured /explore-projects: moved project list below hero, removed placeholders, moved brand copy to bottom, made images clickable (Explore Projects) Luxury Home Builder Bay Area
- `cl-real-147` · 2026-03-18 · /explore-projects · _changelog_ — Added Princeton and Kiner project cards on /explore-projects with titles, descriptions, and links (Explore Projects) Luxury Home Builder Bay Area
- `cl-real-148` · 2026-03-19 · /custom-home-builder-bay-area · _changelog_ — Created new Custom Home Builder Guide page at /custom-home-builder-bay-area (Custom Home Builder Bay Area) Custom Home Builder Bay Area
- `cl-real-158` · 2026-03-19 · /explore-projects · _changelog_ — Replaced blurry Princeton and Kiner preview images with higher-resolution versions (Explore Projects) Luxury Home Builder Bay Area
- `cl-real-159` · 2026-03-19 · /explore-projects · _changelog_ — Reordered live project cards to requested sequence (Explore Projects) Luxury Home Builder Bay Area
- `cl-real-160` · 2026-03-19 · /services · _changelog_ — Adjusted /services hero image positioning so home is centered instead of sky on desktop (Services) Design Build Firm Bay Area
- `cl-real-162` · 2026-03-23 · /services/teardown-rebuild · _changelog_ — Created new Teardown & Rebuild service page at /services/teardown-rebuild (Teardown Rebuild) Custom Home Builder Bay Area
- `cl-real-163` · 2026-03-23 · /services · _changelog_ — Updated placeholder links on /services to route to newly published teardown-rebuild and whole-home-remodel pages (Services) Design Build Firm Bay Area
- `cl-real-164` · 2026-03-24 · /services/home-additions · _changelog_ — Created new Major Home Additions & Expansions service page (Home Additions) Custom Home Builder Bay Area
- `cl-real-165` · 2026-03-25 · (site-wide) · _changelog_ — Published structural, on-page, and SEO/AEO optimization updates across existing priority city and service pages (Mar 25 Optimizations) Custom Home Builder Bay Area
- `cl-real-166` · 2026-03-26 · /luxury-home-builder-bay-area · _changelog_ — Updated meta title on luxury home builder Bay Area guide page (Luxury Home Builder Bay Area) Luxury Home Builder Bay Area
- `cl-real-168` · 2026-03-30 · (site-wide) · _changelog_ — Implemented full SSG/prerendering for all public pages so visible content is present in initial HTML before JS hydration (Html Prerender) Custom Home Builder Bay Area
- `cl-real-170` · 2026-03-30 · facebook.com · _changelog_ — Updated Facebook bio to entity-based description of Ritz Builders as Cupertino-based luxury custom home builder (facebook.com) Custom Home Builder Bay Area
- `cl-real-171` · 2026-03-31 · / · _changelog_ — Updated homepage title tag (/) Custom Home Builder Bay Area
- `cl-real-172` · 2026-03-31 · / · _changelog_ — Revised hero H1 on homepage (/) Custom Home Builder Bay Area
- `cl-real-174` · 2026-03-31 · / · _changelog_ — Replaced portfolio block on homepage (/) Custom Home Builder Bay Area
- `cl-real-175` · 2026-03-31 · / · _changelog_ — Replaced 'Why Ritz Builders' section on homepage (/) Custom Home Builder Bay Area
- `cl-real-176` · 2026-03-31 · / · _changelog_ — Updated FAQs on homepage (/) Custom Home Builder Bay Area
- `cl-real-177` · 2026-03-31 · / · _changelog_ — Implemented FAQPage JSON-LD on homepage (/) Custom Home Builder Bay Area
- `cl-real-178` · 2026-03-31 · / · _changelog_ — Implemented HomeAndConstructionBusiness JSON-LD on homepage (/) Custom Home Builder Bay Area
- `cl-real-180` · 2026-04-02 · /llms.txt · _changelog_ — Published static llms.txt file at root providing machine-readable firm summary for Answer Engines (Llms.Txt) Custom Home Builder Bay Area
- `cl-real-181` · 2026-04-02 · /our-difference · _changelog_ — Applied content and structure edits to /our-difference page (Our Difference) Design Build Firm Bay Area
- `cl-real-182` · 2026-04-02 · /services · _changelog_ — Applied content and structure edits to /services page (Services) Design Build Firm Bay Area
- `cl-real-183` · 2026-04-02 · (site-wide) · _changelog_ — Reordered main navigation to updated priority sequence (Apr 02 Batch) Custom Home Builder Bay Area
- `cl-real-185` · 2026-04-02 · (site-wide) · _changelog_ — Deployed Profound production-log integration update shifting to real live production request/access logs including bot traffic (Profound Update) Custom Home Builder Bay Area
- `cl-real-188` · 2026-04-03 · (site-wide) · _changelog_ — Removed localhost/dev references from production page source, Facebook tracking scripts, metadata, and schema (Apr 03 Technical) Custom Home Builder Bay Area
- `cl-real-190` · 2026-04-03 · bing-places · _changelog_ — Created and synced new Bing Places for Business profile from Google Business Profile (bing-places) Custom Home Builder Bay Area
- `cl-real-191` · 2026-04-03 · pinterest.com · _changelog_ — Renamed, optimized, and mapped 45 Riverside Way images using entity-aligned file naming for visual AEO (pinterest.com) Cupertino Custom Home Builder
- `cl-real-192` · 2026-04-06 · /custom-home-builder-bay-area/ · _changelog_ — Updated metadata with AEO-optimized FAQPage and Review schema (/custom-home-builder-bay-area/) Custom Home Builder Bay Area
- `cl-real-193` · 2026-04-06 · /custom-home-builder-bay-area/ · _changelog_ — Revised Hero H1 and subtitle (/custom-home-builder-bay-area/) Custom Home Builder Bay Area
- `cl-real-198` · 2026-04-07 · /locations/ · _changelog_ — Added featured project grid to Locations Hub (/locations/) Custom Home Builder Locations
- `cl-real-199` · 2026-04-07 · /locations/ · _changelog_ — Added ProfessionalService and Breadcrumb JSON-LD to Locations Hub (/locations/) Custom Home Builder Locations
- `cl-real-200` · 2026-04-07 · /locations/menlo-park/ · _changelog_ — Complete page reconstruction with updated AEO metadata/schema (/locations/menlo-park/) Menlo Park Custom Home Builder
- `cl-real-201` · 2026-04-07 · /locations/menlo-park/ · _changelog_ — Added new 'Right-Fit' grid (/locations/menlo-park/) Menlo Park Custom Home Builder
- `cl-real-205` · 2026-04-07 · /locations/menlo-park/ · _changelog_ — Replaced previous 11-question FAQ with 6 AEO-optimized questions (/locations/menlo-park/) Menlo Park Custom Home Builder
- `cl-real-206` · 2026-03-05 · profound · _changelog_ — Implemented initial Profound custom-log analytics integration with backend-only log delivery, secure API key, and batching (profound) Custom Home Builder Bay Area
- `cl-real-208` · 2026-03-06 · buildzoom.com · _changelog_ — Corrected legacy BuildZoom profile with updated website, description, service areas, cost range, founder, gallery, social links (buildzoom.com) Custom Home Builder Bay Area
- `cl-real-209` · 2026-03-06 · google-business-profile · _changelog_ — Published 5-star partner review from Julia Bullock mentioning custom homes, rebuilds, Peninsula/Los Gatos (google-business-profile) Custom Home Builder Bay Area
- `cl-real-210` · 2026-03-06 · google-business-profile · _changelog_ — Published 5-star partner review from Huili Liao mentioning luxury custom homes, rebuilds, Menlo Park/Palo Alto/Los Altos/Cupertino (google-business-profile) Custom Home Builder Bay Area
- `cl-real-211` · 2026-03-07 · google-business-profile · _changelog_ — Published review response to Julia Bullock Google review (google-business-profile) Custom Home Builder Bay Area
- `cl-real-212` · 2026-03-07 · google-business-profile · _changelog_ — Published review response to Huili Liao Google review (google-business-profile) Custom Home Builder Bay Area
- `cl-real-213` · 2026-03-07 · yelp.com · _changelog_ — Claimed and completed Yelp business page with categories, specialties, service area, hours, business info, project photos (yelp.com) Custom Home Builder Bay Area
- `cl-real-216` · 2026-03-11 · (site-wide) · _changelog_ — Confirmed successful test lead submission and HubSpot field mapping for updated contact form (Lead Form Overhaul) Custom Home Builder Bay Area
- `cl-real-217` · 2026-04-10 · (site-wide) · _changelog_ — Delayed HubSpot script from critical rendering path on initial page load (Performance Batch) Custom Home Builder Bay Area
- `cl-real-218` · 2026-04-10 · (site-wide) · _changelog_ — Reduced/delayed GTM impact where safely possible (Performance Batch) Custom Home Builder Bay Area
- `cl-real-221` · 2026-04-10 · (site-wide) · _changelog_ — Preloaded/prioritized main hero LCP image where appropriate sitewide (Performance Batch) Custom Home Builder Bay Area
- `cl-real-223` · 2026-04-11 · (site-wide) · _changelog_ — Completed sitewide PageSpeed/Lighthouse optimization targeting LCP<4s, TBT<300ms, CLS<0.1 (Pagespeed Optimization) Custom Home Builder Bay Area
- `cl-real-224` · 2026-04-12 · /locations/menlo-park/ · _changelog_ — Removed duplicate FAQPage JSON-LD block, kept single FAQPage with 6 questions (/locations/menlo-park/) Menlo Park Custom Home Builder
- `cl-real-225` · 2026-04-12 · / · _changelog_ — Consolidated homepage FAQ schema into single FAQPage JSON-LD block, removed overlapping extra block (/) Custom Home Builder Bay Area
- `cl-real-226` · 2026-04-12 · /locations/cupertino-custom-home-builder/ · _changelog_ — Removed extra split FAQ schema blocks, kept single 20-question FAQPage (/locations/cupertino-custom-home-builder/) Cupertino Custom Home Builder
- `cl-real-227` · 2026-04-14 · /our-difference · _changelog_ — Removed duplicate FAQPage JSON-LD, consolidated into single block (Our Difference) Design Build Firm Bay Area
- `cl-real-228` · 2026-04-14 · /explore-projects/austin-avenue-los-altos · _changelog_ — Removed duplicate FAQPage JSON-LD, consolidated into single block (Austin Avenue Los Altos) Los Altos Custom Home Builder
- `cl-real-229` · 2026-04-14 · /explore-projects/louis-road-palo-alto · _changelog_ — Removed duplicate FAQPage JSON-LD, consolidated into single block (Louis Road Palo Alto) Palo Alto Custom Home Builder
- `cl-real-230` · 2026-04-14 · /custom-home-builder-bay-area/ · _changelog_ — Removed duplicate FAQPage JSON-LD, consolidated into single block (/custom-home-builder-bay-area/) Custom Home Builder Bay Area
- `cl-real-231` · 2026-04-14 · /luxury-home-builder-bay-area/ · _changelog_ — Removed duplicate FAQPage JSON-LD, consolidated into single block (/luxury-home-builder-bay-area/) Luxury Home Builder Bay Area
- `cl-1-2026-03-05` · 2026-03-05 · Profound · _changelog_ — Captured first clean baseline across 100 prompts / 300 exported answers before any public AEO changes. (Official baseline snapshot) Custom Home Builder Bay Area
- `cl-2-2026-03-06` · 2026-03-06 · /locations/menlo-park · _changelog_ — Published FAQ block plus heading and description updates in HTML. Crawlable in GSC inspection. (Menlo Park city page) Menlo Park
- `cl-3-2026-03-06` · 2026-03-06 · /locations/los-altos · _changelog_ — Published FAQ block plus heading and description updates in HTML. Crawlable in GSC inspection. (Los Altos city page) Los Altos
- `cl-5-2026-03-06` · 2026-03-06 · Google Business Profile · _changelog_ — Published new 5-star partner / realtor review mentioning high-end custom homes, rebuilds, and Peninsula / Los Gatos service areas. (Julia Bullock review) Custom Home Builder Bay Area
- `cl-7-2026-03-06` · 2026-03-06 · Google Business Profile · _changelog_ — Published new 5-star partner / realtor review mentioning luxury custom homes, major rebuilds, architect-driven work, Marisa, and Menlo Park / Palo Alto / Los Altos / Cupertino. (Huili Liao review) Cus
- `cl-8-2026-03-07` · 2026-03-07 · Profound · _changelog_ — Captured 218 exported answers after the first live changes. (Post-change snapshot) Custom Home Builder Bay Area
- `cl-9-2026-03-07` · 2026-03-07 · Google Business Profile · _changelog_ — Published review response to the Julia Bullock Google review. (Julia Bullock review response) Custom Home Builder Bay Area
- `cl-10-2026-03-07` · 2026-03-07 · Google Business Profile · _changelog_ — Published review response to the Huili Liao Google review. (Huili Liao review response) Custom Home Builder Bay Area
- `cl-11-2026-03-07` · 2026-03-07 · Yelp · _changelog_ — Claimed and completed Yelp business page with categories, specialties, service area, hours, business info, and project photos. (Ritz Builders Yelp page) Custom Home Builder Bay Area
- `cl-13-2026-03-08` · 2026-03-08 · /design-studio · _changelog_ — Published FAQ block plus heading and description updates in HTML. Crawlable in GSC inspection. (Design Studio) Design Build Firm Bay Area
- `cl-14-2026-03-08` · 2026-03-08 · /our-process · _changelog_ — Published FAQ block plus heading and description updates in HTML. Crawlable in GSC inspection. (Our Process) Design Build Firm Bay Area
- `cl-21-2026-03-11` · 2026-03-11 · Sitewide contact form · _changelog_ — Confirmed successful test lead submission and HubSpot field mapping for the updated sitewide contact form prior to live deployment. (HubSpot mapping confirmation) Custom Home Builder Bay Area
- `cl-22-2026-03-12` · 2026-03-12 · /palo-alto · _changelog_ — Published new Palo Alto city page. (Palo Alto city page) Palo Alto
- `cl-24-2026-03-12` · 2026-03-12 · / · _changelog_ — Published homepage FAQ updates from the March 12 batch. (Homepage FAQs) Custom Home Builder Bay Area
- `cl-31-2026-03-13` · 2026-03-13 · /available-homes/kiner-residence-willow-glen · _changelog_ — Published Kiner FAQ section below Schedule a Visit and above the global contact form on the Kiner available homes page. (Kiner Residence FAQs) Luxury Home Builder Bay Are
- `cl-35-2026-03-13` · 2026-03-13 · /locations/atherton · _changelog_ — Updated the Atherton page subheading beneath the H1 to focus on one-acre zoning, FAR limits, heritage tree protections, design review approvals, and Ritz Builders' architect-led in-house model. (Ather
- `cl-39-2026-03-17` · 2026-03-17 · /explore-projects · _changelog_ — Updated the Riverside project card title on the explore-projects parent grid to explicitly say 'in Cupertino' inside the card only. (Riverside project card) Cupertino
- `cl-40-2026-03-17` · 2026-03-17 · /explore-projects/austin-avenue-los-altos · _changelog_ — Built and published the Austin Avenue project page and added it as the second active project card on /explore-projects. (Austin Avenue Residence) Los Altos
- `cl-41-2026-03-17` · 2026-03-17 · /explore-projects/louis-road-palo-alto · _changelog_ — Built and published the Louis Road project page and added it as the third active project card on /explore-projects. (Louis Road Residence) Palo Alto
- `cl-42-2026-03-17` · 2026-03-17 · /explore-projects/louis-road-palo-alto · _changelog_ — Implemented the Louis Road page with the required video schema support including the metadata needed for validation. (Louis Road video schema) Palo Alto
- `cl-44-2026-03-17` · 2026-03-17 · /locations/cupertino-custom-home-builder · _changelog_ — Published the 20-question Cupertino FAQ section in HTML and implemented FAQPage JSON-LD with a two-column desktop layout. (Cupertino city page FAQs) Cupertino
- `cl-48-2026-03-18` · 2026-03-18 · /services/architect-provided-plans · _changelog_ — Built and published the new Architect-Provided Plans service page. (Architect-Provided Plans page) Already have Plans Bay Area
- `cl-51-2026-03-18` · 2026-03-18 · /explore-projects · _changelog_ — Added and published the Princeton and Kiner project cards on /explore-projects with the requested titles, descriptions, and links. (Princeton and Kiner project cards) Luxury Home Builder Bay Are
- `cl-54-2026-03-19` · 2026-03-19 · Under /services · _changelog_ — Built and published the new Design-Build child page under /services. (Design-Build service page) Design Build Firm Bay Area
- `cl-55-2026-03-19` · 2026-03-19 · /services · _changelog_ — Adjusted the /services hero image positioning on desktop so the home is centered correctly rather than the sky. (Services hub hero focal point fix) Design Build Firm Bay Area
- `cl-56-2026-03-19` · 2026-03-19 · /explore-projects · _changelog_ — Replaced blurry Princeton and Kiner preview images with higher-resolution versions and reordered the live projects to the requested sequence. (Project gallery image replacements and reorder) Luxury Ho
- `cl-62-2026-03-23` · 2026-03-23 · /services/whole-home-remodel · _changelog_ — Built and published a new Whole-Home Remodel service page to expand coverage for major renovation and full-home transformation intent. (Whole-Home Remodel service page) Design Build Firm Bay Area
- `cl-64-2026-03-24` · 2026-03-24 · Profound · _changelog_ — Implemented a revised Profound custom-log integration using centralized sitewide tracking triggers, backend queueing, updated payload handling, and batched delivery to Profound at regular intervals. (
- `cl-65-2026-03-25` · 2026-03-25 · Priority live pages · _changelog_ — Published targeted structural, on-page, and SEO/AEO optimization updates across existing priority pages, including title and meta refinement for the Bay Area luxury home builder page. (March 24 optimi
- `cl-67-2026-03-30` · 2026-03-30 · All Pages · _changelog_ — Verified that core priority pages were now serving meaningful crawlable HTML on live fetch, including the homepage, services hub, Design-Build, Build on Your Lot, Architect-Provided Plans, Major Home 
- `cl-68-2026-03-30` · 2026-03-30 · Facebook page · _changelog_ — Updated the Facebook bio to be more entity-based and clearer around Ritz Builders as a Cupertino-based luxury custom home builder and architect-led design-build firm serving Silicon Valley and the Bay
- `cl-72-2026-04-02` · 2026-04-02 · Profound · _changelog_ — Deployed another Profound integration update intended to shift tracking toward real live production request/access logs and continuous log delivery from the live request pipeline. (Profound production
- `cl-76-2026-04-03` · 2026-04-03 · All Pages · _changelog_ — Removed localhost/dev references from production page source, Facebook tracking scripts, metadata, and schema. (Localhost Leakage Cleanup) Custom Home Builder Bay Area
- `cl-77-2026-04-03` · 2026-04-03 · /services · _changelog_ — Applied content and structure edits based on the 04:02:26-OurServicesPageEdits.pdf file. (Our Services Page Edits) Design Build Firm Bay Area
- `cl-79-2026-04-03` · 2026-04-03 · /llms.txt · _changelog_ — Published a static llms.txt file at the root directory based on the provided PDF content. (llms.txt Implementation) Custom Home Builder Bay Area
- `cl-80-2026-04-03` · 2026-04-03 · Visual AEO Sprint - Riverside Way Images · _changelog_ — Cupertino Custom Home Builder (Renamed, optimized, and mapped 45 high-resolution architectural images for the Riverside Way flagship project using entity-aligned file naming frameworks to feed visual 
- `cl-82-2026-04-04` · 2026-04-04 · Bing Places · _changelog_ — Created and synced the new Bing Places for Business profile from the live Google Business Profile to expand Microsoft local entity coverage, keep business details aligned across Google and Bing, and s
