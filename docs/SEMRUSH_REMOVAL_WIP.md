# SEMrush caller-first removal — WIP status (Phase F.1 Part 2) · 2026-06-27

> **State: INCOMPLETE — tree does NOT compile.** Part 1 (fast/full ActionPack mode) is
> committed + green on `claude/v1-core-consolidation` (41942d4f). This Part-2 SEMrush
> removal is a large refactor (`rg -i semrush src/` ≈ 831 mentions / ~60+ files) that
> exceeds one session; it is preserved here as a save-point. Approach:
> **delete the leaf files, then fix every consumer via `tsc --noEmit` until 0.**

## DONE (≈35 files)
- **Deleted (26):** `lib/connectors/semrush/*` (whole dir), `recommendation-intelligence/semrush-page-signals.ts`,
  `triggers/semrush-{striking-distance,cannibalization,keyword-gap}.ts`, `/diagnostics/semrush/{page,actions}`,
  + 8 test files for the above.
- **Edited (callers, SEMrush removed):** `load-trigger-candidates-for-tenant.ts` (3 triggers + PREDICATE_COUNT 17→14),
  `cron-sync.ts`, `settings/connectors/actions.ts` (save/disconnect/syncNow/cards/unions),
  `diagnostics/connectors/actions.ts`, `compute-opportunity-map.ts`, `evidence-summary.ts`
  (deleted `buildSemrushEvidenceLines`+`difficultyBand`), `recommendation-action-rows.ts`,
  `load-queue.ts` (live+persisted), `today-v2-data.ts`, `today-newpages-data.ts`,
  `build-source-stat-cards.ts`, `why-this-matters-narrative.ts`, `llm-why-narrative.ts`,
  `recommendation-qa.ts` (dropped `semrush` evidence family), `llm-expert-strategist.ts`,
  `topic-fit-from-evidence.ts`, `recommendation-detail-client.tsx`, `recommendation-v2-card.tsx`.

## REMAINING (the next session finishes this — `npx tsc --noEmit` is the guide)
1. **Page Surgeon wave (highest build-break risk):**
   - `page-surgeon/contract.ts` — remove `SemrushKeywordRow`/`SemrushExpansionRow`/`SemrushEvidence` types,
     the `semrush?: SemrushEvidence` packet field, and `'semrush_market_opportunity'` from the decision discriminator.
   - `page-surgeon/assemble-packet.ts` — remove the 2 deleted imports + `semrushByUrl`/`semrushExpansionsByUrl`
     ctx fields + Promise.all loads + `hasSemrush` + the `if(hasSemrush) packet.semrush={…}` block + evidenceHash semrush fields.
   - `page-surgeon/page-decision.ts` — remove `'semrush'` from `SourceName`, the `s === "semrush"` detail branch,
     `highValueUnservedCluster` on `packet.semrush`, the two `const sem = packet.semrush` blocks.
   - `page-surgeon/title-scorers.ts` — remove the **weighted `semrush_market_opportunity` dimension (0.5)** +
     `aeo_serp_feature_fit`'s `packet.semrush.serpFeatures` input (re-source from profound only).
   - `page-surgeon/title-candidates.ts` — remove `packet.semrush.relatedKeywords` use.
   - `page-surgeon/llm-judge.ts` — strip the SEMrush prompt instructions.
2. **Scorer + eligibility + provenance:** `priority-score.ts` (delete 3 `semrush_*` severities),
   `promotion-eligibility.ts` (delete 4 `semrush_*` pairs), `rec-provenance.ts` (drop `'semrush_opportunity'`),
   `draft-enrichment.ts` (drop `'semrush_striking_distance'` from QUERY_TITLE_TRIGGERS),
   `build-graph.ts` (delete dead `difficulty` from DemandInput — **KEEP `searchVolume`**, it's provider-agnostic),
   `keyword-portfolio.ts` (`KeywordSource` drop `'semrush'`).
3. **Connector store + flags:** `lib/connector-store.ts` (SemrushConnectorToken/getSemrush/patch +
   `'semrush'` in ConnectorProvider/ConnectorToken/REAL_DATA_SOURCE_PROVIDERS),
   `lib/legacy-flags.ts` (remove the now-dead `'semrush'` LegacySystem + `load-canonical-worklist.ts` quarantine warning).
4. **UI/copy:** `connectors-client.tsx` (SEMrush card), `settings/page.tsx`, `settings-tabs-client.tsx`,
   `connector-capability-copy.ts`, `help/page.tsx`, `data-sources-strip.tsx`, `first-reading-waiting.tsx`,
   `state-of-union-section.tsx`, `opportunities/opportunity-list.tsx`, `today-newpages-card.tsx`,
   `page-opportunity-brief-view.tsx`, `insight/{opportunity,compute-state-of-union,connection-health}.ts`,
   `customer-copy-templates.ts`, `page-opportunity-brief.ts`, `llm/schemas.ts`, `llm/structured-drafter.ts`,
   `workbench-data.ts` (the live striking-distance column), `push-receipt.ts`.
5. **Tests (~14):** remove `semrush` from fixtures in `recommendation-qa.test`, `why-this-matters-narrative.test`,
   `llm-why-narrative.test`, `llm-expert-strategist.test`, `build-source-stat-cards.test`, `connectors-actions.test`,
   `evidence-summary.test`, `indexing-caveat.test`, `page-decision-trust.test`, `artifact-bundle.test`,
   `change-pack.test`, `llm-judge.test`.
6. **Comment-only (safe, last):** `serp-guard.ts`, `serp-validation.ts`, `load-fanout-seeds.ts`,
   `promotion-writer.ts` — touch only the SEMrush *words*, not logic.

## DO NOT
- Do NOT drop the DB tables (`semrush_domain_metrics`/`semrush_organic_keywords`/`semrush_keyword_gaps`) —
  data deletion is operator-gated. Leave them orphaned (safe).
- Do NOT remove `searchVolume` from the demand graph (provider-agnostic; DataForSEO fills it).

## Replacements (already decided)
- `semrush_striking_distance` → `gsc_striking_distance` (already wired; no loss).
- `semrush_cannibalization` → deleted; GSC-native cannibalization serves /opportunities. Queue-trigger wiring = follow-up.
- `semrush_keyword_gap` → deleted; no first-party equivalent until DataForSEO keywords.

## Finish: `tsc 0` → `npm run build` → re-run `scripts/_canonical-truthdump.ts` (expect 364 packs, no semrush) →
## `rg -i "semrush"` returns only docs → commit Part 2.
