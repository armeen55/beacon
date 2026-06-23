# Casual-User Audit — Cleanup Ledger

Source: 923-finding casual-user ("Sara") audit (2026-06-22). 292 critical / 441 medium / 190 low.
Full medium/low list: /tmp/audit_report.txt (scratch). Critical list: in the session transcript.

Campaign = make Beacon understandable to a non-SEO business owner. Phases: (1) global plain-language
system, (2) metric-with-meaning, (3) trust language, (4) page-by-page critical, (5) action vocabulary,
(6) safety/help, (7) this ledger.

## Tally
- Total findings: 923 (292 critical)
- Fixed critical: 3  (272/276/282 wordmark tagline + #290 sidebar contrast)
- Fixed medium/low (via global patterns): ongoing
- Remaining critical: 289
- Deferred (with reason): 0

## Batches
- **B1 — Phase 1 foundation** (`src/lib/plain-language.ts`): canonical term map (CTR→click rate,
  impressions→times shown on Google, SERP→Google results page, schema/JSON-LD→Google-readable page
  info, Change Pack→suggested edits, answer block→short answer at the top, controls→similar pages we
  did not change, cannibalization→two pages competing, rage/dead clicks→frustrated clicks, etc.),
  METRIC_META (label + plain explain + good-direction for every number), TERM_GLOSSARY, BEACON_TAGLINE,
  NOTHING_GOES_LIVE_NOTE. Sidebar wordmark tagline fixed + contrast bumped. typecheck clean.

## Next
- B2: Metric-with-meaning component + Today State-of-the-Union hero (worst page, 48 critical).
