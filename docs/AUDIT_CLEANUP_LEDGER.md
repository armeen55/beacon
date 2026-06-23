# Casual-User Audit — Cleanup Ledger

Source: 923-finding casual-user ("Sara") audit (2026-06-22). 292 critical / 441 medium / 190 low.
Full medium/low list: /tmp/audit_report.txt (scratch). Critical list: in the session transcript.

Campaign = make Beacon understandable to a non-SEO business owner. Phases: (1) global plain-language
system, (2) metric-with-meaning, (3) trust language, (4) page-by-page critical, (5) action vocabulary,
(6) safety/help, (7) this ledger.

## Tally
- Total findings: 923 (292 critical)
- Fixed critical: ~30  (B1 wordmark/contrast; B2 Today hero #1-4/31-38; B3 Today plan #8/9/10/39 + opportunity action copy #135/136/move-2)
- Fixed medium/low (via global patterns): ongoing
- Remaining critical: ~262
- Deferred (with reason): 0

## Batches
- **B1 — Phase 1 foundation** (`src/lib/plain-language.ts`): canonical term map (CTR→click rate,
  impressions→times shown on Google, SERP→Google results page, schema/JSON-LD→Google-readable page
  info, Change Pack→suggested edits, answer block→short answer at the top, controls→similar pages we
  did not change, cannibalization→two pages competing, rage/dead clicks→frustrated clicks, etc.),
  METRIC_META (label + plain explain + good-direction for every number), TERM_GLOSSARY, BEACON_TAGLINE,
  NOTHING_GOES_LIVE_NOTE. Sidebar wordmark tagline fixed + contrast bumped. typecheck clean.

- **B2 — Today hero** (state-of-union.ts + section): plain headline/sublines, stats carry their own timeframe, section titles/empty-states plain. test updated.
- **B3 — Today plan + opportunity copy** (state-of-union-section PlanBlock + opportunity.ts): 'Change Pack ready'->'Draft ready'; SERP warning neutralized + gated so it no longer contradicts answer-block moves (#9); est line -> 'visits you could win back'; move-2 SERP paragraph + evidence line rewritten plain. tests updated.

- **B4 — Today all-source stat row** (build-source-stat-cards.ts + components): naked-number labels -> plain (Impressions->Times shown on Google, Avg. position->Average Google rank, Keywords ranked->Searches you rank for, Quick wins->Almost on page 1, Search volume->Monthly searches, Dead clicks->Clicks that did nothing, Conversions->Sign-ups or sales, AI platforms->AI tools checked) + 'clicks/visit'->'frustrated clicks per visit'. stat-card tests updated.

## Next
- B5: finish Today (AI-visibility hero, all-source stat row, do-today/working cards, daily-flow strip), then Recommendations (29 critical).
