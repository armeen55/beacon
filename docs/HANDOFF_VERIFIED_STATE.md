# Beacon — Start Here

> 🟡 **W4 Stage 0 + Stage 1 LANDED (2026-05-04):** Customer-one historical backfill orchestrator scaffolded. Stage 0 preflight + Stage 1 backup wired and run cleanly; stages 2–8 (extract / rederive / copy-orphan / relabel / verify / publish / rollback) are reserved and hard-fail with "not yet implemented; awaiting operator approval" messages. **No production mutation.** `--dry-run` is the default; `--write` is required to actually export.
>
> **What landed:**
>
> 1. **`scripts/customer-one-backfill.ts`** (NEW, ~735 lines) — staged orchestrator with 9 stages enumerated. Today's commit implements stages 0 + 1 only. The `IMPLEMENTED_STAGES` set carries `["preflight", "backup"]`; every other stage routes through `validateStage` → `isReserved: true` → exit 2 with operator-actionable message. Unknown stages rejected with the valid-stages list. Same-day backup directory is blocked unless `--force-overwrite`. `--stage=publish` triggers a giant red warning before the unimplemented-stage gate fires (defense in depth). `LOCKED_CSV_MANIFEST` pins SHA-256 of the four canonical Profound CSVs at the moment W4 preflight ran (preflight aborts if any source file drifts).
>
> 2. **`tests/scripts/customer-one-backfill.test.ts`** (NEW, 35 cases) — operator-locked safety contracts: hash determinism (sha256 fixture matches the known `'hello world'` hash) · stage parsing rejects null / unknown / reserved · `IMPLEMENTED_STAGES` carries ONLY preflight + backup · `validateStage('publish').isReserved === true` · `shouldBlockSameDayBackup` covers all four cases · manifest summary aggregates correctly · `backupDirFor` is deterministic · `dateStringFor` returns YYYY-MM-DD · LOCKED_CSV_MANIFEST has all 4 CSVs with 64-char hex hashes · SUPABASE_TABLES_TO_BACKUP carries every table the operator's spec listed · ALL_STAGES enumerates all 9 stages · **source-scan invariants:** `runPreflight` body never calls `.insert/.update/.delete/.upsert` (read-only) · `runBackup` body never calls those either (Supabase read-only on backup too) · every `writeFileSync` target inside `runBackup` lands under `backupDir` · publish stage prints the giant warning.
>
> 3. **Stage 0 preflight executed clean** (read-only against live Supabase):
>    - Supabase reachable ✓
>    - `prompt_answer_observations`: **1,936 rows** (Apr 22 → May 1; native polling output only)
>    - Schema-v2 coverage: 100% have `descriptor_window` / `source_system` / `competitor_co_mentions` / `answer_structure` · 78.31% have `citation_urls` (older Pre-Commit-7 native polls null) · 0% have `competitor_descriptor_windows` (W2 §2.1 field never landed in Supabase — pure backfill candidate) · 0% have `metadata.regime` (expected — that field exists for `historical_recovered` provenance only)
>    - `daily_metric_snapshots`: 2,325 rows (1,380 benchmark + 945 derived; Apr 7 → May 1)
>    - `recommended_edits`: 17 · `recommendation_responses`: 7 · `tracked_prompts`: 100 · `tracked_entities`: 40 · `changelog_entries`: 334
>    - All 4 CSV hashes match the locked manifest ✓
>    - **tracked_prompts ↔ CSV mapping: 100/100 case-insensitive exact match ✓**
>    - `.data/_backups/` writable ✓
>
> 4. **Stage 1 backup executed clean** (`--write` flag set, single invocation): wrote 66 entries to `.data/_backups/pre-w4-backfill-2026-05-04/` totaling 65,728 rows / ~205 MB. Layout:
>    - `supabase/` — 7 table exports (the source of truth)
>    - `local/tenants/ritz-builders/` — 55 .data files (local cache snapshot)
>    - `csv-source/` — 4 SHA-256 pin files for the Profound CSVs (NOT the 140 MB of CSV bytes; only the manifest entry)
>    - `backup-manifest.json` (28 KB structured) + `backup-manifest.txt` (10 KB human-readable). Each entry carries `name` / `sourceOfTruth` / `rowCount` / `byteCount` / `sha256` / `timestamp` / `tenantId` / `tenantSlug` / `relativePath` per operator spec. Manifest also pins `scriptSha` (sha256 of the orchestrator source itself) so future restores correlate against `git log -- scripts/customer-one-backfill.ts`.
>
> 5. **Notable production-state findings** the prior preflight (2026-05-01) did not surface, now confirmed:
>    - **The 14,096 historical Profound rows currently live ONLY in `.data/tenants/ritz-builders/prompt-answer-observations.json`** (local cache from a prior import run). Supabase production carries only the 1,936 native-poll observations (Apr 22 → May 1). Stage 2 (extract-observations) will need to push fresh `historical_recovered` rows INTO Supabase, not just rewrite local cache. The local 14K rows are pre-Schema-v2 (no `regime` / `source_system` / `extracted` metadata; no `descriptor_window` / `competitor_co_mentions` / `competitor_descriptor_windows` / `citation_urls` / `answer_structure` / `mention_position` / `citation_rank` / `primary_recommendation`) — they're the EXPECTED pre-W4 shape that W4 enriches.
>    - `.data/tenants/ritz-builders/daily-metric-snapshots.json` shows 31,384 rows but Supabase has only 2,325. The local cache is stale (Apr 26 timestamp) and includes a snapshot regime the production DB never received.
>    - `tracked_prompts` + `tracked_entities` are operator-shared GLOBAL tables (no `tenant_id` column per `dual-write.ts` `GLOBAL_TABLES`). The preflight accordingly reads them without tenant filter; the backup exports them in full as global registry snapshots.
>
> **Verification (2026-05-04):** `npx tsc --noEmit` clean · `tests/scripts/customer-one-backfill.test.ts` 35/35 pass · `npm run test` 3906/3912 (6 pre-existing baseline failures all OUTSIDE this surface — same UI smoke time-drift + tenant-isolation + auto-link-via-changelog tests confirmed in §3.11; net change: +35 passes, ±0 failures) · `BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders npm run build` clean · Stage 0 report green · Stage 1 manifest written with 66 entries, all sha256 hashes verified, no Supabase mutations.
>
> **Constraints honored (operator-locked):** No production mutation. No Supabase writes (only reads + backup exports). No Profound code archive/delete. No paid generations. No Apply-All-HIGH. No `.data` cache mutation outside `.data/_backups/`. No execution of stages 2–8 (all hard-fail today).
>
> **Next 3 actions (operator-gated):**
> 1. **Operator review of Stage 1 backup manifest** — read `.data/_backups/pre-w4-backfill-2026-05-04/backup-manifest.txt`, confirm 7 Supabase tables + 55 local files + 4 CSV pins are present, validate the rollback inputs are complete + recoverable.
> 2. **Operator approval to design + run Stage 2 (extract-observations)** — pure compute, $0 LLM cost, deterministic. Streams the 14,096 raw CSV rows through Schema v2 extractors + stamps `historical_recovered` provenance, writes to `.data/_staging/w4-extracted-observations.json` (NEVER directly to Supabase or live `.data/tenants/`). Stage 2 stays staged-only until Stage 6 verification harness greenlights publish.
> 3. **(Decision)** When publish lands, push fresh `historical_recovered` observations INTO Supabase (the source of truth) — the local `.data/tenants/ritz-builders/prompt-answer-observations.json` is stale cache and should be regenerated as part of publish, not used as input.

> 🟢 **W3 Step 3.11 (Action Type Planner v0) LANDED (2026-05-04):** H2 + FAQ proved the safe-generation loop end-to-end (query fanout → evidence packet → LLM → validators → exact bundle replay → ranked action table). H2 / FAQ are not the whole product — Beacon must recommend the RIGHT website task type per cluster: create page, rewrite title, rewrite meta, rewrite H1, add H2 / section, improve copy, add FAQ, add schema, add internal links, add comparison table, technical fix, review decision. Step 3.11 ships the PLANNER (decision layer) only — not all the generators yet.
>
> **What landed:**
>
> 1. **`src/domains/recommendations/action-type-planner.ts`** (NEW) — `buildRecommendedActionPlan(input): ActionPlan[]` is a pure deterministic helper that walks 12 operator-locked rules in priority order and emits the highest-priority plan that fires. Every plan carries:
>    - `actionType` — one of 12 `PlanActionType` values
>    - `targetUrl` / `targetPageLabel` — null+`New page` for `create_page`, otherwise the resolved owned URL + operator-friendly label
>    - `proposedElementType` — the `ElementType` the generator should produce (h1 / h2 / title / meta / faq_question / table / schema_type / internal_link / answer_block) or null for page-level / review actions
>    - `evidenceReason` — one-line operator-readable evidence summary
>    - `audit` — full per-plan structured audit: `rawFanoutTriggers[]` (verbatim AI-emitted queries), `normalizedIntent` (superlatives stripped), `pageFactsUsed[]` (which `PageFactsForPlanner` fields contributed), `whyThisActionType` (one paragraph), `whyNotOtherTypes[]` (every NON-chosen plan + a rejection reason), `confidence` (fanout-backed / prompt-backed / site-inventory-backed / thin)
>    - `riskLevel` — low / medium / high
>    - `canGenerateNow` — `true` only for `add_h2_section` + `add_faq` in v0; everything else is `false` (operator-handoff task)
>    - `recommendedGenerator` — concrete existing `ActionType` the generator emits (1:1 mapping today; 1:N possible later)
>
> 2. **Priority-ordered rule walk** (operator-locked):
>    1. `technical_fix` — page-level defects (noindex / canonical mismatch / invalid schema / blocked or stale crawl) outrank everything else.
>    2. `create_page` — no owned page covers the cluster.
>    3. `add_internal_links` — homepage over-cited while target page exists.
>    4. `rewrite_h1` — H1 missing / generic / not anchored to cluster.
>    5. `rewrite_title` — title generic / weak / missing geo+service.
>    6. `rewrite_meta_description` — meta missing / weak / overlong.
>    7. `add_comparison_table` — comparison-stage demand (operator-explicit: lands BEFORE `add_h2_section` so a "best luxury home builders" fanout doesn't degrade into a self-claim H2).
>    8. `add_faq` — question-shaped fanout / prompts.
>    9. `add_schema` — ONLY when visible content supports it (FAQPage requires visible FAQ; BreadcrumbList requires hierarchy; Service / WebPage requires service content). Never recommended for hidden / unsupported content.
>    10. `add_h2_section` — page broadly matches the cluster but missing one important subtopic.
>    11. `improve_body_copy` — page exists but body is too thin to win the cluster prompts.
>    12. `review_decision` — terminal fallback when nothing else fires.
>
> 3. **Action-table model extended** — `ActionRowType` gained `edit_h1` (was folded into "H2") + `add_comparison_table` (was folded into "Copy"). 13 visible task-type labels now: Page · Title · Meta · H1 · H2 · Section · Copy · FAQ · Schema · Links · Table · Technical · Review (+ Regenerate meta-action). `actionRowTypeForEdit` mapping updated: `change_h1` → `edit_h1`; `add_table` / `add_comparison_section` → `add_comparison_table`. Persisted H2/FAQ rows render unchanged (defensive: same `add_h2_section` / `add_faq` ActionType → same row type / label).
>
> 4. **Tests (1 new file, 37 cases · 0 regressions to recs+arch):**
>    - `action-type-planner.test.ts` (NEW, 37) — pin all 13 operator-locked scenarios: "best luxury home builders" → `add_comparison_table` (NOT self-claim H2) · weak title → `rewrite_title` · weak meta → `rewrite_meta_description` · missing H1 → `rewrite_h1` (highest of the three) · no owned page → `create_page` · question-shaped fanout → `add_faq` · comparison fanout → `add_comparison_table` · homepage over-cited → `add_internal_links` · visible FAQ → `add_schema` (FAQPage unlocked) · absent visible FAQ → `add_schema` blocked · noindex / invalidSchema / crawlBlocked → `technical_fix` · audit explains why this + why NOT all 11 others · `whyNotOtherTypes` covers every non-chosen plan with a rejection reason · `confidence` falls to "thin" with no evidence · `rawFanoutTriggers` carries verbatim queries (including "best …" — operator-locked rule that raw fanout MAY contain forbidden modifiers but PUBLIC copy must transform them) · ACTION_ROW_TYPE_LABEL covers all 13 required labels · `planLabelFor` mirrors them · `canGenerateNow` true ONLY for the 2 wired safe generators · `proposedElementType` correct for every plan · heuristic helpers (`fanoutHasForbiddenSuperlative` / `fanoutLooksComparison` / `fanoutHasQuestionShape` / `titleIsWeak` / `metaIsWeak` / `h1IsWeak` / `pageHasTechnicalIssue` / `ownedPageBestMatch` / `normalizedIntentFromSignal` / `schemaIsRecommendable`) all individually unit-tested.
>    - Pre-existing test updated (`render-output-cleanup.test.tsx`) — pinned the OLD `Add an "..." H2` pattern from §3.5e; updated to the §3.15 `Add "..." H2` shape with regression-prevention assertion. (Carried over from §3.15.)
>
> 5. **Constraints honored** — No paid generation. No broad regeneration. No Apply-All-HIGH. No backfill. No Profound archive/delete. No cards/lanes redesign. Persisted H2/FAQ rows are not mutated. Exact bundle replay (W3 §3.10) intact.
>
> **Verification (2026-05-04):** `npx tsc --noEmit` clean · 1285/1285 on `src/domains/recommendations` + `tests/architecture` (recs + arch surface area) · `npm run test` 3871/3877 (6 pre-existing baseline failures all OUTSIDE this surface — same UI smoke time-drift + tenant-isolation + auto-link-via-changelog tests confirmed in §3.13/§3.15; net change vs §3.15: +37 passes, ±0 net failures) · `BEACON_TENANT_ID=… BEACON_TENANT_SLUG=… npm run build` clean.
>
> **What this enables:** Beacon can now CHOOSE the right task type for each cluster — title / meta / H1 / schema / link / table / review — not only H2/FAQ. The planner is wired into the rule layer; the next phase activates the per-type generators behind feature-flagged validators (Title / Meta / H1 / Internal Links / Schema / Comparison Table). v0 ships the safe set (H2 + FAQ) and surfaces every other plan as a clearly-marked operator-handoff task in the existing ranked action table.
>
> **Browser spot-check (post-§3.15 deploy)** confirmed by operator on the table screenshot: 9 rows (down from 12), 3 FAQ pairs each grouped to one row, real question text in titles, `Add "..." H2` not `Add an "..."`, no `(new)` / `(question)` / `(answer)` noise tags, types correct (H2/FAQ/Page/Review), no raw IDs / em dashes / bare "Ritz" / leading "Best …".
>
> **Next 3 actions (operator-locked):**
> 1. **W4 historical backfill** — operator's announced next phase (per the §3.11 spec: "After Step 3.11 passes, pause. Then we resume W4 historical backfill.").
> 2. **(Optional) Activate one new generator behind a flag** — e.g., the `rewrite_title` or `add_internal_links` generator, gated by an env flag and validated through the same `--save-bundle` / `--from-bundle` review-and-replay pipeline §3.10 ships.
> 3. **(Optional) Surface the planner's audit + canGenerateNow on the existing action table** — when a row's underlying plan has `canGenerateNow: false`, render a "Queue this for the operator" badge instead of the Accept button.

> 🟢 **W3 Step 3.15 (Action-table polish: FAQ Q+A grouping + title cleaning) LANDED (2026-05-04):** Operator browser-spot-check after the §3.13 persists revealed three small UI defects in the ranked action table (the table itself was accepted; this is polish, not a redesign):
>
> 1. Each FAQ Q+A pair was rendering as TWO duplicate rows (the question and the answer each on its own line) — wrong for the operator who thinks of an FAQ as one shipment.
> 2. Row titles for FAQ rows were leaking the displayLabel's noise tags (`(new)`, `(question)`, `(answer)`) into the table column instead of using the actual question text the operator approved.
> 3. H2 titles read `Add an "How to choose ..." H2 to the X page` — dangling article when the cleaned label starts with a capital. Operator wants `Add "..." H2`.
>
> **Three layered fixes (no new architecture, no new endpoints, no new model spend):**
>
> 1. **FAQ Q+A pair grouping** in `buildRecommendationActionRows` — new `partitionEditsForFaqPairing` + `composeFaqPairRowTitle` helpers split each rec's `renderable` edits into `faqPairs[]` (matched `faq_question[new]:<hash>` + `faq_answer[new]:<hash>` tuples), `nonFaqEdits[]`, and `orphanFaqEdits[]`. One grouped row per matched pair; orphans suppressed from the main table per operator scope ("unpaired FAQ question/answer does not render as active main-row task"). Grouped row id pattern: `<recStableKey>::faq-pair::<hash>`. The drawer's `proposedText` carries the QUESTION, the new `faqAnswerText` field carries the ANSWER, and `debug.pairedAnswerEditId` records the answer's edit id alongside `debug.editId` (the question's). Evidence refs + risks unioned across both rows; first-seen wins on duplicate refs.
>
> 2. **Row-title cleanup** — `composeFaqPairRowTitle` produces `Add FAQ: "{actual question text}" to the {targetLabel}` (curly-quoted, capped at 100 chars), drawing question text from `proposed_text` rather than the displayLabel. `composeEditRowTitle`'s `add_h2_section` branch dropped the dangling `an` article: `Add "..." H2 to the {targetLabel}` (no `an`). `cleanDisplayLabel` extended to strip trailing noise parentheticals — `(new)`, `(new H2)`, `(new H3)`, `(new FAQ)`, `(new section)`, `(question)`, `(answer)` — case-insensitive, ONLY when the inside word matches the noise set. Legitimate trailing parentheticals like `(no footprint increase)` are preserved.
>
> 3. **Drawer Q+A side-by-side** — `RowDrawer` derives `isGroupedFaq` from `row.actionType === "add_faq" && d.faqAnswerText`. When true, the "Exact recommended change" section renders Question + Answer as two separate `<pre>` blocks (data-attributes `data-rec-faq-question` / `data-rec-faq-answer` for tests + diagnostics). Non-FAQ rows keep the legacy single "Proposed" block. `currentText` (when present) still renders above; "Why" / "Evidence" / "Measurement plan" / "Debug" sections unchanged.
>
> **Tests (2 new files, 39 cases · 1 pre-existing test updated):**
> - `recommendation-action-rows-faq-grouping.test.ts` (NEW, 26) — matched FAQ pair → exactly ONE row · grouped title uses actual question text, never displayLabel noise · title ends with `to the {target} page` · drawer carries question on `proposedText` + answer on `faqAnswerText` · non-FAQ rows have `faqAnswerText: null` · orphan FAQ Q alone → no main row · orphan FAQ A alone → no main row · two pairs different hashes → exactly two grouped rows · FAQ pair + H2 in same rec → 2 rows total · `Add "..." H2` not `Add an "..." H2` · trailing `(new)` stripped · leading `H2:` stripped · cleanDisplayLabel strips `(new)` / `(new H2)` / `(question)` / `(answer)` · preserves legitimate parentheticals like `(no footprint increase)` · chained noise tag stripping · `partitionEditsForFaqPairing` defensive against duplicates · `extractElementKeyHashSuffix` handles malformed input · `composeFaqPairRowTitle` truncates very long question text.
> - `recommendations-step-3.15-faq-grouping.test.ts` (NEW, 13) — source-scan invariants: builder exports `composeFaqPairRowTitle` / `partitionEditsForFaqPairing` / `extractElementKeyHashSuffix` · `ActionRowDetail` carries `faqAnswerText: string | null` · debug carries `pairedAnswerEditId: string | null` · grouped row id pattern uses `faq-pair::${hash}` · composeEditRowTitle drops dangling `an` on add_h2_section · cleanDisplayLabel declares the noise-tag set · drawer derives `isGroupedFaq` from `row.actionType === "add_faq"` + `d.faqAnswerText` · Question + Answer labels + pre blocks render with `data-rec-faq-*` attributes · non-FAQ fallback to single "Proposed" block.
> - `tests/app/recommendations/render-output-cleanup.test.tsx` (1 updated) — pinned the OLD `Add an "..." H2` title pattern; updated to the new `Add "..." H2` shape with a `not.toMatch(/Add an [“"][A-Z]/)` regression-prevention assertion.
>
> **Verification (2026-05-04):** `npx tsc --noEmit` clean · 1248/1248 on `src/domains/recommendations` + `tests/architecture` (recs + arch surface area) · `npm run test` 3834/3840 (6 pre-existing baseline failures all OUTSIDE this surface — UI smoke time-drift + tenant-isolation + auto-link-via-changelog; net failures vs §3.13 baseline: ±0) · `BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders npm run build` clean.
>
> **Net effect on the operator-visible queue:** the 12 visible rows from §3.13 collapse to ~9 (each of the three FAQ pairs — Palo Alto, Cupertino, Luxury — collapses from 2 rows to 1 grouped row). Titles read like the operator wrote them: `Add FAQ: "What should I look for in a luxury home builder in the Bay Area?" to the Luxury Home Builder Bay Area page`, `Add "How to choose a luxury custom home builder" H2 to the Luxury Home Builder Bay Area page`, etc.
>
> **Constraints (still operator-locked):** No paid generations. No Apply-All-HIGH. No customer-one backfill. No Profound archive/delete.
>
> **Next 3 actions:**
> 1. **(Optional) Operator browser-spot-checks /recommendations** post-deploy to confirm the FAQ pairs render as one row each with the new title shape and the drawer's Q+A side-by-side layout.
> 2. **(Optional) Run paid generation on one more fresh cluster** to grow the inspection sample. Stays operator-locked OUT.
> 3. **(Optional) Surface the Cupertino + Luxury rows on `/changes`** for end-to-end review of the persisted-edits lifecycle.

> 🟢 **W3 Step 3.10–3.13 (Static-bundle replay path + query-fanout audit + leading-superlative guardrail + Cupertino & Luxury persisted) LANDED (2026-05-03):** Closes a real defect the operator caught on the §3.9 review: `--write` was calling OpenAI fresh on every invocation, so the bytes that landed on disk were not byte-identical to the dry-run report the operator approved. The fix is a five-piece review-and-replay pipeline that ships the EXACT operator-approved bytes with zero new model spend, plus a public-copy guardrail that the §3.10 paid run revealed (the LLM emitted an H2 starting with bare "Best ..." that slipped past the existing brand-claim regex).
>
> **Five layered changes:**
>
> 1. **Static-bundle provider** (`src/domains/recommendations/providers/static-bundle.ts`, NEW) — `staticBundleProvider(bundle)` returns a saved bundle verbatim, asserting `tenantId / recId / evidenceHash` match the live packet so the operator can't accidentally persist the wrong bundle for the wrong rec. `looksLikeSpecificEditBundle` type guard for unsafe JSON. The provider's `name` mirrors the bundle's original `providerName` so telemetry preserves true provenance ("openai" / "deterministic"), not a synthetic "static" marker.
>
> 2. **`--save-bundle` + `--from-bundle` flags on `build-edits-for-queue.ts`** — two-step review-and-persist flow: `--save-bundle=<path>` writes the LLM bundle to disk after generation, then `--from-bundle=<path> --write` persists the EXACT bytes with no second model call. Every existing validator gate (placeholder, brand-claim grounding, em-dash, brand-name-first, FAQ pairing, competitor leak, leading-superlative) re-runs on the loaded bundle so unsafe bytes never reach disk even when replaying.
>
> 3. **Query Fanout Audit** (`src/domains/recommendations/query-fanout-audit.ts`, NEW + `scripts/audit-saved-bundle.ts` runner) — operator scope: "We should not approve copy from vibes. Show the query fanout / AI search evidence behind each generated edit." For every edit in a saved bundle the audit prints: raw fanout queries (verbatim), prompt snippets, normalized intent, recommended buyer-safe angle, evidence sources used, transformed terms (forbidden-modifier raw → buyer-decision rewrite, e.g., "best luxury home builders" → "How to choose a luxury home builder"), confidence (fanout-backed / prompt-backed / competitor-page-backed / thin-evidence), and unsafe phrasings detected in the proposed text. Pure compute, deterministic, packet rebuilt without any LLM call. The audit caught the bare "Best ..." H2 that the validator's `best_in_market` regex missed (no definite article, no verb).
>
> 4. **Public-copy leading-superlative ban** (`validateNoLeadingSuperlativePublicCopy`) — operator-locked guardrail layered after brand-claim grounding: generated `proposedText` + `displayLabel` MUST NOT start with `Best…`, `Top…`, `Leading…`, `Premier…`, `#1…`, `Top-rated…`, `Highest-rated…`, `Most-trusted…` — even when the AI fanout query that grounded the rec contained "best …". Raw fanout keywords carry comparison intent; public Ritz copy must transform that into a buyer-decision angle ("How to choose…", "What to look for…", "Questions to ask…") rather than parrot a self-award framing. Env opt-out: `BEACON_ALLOW_LEADING_SUPERLATIVE=1`.
>
> 5. **`--rec-id-override` on the from-bundle flow** — when the queue churns between save and replay (e.g. a single-prompt rec gets promoted to a cluster page), the operator passes `--rec-id-override=<current key>` and the script grafts `bundle.recId` in memory + opts the static provider into `allowEvidenceHashDrift` so the replay still validates and persists. The on-disk JSON is NEVER mutated — the override is a CLI-time graft with a loud warning. tenantId + recId equality still enforced.
>
> **Two persistences this session, $0 model spend:**
>
> | Cluster | rec_id | Edits persisted | Source attribution | Cost |
> |---|---|---:|---|---:|
> | Cupertino | `create_cluster_page:geo:Cupertino` | 1 H2 + 2 FAQ (paired hash `cupertino01`) | `source=openai` (queue churn promoted `create_single` → `create_cluster_page`; saved bytes are the original LLM output, persisted via `--rec-id-override`) | $0 (saved telemetry: $0.011674) |
> | Luxury Home Builder Bay Area | `create_cluster_page:topic:Shield: Luxury Home Builder Bay Area` | 1 H2 + 2 FAQ (paired hash `faqlux01ab23cd45`) | `source=operator_edited` (the §3.10 H2 + FAQ Q failed the new leading-superlative + best_in_market gates; operator hand-edited bytes to a buyer-decision angle) | $0 (saved telemetry: $0.013929) |
>
> **Operator checklist verification on the 6 newly-persisted rows (3 Cupertino + 3 Luxury):** zero raw UUIDs in public text · zero em dashes · zero bare "Ritz" · zero leading-superlative public H2s · zero unsupported brand claims · FAQ Q+A pairs share their hash on both clusters · all rows under their cluster `rec_id` · provenance is truthful (`provider_name=openai`, `model=gpt-5-mini`, `source=openai` for Cupertino / `source=operator_edited` for Luxury, `implementation_status=recommended`).
>
> **Tests (4 new files, 64 new cases · 1 validator file extended):**
> - `static-bundle.test.ts` (17 cases, +5 from §3.10 baseline) — pin verbatim return, tenantId/recId/evidenceHash mismatch errors, structural type guard, `STATIC_BUNDLE_PROVIDER_TAG`, plus W3 §3.12 cases for `allowEvidenceHashDrift` (relaxes hash check while keeping tenantId+recId enforced; grafts live packet's hash onto the returned bundle; default still enforces strict equality; pre-graft + drift-allow combination drives the rec-id-override flow cleanly).
> - `query-fanout-audit.test.ts` (27 cases) — `transformForbiddenQueryToBuyerAngle` (best/top → How to choose, geos lift to "in {Geo}", cities don't take "the", year tokens stripped, articles stripped, returns null on buyer-neutral input), `detectUnsafePhrasings` (leading Best/Top/Leading/Premier, inline award-winning/top-rated/most-trusted/most-popular/frequently-recommended, subject-of-sentence "best builder/firm/etc.", de-dupes hits, returns empty on safe copy), `buildQueryFanoutAudit` shape (rich/partial/none coverage, fanout-backed/prompt-backed-only/competitor-page-backed/thin-evidence confidence, evidence sources stable order, recommendedAngle echoes first transformed term or mirrors top fanout, page-level edits handled cleanly).
> - `specific-edit-validator-leading-superlative.test.ts` (14 cases) — pin operator-locked rule 1 (raw fanout MAY contain "best ..."; `why` field may quote raw fanout verbatim), rule 2 (`Best …` / `Top …` / `Leading …` / `Premier …` / `Top-rated …` / `#1 …` rejected on proposedText AND displayLabel; case-insensitive), rule 3 (buyer-decision angles pass: "How to choose …", "What to look for …", "Questions to ask …", "Working with …", "Modernizing older Cupertino homes …" — the persisted Cupertino bytes), rule 4 (`BEACON_ALLOW_LEADING_SUPERLATIVE=1` opts out).
> - `specific-edit-validator.ts` extended — new `validateNoLeadingSuperlativePublicCopy` gate wired into the `validateSpecificEdit` style block (§9.85); fail-loud reason names the matched modifier and walks the operator to the buyer-decision rewrite.
>
> **Verification (2026-05-03):** `npx tsc --noEmit` clean · 1209/1209 on `src/domains/recommendations` + `tests/architecture` (recs surface area my changes touched) · `npm run test` 3795/3801 (6 baseline failures all outside this surface area: 3 UI smoke tests with time-drift on `.data` observation dates from 2026-04-23 expiring the 7-day "live" window, 1 tenant-isolation regression, 2 auto-link-via-changelog regressions — all 6 fail identically when my changes are stashed) · `BEACON_TENANT_ID=… BEACON_TENANT_SLUG=… npm run build` clean.
>
> **Persisted state of `.data/tenants/ritz-builders/recommended-edits.json`:** 20 rows total (14 prior + 3 fresh Cupertino + 3 fresh Luxury). $0 net model spend this session.
>
> **Constraints (operator-locked):** No more paid generations. No Apply-All-HIGH. No customer-one backfill yet. No Profound archive/delete.
>
> **Next 3 actions:**
> 1. **(Optional) Operator browser-spot-checks /recommendations** to confirm the 6 fresh rows render cleanly through the action table UI (Cupertino + Luxury clusters surface in the Type=H2 / Type=FAQ rows with the new copy and `source=operator_edited` / `source=openai` provenance).
> 2. **(Optional) Run paid generation on one more fresh cluster** (Whole Home Renovation Builders, location-specific Strengthen rows for Palo Alto / Menlo Park) ONLY if the operator wants to grow the inspection sample toward the 20–30-rec threshold for any future Apply-All-HIGH conversation. Stays operator-locked OUT until then.
> 3. **(Optional) Tighten the BrandAssertion list** if any factual claim from the persisted Cupertino / Luxury rows needs source verification. Or surface the persisted rows on the operator UI (`/recommendations`, `/changes`) for end-to-end review.

> 🟢 **W3 Step 3.9 (Narrow paid runs: Palo Alto persist + Cupertino + Luxury) LANDED (2026-05-03):** Operator approved the persist + two more dry-runs to broaden the inspection sample. Three runs total surfaced + fixed three real validator gaps without any unsafe data reaching disk. Final state: 3 Palo Alto edits persisted; 5 Cupertino + Luxury edits clean and pending operator approval to persist.
>
> **Distribution across all three runs:**
> - **Palo Alto (`--write`):** 3 generated · 3 ship-as-is · 0 rejected · $0.013672 USD · persisted to `.data/tenants/ritz-builders/recommended-edits.json`. (1 H2 + 1 FAQ pair, gold-standard voice).
> - **Cupertino (DRY-RUN):** 3 generated · 2 ship-as-is (FAQ pair) · 1 rejected (H2 — LLM hallucinated competitor "TerraRevo" in evidence refs) · $0.014794 USD. Clean public copy on accepted rows.
> - **Luxury Home Builder Bay Area (DRY-RUN):** 3 generated · 3 ship-as-is (1 H2 + 1 FAQ pair) · 0 rejected · $0.014569 USD. Final run after two validator fixes.
>
> **Three validator gaps caught + fixed mid-run:**
> 1. **Alias floor 3 → 4** (`MIN_COMPETITOR_ALIAS_LENGTH`) — bare-"Bay" alias of competitor "Bay Builders" was matching every "Bay Area" mention in legitimate geo copy. Floor raised; same fix suppresses 3-letter abbreviations like "ICB" from "ICB Builders". Full names still match when actually present.
> 2. **FAQ pairing per-edit aware** (`checkFaqPairing` accepts `perEditOk` flags) — a per-edit-failed FAQ question used to leave its matching answer effectively orphaned at persist time. Pairing now skips per-edit-failed rows during bucketing so the answer is correctly flagged as orphan. Cupertino run #1 hit this.
> 3. **`best_in_market` regex adjective gap** — "the best luxury home builders" slipped through the original strict-adjacency pattern. Regex now allows up to 3 modifier words between "best" and the noun. Same fix applied to `leading_brand`. Plurals (`builders?`, `firms?`, etc.) standardized.
>
> **Tests (5 new + 5 updated, 22 new + invariant cases):** `brand-assertions.test.ts` (+4 — adjective-gap regression cases on best/leading + the legitimate "best for X" allow-through), `specific-edit-validator.test.ts` (+2 — Bay-Builders short-alias guard + full-name still matches; updated 2 alias-builder tests for the new floor), `specific-edit-validator-faq-pairing.test.ts` (+1 — Cupertino regression: per-edit-failed Q leaves matching A as effective orphan), `recommendations-step-3.7-brand-grounding.test.ts` (1 updated — `checkFaqPairing` call regex now matches the per-edit-aware shape).
>
> **Verification (2026-05-03):** `npx tsc --noEmit` clean · 239/239 targeted (validator + brand + arch + faq-pairing + brand-claims) · `npm run test` 3733/3737 (4 baseline failures verified independent against `8b12b3d`) · `BEACON_TENANT_ID=… npm run build` clean.
>
> **Decision:** narrow paid runs are now safe to use one cluster at a time. Apply-All-HIGH stays operator-locked OUT.
>
> **Persisted state of `.data/tenants/ritz-builders/recommended-edits.json`:** 14 rows (11 prior + 3 fresh Palo Alto). Pending operator approval: 5 more (2 Cupertino FAQ pair + 3 Luxury). Per-edit grading + verification matrix in `docs/W3_STEP_3.9_NARROW_PAID_RUNS_REPORT.md`.
>
> **Next 3 actions:**
> 1. **Operator reviews Cupertino + Luxury** in `docs/W3_STEP_3.9_NARROW_PAID_RUNS_REPORT.md`. If approved, persist with `--write`.
> 2. **(Optional) Run paid generation on the next 1-2 fresh clusters** (Whole Home Renovation Builders, location-specific strengthen rows for Palo Alto / Menlo Park) to broaden the inspection sample.
> 3. **Apply-All-HIGH** stays operator-locked OUT until the operator personally approves it after a wider inspection sample.

> 🟡 **W3 Step 3.8 (FAQ Q+A pairing fix) LANDED (2026-05-03):** Two commits: `c261e35` (validator + Rule 13 paired contract + tests) + the doc that grades the dry-run on Palo Alto. The W3 §3.7 paid run flagged one residual defect — the LLM bundled FAQ question + answer body into a single `faq_question[new]` proposedText. Step 3.8 closes it with three layered enforcement points:
>
> - **Per-edit FAQ shape gate** — `validateFaqRowShape` rejects newline-bundled answers + `Q: \n A:` deterministic-shape bundling on `faq_question[new]:<hash>` rows. Rejects bare-question shapes + under-30-word stubs on `faq_answer[new]:<hash>` rows. Wired BEFORE `validateFaqIntentRewriting` so the operator-actionable error fires before the generic "must end with ?" reason.
> - **Bundle-level pairing** — `checkFaqPairing` groups every FAQ edit by element-key hash suffix; rejects orphan questions / orphan answers / duplicate Q's / duplicate A's. Failures land in `bundleErrors` AND overwrite the orphan's per-edit result so the operator sees WHICH row failed pairing. The persist layer (`runProviderAndPersist`) refuses to persist when bundleErrors is non-empty — orphans never reach disk.
> - **SYSTEM_PROMPT Rule 13** extended with the paired-output contract: question row carries `faq_question[new]:<hash>` with question-only text, answer row carries `faq_answer[new]:<hash>` with answer-only body (40–120 words preferred), both share the same hash suffix. BAD (bundled) + GOOD (paired) examples included. Cross-references Rule 18 + Rule 19 so the answer body still goes through the brand-grounding + voice/style stack.
>
> **Dry-run verification on the Palo Alto cluster:** 5 edits generated · 5 ship-as-is · 0 rejected · cost $0.015969 USD.
> - 1 H2 with the gold-standard "Ritz Builders emphasizes … our integrated process …" voice.
> - 2 FAQ pairs (4 rows) sharing hashes `pa01ab2c3d4` + `pa02ab2c3d5`. Each pair: clean question + 51-word substantive answer.
> - Zero brand-claim leaks · zero em dashes · zero bare "Ritz" · zero placeholder · zero competitor leaks · zero wrong-page anchors.
>
> Per-edit grading + verification matrix (every operator-locked rule × this run): `docs/W3_STEP_3.8_FAQ_PAIRING_REPORT.md`.
>
> **Tests (1 new file + 4 updated, 38 new + 12 invariant cases):**
> - `specific-edit-validator-faq-pairing.test.ts` (NEW, 16) — per-edit shape (bundled rejected, paired passes, bare-question answer rejected, < 30-word answer rejected); bundle pairing (paired bundle passes, orphan Q rejected, orphan A rejected, duplicates rejected, mixed bundle isolates failure); brand gates still active on answer body (bare "Ritz", em dash, "frequently recommended" all rejected).
> - `recommendations-step-3.7-brand-grounding.test.ts` (+12) — source-scan: SYSTEM_PROMPT Rule 13 PAIRED FAQ OUTPUT block + faq_question/answer hash-pairing shape + BAD/GOOD examples + cross-reference to Rule 18/19; validator wires `validateFaqRowShape` BEFORE `validateFaqIntentRewriting`; bundle validator aggregates pairing failures + overwrites per-edit results.
> - `specific-edit-validator.test.ts` (4 updated) — pre-existing structural-quality + faq_answer-bypass tests reworked to use the new paired shape and expect the new W3 §3.8 rejection reasons; "UNAFFECTED faq_answer" fixture expanded to 30+ words.
> - `openai.test.ts` source-scan stays green — Rule 13's faq_answer carve-out preserved + W3 §3.8 paired contract added.
>
> **Verification (2026-05-03):** `npx tsc --noEmit` clean · 232/232 targeted (faq-pairing + adjacent + arch) · 46/46 openai source-scan · `npm run test` 3726/3730 (4 pre-existing baseline failures verified independent against `8b12b3d`) · `BEACON_TENANT_ID=… npm run build` clean.
>
> **Decision: GO for narrowly-scoped paid runs going forward** with `--write` enabled when the operator approves a specific cluster's output. The gate stack (3.7 grounding + 3.7s style + 3.8 pairing) is now production-ready for one cluster at a time. Apply-All-HIGH stays operator-locked OUT.
>
> **Next 3 actions:**
> 1. **(Optional) Operator persists the Palo Alto run** with `--write` if the per-edit grading in `docs/W3_STEP_3.8_FAQ_PAIRING_REPORT.md` looks shippable.
> 2. **(Optional) Run paid generation on the next 1–2 fresh clusters** (Cupertino, Luxury Home Builder Bay Area, Whole Home Renovation Builders) to broaden the operator-inspection sample toward the 20–30-rec threshold for any future Apply-All-HIGH conversation.
> 3. **(Optional) Operator tightens the BrandAssertion list** if any factual claim from the Palo Alto run needs source verification or rewrite.

> 🟡 **W3 Step 3.7s (Public-copy style correction) LANDED (2026-05-03):** The Step 3.7 paid run on Palo Alto produced grounded copy, but the operator caught two style defects: it used "Ritz" (short form) instead of "Ritz Builders", and dropped two em dashes into the body. Step 3.7s adds a permanent style layer enforcing the operator-locked voice + punctuation rules.
>
> **Two new validator gates (layered after the brand-claim grounder):**
> - **No em dashes** — generated public copy MUST NOT contain `—` (em dash) or free-standing `–` (en dash) used as sentence punctuation. Digit-bounded ranges like `10–15 weeks` and `2024–2025` stay allowed. Validator returns `em dash banned in public copy ('—' near "<context>") — replace with period / comma / colon / parentheses`. Env opt-out: `BEACON_ALLOW_EM_DASH=1`.
> - **Full entity name on first mention** — every standalone generated section uses the full entity name ("Ritz Builders") on the first brand mention. Bare "Ritz" alone is NEVER allowed. After the first full mention, the model may transition to first-person plural ("our team", "we", "our process") for natural website tone. Per-tenant style registered via `getBrandNameStyle(tenantId)` in `brand-assertions.ts`. Env opt-out: `BEACON_ALLOW_SHORT_BRAND_NAME=1`.
>
> **SYSTEM_PROMPT Rule 19 (PUBLIC-COPY VOICE + STYLE):** five sub-rules walk the model through the new contract:
> - 19a — NO EM DASHES, with BAD/GOOD rewrite examples.
> - 19b — FULL ENTITY NAME ON FIRST MENTION, with the "Ritz Builders … Our team coordinates …" gold pattern + explicit BAD examples (bare "Ritz" / second-instance "Ritz").
> - 19c — H2 STYLE (topic-first, no brand-stuffing). "Architect-designed custom homes in Palo Alto" GOOD; "Why Ritz Builders is frequently recommended for Palo Alto custom homes" BAD.
> - 19d — PUBLIC BODY STYLE (self-contained, answer-engine-friendly chunks; first sentence makes sense quoted alone; no keyword stuffing; no fake social proof unless packet-grounded).
> - 19e — GOLD-STANDARD EXAMPLE — verbatim operator-approved Palo Alto H2 + body that the model should mirror.
>
> **Tests (3 files extended, 39 new cases):**
> - `brand-assertions.test.ts` (+16) — getBrandNameStyle / findEmDashes / findIncompleteBrandMentions detectors, digit-bounded en dash allowance, word-boundary anchors, second-instance bare-short rejection.
> - `specific-edit-validator-brand-claims.test.ts` (+11) — validator integration: em dash + en dash + digit-range allowance, gold-standard Palo Alto H2 passes, packet user-prompt text containing "Ritz" never trips the gate, env opt-outs work.
> - `tests/architecture/recommendations-step-3.7-brand-grounding.test.ts` (+12) — source-scan: brand-assertions exports the new helpers, validator wires `validateNoEmDashes` + `validateBrandNameFirstMention` after `validateBrandClaimGrounding`, env opt-outs wired, SYSTEM_PROMPT Rule 19 + 19a/b/c/d/e blocks present + carry the gold-standard Palo Alto example.
>
> **Verification (2026-05-03):** `npx tsc --noEmit` clean · 310/310 targeted (extended 3.7s + adjacent) pass · `npm run test` 3702/3706 (4 baseline failures verified independent against `8b12b3d`) · `BEACON_TENANT_ID=… npm run build` clean.
>
> **Net effect on the model:** the style layer is the difference between the Step 3.7 output ("Ritz emphasizes … complex builds — for example …") and the operator's preferred shape ("Ritz Builders emphasizes … For complex Palo Alto sites, including … our integrated process …"). Both layers (Step 3.7 grounding + Step 3.7s style) now apply. The next paid run on a fresh cluster will surface output that mirrors the gold-standard example.
>
> **Next 3 actions:**
> 1. **(Optional) Re-run paid generation on Palo Alto** with the style layer armed to verify the model produces the operator's preferred Palo Alto H2 verbatim.
> 2. **(Optional) Run the same paid generation on the next 1–2 fresh clusters** (Cupertino, Luxury Home Builder Bay Area, Whole Home Renovation Builders) to broaden the inspection sample toward the 20–30-rec threshold for Apply-All-HIGH.
> 3. **(Optional) Step 3.8 — FAQ Q+A pairing fix** (the residual defect from Step 3.7's first paid run — model bundled Q+A into one proposedText). SYSTEM_PROMPT Rule 13 update to emit Q + A as two linked edits.

> 🟡 **W3 Step 3.7 (Brand-claim grounding + first paid LIVE run) LANDED (2026-05-03):** Two commits: `2b99413` (the grounding layer) + the doc that grades the first paid LIVE run on a fresh cluster.
>
> **The W3 §3.6 minor-edit defect is closed.** Three of four LLM minor-edit rows in the §3.6 sample shipped unsupported social-proof claims ("Ritz is **frequently/commonly/often** recommended"). The W3 §3.7 grounding layer routed every public-copy field through:
> - **`brand-assertions.ts`** — operator-curated allowed phrases per tenant (10-row Ritz list: architect-led design-build, Bay Area / Silicon Valley luxury custom homes, custom homes, remodels, whole-home remodels, teardown / rebuild, in-house architecture, concept-to-completion, premium / luxury positioning) + 13 forbidden-claim regex patterns with `unlockedBy` categories (popularity / trust / ranking_first / award / tenure / client_outcome). `guarantee_outcome` permanently locked.
> - **Evidence packet** — `brandAssertions` field threaded into `SpecificEditEvidencePacket`; `evidenceHash` flips when the assertion list changes.
> - **OpenAI SYSTEM_PROMPT Rule 18** — BRAND-CLAIM GROUNDING block lists allowed claims, forbidden claims, the unlocked-by category map, GROUNDED phrasing examples ("Ritz emphasizes…", "Ritz's page can highlight…", "The section should explain…") and explicit UNGROUNDED examples.
> - **Validator** — `validateBrandClaimGrounding` scans `proposedText` + `displayLabel` only (not `why` / `risks` / `measurementPlan` / `currentText` / packet text). Each match returns `unsupported brand claim` with the pattern id surfaced. `BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS=1` env opt-out for operator-approved overrides.
>
> **First paid LIVE run (DRY-RUN mode) on a fresh cluster: PASSED.** Target: `create_cluster_page:geo:Palo Alto` (queue rank #2, target `https://ritzbuilders.com/locations/palo-alto`, no prior edits). 2 edits generated, 1 ship-as-is + 1 rejected (FAQ-shape defect, NOT brand-claim). **Zero brand-claim leaks.** Cost: $0.012162 USD total. The model defaulted to "Ritz **emphasizes** an architect-led design-build approach…" — the canonical grounded phrasing example from Rule 18 — instead of the §3.6 unsupported-recognition sentence shape.
>
> Full per-edit grading + verification matrix in `docs/W3_STEP_3.7_FIRST_PAID_RUN_REPORT.md`.
>
> **Tests (3 new files, 66 cases):**
> - `brand-assertions.test.ts` (34) — list shape, retrieval per tenant, forbidden-pattern coverage, unlocking, permanently-locked guarantee, multi-pattern matches, format helpers.
> - `specific-edit-validator-brand-claims.test.ts` (15) — each forbidden pattern rejected w/o assertion, allowed w/ matching-category assertion, public-copy scope (operator-facing fields never trip), env opt-out works.
> - `tests/architecture/recommendations-step-3.7-brand-grounding.test.ts` (17) — SYSTEM_PROMPT Rule 18 + canonical claim lists; OpenAI provider stringifies packet (carries brandAssertions); evidence packet builder threads brandAssertions into the hash; validator imports + wires `validateBrandClaimGrounding` after `validateCompetitorPublicCopy`.
>
> **Verification (2026-05-03):**
> - `npx tsc --noEmit` clean · 271/271 targeted (3.7 + adjacent validator + evidence) · `npm run test` 3663/3667 (4 baseline failures verified independent against `8b12b3d`) · `BEACON_TENANT_ID=… npm run build` clean.
>
> **Decision: GO for narrowly-scoped paid runs going forward** (one cluster at a time, dry-run mode, operator-approved). Apply-All-HIGH stays operator-locked OUT until 20–30 fresh recs are operator-inspected (W3 §1.5).
>
> **Next 3 actions:**
> 1. **Operator: review the Palo Alto H2 in `docs/W3_STEP_3.7_FIRST_PAID_RUN_REPORT.md`.** If you approve, persist via `--write` flag re-run.
> 2. **(Optional) Step 3.8 — FAQ Q+A pairing fix.** SYSTEM_PROMPT Rule 13 update so the model emits Q + A as two linked edits with a shared hash suffix. The W3 §3.6 + §3.7 reports both flag this as the next residual defect.
> 3. **(Optional) Run the same paid generation on the next 1–2 fresh clusters** (`Cupertino`, `Luxury Home Builder Bay Area`, `Whole Home Renovation Builders` again) to broaden the operator-inspection sample toward the 20–30-rec threshold for Apply-All-HIGH.

> 🟡 **W3 Step 3.6 (Sample-quality report on the production rec corpus) LANDED (2026-05-03):** Read every one of the 11 specific edits in `.data/tenants/ritz-builders/recommended-edits.json`, scored each against the operator-locked rubric (ship-as-is / minor-edit / no / placeholder). No paid runs. No regeneration. Results in `docs/W3_STEP_3.6_SAMPLE_QUALITY_REPORT.md`.
>
> **Distribution:** 1 ship-as-is (the operator already shipped it 2026-04-28) · 4 minor-edit (all LLM-sourced, all need brand-claim verification) · 5 placeholder (4 deterministic FAQs + 1 LLM Q-without-answer) · 1 no (deterministic competitor-name leak, quarantined by Step 3.5b.A's validator).
>
> **Source breakdown:**
> - **deterministic — 5 edits, all unshippable.** 4/5 are placeholder ("A: Draft answer (operator: rewrite). Anchor on: …"). 1/5 named a specific competitor in public copy. The deterministic FAQ generator was a placeholder factory; W3 Step 3.4's LLM activation replaces it.
> - **openai (gpt-5-mini) — 6 edits.** 1 ship-as-is (already shipped) + 4 minor-edit + 1 placeholder (FAQ Q without paired A). Every LLM body uses plausible brand voice; no competitor names; no raw prompt-id leaks; topical accuracy holds. Three minor-edits share the same defect: unsupported claims like "Ritz is frequently/commonly/often recommended" — the LLM has no source for these so it pattern-matches to generic builder-website copy.
>
> **Decision:** **CONDITIONAL GO for the first paid LIVE run.**
> - ✅ Quality bar met when the LLM is the source.
> - ✅ Validator + entity-pollution filter + scrubber stack holding.
> - ⚠️ Must-fix before paid run: brand-claim grounding (plumb operator-curated `brand_assertions` through the openai SYSTEM_PROMPT so the LLM uses ONLY operator-supplied facts when claiming recognition; otherwise rewrite to a process-focused sentence).
> - ⚠️ Should-fix before scaling FAQ output: FAQ pairing (Q+A as one row, not two).
> - ❌ Apply-All-HIGH stays operator-locked OUT.
>
> **Next 3 actions:**
> 1. **Plumb `brand_assertions`** through `specific-edit-evidence.ts` (packet) + `openai.ts` (SYSTEM_PROMPT v2). Operator supplies a list of concrete, verifiable facts. LLM uses only these for third-party-recognition claims.
> 2. **First paid LIVE run** on a single fresh cluster (5–10 edits) with brand-claim grounding plumbed. Operator inspects manually. If ≥80% ship-as-is or minor-edit + ≤10% placeholder, proceed to broader generation.
> 3. **(Optional)** FAQ Q+A pairing fix (lower priority — operator can manually pair Q+A rows today).

> 🟢 **W3 Step 3.5g (Action-table polish: Type=Page, View on shipped, helper copy, chevron-only Details) LANDED (2026-05-03):** Operator browser audit on Step 3.5f accepted the row-content direction; small surfaces still needed polish:
> - **Type column** renders "Page" for create_page rows (was "—" placeholder).
> - **Shipped rows** render an actionable View button (was inert "✓ Shipped" text).
> - **Evidence** appends "while competitors appear" when Ritz absent + dominant competitor present (entity-pollution-filtered).
> - **Subtle helper copy** under toolbar: "Accepting a task starts tracking its impact on AI visibility."
> - **Details affordance** is chevron-only — visible "Details" text dropped from the row + column header to avoid duplicate-feeling Action + Details labels.
>
> **Tests (1 new file + 4 updated):** `tests/architecture/recommendations-step-3.5g-polish.test.ts` (NEW, 9) · render-output-cleanup.tsx (3 updated + 4 new acceptance) · step-3.5f-row-polish (1 updated). 202/202 targeted pass.

> 🟡 **W3 Step 3.5f (Ranked-action-table row polish) LANDED (2026-05-03):** Operator browser re-audit on Step 3.5e accepted the table SHAPE but failed row CONTENT — generic titles ("Create a page for this scenario"), duplicate `H2 "H2: …"` quote prefixes, low-priority top rows, "Defer" as the primary action for Needs review, "Create page" pill wrapping into two lines, repetitive evidence copy, tracking rows above open work, and no visible Details affordance. This commit addresses every operator-locked rule.
>
> **Concrete row content (operator-locked):**
> - **Title humanizer extended:** new topic patterns (`whole_home_renovation`, `luxury_custom_home`, plus refined matches), `extractTopicFromPrompts(prompts)` so geo-only clusters ("Atherton") recover topic from affected prompts ("design-build vs architect", "vacant-lot custom home"), `cleanDisplayLabel` strips `H2:`, `H2 heading (new):`, `New FAQ:`, `FAQ answer:`, `Title:`, `Meta:` prefixes plus matched outer quotes, `sanitizeClusterLabel` strips `Shield:` namespace + `(Bay Area)` suffix + trailing `Builders` noise, `composeFromClusterLabel` falls back to the cluster phrase verbatim instead of "this scenario".
> - **Decision-style topics get a "decision page" suffix.** "Create an Atherton older-home rebuild **decision** page", "Create a Cupertino design-build vs architect **decision** page", "Create a completed-plans handoff **decision** page".
> - **Edit titles use curly quotes consistently:** `Add an "Architect-led design-build advantage" H2 to the Whole Home Remodel page` (was duplicating `H2 "H2: …"`).
> - **Decision rows name the actual decision:** "Decide whether to split the Los Altos page into a dedicated kitchen remodel page", "Decide direction for Atherton older-home rebuild", "Regenerate edits for Cupertino custom home". Never "this opportunity" / "this scenario" / "this recommendation" fallbacks.
> - **Priority recomputation** blends 5 signals (severity + observation count + brand citation share + needsHumanReview + engineConfidence + hasExactEdit). High floors: severity=high + obs≥10 → High; severity=high + exact edit + non-low confidence → High. Medium floors: needsHumanReview → Medium minimum; brand_share=0 + obs≥10 → Medium minimum; multi-prompt + exact edit + non-low confidence → Medium. Low only when genuinely thin (obs<3, or single-prompt+obs<5).
> - **Evidence summary leads with `{N} AI answers; {topic-specific gap}.`** Rows now distinguish themselves: "12 AI answers; Ritz not cited for Atherton design-build vs architect comparisons.", "33 AI answers; Greenberg winning Whole Home Remodel page queries.", "8 AI answers; Schema missing on the Available Homes page."
> - **Sort buckets put open work first:** new / needs_review / needs_fresh_edit (bucket 0) → accepted (1) → measuring (2) → shipped (3) → deferred / dismissed (4). Tracking rows never outrank open work by default.
> - **Action button mapping per status:** Accept (new+exact) · Review (new+review_decision · needs_review) · Regenerate (new+regenerate · needs_fresh_edit) · Mark shipped (accepted) · View (measuring · accepted-without-edits) · ✓ Shipped (shipped) · Promote (deferred) · Restore (dismissed). **Defer is no longer a primary row button** — it lives only as a drawer-secondary footer button.
> - **Type pill compact:** create_page rows render `—` (the row title already says "Create"), other types use compact labels (`H2`, `Title`, `Meta`, `Schema`, `FAQ`, `Section`, `Copy`, `Links`, `Technical`, `Review`, `Regenerate`) with `whitespace-nowrap` so the column never wraps. Type-filter dropdown uses "Page" instead of "Create page".
> - **Visible Details affordance** — every row carries a Details button (with chevron) in the rightmost column, not just hidden row-click behavior.
> - **Drawer footer carries Defer + Dismiss as secondary actions** (`data-rec-drawer-secondary-actions="true"`), hidden once the row reaches a terminal state.
>
> **Tests (1 new file + 3 updated):**
> - `tests/architecture/recommendations-step-3.5f-row-polish.test.ts` (NEW, 28) — humanizer + builder + client-UI invariants per Step 3.5f rule.
> - `tests/app/recommendations/render-output-cleanup.test.tsx` (+10 acceptance tests) — operator-locked: no scenario/opportunity fallback, no duplicate H2 prefix, "homepage page" never renders, Type column compact, needs_review primary button is Review (not Defer), top-5 rows not all Low, evidence specificity, sort order (open work above tracking).
> - `src/domains/recommendations/recommendation-title-humanizer.test.ts` (5 updated + 2 new) — decision-page suffix; new "Decide direction for {topic}" copy; "this opportunity" / "this scenario" never emitted.
> - `tests/sprint6a1-phase12-wiring.test.ts` (1 updated) — `buildRecommendationActionRows` now invoked with `{ queue, promptTextById }`.
>
> **Verification (2026-05-03):**
> - `npx tsc --noEmit` clean · 189/189 targeted (humanizer + evidence-preview + confidence-distribution + step-3.5e action-table + step-3.5f row-polish + render-output-cleanup + ui-cleanup + sprint6a1) pass · `npm run test` 3584/3588 (4 pre-existing failures: prompts/[id] drilldown smoke × 1, prompts route smoke × 2, tenant isolation × 1 — verified independent against `8b12b3d` baseline) · `BEACON_TENANT_ID=… npm run build` clean (Vercel-equivalent read-only-FS).
> - **Could not verify from this environment:** Vercel deploy SHA matches the new commit — operator dashboard check + browser re-audit needed.
>
> **Out of scope (per Step 3.5f + W3 §1.5):**
> - LIVE paid generation — first paid run is post-Step-3.6, operator-approved
> - Step 3.6 sample-10 quality report — gated on this re-audit passing
> - Apply-All-HIGH / bulk-accept UX — operator-locked OUT
> - Customer-one backfill — W4
> - Profound CSV archive / code deletion — post-May-10
> - Broad UI redesign outside /recommendations
>
> **Next 3 actions:**
> 1. **Operator: re-audit /recommendations in browser** after Vercel deploys this commit. Verify: row titles read as concrete tasks ("Add an 'Architect-led design-build advantage' H2 to the Whole Home Remodel page" / "Create an Atherton older-home rebuild decision page"); needs_review rows show Review (not Defer) as primary; dismissed rows show Restore; deferred rows show Promote; tracking rows sit BELOW open work; Type column never wraps "Create page"; visible Details chevron on every row; "Weak signal" / "homepage page" / "this opportunity" / "this scenario" never appear; evidence rows distinguish each other with topic-specific copy.
> 2. **If browser re-audit passes, proceed to W3 Step 3.6 (sample-10 quality report).**
> 3. **(Optional)** one-rec dry-run probe before Step 3.6 if you want a smaller paid sample first.

> 🟡 **W3 Step 3.5e (Recommendations as a HubSpot-style ranked action TABLE) LANDED (2026-05-03):** Single code commit on `main`. Operator browser re-audit on Step 3.5d (lane model) failed product acceptance — "stop the card/lane approach. The page should not look like a dashboard of cards. It should look like a clean work queue." The fix is the next product-architecture rewrite: lanes/cards out, ranked action table in.
>
> **Page shape:** PageHeader subcopy ("Beacon turns AI visibility gaps into concrete website tasks…") + toolbar (search + Type filter + Status filter + summary line "N actions · M new · K tracking" + last-refreshed) + one `<table>` with columns **# · Recommended action · Target · Type · Priority · Status · Evidence · Action**. Click a row → inline drawer below with Exact recommended change (before/after copy or page brief) · Why Beacon recommends it · Evidence (affected prompts / observations / top competitor / refs) · Measurement plan · Risks · Overlapping pages · collapsed Debug block (raw IDs, evidence hash, resolver tier, full reasoning).
>
> **Action-row model (NEW `recommendation-action-rows.ts`):** flattens the rec queue + linked specific edits into one ranked table row per concrete website task. One rec with 3 usable edits → 3 rows ("Add an H2 …", "Add an FAQ …", "Add a section …"). Row title is action-aware (`composeEditRowTitle` covers every ActionType). Type column shows operator-readable label (Create page / H2 / Title / Meta / Schema / FAQ / Section / Copy / Links / Technical / Review / Regenerate). Priority is `high` / `medium` / `low` ("Weak signal" never appears — operator scope: use Low instead). Status maps from edit lifecycle + rec response → New / Accepted / Measuring / Shipped / Needs review / Needs fresh edit / Deferred / Dismissed.
>
> **Generic-competitor filter** (entity-pollution-filter) preserved everywhere: "General Contractors winning" / "Architects winning" never reach the evidence column. Real competitors (De Mattei Construction, etc.) still surface.
>
> **Internal taxonomy** lives on `data-rec-*` attributes (`data-rec-row-id`, `data-rec-action-row-type`, `data-rec-priority`, `data-rec-status`, `data-rec-source-rec-id`, `data-rec-source-edit-id`, `data-rec-rank`, `data-rec-type-pill`, `data-rec-priority-pill`, `data-rec-status-pill`, `data-rec-action-button`, `data-rec-debug-block`) for tests + diagnostics. Operator never sees raw enum tokens.
>
> No paid runs / regeneration / Apply-All-HIGH / backfill / Profound archive.
>
> **What changed:**
> - **Action-row model + builder (NEW `recommendation-action-rows.ts`)** — `RecommendationActionRow` type with id / rank / title / targetLabel / targetUrl / actionType / priority / status / evidenceSummary / sourceRecommendationId / sourceEditId / hasExactEdit / detail (drawer payload). `buildRecommendationActionRows({queue})` flattens recs → actions: one renderable specific edit → one row; rec with `create_new_page` action and zero edits → one create_page row; rec with `split_or_separate_page` / `merge_or_dedupe` / `needs_review` and zero edits → one review_decision row; rec with all-dismissed edits → one regenerate_edit row; otherwise suppressed. Sort: priority DESC → open-vs-decided → observation count DESC → id ASC. Pure / deterministic.
> - **Title composer covers every ActionType** — `composeEditRowTitle` emits action-aware verbs ("Add an H2 …", "Rewrite the … title", "Add … schema to the …", "Add an FAQ …"). `composeMetaRowTitle` covers create_page (delegates to `humanizeRecTitle`), review_decision ("Choose whether to split the …", "Pick a direction for the … opportunity"), regenerate_edit ("Regenerate edits for the … recommendation").
> - **Target labels** — `targetLabelForUrl` returns "Homepage" (path `/`), "{Page Name} page" (e.g., "Whole Home Remodel page"), or "New page" (NEEDS_NEW_PAGE sentinel). Never "homepage page" duplication. Edits prefer their own anchor URL over the rec's resolution when both exist.
> - **Status / Priority mapping** — `statusForRow` reads response.status + edit lifecycle + needsHumanReview to land on New / Accepted / Measuring / Shipped / Needs review / Needs fresh edit / Deferred / Dismissed. `priorityForRow` blends engineConfidence + severity + affectedPromptCount → high / medium / low (single-prompt caps at low).
> - **Client rewritten as a table** (`recommendations-client.tsx`) — pre-3.5e lane sections (LaneSection / BacklogSection / RecLane / lane badges) deleted entirely. Toolbar (search + type filter + status filter + summary), `<table>` with the 8 operator columns, per-row Type/Priority/Status pills, lane-aware Action button (Accept / Mark shipped / Undo / Dismiss / Defer / "Tracking" / "✓ Shipped"), and inline drawer (`<tr><td colspan=8>`) with Exact change / Why / Evidence / Measurement plan / Risks / Overlapping pages / Debug (collapsed `<details>`).
> - **Drawer evidence** — affected prompt count, observation count, top REAL competitor (via `shouldExcludeFromCompetitorRanking`), evidence-ref dropdown (with prompt-text snippet for `prompt` refs), full reasoning + confidenceReason (scrubbed for brackets + UUIDs) lives in the Debug `<details>`.
> - **Page header** — subcopy now reads "Beacon turns AI visibility gaps into concrete website tasks. Review the top actions, accept them, or mark them as shipped." Shell width widened from `max-w-4xl` → `max-w-5xl` so the table fits without horizontal scroll.
>
> **Tests (1 new file + 5 updated):**
> - `tests/architecture/recommendations-step-3.5e-action-table.test.ts` (NEW, 25) — table-shape source-scan invariants: lane patterns gone, table + columns + toolbar + summary + drawer + debug-block all wired with the right `data-rec-*` attributes.
> - `tests/app/recommendations/render-output-cleanup.test.tsx` (rewritten, 25) — render-side acceptance: table shape, concrete row titles, no `homepage page`, pills carry humanized text + data-* enum, `Weak signal` never visible, accepted state hides Accept button + shows Mark-shipped, generic-competitor filter, no bracketed diagnostics by default, no `Site match` / `AI-reviewed`, confidence-distribution invariant on a 5-rec fixture.
> - `tests/architecture/recommendations-ui-cleanup.test.ts` (rewritten) — pruned to the contracts that survive every redesign: HIGH copy never auto-apply; no Apply-All-HIGH; server actions still wired; no raw enum leakage as visible JSX text.
> - `tests/sprint6a1-phase12-wiring.test.ts` (UI block rewritten) — pre-3.5e SpecificEditsSection / `destructure edits` / Accept-button-copy assertions deleted (those moved into the action-row builder layer); replaced with the table-model wiring (client imports + invokes `buildRecommendationActionRows`; server actions still bound).
> - `tests/architecture/recommendations-step-3.5d-lane-queue.test.ts` (DELETED) — obsolete with the lane model gone.
> - `tests/routes/recommendations-smoke.test.ts` (1 line updated) — shell width regex now matches `max-w-(?:4xl|5xl)`.
>
> **Pure-helper tests (unchanged from 3.5d, still green):** recommendation-title-humanizer.test.ts (35), recommendation-evidence-preview.test.ts (16), confidence-distribution.test.ts (5).
>
> **Verification (2026-05-03):**
> - `npx tsc --noEmit` clean · targeted tests 80/80 (action-table source scan + render-output + ui-cleanup + sprint6a1 client UI + smoke) and 67/67 (humanizer + evidence-preview + confidence-distribution) · `npm run test` 3542/3546 (4 pre-existing failures: prompts/[id] drilldown smoke × 1, prompts route smoke × 2, tenant isolation × 1 — verified independent against `8b12b3d` baseline) · `BEACON_TENANT_ID=… npm run build` clean (Vercel-equivalent read-only-FS).
> - **Could not verify from this environment:** Vercel deploy SHA matches the new commit — operator dashboard check + browser re-audit needed.
>
> **Out of scope (per Step 3.5e + W3 §1.5):**
> - LIVE paid generation — first paid run is post-Step-3.6, operator-approved
> - Step 3.6 sample-10 quality report — gated on this re-audit passing
> - Apply-All-HIGH / bulk-accept UX — operator-locked OUT
> - Customer-one backfill — W4
> - Profound CSV archive / code deletion — post-May-10
> - Broad UI redesign outside /recommendations
>
> **Next 3 actions:**
> 1. **Operator: re-audit /recommendations in browser** after Vercel deploys this commit. Verify: page is a clean ranked table (no card stack); 8 columns visible; first 8–12 rows scannable above the fold; each row title is a concrete task ("Add an H2 …", "Create a … page", "Rewrite the … meta description"); search + filters work; clicking a row opens an inline drawer with exact change + why + evidence + measurement plan + collapsed Debug; no "Weak signal" / "homepage page" / "General Contractors winning" / raw UUIDs / `[label tokens]` brackets in the default table.
> 2. **If browser re-audit passes, proceed to W3 Step 3.6 (sample-10 quality report).**
> 3. **(Optional)** one-rec dry-run probe before Step 3.6 if you want a smaller paid sample first.

> 🟡 **W3 Step 3.5d (Recommendations decision-queue lane model) LANDED (2026-05-03 morning), SUPERSEDED BY 3.5e (2026-05-03 afternoon):** Five-lane card layout (`ready_to_ship` / `needs_decision` / `needs_fresh_edit` / `tracking` / `backlog`) with lane-aware buttons + expansion drawer per card. Operator browser audit declared the card model wrong: "stop the card/lane approach. The page should not look like a dashboard of cards. It should look like a clean work queue." Replaced by Step 3.5e's HubSpot-style ranked action table. Pure helpers from 3.5d (`recommendation-title-humanizer.ts`, `recommendation-evidence-preview.ts`, `display-state.ts`) all kept; the client-side lane UI is gone.

> 🟡 **W3 Step 3.5c (Triage UX reset after Step 3.5b browser re-audit) LANDED (2026-05-02):** Single code commit `7199094` on `main`. Operator browser re-audit on Step 3.5b still failed product acceptance — the page improved but stayed an evidence/debug feed. This commit closes the gap on six remaining issues. No paid runs / regeneration / Apply-All-HIGH / backfill / Profound archive.
>
> - **Display-state classifier (NEW)** — `src/domains/recommendations/display-state.ts`. Six states (`actionable_edit` / `manual_review` / `needs_fresh_edit` / `accepted_tracking` / `backlog` / `suppressed`) drive the rec card's chip + action surface. Operator-readable labels ("Ready to ship" / "Needs your judgment" / "Needs fresh edit" / "Tracking" / "Backlog" / "Hidden"). `effectiveTierForDisplay` enforces the rule that `needs_fresh_edit` cannot appear in NOW.
> - **Generic competitor pollution filter on EvidenceChips** — `shouldExcludeFromCompetitorRanking()` (no-entity fallback path) drops "General Contractors" / "Local Contractors" / "Architects" / "Home Builders" / "Custom Home Builders" / "Bay Area Builders" before they can land in chips. Chip text renamed `{name} primary · {pct}%` → `{name} winning · {pct}%` for natural operator language.
> - **Raw prompt-id scrubber** — new `scrubRawPromptIds(text)` defense-in-depth helper. Patterns scrubbed: `prompt {full UUID}`, `prompt {8+ hex prefix}`, bare full UUID. Replaced with "an affected prompt". Wired into reasoning, confidenceReason, edit.why renders.
> - **"Site match" / "AI-reviewed" tier badges DROPPED** from default header. Resolver tier still drives engineConfidence under the hood; no longer surfaces as a chip.
> - **Display-state chip + drop "fragmented" / "{N} prompts"** — operator chips ("Tracking" / "Needs fresh edit" / etc.) replace internal cluster jargon.
> - **Title humanization — scenario fallback** — Step 3.5b.F's wrapped-quote form replaced with a scenario-class fallback (`Create a page for this buying scenario` / `this remodeling scenario` / `this rebuild scenario` / `this comparison scenario` / `this cost question` / `this decision scenario`). No raw prompt copy in titles.
>
> **Tests (35 new across 4 files):**
> - `display-state.test.ts` (NEW, 15) — six-state classifier; tier-downgrade rule; operator-label invariants.
> - `build-title.test.ts` (5 updated + 2 new) — scenario-class fallbacks per intent (cost / comparison / rebuild / remodel / buying / decision).
> - `tests/domains/recommendations/build-title.test.ts` (1 updated) — long-label assertion swapped from ellipsis to scenario-fallback.
> - `tests/app/recommendations/render-output-cleanup.test.tsx` (+10) — General Contractors filtered; Architects/Home Builders/Local Contractors filtered; no "fragmented" chip; no "Site match" / "AI-reviewed" badges; raw prompt-ids scrubbed (8+ hex prefix + full UUID); accepted_tracking hides action surface; needs_fresh_edit shows chip + empty-state; queue not mostly Weak signal.
>
> **Verification (2026-05-02):**
> - `npx tsc --noEmit` clean · 67/67 targeted (display-state + build-title × 2 + render-output-cleanup) · `npm run test` 3448/3454 (4 pre-existing failures verified independent against `5d32f5f` baseline) · `npm run build` clean.
> - **Could not verify from this environment:** Vercel deploy SHA matches `7199094` — operator dashboard check + browser re-audit needed.
>
> **Out of scope (per Step 3.5c + W3 §1.5):**
> - LIVE paid generation — first paid run is post-Step-3.6, operator-approved
> - Step 3.6 sample-10 quality report — gated on this re-audit passing
> - Apply-All-HIGH bar — operator-locked OUT
> - Customer-one backfill — W4
> - Profound CSV archive / code deletion — post-May-10
> - Broad UI redesign outside /recommendations
>
> **Next 3 actions:**
> 1. **Operator: re-audit /recommendations in browser** after Vercel deploys `7199094`. Verify: no "General Contractors winning"; no "prompt 319557d1" anywhere; no "Site match" badges; no "fragmented" chips; accepted recs show "Tracking" chip + no Accept buttons; "If I buy a property" cluster shows "Create a page for this buying scenario" title; mix of Strong / Review / Weak signal pills.
> 2. **If browser re-audit passes, proceed to W3 Step 3.6 (sample-10 quality report).**
> 3. **(Optional)** one-rec dry-run probe before Step 3.6 if you want a smaller paid sample first.

> 🟢 **W3 Step 3.5b (Product cleanup after Step 3.5 browser audit) LANDED (2026-05-02):** Single code commit `9b05327` on `main`. Operator's browser audit caught six product issues source-scan tests missed; this commit fixes all six without paid runs / regeneration / Apply-All-HIGH / backfill.
>
> - **A. Competitor-name leak quarantined** — `scripts/quarantine-competitor-public-copy-pre-w3.ts` (NEW, idempotent). Forward-only flips the operator-flagged H2 row (`create_cluster_page:geo:Los Altos__add_h2_section__h2[new]:c75a1120a6aa`, "Why teams choose us over De Mattei Construction") from `accepted` → `dismissed` with `not_found_reason: "invalid_competitor_public_copy_pre_w3"`. Local + Supabase dual-write executed; postflight green. Sister "Bay" matches were false positives (geographic Bay Area refs, not Bay Builders competitor); not quarantined.
> - **B. Confidence semantics revised** — `tier_deterministic_only` LOW gate REMOVED. Was forcing every deterministic-only rec into Weak signal regardless of evidence. Now deterministic-only BLOCKS Strong but does NOT force Weak signal. New combined LOW gate `single_prompt_no_evidence` fires only when affectedPromptCount === 1 AND no packet signal AND zero structured evidence refs (genuinely thin). HIGH-blocker code renamed `tier_observation_only` → `tier_not_adjudicated_or_inventory` to reflect that both observation AND deterministic_only block Strong.
> - **C. Raw enum labels removed from rendered UI** — new `EDIT_DIFFICULTY_LABEL` (low→Easy / medium→Medium / high→Hard); EvidenceChips effort chip humanized (low→"Quick win" / medium→"Medium effort" / high→"Heavy lift"). Internal enums stay in `data-*` attributes. **Rendered-output tests** (not just source-scan) pin the contract.
> - **D. Motive jargon replaced** — `MOTIVE_LABEL` values rewritten as operator-readable sentences (e.g., `capture_absent_cluster` → "AI is not citing Ritz for this topic yet.", `counter_competitor` → "A competitor is currently winning this answer."). Label "Motive:" replaced with "Why this matters:".
> - **E. Bracketed diagnostic scoring stripped from default card** — new `stripBracketedDiagnostics()` helper drops `[reason1; reason2; …]` suffixes from `confidenceReason` on the default card body. Full text preserved in the underlying field for evidence expansion.
> - **F. Prompt-shaped titles fixed** — new `looksLikePromptText()` helper in `build-title.ts`. When the cluster label reads like a customer-asked sentence (starts with prompt-starter, has pronoun, has `?`, or > 50 chars), the create-page title wraps as `Create a page for "{label}"` instead of the broken-grammar form `Create a {label} page`.
>
> **Tests (33 new across 3 files):**
> - `confidence.test.ts` (+10) — deterministic-only doesn't force LOW; new combined LOW gate; "INVARIANT: queue of 5 well-formed rec shapes → 0 LOW".
> - `build-title.test.ts` (NEW, 16) — `looksLikePromptText` triggers + non-triggers; "Create a If I..." regression fixed; LLM operatorTitle still wins.
> - `tests/app/recommendations/render-output-cleanup.test.tsx` (NEW, 7) — rendered HTML asserts: "Why this matters" replaces "Motive:", humanized motive copy lands, no bracketed diagnostics, no raw "low" body text, "Easy" + "AI-generated" + "Review" labels, queue not all Weak signal, prompt-shaped title grammar correct.
>
> **Verification (2026-05-02):**
> - `npx tsc --noEmit` clean · 56/56 targeted (build-title + confidence + render-output) · `npm run test` 3424/3428 (4 pre-existing failures verified independent against `5d32f5f` baseline) · `npm run build` clean.
> - **Could not verify from this environment:** Vercel deploy SHA matches `9b05327` — operator dashboard check + browser-spot-check.
>
> **Out of scope (per Step 3.5b + W3 §1.5):**
> - LIVE paid generation — first paid run is post-Step-3.6, operator-approved
> - Apply-All-HIGH bar — operator-locked OUT
> - Customer-one backfill — W4
> - Profound CSV archive / code deletion — post-May-10
> - Broad UI redesign outside /recommendations
>
> **Next 3 actions:**
> 1. **Operator: re-audit /recommendations in browser** after Vercel deploys `9b05327`. Verify: De Mattei H2 gone; mix of Strong/Review/Weak signal pills (not all Weak); no bracketed scoring; no "Motive: Capture absent cluster"; no raw "low" / "medium" / "high"; no "Create a If I..." titles.
> 2. **If browser audit passes, proceed to W3 Step 3.6 (sample-10 quality report).**
> 3. **(Optional, ad-hoc) one-rec dry-run probe** — single packet at `--dry-run`, ~$0.03, no .data writes — if you want a smaller paid sample before broader Step 3.6.

> 🟢 **W3 Step 3.5 (Recommendations UI cleanup with engineConfidence pill) LANDED (2026-05-02):** Single code commit `4d9fa1a` on `main`. Renders the trust label that Step 3.3's rubric stamps and Step 3.4 fed real packet signals into. No new LLM runs, no paid calls, no regeneration, no Apply-All-HIGH.
>
> - **`RecConfidencePill` (NEW, `src/components/display/rec-confidence-pill.tsx`)** — operator-locked labels: `high` → **"Strong"**, `medium` → **"Review"**, `low` → **"Weak signal"**. Internal enum stays high/medium/low; `data-rec-confidence` attribute carries it. Tooltip surfaces the trust contract per tier ("Strong: likely safe to ship after a brief review. Manual ship only — never auto-apply.") plus diagnostic reason codes from `engineConfidence.reasons`.
> - **Pill rendered on every rec card** in `recommendations-client.tsx` between the action label and tier badge.
> - **Humanized labels replace raw enum tokens** — `humanizeActionType()` (Title-Case fallback for unmapped action_types), `EDIT_SOURCE_LABEL` (`openai`/`anthropic` → "AI-generated", `deterministic` → "Deterministic"), `EDIT_CONFIDENCE_LABEL` (`high`/`medium`/`low` → "Strong"/"Review"/"Weak signal"). `data-source` / `data-edit-confidence` attributes carry the raw internal enum.
> - **Empty-state for filtered edits** — when `allEdits.length > 0` but the Step-3.1b-quarantine filter leaves `editCount === 0`, the rec card shows: *"{N} specific edits on this rec — all dismissed or no longer actionable. Re-run the generator to produce fresh edits, or accept the rec to track the change at the rec level only."* With `data-recommendations-edits-empty="true"` for tests.
> - **Apply-All-HIGH stays explicitly OUT.** Architecture invariant `tests/architecture/recommendations-ui-cleanup.test.ts` BLOCKS reintroduction: no `acceptAllHighConfidence` / `HighConfidenceApplyBar` / "Apply all HIGH" copy / "auto-apply" / "one-click" / "instantly ship" anywhere in the client source.
>
> **Tests (25 new across 2 files):**
> - `rec-confidence-pill.test.tsx` (15) — label renders, no-auto invariant (visible label scan, tooltip stripped — tooltip CAN say "never auto-apply" since that's the trust copy), tooltip body, internal enum doesn't leak, exported map covers every value.
> - `recommendations-ui-cleanup.test.ts` (10) — pill imported + rendered, no auto-apply phrasing, no Apply-All-HIGH bar/action, humanizers wired, empty-state branch present, every existing action (Accept/Defer/Dismiss/Mark-shipped/Undo) still bound.
>
> **Verification (2026-05-02):**
> - `npx tsc --noEmit` clean · 25/25 new tests pass · `npm run test` 3396/3400 (4 pre-existing failures verified independent of this change against `5d32f5f` baseline: 3 prompts-smoke fixture time-drift + 1 tenants/isolation, same set as W1/W2/W3 baselines) · `npm run build` clean.
> - **Could not verify from this environment:** Vercel deploy SHA matches `4d9fa1a` — operator dashboard check.
>
> **Out of scope (per Step 3.5 + W3 §1.5):**
> - Apply-All-HIGH bar / batch-accept UX — operator-locked OUT, architecture invariant blocks reintroduction
> - LIVE paid generation across the queue — first paid run is post-Step-3.6, operator-approved
> - Customer-one backfill — W4
> - Profound CSV archive / code deletion — post-May-10
>
> **Next 3 actions:**
> 1. **Operator: confirm Vercel deploy of `4d9fa1a` is "Ready"** + **browser-spot-check /recommendations** for the new "Strong" / "Review" / "Weak signal" pills + verify no "openai" / "low" / "add_h2_section" raw enum tokens in any rec card.
> 2. **Continue W3 Step 3.6 (sample-10 quality report).** The W3 finale: pick 10 recs across the queue, run `runProviderAndPersist({ packet, dryRun: true })` against the live OpenAI provider, score each generated edit honestly (ship-as-is / minor-edit / no / placeholder). Operator-locked gate before any broader regeneration.
> 3. **(Optional, ad-hoc) operator-gated one-rec dry-run** if you want a smaller paid probe before the broader Step 3.6 sample.

> 🟢 **W3 Step 3.4 (LLM provider activation + confidence loop closure) LANDED (2026-05-02):** Single code commit `37ef437` on `main`. Architecture-only — turns on the LLM grounding path so the W3 Step 3.2 evidence packet can produce real edits, but takes ZERO live paid runs. Validators + confidence rubric prevent bad output from reaching the product. Live regeneration is operator-gated, post-3.6.
>
> - **Loop closed: packet signals → confidence.** `hasAiSearchSignalForRec` + `hasCompetitorPageBlueprintsForRec` (NEW pure helpers in `specific-edit-evidence.ts`) derive real signals from observations; `load-queue.ts` replaces the hardcoded `false`s with these. **HIGH is now reachable** when a rec has real packet evidence + every other dimension passes. Both helpers run in O(observations of affected prompts) per rec — no extra I/O.
> - **SYSTEM_PROMPT v2** in `openai.ts` carries three new operator-locked rules: **Rule 15** (consume `aiSearchSignal.topSearchQueries` / `topDescriptors` / `topCompetitorCoMentions` / `competitorPageBlueprints` / `crossTenantPatterns` per the operator's grounding contract); **Rule 16** ("RETURN [] FOR THIS PACKET" when can't write specific copy — better empty than generic); **Rule 17** (operator-locked placeholder phrase ban). Existing Rules 1–14 preserved verbatim (Rule 12 no-competitor-names, Rule 13 FAQ customer-voice, Rule 14 evidence priority).
> - **Provider activation safety verified** — every gate already exists: Vitest safety, Vercel build guard, OPENAI_API_KEY config gate, budget gate before paid call (`runProviderAndPersist` → `checkBudget` → empty no-persist result if blocked), every failure mode returns an empty bundle never a placeholder, deterministic fallback path unchanged. `validateSpecificEditBundle` runs every edit through Step 3.1's placeholder + competitor-leak + structural-quality gates; failed edits drop, only validated rows persist.
> - **NO live paid run.** Tests use mocks. The LLM provider activation in this step means SYSTEM_PROMPT v2 + loop closure + verification. First live generation comes post-Step-3.6 with operator approval per packet/rec.
>
> **Tests (23 new across 2 new files + 2 modified files):**
> - `w3-step-3.4-loop-closure.test.ts` (NEW, 13) — packet helpers + HIGH-reachability + builder/helper agreement.
> - `openai.test.ts` (+9 SYSTEM_PROMPT verification) — pins every operator-locked phrase: aiSearchSignal sections, competitorPageBlueprints structure-not-name instruction, crossTenantPatterns empty-stub note, Better-empty-than-generic, placeholder phrase set, Rule 12, Rule 14.
> - `confidence.test.ts` (+1 fix) — readonly-modifier compatibility.
>
> **Verification (2026-05-02):**
> - `npx tsc --noEmit` clean · 671/671 across `src/domains/recommendations/` (was 649; +22) · `npm run test` 3371/3375 (4 pre-existing failures verified independent of this change against `5d32f5f` baseline) · `npm run build` clean.
> - **Could not verify from this environment:** Vercel deploy SHA matches `37ef437` — operator dashboard check.
>
> **Out of scope (per W3 §1.5 + Step 3.4 scope):**
> - **LIVE paid generation across the queue** — tests use mocks; first paid runs are post-Step-3.6, operator-approved per packet
> - Apply-All-HIGH bar — deferred until founder reviews 20–30 generated recs
> - Recommendations UI cleanup — Step 3.5
> - Customer-one backfill — W4
> - Profound CSV archive / code deletion — post-May-10
>
> **Next 3 actions:**
> 1. **Operator: confirm Vercel deploy of `37ef437` is "Ready".**
> 2. **Continue W3 Step 3.5 (Recommendations UI cleanup).** Renders the `engineConfidence` pill (now real, since Step 3.4 closed the loop), simple-card default, evidence expansion. Operator scope explicitly forbids Apply-All-HIGH UI.
> 3. **(Optional, operator-gated) one-rec dry-run sample.** Pick a single rec with real packet signals; run `runProviderAndPersist({ packet, dryRun: true })` against the live OpenAI provider; inspect the bundle WITHOUT persisting. Confirms the SYSTEM_PROMPT v2 produces grounded edits before Step 3.6's broader sample-10 quality report.

> 🟢 **W3 Step 3.3 (Confidence rubric — the trust contract) LANDED (2026-05-02):** Single code commit `ab3b11a` on `main`. Defines HIGH / MEDIUM / LOW BEFORE the LLM provider activates in Step 3.4. Founder direction: "confidence is the trust contract; the LLM provider should not activate first and then have confidence slapped on after."
>
> - **`src/domains/recommendations/confidence.ts` (NEW)** — `RecConfidence = "high" | "medium" | "low"` + 22 stable `ConfidenceReasonCode`s + `computeRecConfidence(args)`. Pure / deterministic. Imports `looksLikePlaceholder` from Step 3.1 for defense-in-depth.
> - **HIGH is hard to earn on purpose** (operator-locked). Requires ALL six dimensions to pass: ≥2 affected prompts, resolverTier in {adjudicated, inventory}, every edit at "high", packet has aiSearchSignal OR competitorPageBlueprints, resolutionConfidence === "high", evidenceRefCount ≥ 2. Any blocker forces MEDIUM (after LOW gates pass). Targeted distribution: HIGH 5–15% / MEDIUM 50–70% / LOW 20–40%.
> - **LOW gates short-circuit** (first match wins): no_affected_prompts / needs_human_review / no_edits / edit_low_confidence / edit_placeholder_text (defense-in-depth via Step 3.1's `looksLikePlaceholder`) / competitor_name_leak_in_copy / tier_deterministic_only / resolution_low_confidence.
> - **Apply-All-HIGH explicitly OUT.** The rubric file documents that HIGH means "likely safe to ship MANUALLY," never "auto-apply." Test `Apply-All-HIGH guardrail` enforces a 5+ reason floor for HIGH so any future weakening of the rubric to a single positive signal forces a conversation.
> - **Loader integration (`load-queue.ts`)** — new `LiveRecQueueItem = PrioritizedRecommendation & { engineConfidence: RecConfidenceVerdict }`. Loader fresh-reads `recommended_edits` (moved from page.tsx) and stamps engineConfidence on every queue item. `LiveRecommendationQueue.recommendedEdits` exposes the rows so page.tsx consumes via `live.recommendedEdits` instead of re-fetching. `hasAiSearchSignal` / `hasCompetitorPageBlueprints` pass through `false` at this layer — HIGH is intentionally unreachable today; Step 3.4 plumbs in real packet signals so the trust label earns its weight when the LLM provider activates.
> - **Page integration (`page.tsx`)** — `RecommendationQueueRow.rec` is now `LiveRecQueueItem`. UI doesn't render the verdict yet (Step 3.5); the field is exposed so the upcoming UI cleanup reads it without a second wiring pass.
> - **Wiring tests updated** — `tests/sprint6a1-phase12-wiring.test.ts` and `load-queue.test.ts` updated to assert the relocated edits-read in the LOADER (single source of truth for engineConfidence input) and that page.tsx no longer re-fetches.
>
> **Verification (2026-05-02):**
> - `npx tsc --noEmit` clean · 28/28 confidence tests · 22/22 wiring · 9/9 reads-fresh · `npm run test` 3349/3353 (4 pre-existing failures verified independent of this change against `5d32f5f` baseline: 3 prompts-smoke fixture time-drift + 1 tenants/isolation) · `npm run build` clean.
> - **Could not verify from this environment:** Vercel deploy SHA matches `ab3b11a` — operator dashboard check.
>
> **Out of scope (per W3 §1.5):**
> - Apply-All-HIGH bar — deferred until founder reviews 20–30 generated recs
> - LLM provider activation — Step 3.4 (next)
> - Recommendations UI cleanup — Step 3.5
> - Customer-one backfill — W4
> - Profound CSV archive / code deletion — post-May-10
>
> **Next 3 actions:**
> 1. **Operator: confirm Vercel deploy of `ab3b11a` is "Ready"**.
> 2. **Continue W3 Step 3.4 (LLM provider activation).** Wires the SYSTEM_PROMPT v2 to consume the Step 3.2 evidence packet (`aiSearchSignal` + `competitorPageBlueprints` + cross-tenant brain stub). With Step 3.3 in place, the producing LLM's edits get stamped with the trust label as they flow through `load-queue.ts`. Anti-leak guards (no competitor names in Ritz copy) live in the validator + the rubric's competitor-name-leak LOW gate.
> 3. **Browser-spot-check /recommendations** — page should look identical to post-Step-3.2; engineConfidence is stamped server-side but the UI doesn't render the pill yet (Step 3.5).

> 🟢 **W3 Step 3.2 (Recommendation Engine v2 evidence packet foundation) LANDED (2026-05-01):** Single code commit `bded491` on `main`. Three new blocks land on `SpecificEditEvidencePacket` — `aiSearchSignal`, `competitorPageBlueprints`, `crossTenantPatterns`. Step 3.4's LLM provider will consume them; this step ships the packet shape only (no LLM call, no UI consumer).
>
> - **`aiSearchSignal`** — what AI actually emits while answering affected prompts. `topSearchQueries` (verbatim, deduped + counted across observations + platforms), `topDescriptors` (lowercased near-brand descriptor windows), `topCompetitorCoMentions` (filtered through `entity-pollution-filter` so Houzz/Yelp/Angi/BuildZoom never reach the LLM as "competitors"). Caps 10/12/8. Empty arrays when no signal — better empty than fake.
> - **`competitorPageBlueprints`** — top competitor pages cited on affected-prompt observations. URL + domain + topic + citationCount + promptsCitedOn from real aggregation; pageTitle from `CompetitorPageEvidence` when available; h1/topH2s/faqQuestions/metaDescription stay null/empty (future scraper; never invented). Filters: drop `class !== "competitor"`, drop directory domains, drop owned domains. Cap = 5.
> - **`crossTenantPatterns`** — STUB. New `src/domains/recommendations/cross-tenant-brain.ts` defines `CrossTenantPattern` + `GetCrossTenantPatternsArgs` + `getCrossTenantPatterns()` returning `[]`. Pure, operator-locked signature so the future producer (post-month-3) drops in without touching consumers. Activation gated to `BEACON_CROSS_TENANT_BRAIN=1` (env not yet wired).
> - **Packet shape + `evidenceHash`** — all three new fields are required (empty defaults), so `evidenceHash` is deterministic regardless of producer state. Tests prove hash flips on `aiSearchSignal` change AND on `competitorPageBlueprints` change, and stays stable across re-runs with identical inputs.
> - **New optional builder args** — `citationEvidenceIndex` + `competitorPages` (both default null/[] so existing callers keep working without modification).
>
> **Verification (2026-05-01):**
> - `npx tsc --noEmit` clean · 106/106 targeted (102 evidence-packet + 4 cross-tenant stub) · `npm run test` 3321/3325 (4 pre-existing failures verified independent of this change against `5d32f5f` baseline: 3 prompts-smoke fixture time-drift + 1 tenants/isolation, same set as W1/W2/W3-scope-lock/W3-Step-3.1/W3-Step-3.1b baselines) · `npm run build` clean.
> - **Could not verify from this environment:** Vercel deploy SHA matches `bded491` — operator dashboard check.
>
> **Out of scope (per W3 scope lock):**
> - LLM provider activation — Step 3.4
> - Confidence rubric — Step 3.3 (type stubs only if strictly necessary; not needed for 3.2)
> - Recommendations UI cleanup — Step 3.5
> - Apply-All-HIGH bar — deferred until 20–30 manual reviews
> - Customer-one backfill — W4
> - Profound CSV archive / code deletion — post-May-10
>
> **Next 3 actions:**
> 1. **Operator: confirm Vercel deploy of `bded491` is "Ready"** — single code commit + sibling docs commit.
> 2. **Continue W3 Step 3.3 (confidence rubric)** OR jump to **Step 3.4 (LLM provider activation)** depending on operator preference. The rubric is a single pure file (`computeRecConfidence(rec, edits) → "high" | "medium" | "low"`) stamped on `rec.resolution.confidence` in `load-queue.ts`. Step 3.4 wires the SYSTEM_PROMPT v2 to consume this packet.
> 3. **Browser-spot-check /recommendations** to confirm Step 3.1b's quarantine + 3.2's no-op (3.2 changes packet shape; the deterministic generator path is unchanged at this step, so the visible queue should look identical to post-Step-3.1b).

> 🟢 **W3 Step 3.1b (Pre-W3 placeholder quarantine) LANDED (2026-05-01):** Single code commit `1be64f9` on `main`. The 4 Los Altos `add_faq` rows operator-accepted before Step 3.1's hardening are now `dismissed` with `not_found_reason: "invalid_placeholder_pre_w3"`. Architecture invariant allowlist DROPPED; placeholder copy is no longer renderable on /recommendations or /today.
>
> - **Quarantine script (`scripts/quarantine-pre-w3-placeholder-edits.ts`, NEW)** — mirrors `archive-faq-test-pollution.ts`: idempotent, dry-run + execute modes, preflight + postflight assertions, hardcoded targets (4 placeholder IDs + sibling H2 + rec-level response). Forward-only flip: `accepted` → `dismissed` with the documented reason. Local file write + Supabase dual-write (DUAL_WRITE=true confirmed). All 10 postflight checks green; sibling H2 + rec response byte-equivalent.
> - **UI filter (`recommendations-client.tsx`)** — rec card now filters `dismissed | not_found_after_7d` before rendering `SpecificEditsSection`. Without this, a dismissed placeholder row would still appear in the expanded edits list with a "Dismissed" pill but the original placeholder text still on screen. The lifecycle classifier on /changes already drops both to `unclassified`; this brings /recommendations into parity. Destructure renamed `edits` → `allEdits` so the filtered array takes the `edits` name; editCount + eligibleEditCount + the consumer all read the filtered array.
> - **Architecture invariant (`tests/architecture/no-placeholder-recommended-edits.test.ts`)** — `KNOWN_PRE_W3_PLACEHOLDER_IDS` allowlist DROPPED. Replaced with `QUARANTINED_PRE_W3_IDS` (same 4 IDs, but as a regression target, not an exemption). Two new tests pin the post-Step-3.1b state: "quarantined rows are dismissed with the documented reason" + "quarantined rows do not pass `isActive` filter."
> - **Regression test (`tests/app/recommendations/pre-w3-quarantine-non-renderable.test.ts`, NEW)** — 5 focused tests covering: (1) 4 IDs dismissed with reason, (2) /recommendations rec card filter blocks them, (3) /today implementation-queue source predicate blocks them, (4) original `proposed_text` preserved (history not deleted), (5) architecture invariant active-row scan finds zero violations.
> - **Wiring test (`tests/sprint6a1-phase12-wiring.test.ts`)** — Phase 6A.1.12 destructure-pattern regex updated for the new `edits: allEdits` shape; behavior contract unchanged.
>
> **Verification (2026-05-01):**
> - `npx tsc --noEmit` clean · 184/184 targeted tests pass + 22/22 wiring · `npm run test` 3295/3299 (4 pre-existing failures verified independent of this change against `5d32f5f` baseline: 3 prompts-smoke fixture time-drift + 1 tenants/isolation, same set as W1 + W2 + W3-scope-lock + W3 Step 3.1 baselines) · `npm run build` clean.
> - **Could not verify from this environment:** Vercel deploy SHA matches `1be64f9` — operator dashboard check.
>
> **Acceptance (per operator scope):**
> 1. ✅ `.data/tenants/*/recommended-edits.json` has zero active/renderable placeholder edits.
> 2. ✅ Architecture invariant has no permanent allowlist (replaced with explicit `QUARANTINED_PRE_W3_IDS` regression target).
> 3. ✅ Old placeholder rows are filtered AND marked invalid; they do not render as a usable recommendation.
> 4. ✅ No new placeholder rows can be added (Step 3.1's validator + generator gates).
> 5. ✅ History preserved: dismissed rows still carry their original proposed_text in the data store.
>
> **Next 3 actions:**
> 1. **Operator: confirm Vercel deploy of `1be64f9` is "Ready"** — single code commit + sibling docs commit.
> 2. **Browser-spot-check /recommendations** for the Los Altos rec — should show 1 H2 edit only (the sibling), not 5 (4 dismissed FAQs hidden by the new filter).
> 3. **Continue W3 Step 3.2 (evidence packet extension).** Foundation for Step 3.4 LLM activation: `aiSearchSignal` + `competitorPageBlueprints` + cross-tenant brain stub.

> 🟢 **W3 Step 3.1 (Placeholder kill + FAQ structural-quality gate) LANDED (2026-05-01):** Single code commit `dd59d6a` on `main`. Beacon now refuses to put placeholder copy in the recommendation queue at three layers — helper, validator, and the deterministic FAQ generator's abstain path.
>
> - **Helper (`src/domains/recommendations/placeholder-detection.ts`, NEW)** — `PLACEHOLDER_PATTERNS` covers 8 operator-locked phrases (Draft answer / TBD / operator: rewrite / (operator: ...) / rewrite below / [insert ...] / placeholder / TODO:) with word-boundary anchors so legitimate copy ("our crane operator drafts each plan") never false-matches. `evaluateFaqAnswer({question, answer})` returns a discriminated verdict with reasons `too_short` (<25 words), `repeats_question` (≥80% content-word overlap), `no_specific_content` (<5 distinct words after stopwords + question + GENERIC_FILLER), or `placeholder_phrase`. `parseFaqProposedText` extracts Q + A halves from the deterministic generator's `Q: ... \n\nA: ...` shape.
> - **Validator (`specific-edit-validator.ts`)** — New rule 9.55 (`validateNoPlaceholder`) wired between FAQ-intent-rewriting (9.5) and competitor-public-copy (9.6). Two passes: phrase scan against proposedText AND displayLabel; structural scan against parsed Q+A bodies for FAQ action types. **No env opt-out** — placeholder copy must never reach the queue. Existing rule 9.5 ("?" check) extended to recognize the Q+A shape so the deterministic generator's full output runs the gate (was previously filtered out).
> - **Generator (`add-faq.ts`)** — `composeAnswerSeed` now returns `string | null`. Three branches: (A) ≥2 descriptors → real grounded body referencing actual descriptors AI uses; (B) 1 descriptor + cluster label → narrower body anchored on both; (C) abstain. Branches A and B validate via `evaluateFaqAnswer` before returning, falling through on fail. Outer loop sees null, rolls back the dedupe entry, emits no edit. Apologetic risk copy ("operator must rewrite") replaced with grounded framing.
> - **Architecture invariant** — `tests/architecture/no-placeholder-recommended-edits.test.ts` scans every tenant's `recommended-edits.json` for placeholder phrases AND for FAQ structural failures. The 4 Los Altos add_faq rows operator-accepted before the hardening are allowlisted by id (`KNOWN_PRE_W3_PLACEHOLDER_IDS`); the test refuses to grow the list. Stale-allowlist guard ensures entries are removed when the underlying rows get regenerated.
>
> **Verification (2026-05-01):**
> - `npx tsc --noEmit` clean · placeholder-detection 32/32 · validator 103/103 (11 new) · generators 40/40 (6 new) · architecture invariant 3/3 · `npm run test` 3289/3293 (the 4 failures are the same pre-existing set as W1/W2/W3-scope-lock baselines: 3 prompts-smoke fixture time-drift + 1 tenants/isolation) · `npm run build` clean.
> - **Could not verify from this environment:** Vercel deploy SHA matches `dd59d6a` — operator dashboard check.
>
> **Out of scope (per W3 scope lock):**
> - LLM provider activation (Sprint 6A.2) — Step 3.4
> - Recommendations UI cleanup — Step 3.5
> - Apply-All-HIGH bar — deferred
> - Customer-one backfill — W4
> - Profound CSV archive / code deletion — post-May-10
>
> **Next 3 actions:**
> 1. **Operator: confirm Vercel deploy of `dd59d6a` is "Ready"** — Step 3.1 is a single code commit + sibling docs commit.
> 2. **Continue W3 Step 3.2 (evidence packet extension).** Adds `aiSearchSignal` (top search queries + top descriptors + top competitor co-mentions filtered through entity-pollution-filter), `competitorPageBlueprints` (top-cited competitor pages joined to `page_element_inventory`), and `crossTenantPatterns` (stub returning `[]`). Foundation for Step 3.4 LLM activation.
> 3. **Watch the next regeneration cycle** for the 4 known-bad Los Altos FAQ rows. They stay `accepted` until Step 3.4's LLM provider replaces them with grounded copy; the architecture invariant's allowlist will shrink to zero at that point.

> 🟡 **W3 SCOPE LOCKED (2026-05-01) — founder-revised before any W3 code lands:**
>
> **In scope:**
> 1. **Recommendation Engine v2 evidence packet.** Extend `SpecificEditEvidencePacket` with `aiSearchSignal` (top search queries, top descriptors, top competitor co-mentions filtered through entity-pollution-filter), `competitorPageBlueprints` (top-cited competitor pages joined to `page_element_inventory`), and `crossTenantPatterns` (stub returning `[]` — no real cross-tenant logic yet).
> 2. **Placeholder kill.** Validator rejects `Draft answer / TBD / [insert / rewrite below / (operator: rewrite)` patterns. Deterministic generators abstain when no `aiSearchSignal.topSearchQueries` AND no `competitorPageBlueprints` AND no descriptors-near-brand. Better empty than bad.
> 3. **LLM provider activation (Sprint 6A.2 deferred from W2).** OpenAI provider uses the evidence packet. Grounded edits only. No competitor-name leakage into Ritz copy. No generic SEO fluff. Budget-gated through existing `adjudicator-budget.ts` ($200/mo cap).
> 4. **Confidence rubric.** New `src/domains/recommendations/confidence.ts` with `computeRecConfidence(rec, edits)` → `"high" | "medium" | "low"`. **HIGH means "likely safe to ship manually," NOT "auto-apply."** Stamped on `rec.resolution.confidence` in `load-queue.ts`.
> 5. **Recommendations UI cleanup.** Simple card default. Evidence expansion. Confidence pill. (UUIDs + jargon already killed in W1.) **No Apply-All-HIGH bar.**
> 6. **Tests / gates.** New architecture invariants: 0 placeholder rendered edits; 0 UUIDs (existing); Houzz/directories excluded from competitor instructions (existing); thin-evidence abstain; cost cap enforced. **Sample 10 generated recs on Ritz prod data and report quality honestly** — this is the W3 gate.
>
> **Explicitly out of scope for W3:**
> - **Apply-All-HIGH bar.** Deferred until the founder has personally inspected 20–30 generated recommendations and trusts the HIGH label. Until then, the only acceptance path is per-rec Accept (existing `acceptRecommendation`).
> - **`acceptAllHighConfidence` / `undoAcceptAllHighConfidence` server actions.** Not built.
> - **Customer-one backfill mutation.** Backfill execution remains W4. W3 ships against current native-only data (since 2026-04-22) plus the schema-compatible model already in place.
> - **Profound CSV archive + Profound code deletion.** Both deferred until after May 10 expiry.
> - **`llm-budget-tiers.ts`.** Tier-aware caps deferred — single-tenant single-pricing for now; existing `adjudicator-budget.ts` is enough.
>
> **Master plan file** (`~/.claude/plans/beacon-master-sorted-creek.md`) §3.2, §5.6, §5.7, §9 W3 row, §10 file summary, §13 risk register, §14 success criteria all updated to reflect this amendment. Plan-file edits paired with the doc commit below so any context-reset agent reads the same scope.
>
> **Capability tier for W3:** **Max** — touches the wedge data path (LLM-grounded copy, validator semantics, evidence-packet shape that the brain learns from), and the confidence rubric is the trust contract for every future batch UX.

> 🟢 **W2 Step 2.4 (Operator Mark-shipped + day-3 stale tint) LANDED (2026-05-01):** Single commit `260b313` on `main`. Adds the manual override that lets an operator start the verdict bake-window clock from /recommendations or /changes without waiting for tomorrow's 07:00 UTC scan, plus a day-3 yellow tint that warns when accepted edits sit unconfirmed.
>
> - **Persistence (`src/domains/recommendations/recommended-edits-persistence.ts`)** — `LiveMatchKind` extended with `"operator_override"` (never emitted by the match engine; only stamped by the new helper). New `markRecommendedEditsAsShipped({ editIds, tenantId, now? })` flips `recommended` or `accepted` → `verified_live` with `live_at = nowIso`, `live_match_kind = "operator_override"`, `live_match_confidence = "high"`. Forward-only at the persistence layer: rows already past `verified_live` are no-op. Idempotent. Dual-write follows the same file-first-then-Supabase contract as `markRecommendedEditsAccepted`. 10 new unit tests cover every transition path (recommended→shipped, accepted→shipped, all 7 forward-state no-ops, legacy undefined, unknown ids, empty input, field preservation, idempotency, dual-write failure, mixed-id batching).
> - **Server actions** — New `markRecommendationShipped({ stableKey })` in `src/app/(shell)/recommendations/actions.ts` reads the rec's edits, filters to eligible (`recommended | accepted`), batches through the persistence helper, revalidates `/recommendations` + `/changes` + layout. New file `src/app/(shell)/changes/actions.ts` adds `markChangelogEditShipped({ changelogId })` — re-resolves `(source_rec_id, action_type, target_element_key)` via `changelogJoinKey` + `indexEditsByJoinKey`, single-edit batches through the helper. Re-resolving server-side keeps the lifecycle invariant honest even when the UI is stale.
> - **/recommendations UI** — `eligibleEditCount` filtered inline (`row.implementation_status ?? "recommended"`) to keep the file client-safe (importing the helper module would pull `server-only` runtime code into the client bundle and break the build — verified by an actual failed `npm run build`, fixed by inlining). `acceptedAgeDays` derived from `response.respondedAt`; `isStalePending = accepted && eligibleEditCount > 0 && age ≥ 3 days`. Card border + bg flip yellow with an "Nd pending" pill next to "✓ Accepted". "Mark shipped" button renders only when accepted && eligible > 0; tooltip explains the operator-override stamp. Once every linked edit reaches `verified_live` the button vanishes.
> - **/changes scorecard UI** — `canMarkShipped = lifecycleStatus ∈ {recommended, accepted}` (uses the existing `editStatusByChangelogId` map; no new data path). `ageDays` from `changelog.timestamp` (accept-at proxy because per-edit fan-out fires at accept time). Stale-pending tints the `<tr>` warning-yellow + "Nd pending" pill below the lifecycle pill. "Mark shipped" button under the pill with `stopPropagation` so pressing it doesn't toggle the row's expand. Inline feedback (success or error) without navigating away.
>
> **Verification (2026-05-01):**
> - `npx tsc --noEmit` clean · vitest persistence file 43/43 (10 new + 33 existing) · architecture invariants 157/157 · changes-smoke 1/1 · `npm run test` **3234 / 3238** (4 pre-existing failures verified independent of this change — same set as W1 + W2 2.3 baselines).
> - `npm run build` clean — caught a server-only-on-client regression mid-implementation (recommendations-client tried to import `editLifecycleStatus` from the persistence module which has `import "server-only"`); fixed by inlining the one-liner. Full route table emits.
>
> **Explicitly out of scope for 2.4 (per operator direction):**
> - Profound CSV archive — May 10 expiry hasn't passed.
> - Profound code deletion — waits until after May 10 cutover.
>
> **Next 3 actions:**
> 1. **Operator: confirm Vercel deploy of `260b313` is "Ready"** — single code commit, docs sync follows in a sibling commit.
> 2. **Browser-spot-check /recommendations + /changes** for the new Mark-shipped buttons. Stale tint will only render against rows whose `respondedAt` (recs) or `timestamp` (changelog) is ≥3 days old; current Los Altos accepted rec from 2026-04-25 is 6 days old as of today, so its card should render with the yellow tint and "6d pending" pill.
> 3. **Continue W2.** Step 2.4 is the last polish piece before W2 Step 2.5 (the rec-engine v2 Sprint 6A.2 activation deferred from W2). Or proceed to W3 (Recommendation Engine v2 query fan-out) per master plan §9.

> 🟢 **W2 Step 2.3 (How AI described you v2 layout) LANDED (2026-05-01):** Commit `62ce313` pushed to `main`. Replaces the old `EnrichmentBadges` single-day component with the 4-section v2 layout (Who AI thinks you are / Who AI thinks they are / Where AI ranks you / What format wins). Pure UI consumption of the Step 2.2/2.2b data contracts — every product-intelligence decision lives in the data layer; the React tree just maps fields to copy + visuals. New components: `enrichment-v2.tsx`, `sparkline.tsx`, `competitor-select.tsx`, `structure-labels.ts`. Hosted smoke confirmed `/login` 200, `/api/poll/run` 401, root redirects. Vercel SHA verification inconclusive from this environment.

> 🟢 **Week 1 (Trust + Polish) LANDED (2026-05-01):** 5 logical commits + 1 docs-contract commit, pushed `5d32f5f..5cfd9e7`. Founder-felt UI bugs across /today + /recommendations now fixed; new architecture invariants prevent regression. Roadmap reordered last turn — W1 trust → W2 wedge UX → W3 recs v2 → W4 backfill → W5 sellable.
>
> - **Step 1.1 (`333d74e`)** — UUID hygiene. New `src/domains/recommendations/evidence-summary.ts` (helper + 10 unit tests). `prompt:7ee3216b-...` chips on /recommendations + /changes detail now render `prompt: "<text snippet>"`. Two leak sites killed: `recommendations-client.tsx:1101` and `actions.ts:298`. `promptTextById` threaded from page server → client.
> - **Step 1.2 (`a9f6da4`)** — Operator jargon sweep, scoped to `src/app` + `src/components`. "Decide tonight" → "Action queue"; `EVIDENCE_BASIS_LABEL.heuristic` value → "Pattern-based" (internal enum key preserved); "Profound-style" stripped from Today chart components + composite tooltip. New invariant `tests/architecture/no-operator-jargon.test.ts` walks scoped roots, strips comments before matching, fails on banned strings. Domain modules + methodology copy + import-page references intentionally untouched.
> - **Step 1.3 (`ec8b140`)** — VSR delta math + calendar-window chart. `EntityVisibility.delta` now `number | null` with sample-day counts; `computeLeaderboard()` takes `windowDays` + `windowEndDate`, derives both windows internally; previous-window samples below `⌈N/3⌉` (floor 2) → `delta: null` (never faked 0). Server precomputes leaderboard for every chart-toggle window (7/14/30/60). `timeRange` lifted to `today-client.tsx`; chart switches from `slice(-N)` to calendar-date filter; "K sampled days in this N-day window" strip honest about sparse sampling. Headline delta relabelled "X.X pt within this window" so it never blurs with leaderboard's "vs. previous N days".
> - **Step 1.4 (`d57327d`)** — Entity pollution filter. New `src/domains/recommendations/entity-pollution-filter.ts` with `isDirectoryEntity()` + metadata-first `shouldExcludeFromCompetitorRanking()`. Houzz / Yelp / Angi / BuildZoom / Thumbtack / BBB / generalcontractors.org excluded from competitor ranking AND from rec engine `competitorAngles` aggregation. Real builders (De Mattei, Kasten, Supple) survive; "Bay Builders" with metadata kept; "General Contractors" by name only excluded. `dir-generalcontractors-org` row NOT deleted from `tracked-entities.json` because pages.json + 10+ citation cold-store shards reference it; the directory filter handles it operationally.
> - **Step 1.5 (`9b98d15`)** — Poll chunk failure resilience. New `poll-error-classifier.ts` (8 kinds, retryable only on `transient_network` / `timeout` / `server_5xx`). Per-prompt single retry on 1s backoff, NO retry on auth / rate_limit / invalid_request / parse_error. New `PerplexityPollResult.reliability` block (`retryCount`, `failureCountsByKind`, `dominantFailureType`, `estimatedUnconfirmedCostUsd`). Structured `CHUNK_SUMMARY` JSON line per run. Silent post-sample try/catch replaced with classified `PERSIST_FAILED` log + `estimated_unconfirmed_cost` accumulator. **`BEACON_PER_RUN_BUDGET_USD` default $5 → $8** in code (env override unchanged); operator must verify Vercel env var manually. Tests: 49 (16 classifier + 8 integration cases covering every operator-brief scenario).
> - **Docs (`5cfd9e7`)** — `CLAUDE.md` execution-contract override: accepted-plan = full landing-strip (edits + tests + commits + push + deploy + verify). Pause unchanged for destructive / data-deletion / hosted-env / paid-API / irreversible-migration.
>
> **Verification (2026-05-01):**
> - `npm run typecheck` clean · `npm run test` **3143 / 3147** (4 pre-existing failures verified against `5d32f5f` baseline: 3 prompts-smoke fixture time-drift + 1 tenant-isolation) · `npm run build` clean.
> - `https://beacon-bice.vercel.app/login` HTTP 200; `/api/poll/run` 401 with bad bearer.
> - **Vercel deploy SHA + `BEACON_PER_RUN_BUDGET_USD` env var unverifiable from this environment** — no Vercel CLI / API token. Operator must check the dashboard.
>
> **Backfill methodology accepted in principle (Method 1: aggressive deterministic re-extraction); preflight blockers landed 2026-05-01 evening:**
> 1. Reconcile 498K-vs-14K row count discrepancy (498,676 lines is the truthful raw CSV count; 14K likely = distinct prompt-date-platform tuples).
> 2. Recover historical entity-registry from git history before accepting `medium_entity_drift`.
> 3. Run preflight stage (no mutation) producing inventory + field recovery + prompt match + entity drift + truncation reports + 20 sample observation JSONs.
> 4. Decide observation model: row-level (~498K) vs cell-deduped (~14K) vs cell-merged (~14K with unioned signals).
> Preflight agent currently running. Backfill execution remains W4. Provenance terminology locked: `native_live` / `historical_recovered` / `historical_imported`. Never "fake native"; always "native-shaped recovered observations".
>
> **Next 3 actions:**
> 1. **Operator: verify Vercel deployment of `5cfd9e7` is "Ready" + check `BEACON_PER_RUN_BUDGET_USD` env var** (decision yes/no on the $8 bump).
> 2. **Read the preflight report** when it lands (`/tmp/beacon-preflight-2026-05-01.md`); approve or amend Method 1 against the verified data shape; greenlight Week 2 kickoff.
> 3. **Watch tomorrow's 07:00 UTC poll for `CHUNK_SUMMARY` log evidence** that Step 1.5 deployed and is logging the new structured summary.

> 🟢 **Phase v4 Commits 5–7 LANDED (2026-04-30) — "Replace Profound" finishing pass:** Closed the last open work in `/Users/armeen/.claude/plans/you-are-taking-over-floofy-giraffe.md` so Profound's 2026-05-10 expiry is a non-event for daily operation. Source plan: `/Users/armeen/.claude/plans/you-are-working-on-purring-shell.md`. Full detail in `docs/VERIFICATION_LOG.md` 2026-04-30 entry.
>
> - **Commit 5 (Today KPI flip)** — verified live. Derived snapshots flowing daily; today scoreboard reads `daily_metric_snapshots source_type='derived' scope_type='platform'` with "As of Apr 30 (today)" / "(yesterday)" fallback badge. No code changes needed — already shipped, validation only.
> - **Commit 6 (Schema v2 + extraction backfill)** — verified live. 1761/1761 (100%) post-Apr-22 observations carry `descriptor_window` / `competitor_co_mentions` / `citation_domain_classes` / `answer_structure`. Polls + backfill both healthy.
> - **Commit 7B (Citation evidence index rebuild from native)** — the big one. `citation_evidence_index` was 15 days stale (`built_at=2026-04-15`, 105,927 Profound citations). Wired `scripts/rebuild-citation-evidence-index-native.ts` for nightly auto-execution: script now dual-writes (file + Supabase); new hosted endpoint `POST /api/cron/rebuild-citation-evidence-index`; new GH Actions job `rebuild-citation-evidence-index` runs after both poll jobs with `if: always()`. Manual rebuild ran today: `built_at=2026-04-30T21:13:52.951Z`, 7,960 native citations, 769 pages, top topics LA/Cupertino/Menlo/Atherton/Shield. /pages, /competitors, /topics, /changes now read live native data.
> - **Commit 7A (Mixed-source full Z-score math)** — replaced Commit 2's pure-split abstain with a partial-overlap drop-benchmark filter at `src/domains/attribution/url-verdict.ts`. When baseline + post mix `source_type`, drop benchmark days from both windows; abstain (`not_enough_native_baseline`) only when filtered baseline < `baselineMinDays`. Why drop instead of regime-shift scaling: no parallel-system overlap days exist (Profound stopped Apr 15, native started Apr 22). 5 new partial-overlap test cases pass; 23 existing pass. Verdict label `"No native baseline"` → `"Not enough native data yet"`.
> - **Commit 7B (enrichment badges)** — verified rendering on /today via the existing `EnrichmentBadges` (`src/components/today/enrichment-badges.tsx` Apr 23). 200 obs/day × 2 platforms feeding live data through `buildEnrichmentRollup`. No code change needed.
> - **Commit 7D (Copy audit)** — killed user-visible Profound/`BEACON_*` jargon on 6 routes. `lifecycle-attribution-copy.ts`: dropped env var name from `verdict_off` tooltip; `not_implemented` label → `"Not shipped"`; `EVIDENCE_FRESHNESS_NULL_COPY` rewritten. `evidence-freshness-banner.tsx`: split into 3 branches (null/fresh-green-<36h/stale-amber-≥3d), all "Profound" mentions removed from visible copy. `scorecard-client.tsx`: 2 fixes (legacy-rows empty state + URL-not-cited fallback). `methodology/page.tsx`: opening explainer now describes native polling instead of Profound imports.
>
> **Verification (2026-04-30):**
> - `npm run typecheck` clean · `npm run test` 3080/3081 pass (1 pre-existing tenant-isolation failure, baseline) · `npm run build` clean.
> - Supabase `citation_evidence_index`: `built_at=2026-04-30 21:13:52.951+00`, 7960 citations, 12 topics, 1191 page×topic rows, 769 pages.
> - `.data/tenants/ritz-builders/citation-evidence-index.json`: matching built_at + counts (vestigial `tenant_id` field dropped; type schema doesn't include it).
> - `daily-native-poll.yml` now has 3 jobs (`poll-perplexity` + `poll-openai` + `rebuild-citation-evidence-index`); rebuild has `needs: [poll-perplexity, poll-openai]` + `if: always()`.
>
> **Next 3 actions (2026-04-30 → 2026-05-10):**
> 1. **Watch tomorrow morning's 07:00 UTC daily-native-poll cron run.** Verify the new `rebuild-citation-evidence-index` GH Actions job fires after both poll jobs and that `citation_evidence_index.built_at` updates within 60 min of the polls finishing. Failure → automatic GitHub email within 45 min (existing canary contract).
> 2. **Browser-spot-check /pages, /competitors, /topics on the Vercel preview deploy.** Top-3 competitors and topic rankings should differ visibly from last week's Profound-era data. EvidenceFreshnessBanner should render the green "live native data — last rebuilt {date}" branch.
> 3. **Decide on flipping `BEACON_LIFECYCLE_VERDICT_ENABLED=1`** once the H2's bake window elapses (earliest 2026-05-05, 7 days from `live_at=2026-04-28`). The "Verdict tracking off" pill copy already explains the flag-off state.

> 🟢 **Recommendation Lifecycle OS UI — Phases 6A.1 → 6A.10 LANDED (2026-04-28):** The lifecycle backend (Phases 0–5, hosted-cron Phase 6D) is now mirrored by an operator-grade UI. Single sweep across /changes + /today + /recommendations.
>
> - **6A.1** — archived the two unimplemented Whole Home Remodel FAQ test rows (`cl-mogzw78n87lkhq`, `cl-mogzw78n5j9e7u`) via idempotent script (`scripts/archive-faq-test-pollution.ts`). H2 `cl-mogzw78nv8pu54` preserved byte-for-byte; rec-level `recommendation_responses` row preserved. Both `.data` and Supabase mirrors mutated; 9/9 postflight checks passed including SHA fingerprints on H2 + rec response.
> - **6A.2** — `/changes` loader quarantine + lifecycle tabs. New pure classifier `src/domains/attribution/lifecycle-classification.ts` (priority order: live_verified → needs_review → pending_implementation → scan_confirmed → imported_legacy → unclassified). Default tab = `live_verified`; archived rows defended-against at the classifier even if a future loader bug surfaces them. PageHeader copy: "Verified and tracked changes…".
> - **6A.3** — `LifecycleStatusPill` component (`src/components/display/lifecycle-status-pill.tsx`). Granular `status` (verified_live / accepted / dismissed / needs_review / etc.) wins over `cls` fallback; compact + full modes; `data-lifecycle-key` for E2E. Rendered on every /changes row + every /recommendations specific edit. H2 reads `✓ Live`; Phase 6A.1 dismissed FAQs read `Dismissed`.
> - **6A.4** — `/today` scan-findings rename + collapse. "N changes detected" → "Scan diffs to review (N)" inside a `<details>` collapsed by default. "Confirm" → "Confirm and add to changelog" (server actions byte-identical). Anchor `#change-review-section` preserved.
> - **6A.6** — lifecycle-aware attribution copy. New `resolveAttributionCopy` (`src/domains/attribution/lifecycle-attribution-copy.ts`) replaces the misleading "No data" pill with branch-specific copy: "Too early — verdict pending" (verified_live within 7d), "Verdict tracking off" (verified_live ≥ 7d w/ flag off), "Waiting on implementation" (accepted, no live_at), "Not implemented" (not_found_after_7d), "Legacy — no eligible window", "Scan-confirmed — measuring", "Verdict pending" fallback. Verified-live bake-window override on stale stored outcomes locked by tests. `EvidenceFreshnessBanner` null-branch copy refreshed (no longer claims "no native polling").
> - **6A.7** — `/today` lifecycle status strip + implementation queue. `TodayLifecycleStrip` 4-chip row (live_verified always shown) + `TodayImplementationQueue` (top accepted edits not yet live). Same recommended_edits read /changes uses; strip and tab counts always reconcile.
> - **6A.8** — `/today` command-center hierarchy restructure. New 8-tier order locked by source-level test `tests/routes/today-section-order.test.ts`: critical alerts (poll/freshness/scan/needs-review) → `TodayDoNextCard` (priority: ship_pending > decide_recommendation > review_scan_diffs > calm) → lifecycle strip → impl queue (capped to 3) → Decide tonight queue → wins / latest signal → `TodayMetricsDisclosure` (collapsed; localStorage-persisted) → scan diffs (Phase 6A.4 contract intact). Queue rows surface a `needs rewrite` badge when `proposed_text` matches the generator placeholder pattern (the 4 Los Altos FAQ scaffolds). `/changes?tab=…` deep-link plumbing landed via `useSearchParams` + `router.replace`.
> - **6A.10** — strip parity on `/changes` (same `TodayLifecycleStrip`) + this docs sync. Strip's `notFoundAfter7d` count derived directly from `recommended_edits.implementation_status` since the classifier bins it into `unclassified`.
>
> **Current state of the truth surfaces (2026-04-28):**
> - `BEACON_LIFECYCLE_ENABLED` = ON (set in GH Actions secrets); hosted scan #4 ran successfully with `lifecycle.runnerCalled=true`, `evaluated=8`, `updated=0`, `liveAtStamped=0`, `noStableAcceptTimestamp=0`.
> - `BEACON_LIFECYCLE_VERDICT_ENABLED` = OFF (intentionally, per scope of every 6A.x phase).
> - `/changes` default tab = "Live verified", showing the H2 row only.
> - `/today` first non-alert section is the Do-Next card; lifecycle strip + queue follow; metrics + scan diffs collapsed at the bottom.
> - **Whole Home Remodel H2** is `verified_live` with `live_at=2026-04-28 05:26:26.05+00`, `live_match_confidence=high`, `live_match_kind=exact`, `live_element_key=h2[6]:070a58b1f3f4` (verified in Supabase). Reads `Live ✓` lifecycle pill + `Too early — verdict pending` attribution pill.
> - **Whole Home Remodel FAQ Q + A** are `dismissed` (recommended_edits) and `archived=true` (changelog). Excluded from /changes default and from /today implementation queue.
> - **Los Altos** rec (`create_cluster_page:geo:Los Altos`, accepted 2026-04-25) holds 5 pending accepted edits: 1 H2 (ship-ready) + 4 FAQ scaffolds with placeholder answers. Operator audit flagged FAQ rows as needing rewrite before shipping; queue surfaces this with the `needs rewrite` badge. **No mutation** — rows remain `accepted`.
> - Total UI test additions across 6A.1–6A.10: ~80 new tests; full suite 3052/3053 pass (1 pre-existing tenant-isolation failure unrelated to lifecycle work).
>
> **Next 3 actions:**
> 1. **Dogfood the new /today + /changes for a few days** before any further restructure. Real operator usage will reveal what the audit + tests can't.
> 2. **Wait for a real ambiguous match (`needs_review` / `partially_implemented` / `wrong_page`)** to appear in production data, then ship Phase 6B (one-click triage UX). Today's data has zero such rows.
> 3. **When the H2's bake window has elapsed (≥7 days from `live_at`)**, decide on flipping `BEACON_LIFECYCLE_VERDICT_ENABLED=1`. The "Verdict tracking off" pill copy already explains the flag-off state to operators.

> 🔴→🟢 **Accept ON CONFLICT bug FIXED (2026-04-27):** Operator-reported bug — clicking Accept locally with `DATA_SOURCE=supabase DUAL_WRITE=true` threw `"there is no unique or exclusion constraint matching the ON CONFLICT specification"`. Diagnosed as the same bug class as Sprint 6A.2f's `recommended_edits` fix, but on `recommendation_responses`: the Phase 7.2 multi-tenant migration swapped the PK from `(rec_id)` to `(tenant_id, rec_id)`, but `dual-write.ts:892` still passed `onConflict: "rec_id"` — single-column spec doesn't match the compound PK. Verified via `pg_indexes`: production has `recommendation_responses_pkey USING btree (tenant_id, rec_id)` and ZERO unique index on `rec_id` alone. **Fix:** one-line patch — `"rec_id"` → `"tenant_id,rec_id"` in `syncRecommendationResponses`. **Regression guard:** new `tests/architecture/dual-write-onconflict.test.ts` (5 invariants) pins the onConflict spec for `recommendation_responses`, `recommended_edits`, `url_change_outcomes`, `page_element_inventory`, `changelog_entries` against future drift. Sister sync helpers were spot-checked and confirmed correct (none had the same bug). **Verification:** typecheck clean · 2844/2844 vitest pass (was 2839 + 5 new) · architecture invariants 123/123 (was 118 + 5 new) · clean local build · Vercel-equivalent build green. **Operator action:** can now retry Accept on `/recommendations` from local dev. The operator's earlier file-write succeeded (response IS in `.data/tenants/ritz-builders/recommendation-responses.json:49–55` for Whole Home Remodel) — the changelog fan-out + lifecycle flip never ran because the action threw mid-flight. Re-clicking Accept will: (a) re-upsert the response (idempotent on `recId`), (b) NOW also dual-write to Supabase, (c) fire the changelog fan-out (3 entries), (d) flip the 3 `recommended_edits` to `accepted`. Then the Phase 3 lifecycle scan can run as Step 1 of the safety gate.

> 🟢 **Recommendation Lifecycle OS — Phase 4 LANDED (2026-04-27):** Verdict engine reads `live_at`-aware change date + emits new `not_implemented` label, both behind `BEACON_LIFECYCLE_VERDICT_ENABLED` (default OFF, independent from `BEACON_LIFECYCLE_ENABLED`). When OFF: byte-identical to pre-Phase-4 — no `live_at` reads, no `not_implemented` emission, no `recommended_edits` repository load. When ON: `computeChangeVerdict` resolves baseline-split via `entry.live_at ?? entry.timestamp`; `materializeUrlOutcomes` joins changelog → `recommended_edits` via `lifecycleLookupKey(source_rec_id, action_type, target_element_key)` and emits synthetic `not_implemented` (no Z-score, no series consumption, `confidence: "high"`) for entries linked to `not_found_after_7d` rows. **Z-score math, attribution windows, polling cadence ALL UNCHANGED.** New pure helpers: `resolveChangeDate(change, useLiveAt)` and `lifecycleLookupKey(...)`. New `ComputeVerdictOptions` type extends `computeChangeVerdict` API: `{ useLiveAt?, forceVerdict? }` — both optional, omitted = pre-Phase-4 behavior. `recordUrlOutcome` extended with `useLiveAt?` so `landing_day_n` resolution stays in lock-step with the verdict's baseline date. `not_implemented` added to `TERMINAL_VERDICTS` set + `VERDICT_LABEL`/`VERDICT_TONE` records. Files touched: `src/lib/flags.ts`, `src/domains/attribution/url-verdict.ts`, `src/domains/attribution/url-change-outcome.ts`, new `url-change-outcome.phase4.test.ts` (20 tests). **Verification:** typecheck clean · 2839/2839 vitest pass (was 2819 + 20 new) · architecture invariants 118/118 (no regression) · clean local build · Vercel-equivalent build green · operator data intact post-restore. **Operator action:** sign Phase 4. To dogfood: enable `BEACON_LIFECYCLE_ENABLED=1` first (Phase 3 runner), let it stamp `live_at` via scans for ≥7 days, accumulate at least one `not_found_after_7d` row, then flip `BEACON_LIFECYCLE_VERDICT_ENABLED=1` and compare /changes verdicts.

> 🟢 **Recommendation Lifecycle OS — Phase 3.1 LANDED (2026-04-27):** Surgical correction to Phase 3's accept-time fallback chain. **`recommended_edit.updated_at` is NEVER consulted as an age source** — the runner mutates `updated_at` on every write-back, so using it would reset the 7-day clock on every scan and silently disable the `not_found_after_7d` promotion. New chain (locked): (1) EXACT-matching `changelog_entries.timestamp` requiring `tenant_id` + `source_rec_id` + `action_type` + `target_element_key` (waived when edit's key is null) → (2) `recommendation_responses.respondedAt` (status=accepted, same rec_id) → (3) `edit.created_at` (immutable) → (4) **`null` — runner emits structured warning, increments `noStableAcceptTimestamp` counter, SKIPS the 7-day promotion**. `null` does NOT block other transitions (`verified_live*` promotions still fire). New `RunLifecycleMatchResult.noStableAcceptTimestamp` counter surfaces drift. Phase 3 still gated OFF by `BEACON_LIFECYCLE_ENABLED` — operator sign-off Phase 3 + 3.1 together before flipping. **Verification:** typecheck clean · 2819/2819 vitest pass (was 2806 + 13 new) · architecture invariants 118/118 (no regression) · clean local build · Vercel-equivalent build green · operator data intact post-restore.

> 🟢 **Recommendation Lifecycle OS — Phase 3 LANDED (2026-04-27):** Match runner wired into `runWebsiteScan` after the dual-write block, gated by **`BEACON_LIFECYCLE_ENABLED` (default OFF)**. When OFF: byte-identical no-op — zero repo reads, zero writes, zero log lines from the runner. When ON: reconciliation pre-pass (Phase 1 caveat fix, Option 2 — flips orphaned `recommended_edits` whose parent rec has accepted-evidence in `recommendation_responses` OR `changelog_entries`) → builds per-URL inventory keyed to latest snapshot → calls pure `matchAcceptedEdit` per accepted edit → applies forward-only state transitions (`verified_live ↔ verified_live_modified` is the ONE bidirectional pair; `verified_live*` NEVER auto-downgrades) → stamps `recommended_edits.implementation_status` + `live_at` + `live_snapshot_id` + `live_match_*` + `live_element_key` + `not_found_reason` → opportunistically stamps `changelog_entries.live_at` (idempotent — skips already-stamped). 7-day rule: `accepted` edit + `not_found` match + age ≥ 7d (sourced from earliest matching changelog timestamp, falling back to `recommendation_response.respondedAt`, then `edit.updated_at`) → `not_found_after_7d`. **Phase 3 does NOT change attribution math** — verdict engine still reads `entry.timestamp`. Phase 4 will switch to `live_at ?? timestamp` behind a SEPARATE flag. New files: `src/domains/recommendations/match-runner/{index,reconcile,transitions,inventory-by-url,persist}.ts` + 4 test files. New flag: `isLifecycleEnabled()` in `src/lib/flags.ts`. Single hook in `orchestrate-scan.ts` after `pageElements: inventoryRowCount` log line. **Verification:** typecheck clean · 2806/2806 vitest pass (was 2749 + 57 new) · architecture invariants 118/118 (no regression) · clean local build · Vercel-equivalent build green · operator data intact post-restore. **Operator dogfood instructions (do NOT run yet):** (1) Sign Phase 3 in `.data/exit-gates.json`. (2) Set `BEACON_LIFECYCLE_ENABLED=1` in `.env.local`. (3) Manual scan via Today "Scan now" or `npm run data:scan`. (4) Inspect `recommended_edits` in Supabase / `.data/tenants/ritz-builders/recommended-edits.json` to verify lifecycle field population. (5) Only after local dogfeed succeeds — flip on Vercel.

> 🟢 **Recommendation Lifecycle OS — Phase 2 LANDED (2026-04-27):** Pure-function match engine shipped at `src/domains/recommendations/match-engine/`. Six source files (`types.ts`, `normalize-text.ts`, `similarity.ts`, `per-action-matchers.ts`, `faq-pair.ts`, `index.ts`) + 1 test file (67 tests) + 1 architecture purity invariant (23 forbidden-import checks). **Zero I/O, zero DB, zero scan triggers, zero UI.** Engine consumes `RecommendedEditRow` + `PageElementInventoryRow[]` and returns `MatchResult` with `outcome ∈ {verified_live, verified_live_modified, needs_review, wrong_page, partially_implemented, not_found}` (note: `not_found_after_7d` is intentionally a runner-side decision since the pure fn has no clock). Per-action matchers cover all 10 supported action_types: `edit_title` / `edit_meta` / `change_h1` (singletons) · `add_h2_section` / `rewrite_h2` (positional with wrong-page detection) · `add_faq` / `rewrite_faq` (positional with `matchFaqPair` Q+A reconciliation → `partially_implemented`) · `add_internal_link` (anchor + href dual-signal) · `add_schema` / `fix_schema` (schema_type element lookup). Unsupported action_types return `not_found` + `kind: "unsupported"`. Canonical `normalizeText()` handles NFC + smart quotes + em/en/figure dashes + NBSP + whitespace collapse + terminal-punct strip + optional case-fold; idempotent. Hybrid `similarity()` = max(token-Jaccard, 1 − Levenshtein/maxLen) per spec §3.5. Confidence thresholds locked per action_type per spec §3.2. **Verification:** typecheck clean · 2749/2749 vitest pass · architecture invariants 118/118 (was 95 + 23 new purity) · clean local build · Vercel-equivalent build green · operator data intact post-restore. **Ready for Phase 3 wiring**, but Phase 1 caveat must be addressed first — see source plan.

> 🟢 **Recommendation Lifecycle OS — Phase 1 LANDED (2026-04-27):** Small nullable lifecycle schema migration applied (`lifecycle_os_phase1_recommended_edits_columns`): 7 new columns on `recommended_edits` (`implementation_status` text DEFAULT 'recommended' + 6 nullable `live_*` / `not_found_reason` fields) + 1 column on `changelog_entries` (`live_at` timestamptz null). Postgres backfilled all 8 existing recommended_edits rows to `implementation_status='recommended'`. Partial index `idx_recommended_edits_impl_status_accepted` for cheap "list accepted edits" lookups. New `ImplementationStatus` union (9 states per spec §2). New `editLifecycleStatus()` read-side normalizer treats undefined/null as `'recommended'` (legacy file rows safe). New `markRecommendedEditsAccepted()` helper: idempotent, forward-only (won't downgrade `verified_live` etc.), file-first then dual-write, best-effort dual-write failure handling. Wired into `acceptRecommendation` after the per-edit changelog fan-out — Accept now flips matching `recommended_edits` rows from `recommended` → `accepted`. **No attribution change**, **no match engine**, **no UI surface change**, **no scan trigger** — Phase 1 only ships the per-edit "intent declared" state. **Verification:** typecheck clean · 2682/2682 vitest pass · architecture invariants 95/95 · clean local build · Vercel-equivalent build green · Supabase columns verified · existing 11 legacy rows still load (field absent, normalizer returns `'recommended'`). **Operator next action:** sign Phase 1 in `.data/exit-gates.json` to authorize Phase 2 (pure match engine, no I/O — see source plan).

> 🟡 **Recommendation Lifecycle OS — Phase 0 LOCKED (2026-04-27):** New spec at [`docs/RECOMMENDATION_LIFECYCLE_OS_SPEC.md`](RECOMMENDATION_LIFECYCLE_OS_SPEC.md) locks the contract for the recommendation → implementation → verified-live → tracked loop. **No code changed in Phase 0** — doc-only. Source plan: `/Users/armeen/.claude/plans/you-are-taking-over-cryptic-brooks.md`. **Locked decisions:** (1) Golden path = Hybrid Confidence (HIGH auto, MEDIUM ask, LOW pending); (2) 9-state machine on `recommended_edits` (`recommended` → `accepted` → `verified_live` / `verified_live_modified` / `needs_review` / `wrong_page` / `partially_implemented` / `not_found_after_7d` / `dismissed`); (3) Confidence rubric per action_type with `normalizeText()` canonical (NFC, smart-quote folding, whitespace collapse); (4) Attribution baseline-split uses `live_at` (falling back to `timestamp` for legacy); (5) `not_found_after_7d` returns NEW verdict label `not_implemented` (not `nothing_yet`); (6) Daily polling cadence unchanged — no per-edit ad-hoc polls; (7) Per-phase exit gates (`lifecycle_os_phase0` … `lifecycle_os_phase11`) follow the existing `.data/exit-gates.json` pattern. **Operator action:** read the spec end-to-end; sign off Phase 0 by adding `lifecycle_os_phase0: { status: "passed" }` to `.data/exit-gates.json` to authorize Phase 1 (schema-free `implementation_status` + `live_at` columns).

> 🟢 **Sprint 6A.3 closed (2026-04-26):** Native polling cost observability + runaway protection landed across 5 sub-commits — 6A.3a (pricing helper + provider usage capture) → 6A.3b (daily/monthly/per-run budget helpers) → 6A.3c (poll-loop wiring: pre-flight + mid-run + recordSpend) → 6A.3d (BEACON_POLL_DISABLED kill switch + identical-text dedupe + route response pin) → **6A.3e** (architecture invariants + docs sync). **NO quality reduction:** model unchanged (gpt-4o + sonar), output cap unchanged, prompt text unchanged, daily cadence unchanged, no batching/grouping/caching, full prompt coverage preserved. Caps are runaway protection only — defaults set high enough that normal full-native operation never trips them. New env knobs: `BEACON_DAILY_BUDGET_USD_PER_TENANT` ($10), `BEACON_DAILY_BUDGET_GLOBAL_USD` ($20), `BEACON_MONTHLY_BUDGET_USD` ($200), `BEACON_PER_RUN_BUDGET_USD` ($5), `BEACON_POLL_DISABLED` (truthy disables; truthy = "1"/"true"/"yes"/"on"). Two separate ledgers: `cost-ledger.json` for native polling (this phase) vs `llm-budget.json` for Sprint 6A.2 specific-edit / adjudicator — one budget cannot drain the other. **Vercel caveat:** local cost-ledger persists; hosted Vercel file ledger is non-durable (read-only FS) — pre-flight gates always see "$0 spent" on hosted. OpenAI account-level quota remains the runaway-protection floor on Vercel (proven by 6A.2e dry-run catching HTTP 429 cleanly). Future phase: move polling cost ledger to Supabase for durable hosted enforcement. Architecture invariant in `tests/architecture/cost-controls.test.ts` pins poll-adapter cost-control imports + the route's BEACON_POLL_DISABLED pre-runNativePoll check + cost-ledger write isolation. Existing LLM safety + Sprint 7 multi-tenant invariants remain green. Typecheck clean. Full vitest **2572 / 2572**. Local + Vercel-equivalent builds green. Latest verification: `docs/VERIFICATION_LOG.md` 2026-04-26 Sprint 6A.3 entry. Next: **operator-driven.** Sprint 6A.2f (first live `--write` of LLM-generated edits) needs a successful dry-run with a quota-funded key; Sprint 7.9 (multi-tenant onboarding) waits on a second tenant; Phase 6A.4 candidate: move polling cost ledger to Supabase for hosted enforcement. Rollback per phase: each 6A.3 sub-phase is `git revert <hash>`-clean.

> 🟢 **Sprint 7 closed (2026-04-26):** 7.0 → 7.1 → 7.1a → 7.2 → 7.3 → 7.4 → 7.5a-d → 7.7a-e → 7.8a → 7.8a.1 → 7.8b plan → 7.8b-0 → 7.8b-1 → 7.8b-2-a → 7.8b-2-b → 7.8b-2-c → 7.8b-2-d → 7.8b-2-e → 7.8c → 7.8c.1 → 7.8d-1 → 7.8d-2 → 7.8d-3 → 7.8e-1 → 7.8e-2 → 7.8e-3 → 7.8e-4a → 7.8e-4b → 7.8e-4c → 7.8e-4d. **Phase 7.8e COMPLETE.** Every module-level top-level await read in `src/` lifted to `cache(async () => ...)` getter (Pattern A). Architecture invariant in `tests/architecture/json-store-routing-invariants.test.ts` fails-loud on regression. **Production deploy verified green** (Vercel commit `0dd90e2`, status Ready, `beacon-bice.vercel.app`). Two deploy fixes during the cascade: classified `answer-snapshots` + `frontier-opportunities`; added `BEACON_TENANT_SLUG` env fallback for Vercel's gitignored `.data`.

> ⚠️ **STALE — last updated 2026-04-17.** Most of the content below describes
> pre-pivot (Profound-era) state. Since 2026-04-22 Beacon has shipped the
> native-polling pipeline (Perplexity + OpenAI adapters, hosted `/api/poll/run`,
> GitHub Actions daily cron, chunked retry dedupe) and the "Replace Profound in
> 2 weeks" Phase v4 is now active. Trust these sources over anything below:
>
> - **Active plan:** `/Users/armeen/.claude/plans/you-are-taking-over-floofy-giraffe.md`
> - **What actually shipped 04-22 onward:** `docs/VERIFICATION_LOG.md` (2026-04-24 entry covers Phase v4 Commits 1–4 and the ground-truth surface audit)
> - **Schema v2 design:** `docs/OBSERVATION_SCHEMA_V2.md`
> - **Which surfaces silently lie and which are trustworthy:** `docs/TRUTH_SURFACE_AUDIT_2026-04-24.md`
>
> The legacy "Active plan" reference below (jazzy-tumbling-stroustrup) is no
> longer in play. Everything in this file that predates 2026-04-22 should be
> read as history, not current state.

> **Active plan (legacy, superseded 2026-04-24):** `/Users/armeen/.claude/plans/jazzy-tumbling-stroustrup.md` — the CX0-CX11 MAX implementation plan. Reference spec: Part 14 of `/Users/armeen/.claude/plans/rippling-munching-pnueli.md`.

> **PURPOSE:** This is the entry point for anyone (human or AI) working on Beacon.
> Read this file first. It tells you what Beacon is, where everything stands, what works, what's broken, and where to go next.
>
> **NOT FOR:** Execution steps (→ `NEXT_PHASE_EXECUTION_PLAN.md`), system diagrams (→ `architecture.md`), deep history (→ `master_execution_plan.md`), verification proof (→ `VERIFICATION_LOG.md`).

**Last updated:** 2026-04-17 (Phase 7 Part 1b-v2 Step 2 — keyword-gap scanner v3 LIVE on Today)
**Branch:** `main`
**Build:** `npm run typecheck` ✓ · `npm run test` 1000/1007 ✓ (same 7 pre-existing tenant-isolation failures, no regression)

**Phase 7 Part 1b-v2 Step 2 — COMPLETE (2026-04-17).** The keyword-gap scanner, silenced since Apr 19 when we caught it mining AI answer boilerplate ("Track Record" appeared in 28.7% of all answers), is now live on Today. V3 mines concepts from each observation's `search_queries` field (AI's internal retrieval queries, not output vocabulary). Tier-aware pipeline:
- Tier 1 (saturation_miss) uses raw bigram/trigram concepts — surfaced labels like "Custom Homes", "Luxury Home".
- Tier 2 (gap) applies concept expansion from example queries to produce longer readable phrases — "Home Renovation Contractors Menlo Park", "Modernizing Older Homes Without Expanding".
- Tier 3 (positive) computed but deliberately not surfaced.
- Readability gate rejects 2-3 word fragments starting with plural nouns (e.g., "Builders Bay Area" is filtered out).
- Cities excluded via knownLocations; competitors excluded via dynamic top-40 non-brand mentions.
- Top 3 cards visible on live Today page: "Position 'Custom Homes' on /locations/los-altos" (Tier 1), "Position 'Luxury Home' on /locations/cupertino-custom-home-builder" (Tier 1), 1 gap rec on /locations/menlo-park.

Details in `docs/VERIFICATION_LOG.md` 2026-04-17 entry (Phase 7 Part 1b-v2 Step 2).

**Phase 1 SCHEMA-EXPERIMENT ATTRIBUTION — COMPLETE (2026-04-17):** Missing-schema detector surfaces as Today ActionCard before the change; manual confirm stamps structured schema-diff fields after the change; 5-rung matching ladder attributes at exact specificity. Auto-promote OFF by default (`BEACON_AUTO_PROMOTE_SCHEMA=1` to flip, no scan-side wire-up shipped). 127 new tests, Phase 0 acceptance still 8/8. Details: `docs/VERIFICATION_LOG.md` 2026-04-17 entry.

**Dogfeed Night 1 — COMPLETE (2026-04-17 evening).** Three schema experiments shipped and confirmed with structured fields:
- `/locations/palo-alto` → schema_added · types_added=[BreadcrumbList, HomeAndConstructionBusiness, WebPage] · visible_copy_changed=false
- `/our-process` → schema_added · types_added=[HowTo] · visible_copy_changed=false
- `/explore-projects/riverside-way` → schema_added · types_added=[Article, BreadcrumbList] · visible_copy_changed=false

All three will match at `exact` specificity with c_scope=1.0 when attribution runs over the next 14 days. 10 active experiments now being watched. Tonight's cycle also caught a real production regression (helper temporarily broke SSR on palo-alto while removing a duplicate FAQPage JSON-LD block) — scanner flagged it, operator sent it back for fix, SSR restored. 8 state-transition artifact findings from the bug cycle were bulk-dismissed; no pending content-change findings remain.

**UX hardening shipped tonight:**
- Auto-link feature flag (`src/lib/flags.ts:isFindingAutoLinkEnabled`) — **OFF by default**. Previously the scanner auto-linked every finding to any changelog entry within 30 days whose description contained a matching keyword, which silently collapsed brand-new experiments into old generic entries. Now every finding stays `pending` until operator explicitly confirms/dismisses. Flip `BEACON_AUTO_LINK_FINDINGS=1` to restore legacy behavior (not recommended during dogfeed).
- "Review changes" banner moved from buried to directly below the Visibility line on Today. `ChangeReview` card now renders inline beneath the banner with `id="change-review-section"` scroll anchor so the button actually works.
- Sidebar nav badges rewired: **Today** = pending content-change findings (matches the banner's count exactly), **Pages** = unique pages with bug-class findings (`schema_invalid` + `faq_without_schema` + `robots_txt_blocked` + `deploy_mismatch`), **Changes** = active experiments being watched. Was previously: stale legacy counts from pre-Phase-0 stores, stuck for a week.
- Shared module `src/domains/scanning/content-change-types.ts` — single source of truth for CONTENT_CHANGE_TYPES + BUG_FINDING_TYPES used by both the Today banner and the sidebar badge.

**New CLI:** `scripts/regen-findings.ts` — regenerates scan-findings against the current page-snapshots without re-fetching the site. Needed because `scripts/scan-owned-pages.ts` only writes snapshots, not findings. Use after a CLI scan to feed the detection pipeline.

**Known rough edges left for tomorrow (not blocking dogfeed):**
- `/pages` route copy is pre-Phase-0 legacy ("Same crawl basis as Today: consecutive HTML snapshots and optional guardrails. Observation links appear only when the run is indexed.") — academic disclosure language, should be rewritten
- `/briefs` route is a dead end — UI placeholder for a "proposed briefs" flow that never got wired up
- Brain-action recommender pulls from legacy url-change-outcomes; still shows "Investigate h1 regression" stale recs
- Duplicate-schema detector would help — scanner already sees `faq_schema_block_count > 1` but doesn't emit a finding for it

**Daily-1% operating cadence (chosen 2026-04-17):**
Operator dogfeeds one isolated change per night. Between deploys, fixes one piece of legacy per day — delete code but keep functionality. Goal: 14-night pattern brain that moves Beacon from "collection of shipped phases" to "native AEO tracker for local builders/architects/contractors." Every day: spot one thing that feels off on Today or one of the nav routes, clean it up (code delete preferred over rewrite), verify nothing broke via typecheck + scan. Document in VERIFICATION_LOG.

**Phase 0 TRUTH VALIDATION — COMPLETE (2026-04-16):** Hierarchical event attribution proven against Ritz data. 62 new tests. Seven-section acceptance report via `npx tsx scripts/validate-ritz-truth.ts` passes all 8 criteria — Apr 7–12 data_bad flagged, 4 target spikes detected (±1 day), 299/299 changelog rows covered, `/luxury-home-builder-bay-area` compound_launch → `landed_fast` (23 rows → 1 sample per pattern-sample-integrity check), `/locations/menlo-park` corrected from `hurting` (old URL store, polluted by bug-window zeros) to `helping` (new event store, data_bad skipped), Apr 10 performance_batch + Apr 2 metadata_publication distinguished as separate events. **Zero production surface changes** — `/changes`, Today, and `src/domains/attribution/url-verdict.ts` all untouched; new stores sit alongside legacy ones. Details: `docs/VERIFICATION_LOG.md` 2026-04-16 Phase 0 entry; source plan: `/Users/armeen/.claude/plans/dreamy-beaming-sphinx.md`.

**Phase 0.5 EVENT-LEVEL TRUTH SIDE-BY-SIDE — COMPLETE (2026-04-16):** First feature-flag helper in the repo (`src/lib/flags.ts` · `isEventTruthPreviewEnabled()` · reads `BEACON_EVENT_TRUTH_PREVIEW=1`, server-side, off by default). New route `/changes/truth` — server component reads `change-events` + `event-attributions` + `url-change-outcomes` + `imported-changes` + `site-movement-events`, joins events → children → legacy verdicts → movements, renders each event as a side-by-side row (NEW attribution + confidence_source pill · OLD legacy verdict counts · divergence badge). Expand drills into the narrative + every child row's legacy verdict. `/changes` gains one conditional top-right link when the flag is on. Verified both flag states against the live dev server: flag-off → `/changes/truth` 404s and `/changes` has no link; flag-on → luxury compound_launch shows `landed_fast` measured vs. 23× `nothing_yet` old, menlo Apr 7 event shows `too_early` vs. 6× `hurting` (the Phase 0 headline correction surfaced), `data_bad` narrative reaches the UI. `.env.local` restored to its pre-verification state after the run. Source plan: `/Users/armeen/.claude/plans/shimmering-flickering-hopper.md`.

**Next best action:** Keep the flag off for now — let the event model run silently alongside production for a full re-scan cycle before deciding whether to flip even this read-only preview on for daily use. When ready, turn the flag on via `.env.local`, walk through the divergences (especially the menlo correction), and only then consider whether the event model should influence any Today recommendation or scoring signal.

**Master launch plan active:** `/Users/armeen/.claude/plans/dreamy-beaming-sphinx.md` — "Truth → Brain → Shape → Trust → Live". 7 phases, 6–10 weeks to launch, 14-day personal dogfood, then 3 test subjects. Launch scope: Today + Changes + Settings/Import only. Single-tenant per customer at launch; auth layered in Phase 6.

**Phase 0 TRUTH — COMPLETE (2026-04-16):**
- ✅ 0.1 `src/domains/product/url-citation-history.ts` — per-URL daily citation time series aggregated from `.data/citations-by-date/*.json` via existing `cold-store.getCitationsForDate`. Path-only URL normalization — `/locations/palo-alto` and `https://ritzbuilders.com/locations/palo-alto/` map to the same key. Joins prompt-answer-observations for platform breakdown. Pure function, 7 unit tests.
- ✅ 0.2 `src/domains/attribution/url-verdict.ts` + `url-verdict.test.ts` (15/15 passing) — adaptive Z-score verdict engine. Formula: μ_pre / σ_pre (Poisson-floored at 1) over 14d baseline, μ_post over post-window (max 30d), z = (μ_post − μ_pre) / (σ_pre/√N), sustain-check against last 7d. Verdicts: `helping` / `hurting` / `nothing_yet` / `too_early` / `not_enough_data`. Every verdict carries `explanation.math` (all intermediate values) and `explanation.summary` (plain-English narrative).
- ✅ 0.3 `/changes/page.tsx` now builds `urlHistory` once per page load and computes `UrlVerdict` per row. Legacy `computeScorecard` data still computed for drill-down topic/platform breakdown; no longer drives the headline verdict. New at-a-glance strip shows helping / hurting / too-early counts derived from the new engine. Tracks 300 live changes (post-dedupe).
- ✅ 0.4 `scorecard-client.tsx` rewritten. Kill: Score/Match/Lift/Events/Linked/Next-step columns. New row = `[date] [change] [verdict pill] [delta%] ▸ expand`. Click expand → "Explain this verdict" panel rendering full Z-score math (μ_pre, σ_pre, μ_post, z, sustain up/down) alongside topic + platform drill-down from legacy scorecard data. Verdict filter chips (All / Helping / Hurting / Nothing yet / Too early / No baseline / Site-wide) replace the old outcome-category tabs.
- ✅ 0.6 Archived 16 frozen docs → `docs/archive/completed-specs/`. Moved 12 dead CSV/XLSX (~125MB) → `.data/archive/`.
- **Current honest distribution on Ritz data (300 changes):** 0 Helping (nothing hit the z≥2 + sustain-5/7 bar with current data coverage), 12 Hurting, 56 Nothing yet, 12 Too early, 155 No baseline (URL not cited enough pre-change), 65 Site-wide. User can see which URLs moved and click any row to see the full math. Zero hand-tuned verdicts.

**Phase 0 descoped (needs dedicated pass):**
- 0.5 `KNOWN_TOPICS` + `GEO_CONTAINMENT` removal — audit showed 5-domain blast radius (`pages/classify.ts`, `visibility-events/attribute.ts`, `attribution/compute.ts`, `attribution/memory.ts`, `attribution/config.ts`). Needs a soft-migration via accessor function reading from `tracked-prompts.json` before removal. Moved to Phase 1 work.

**Changes page rebuild — Phase 1 (2026-04-16):** `/changes` is now a single list sorted newest-first. Tabs (Outcomes / Attribution / Replicate) and the Records & Verification section were deleted — the page was rendering 4 competing views across 3 stores, reading as "10 different changelogs". Fix: one list, `timestamp desc` default sort on `ScorecardTable`, default verdict filter set to "all" so freshly-confirmed `too_early` entries land at the top instead of being hidden. New at-a-glance strip shows total count + latest-change recency + experiment-watch count. **Dedupe review flow** added at `/changes/dedupe`: `src/domains/changelog/dedupe.ts` extracts edit-type tokens (`title_change`, `page_created`, `schema_added`, etc.) from `change_description`, matches CSV-summary entries to PDF-granular keepers by URL + ≤3-day window + token-subset rule, and surfaces probable duplicate pairs for operator review — 38 pairs found in current data. Archive is a soft-delete (`ChangelogEntry.archived`, `archived_reason`, `archived_at`) with automatic once-per-day backup of `.data/imported-changes.json`. **Confirm flow upgrade:** `confirmFindingAsChange` now auto-stamps a `hypothesis` + `hypothesis_source: "inferred"` from the detected edit type — operator can overwrite on the detail page via new `HypothesisEditor` client component which calls new server action `updateChangelogHypothesis`. Null-URL entries render with "Site-wide infra" label. Scan-detected entries display a `scan · auto-caught` amber badge. Domain additions: `src/domains/changelog/dedupe.ts` (pure functions) + `dedupe.test.ts` (11 tests), `src/domains/changelog/actions.ts` gains `softDeleteChangelogEntry` / `restoreChangelogEntry` / `updateChangelogHypothesis`. UI: `src/app/(shell)/changes/page.tsx` slimmed from 741 → 246 lines, `changes-tab-shell.tsx` deleted, `src/app/(shell)/changes/dedupe/{page,dedupe-client,actions}.tsx` created, `src/app/(shell)/changes/[id]/hypothesis-editor.tsx` created. Verified end-to-end: server-rendered `/changes` has today's `cl-mo1p4hvf6kuklr` (Whole-Home Remodel title rename, `scan_detection`) at the top of the table, `auto-caught` badge present, dedupe banner shows "38 possible duplicates", `/changes/dedupe` renders "Pair 1 of 38" with keeper/summary cards.
**Operator loop fix (2026-04-15):** Fixed `createChangelogEntry` data loss (was in-memory only, now persists to disk + Supabase). Supabase dual-write now throws when `DATA_SOURCE=supabase` (was silent fire-and-forget). Auto-experiment creation on every changelog entry + finding confirmation — tracks citations, mentions, visibility with daily timeline snapshots. Recommendation engine: final dedup (one rec per URL), extended hard suppression (all page-targeting types), extraction_certainty on all snapshot recs, learning pattern integration (success rate in rationale), "why now" temporal context. Recovered 10 accepted findings from April 14 — linked to existing changelog entries, 5 backfilled experiments created. 6 total experiments.
**State reconciliation (2026-04-15):** Full truth-layer fix. (1) Scan findings now auto-link to matching changelog entries by URL+type instead of sitting as unresolved pending items. (2) Recommendation engine hard-suppresses strengthen_structure recs when changelog already covers FAQ/schema work (checks `signal_type` + description keywords). (3) Import orchestrator switched to `materializePerChangeOutcomes` for learning-ready outcomes. (4) Changes scorecard shows "imported"/"scan" provenance labels. (5) Supabase findings cleaned: 0 pending (was 30). (6) 237 outcomes, 27 patterns (13 high-confidence). Today is clean: no false findings.
**System audit fix (2026-04-14):** Fixed 3 hard bugs: (1) `detect-findings.ts:norm()` now strips protocol+domain so changelog paths match scan URLs — `unexpected_change` and `deploy_mismatch` cross-reference now works for 207 path-only changelog entries; (2) `findings-store.ts:addFindings()` deduplicates guardrail findings by type+URL, replacing pending entries instead of stacking oscillation noise; (3) April 13-14 Profound CSVs imported. All 23 stale findings resolved (13 rejected as noise/false positives, 10 confirmed). `normUrl()` helper added to findings-store for consistent path normalization. Tests updated.
**Phase 12: Learning System (2026-04-14):** 4 learning loops implemented — change pattern recognition (4 patterns), triage rule learning (4 rules), confidence calibration (insufficient data, correctly null), page response profiling (enriches page_visibility). All passive — stored but not consumed by UI. 28 Supabase tables total.
**Phase 11: Relationship Materialization (2026-04-14):** Beacon now stores explicit relationships between changes, pages, and outcomes. `change_outcomes` (10 rows) materializes before/after metric deltas per changelog entry. `page_visibility` (13 rows) materializes per-page citation totals, topics, and trend direction. Findings enriched with `metricMovementDetected` and `signalStrength` (0-100 composite). All materialized from existing data — no new raw data, no route changes. Ready for learning/intelligence layers.
**Phase 10: Portability & Recovery (2026-04-14):** Beacon can now fully reconstruct itself from Supabase alone. Created `scripts/bootstrap-from-supabase.ts` — reads all 23 Supabase tables, writes 49 `.data/*.json` files. Added 3 new tables (`tracked_prompts`, `tracked_entities`, `answer_texts`) with dual-write. Added 5 database indexes for query performance. Verified: deleted `.data/`, bootstrapped, all routes render correctly, scan runs successfully with findings.
**Scoreboard upgrade (2026-04-13):** KPI cards rewritten to business language ("Times AI recommended you", "How often AI mentions you", "Your pages AI sends people to"). Added week-over-week deltas: citations and mention rate now show `+N%` / `-N%` vs last week with green/red coloring. Topic trends relabeled: "rising" → "growing", "declining" → "slipping". Meta lines show "vs last week" context when delta data exists. Data pipeline computes this-week vs last-week buckets from results time series in `today-data.ts`.
**Phase 5: Competitor Monitoring (2026-04-13):** Sitemap-based competitor monitoring — crawls XML sitemaps for 5 configured competitors, diffs page lists to detect new/removed/updated pages, generates contextual alerts (topic inference from URL paths for builder site patterns). Wired into morning brief: alerts appear as "Competitor activity" section between change impact and action cards. CLI script `scripts/crawl-competitor-sitemaps.ts` with `--dry-run` flag. Initial baseline crawl completed: Flegel's (4,746 pages), PAB (6 pages), SV Custom Homes (0 entries), 2 competitors unreachable. Domain: `src/domains/competitor-monitoring/` (types, sitemap-crawler, detect-changes, store). Also added `writeDotDataJson` to persistence layer for non-array object storage. 30 new tests (sitemap parsing, change detection, alert generation, store).
**Phase 3: Attribution Memory (2026-04-13):** Today page now shows **Change Impact** section above action cards — up to 2 memory insights with mini sparklines showing before/after trends. Computed from 85 changelog entries × 22K daily metric snapshots; 11 insights generated from real data, top 2 shown. Example: "20 days ago you updated Luxury Home Builder Bay Area — mentions up 16%" with green trend line + vertical change-date marker. Engine: `src/domains/attribution/memory.ts` — per-topic before/after window comparison with minimum data gates (3 days before, 5 days after, 3+ observations per window). Direction: improving (≥15%), declining (≤-15%), stable. Platform breakdown shows which AI platforms moved. Also fixed: `investigate` rec type relative URL bug — changelog entries with relative paths now normalized via `absoluteUrlForPath`.
**Morning Brief + Change Detection (2026-04-13):** Phase 1 complete: Today page now renders **morning brief** as primary content — citation trend sparkline (2,992 citations, ↑157%) + 3 prioritized action cards with copy/email. Each card has operator-language rationale, concrete step checklists, and AI context from answer intelligence. Phase 2: **Change detection** — `confirmFindingAsChange` server action auto-creates changelog entries from confirmed scan findings; `ChangeReview` component renders on Today when content-type changes are detected (title, H1, meta, FAQ, schema, content changes). Scan trigger already exists via `TodayScanStrip`.
**Product reorientation Phase 1 + cleanup (2026-04-13):** Command Center layout — Today is now a two-panel grid (`2fr_3fr`): **left** = visibility scoreboard (3 KPI cards + compact platform text + health strip), **right** = action queue (primary + secondary action cards + findings count strip). **Nav expanded to 7 items:** Today, Pages, Changes, Market, Local, Topics, Settings. **Data imported:** all April 7-12 CSVs processed (100K+ citations, 11K observations, 20K benchmark snapshots). **Cleanup:** removed donut chart (low density), consolidated stale warnings to health strip only (removed DataFreshnessStrip from shell + warning box from action queue), improved KPI card visual weight (larger numbers, delta top-right), improved action card hierarchy (larger headline, subtler coloring).
**Track 1.2:** Daily ritual perfection — Phases 1–3 complete (2026-04-12): layout + Inbox Zero/digest + Today keyboard path (A / J/K, finding focus, primary `autoFocus` when safe) + **one decision card** (now cut — replaced by action queue). **Stale visibility gate:** hard demotion + findings warning unchanged. **Import copy (2026-04-12):** “latest visibility export / decision layer” framing — not workbook-first.
**Track 1.3:** Replication engine refinement — Phases 1–2 complete (2026-04-12): language/hierarchy + queue structure/experiment linkage/vague suppression
**Track 1.2 / 1.3 / 1.4l exit gates (persistence):** Settings → **Sign-offs** `/settings/exit-gates` + `.data/exit-gates.json` — **`daily_ritual`**, **`replication`**, **`local_layer`** all **`passed`** (operator notes **2026-04-13**); internal sign-off only; does not affect metrics, scores, freshness states, or proof. Settings layout hint hidden when all three gates are `passed`.
**Tier 1 dogfood + vault closure:** `docs/TIER_1_DOGFOOD_WEEK_LOG.md` — expanded **one-row-per-day** schema (Today / Replicate / /local, confusion, copy risk, action, verdict) + strict **human-only** rule (no fabricated weeks). **2026-04-13 static validation** remains on file. **2026-04-14:** Formal **vault Tier 1 closure verification failed** — log still has **no** consecutive operator daily rows (template only); **Tier 1 is not closed** per `master_execution_plan.md`. When the log is complete, re-run verification before updating vault docs. **2026-04-13:** One **honesty** dogfood row added (no live session — operator must replace for real evidence); see `TIER_1_DOGFOOD_WEEK_LOG.md`. **Micro-steps:** same file → **“Operator: smallest step-by-step”** (no log “import”; optional Settings → Import for data).
**Tier 1.1i:** Coverage escalation — **expanded (2026-04-13):** five-state model (`fresh` / `aging` / `stale` / `critical` / `partial`) in `coverage-state.ts` only; aging = crawl age in `(0.7×T, T]` for `T=3`; critical = missing crawl when flagged or age `> 2T`; Today digest + findings attention strip + `shouldShowTodayAllClear`; Market/Changes use `latestWebsiteCrawlRun()` crawl age; methodology `#coverage-states`
**Tier 1.1j:** Proof layer **final trust pass (2026-04-13)** — methodology: “How to read it” + “Beacon does not know” across core metrics; FAQ (coverage labels, continuous updates, every review); standardized review phrases + connector disclosures; overview five-pillar list. Product: `beacon-proof-copy.ts` (`BEACON_LOCAL_SURFACE_FOOTNOTE`, Layer-2 bullets), `local-presence.ts` footnotes + Market review lines, Today `HowWeKnowPanel` + coverage → `#coverage-states`, Market **partial** coverage warning, Connectors page/client, `/local` stored-review wording, `local-operator/surface.ts` data gaps. Checklist refresh: `docs/TIER_1_1J_EXIT_GATE_CHECKLIST.md`.
**Proof layer:** Layer-2 collapsed disclosures on Market + Changes Outcomes (2026-04-12): `<details>` “How this works” / “How verdicts work” + links to `/settings/methodology#citation-share` and `#verdicts`; copy from `beacon-proof-copy.ts`
**Track 1.4:** Local listings / reviews — Phase 1 + **Phases 2B–4** (2026-04-12/13); **1.4d (spec):** `docs/TIER_1_4D_REVIEW_MONITORING_V1_SPEC.md`; **1.4e connectors (2026-04-13):** `docs/TIER_1_4E_REVIEW_CONNECTORS_SPEC.md` + `/settings/connectors` — **Google:** OAuth + **multi-location picker** (fetch → select → persist `selected_location_id` on token) + on-demand Sync now → GBP v4 reviews for selected location only → strict map → `mergeUpsertLocalReviews`; sync blocked until location selected. **Yelp:** server-stored Fusion API key + Sync now → Fusion business + reviews → `mapYelpReviewToLocalReview` → same merge; ids `yelp:…`, import run `connector:yelp`. `last_synced_at` per provider; local-presence freshness = max(import run, Google sync, Yelp sync). No auto-sync. `/local` + manual import unchanged.
**Track 1.4f–g (NAP + surfacing):** NAP consistency expanded to 4 states (`complete` / `incomplete` / `inconsistent` / `unknown`); centralized in `napState` on `LocalPresenceSnapshot`; inconsistency detects conflicting `listing_name` on imported reviews vs configured name. Today attention uses 4-state NAP (inconsistent fact line). Market strip shows NAP state with tone coloring. `/local` shows explicit label + factual explanation. Methodology `#nap-consistency`. No new connectors, scoring formulas, or ranking claims.
**Track 1.4 (listing completeness — operator slice, 2026-04-13):** Read-only **GBP field coverage** style audit on `LocalPresenceSnapshot.listingCompleteness` — present/missing for name (config or Google selected location label), address, phone, website (domain), category (config industry); **hours** not in v1 (no stored hours signal). Coverage labels `strong` / `partial` / `weak` from present-count thresholds only (not a score). `/local` **Listing completeness** section; Today one factual line when `weak` and NAP does not dominate; Market strip optional **Listing completeness:** phrase; methodology `#listing-completeness`. Tests: `listing-completeness.test.ts` + updated attention/market/local smokes.
**Track 1.4l (Local layer exit gate — 2026-04-13):** **`local_layer`** in Sign-offs with static operator checklist + same status/note actions as other gates; methodology `#exit-gates` boundary text expanded. **Operator sign-off (2026-04-13):** **`local_layer`** = **`passed`** in `.data/exit-gates.json` after checklist review; `/local` page header copy tightened to read-only framing (no live-directory implication).
**Track 1.4 — Per-source last sync (`/local`):** `LocalPresenceSnapshot.lastSync` — `google` / `yelp` from connector `last_synced_at`; `manual` from latest non-connector `ImportRun` (`entity_type: reviews`, `imported_count > 0`). **Data freshness** section on `/local` (always three rows + disclosure); methodology `#review-source-timestamps`. Pure projection — no merged timestamp, no new thresholds.
**Methodology (connectors + freshness):** `/settings/methodology` — `#review-connectors` documents **shipped** Google + Yelp (on-demand); `#review-monitoring-v1`, `#local-reviews`, boundaries, and FAQ aligned with manual + connectors, per-source timestamps, no auto-sync, no SLA language. **2026-04-13:** FAQ “connection breaks” + **`/local`** “How this works” / empty-state copy aligned with shipped connectors (no “not syncing yet” drift); tier specs `TIER_1_4D` / `TIER_1_4E` docstrings match.
**Track 1.5:** Milestone polish (2026-04-12): magnitude classification (major/minor), same-key-same-day dedupe, weekly noise cap (3+ minors → suppress on Today), enriched Today teaser (subtitle + relative date + magnitude-aware styling), Changes list collapsed (5 visible, rest behind expand). Exit gate 1.5g verified: ATH truthful, deduped, linked to proof
**Answer Intelligence (2026-04-13):** Built-time index from 9,596 AI answer observations + 84K citations → `answer-intelligence-index.json` (~1.3MB, 146ms build). Types in `src/domains/answer-intelligence/types.ts`; build in `build-index.ts`; store in `store.ts`; repository wired in file + supabase backends. Import pipeline builds index after citation-evidence-index. **Quality gates:** `NON_COMPETITOR_DOMAINS` blocklist (30 directory/platform/media domains) filters co-citation + co-appearing; brand descriptors require `source_count ≥ 2` + `length ≥ 25` + no competitor-name fragments; answerContext requires ≥ 2 signal points; Market "Who replaces you" requires ≥ 50 appearances + ≥ 100 total answers. **Product surfaces:** recommendation engine enriches recs with `answerContext` (mention rate, position, competitor, trend — gated); Today primary action card renders "From AI answers" block; HowWeKnowPanel shows AI answer analysis (mention rate, declining/rising topics); Market page shows "Who replaces you" section (real competitors only, sorted by absent count) + per-topic absence breakdown.
**Native ingestion prep (2026-04-12 / 13):** `docs/NATIVE_INGESTION_READINESS_AUDIT.md` — integrity/utilization/architecture/benchmark/scale; **workbook import removed**; Profound **`writeLegacyBridge`** **dual-writes** when `DUAL_WRITE=true`. **2026-04-13:** Profound CSV discovery is **header-based** (no filename prefixes); **merge-safe** ingest for prompts, raw rows, answer texts, citations per date, benchmarks, changelog — partial-week CSVs no longer require replacing the canonical monolith file.

---

## What Beacon Is

Beacon is a **daily AI visibility operating system** for local businesses. One operator opens it each morning to answer:

- What changed on my site?
- What is true about my visibility?
- What matters right now?
- What should I do next?
- Where is competition beating me?

**Stack:** Next.js 16 (App Router), React 19, TypeScript strict, `.data/*.json` file persistence + Supabase dual-write (23 tables). Bootstrap from cloud: `npx tsx scripts/bootstrap-from-supabase.ts`. Single-user, premium, self-hosted.

**Not:** a generic SEO dashboard, a crawler, a CRM, an agency platform, a science project.

---

## Current System State

### What is genuinely working

| Area | Score | Evidence |
|------|-------|----------|
| Domain architecture | 76/100 | 31 well-bounded domains, strict types, consistent patterns |
| Scan pipeline | 75/100 | Live crawl → snapshot diff → 15 finding types → priority scoring → changelog cross-reference. Guardrail dedup prevents oscillation noise. 7 dedicated tests |
| Attribution engine | 75/100 | Event detection → candidate discovery → triage → scoring → operator verification. Golden tests |
| Proof layer | 78/100 | Confidence badges, evidence tiers, trust sources, freshness dots. Honest about uncertainty |
| Pages route | 75/100 | Page truth + fix briefs + verification workflow. Strongest route |
| Changes route | 70/100 | Scorecard + verdicts + replication. Core "what worked" view |
| Market route | 62/100 | Real competitive intelligence (rankings, topic signals, battlecards). Data-dependent |
| Navigation | Clean | 6 items: Today, Pages, Market, Local, Changes, Settings. Today: **A** → primary CTA, **J/K** → findings; command palette |
| Build health | Solid | Zero type errors, 306 tests pass, production build succeeds |
| Copy/wording | 75/100 | Operator-focused, honest, avoids jargon |

### What is broken or risky

| Problem | Severity | Impact |
|---------|----------|--------|
| **Error boundaries** | DONE | `(shell)/error.tsx` + `settings/error.tsx` implemented and runtime-verified (2026-04-12) |
| **Loading states** | DONE (Phase 0B) | `(shell)/loading.tsx`, `(shell)/pages/loading.tsx`, `(shell)/changes/loading.tsx` — shell + Pages + Changes Suspense fallbacks |
| **Today scan blocks render** | DONE (1A-1–6) | RSC never awaits scan; `ScanStatusBanner` triggers + polls from client; `router.refresh()` on complete. **Phase 5-9:** stale-running guard. **2026-04-14:** domain inference + env injection + preload; **E2E:** full scan **35** pages **success** on **ritzbuilders.com**; CLI updates **`scan-state.json`** on completion (`writeIdleScanStateFromLastResult`); `npm run data:scan` includes domain preload |
| **Demo data not labeled** | MITIGATED (2A) | `DemoBannerGate` + `isDemoMode` when no import runs; sticky banner with import CTA (Phase 2A-3) |
| **Empty states missing** | LOW (2B done) | Import empty states on main routes; **2B-5:** `shouldShowTodayAllClear` returns false when `isDemoMode` (no false “all clear” on sample data) |
| **Module-cached import data** | MEDIUM | `seed-data.server.ts` top-level await → stale in long-running production process |
| **Settings fragmented** | DONE (Phase 3) | Route consolidation + smoke **3-8** verified **2026-04-12**: Import / Config / Data tabs only; Health direct URL; **`/import`**, **`/setup`**, **`/results`** → **404** |
| **Today section count** | DONE (1.2) | Track 1.2 Phase 1: primary action promoted to #1 slot, findings collapsed, proof/system moved to bottom, morning-order text removed, milestone/replication compacted |
| **Render-time side effects** | DONE (1C) | `persistOutcomes()`, `updateExperimentCitations()`/`persistExperiments()`, and `syncMilestonesFromWorkspace()` all moved to post-import; 1C-3 audit confirmed zero writes in render path |
| **Test coverage narrow** | LOW | 460 tests (domain + lib + `exit-gates-store` + local-presence + NAP 4-state + listing completeness + per-source `lastSync` + GBP/Yelp map/sync + GBP location picker + Tier 1.1i coverage + components + **route smokes** + `today-next-line` + `today-one-decision` + **scan-site-domain** + Profound **csv-discovery** / **merge-ingest**); Vitest `fileParallelism: false` + 30s timeout stabilizes heavy dynamic imports; no full E2E |

### Overall scores (from 2026-04-11 audit)

| Composite | Score |
|-----------|-------|
| Product intelligence | 75/100 |
| Operator experience | 45/100 |
| Production safety | 25/100 |
| **Overall** | **53/100** |
| **Launch readiness (now)** | **38/100** |
| **Launch readiness (after safety fixes)** | **72/100** |

---

## Current Phase & Next Actions

**Status:** **Launch Phases 0–5 COMPLETE. Tier 1.1 + 1.1i COMPLETE. Track 1.2 Phases 1–3 COMPLETE** (+ Today stale-visibility hard gate). **Track 1.3 Phases 1–2 COMPLETE. Track 1.4** through listing completeness **+ Sign-offs all `passed`.** **Tier 1 vault closure:** static validation + protocol logged (**2026-04-13**); **calendar dogfood week** — operator completes `docs/TIER_1_DOGFOOD_WEEK_LOG.md` table then pastes **Final Tier 1 note** in that file. Gate: typecheck ✓, 328/328 tests ✓, build ✓.

**Immediate next 3 actions:**

1. **Operator:** Run the 2-week native test — open Today daily, copy morning brief actions to devs, import fresh Profound CSVs, run scans to detect changes, confirm detected changes into changelog. Run `npx tsx scripts/crawl-competitor-sitemaps.ts` periodically to track competitor page changes.
2. **Phase 4: Native Prompt Execution** — build platform adapters (Perplexity, ChatGPT, Gemini) to replace Profound CSV imports with nightly API-based prompt execution. Start with Perplexity (best citation quality).
3. **Competitor monitoring enhancement** — add competitor alert detail view, link alerts to answer intelligence topics for counter-move suggestions, add Settings UI for managing monitored competitors.

**Sprint 6A.1 progress (2026-04-24):** Phases 1–7 COMPLETE.
- P1 migrations (page_element_inventory + recommended_edits + llm_rejections + changelog action_type/target_element_key)
- P2 ActionType registry, P3 ElementType registry, P4 element_key helpers, P5 13 active extractors + dispatcher
- P6 — extractor wired into `verify-action.ts` + `scripts/scan-owned-pages.ts` + `orchestrate-scan.ts` dual-write block. Idempotent on `(source_snapshot_id, element_key)`.
- P7 — `buildSpecificEditEvidencePacket` pure builder ships at `src/domains/recommendations/specific-edit-evidence.ts`. Top-level `clusterId | clusterLabel | clusterKind`. 16-char sha256 evidenceHash. allowedTargetUrls owned-only + sentinel. Strict serializability + no-route-render-generation guard.
- P8 — `SpecificEditProvider` interface + 3 implementations at `src/domains/recommendations/specific-edit-provider.ts` + `providers/{deterministic,openai,anthropic,index}.ts`. Deterministic shell returned empty bundle; openai + anthropic stubs throw `not_implemented (Sprint 6A.2)`. No SDK deps added.
- P9 — Deterministic generators wired. New folder `providers/generators/` with `edit-title.ts`, `add-h2-section.ts`, `add-faq.ts`, `_text-utils.ts`. `runDeterministicGenerators(packet)` aggregates all 3 in stable order.
- P10 — Output validation layer at `src/domains/recommendations/specific-edit-validator.ts`. 10 check categories. Discriminated `{ok: true} | {ok: false; field; reason}` result. All deterministic provider outputs validate clean.
- P11 — Persistence layer + CLI. `recommended-edits-persistence.ts` + `syncRecommendedEdits` dual-write + `scripts/generate-specific-edits.ts`. Deterministic id idempotent on (rec_id, action_type, target_element_key). 19 tests.
- P12 — /recommendations UI surfaces typed edits + Accept fans out N changelog entries.
- P14 — Orchestration extract + queue-driven CLI. `src/domains/recommendations/load-queue.ts` + `scripts/build-edits-for-queue.ts`. Page render unchanged. 18 new tests, 2061 passing.
- P15 — Real scan populated `page_element_inventory` on production: 4312 rows across 35 URLs covering all 13 active extractor types. Zero writes to `recommended_edits` / `changelog_entries`.
- **P13 rerun (today, 2026-04-25) — REAL hosted UI verification.** Picked rank-1 stableKey `create_cluster_page:geo:Los Altos` from the live queue; dry-run generated 20 valid edits (action types: `add_faq=16, add_h2_section=4`, no `edit_title`); `--write` persisted **5 unique rows** to `recommended_edits` (15 deduped by the DB unique-index target). Hosted UI confirmed via dev-server preview: **Specific edits (5)** section renders, Accept button copy is **"Accept — track 5 edits"**, all 5 element keys + the De Mattei H2 proposal text appear in the DOM. **Sprint 6A.1 is end-to-end verified on hosted.** P13 stopped before Accept per operator instruction.
- **Three small infra fixes shipped alongside P13:** (a) `build-edits-for-queue.ts` now loads `.env.local`; (b) `getPageElementInventory()` switched to `queryAllPaged` (PostgREST `max-rows=1000` was silently truncating); (c) `runProviderAndPersist` defensively dedupes by `(rec_id, action_type, target_element_key)` because Phase 9's multi-candidate emission collides on the DB unique index. 19 persistence tests still pass.
- **Phase 13b (today, 2026-04-25) — Accept fan-out test passed + bug fix.** Operator clicked Accept on the Los Altos rec; 5 changelog entries created, each with `source_rec_id` + `action_type` + `target_element_key` + structured notes (Proposed/Evidence/Measurement plan/Risks). `/changes` lists all 5. **One real bug surfaced + fixed:** `acceptRecommendation` was gating the WHOLE changelog block on `shouldStampChangelog`, so `needs_review` recs (like Los Altos) blocked the per-edit fan-out even when typed edits existed. Refactored to fire fan-out unconditionally when edits exist; legacy single-entry path still gated. Added regression test ("fan-out fires even when resolution.action is needs_review"). 2064 tests passing.
- **Phase 6A.1.16 (today, 2026-04-25) — pre-Sprint-7 cleanup.** Two surgical fixes both committed: (a) `recommendation_responses` Undo path now issues an explicit Supabase DELETE via the new `deleteRecommendationResponseByRecId` dual-write helper (was upsert-only, leaving stale rows); (b) production `page_snapshots` migrated to add 8 missing columns (audit found broader drift than the named `body_paragraph_sample`). Snapshot dual-write now succeeds end-to-end (`snapshots=true` in wrapper output). Migration `sprint6a116_page_snapshots_drift_columns` applied. 7 new Undo tests (2071 passing total). Sprint 7 is now safe to start — multi-tenant rebuild can rely on correct per-tenant delete + clean snapshot schema.
- **Sprint 6A.1: TRULY COMPLETE end-to-end on hosted.** 12 architecture phases + 4 verification phases (P13 / P13b / P14 / P15) + 1 cleanup phase (P16). End-to-end loop verified on production data:
  scan → page_element_inventory → SpecificEditEvidencePacket → deterministic provider → recommended_edits → /recommendations Specific edits (N) panel → Accept button → N changelog entries → /changes cards.
- **Next options:**
  - Operator-driven: Accept the Los Altos rec to verify P12's fan-out creates 5 changelog entries with `action_type` + `target_element_key` + `source_rec_id`. Safe to do whenever.
  - **Sprint 6A.2** — LLM activation. Highest signal once a real packet round-trips through openai/anthropic providers.
  - **Sprint 7** — Multi-tenant hardening for beta testers. The Sprint 6A.1 stores need tenant scoping before second tenant onboards.


**Full execution plan:** See `NEXT_PHASE_EXECUTION_PLAN.md` — launch phases complete; active roadmap is **Tier 1** tracks **1.1 → 1.5** (see `master_execution_plan.md` §"Tiered product stack").

---

## Key Numbers *(snapshot / example — from one imported dataset + repo layout; re-run diagnostics on your `.data` if these must be exact)*

| Entity | Count |
|--------|-------|
| Results (imported) | 1,179 |
| Changes (imported) | 85 |
| Opportunities | 0 |
| Outcome events detected | 45 |
| Attribution candidates | 202 |
| Auto-resolved events | 13/45 (29%) |
| Domain modules | 31 |
| App routes (build) | 29 |
| Vitest tests | 460 |
| Viz components | 19 |

---

## Doc Reading Order

| Order | File | What it tells you |
|-------|------|-------------------|
| 1 | **This file** (`HANDOFF_VERIFIED_STATE.md`) | Current state, what works, what's broken, next steps |
| 2 | **`architecture.md`** | How the system fits together: routes, domains, data flow, persistence |
| 3 | **`NEXT_PHASE_EXECUTION_PLAN.md`** | What to do next: phased plan, micro-steps, cursor prompts |
| 4 | **`VERIFICATION_LOG.md`** | Proof of past work: dated entries with before/after metrics |
| 5 | **`master_execution_plan.md`** | Deep context vault: all history, all ideas, full backlog |
| 6 | **`TIER_1_DOGFOOD_WEEK_LOG.md`** | Tier 1 dogfood protocol + daily log + vault closure note (when filled) |
| 7 | **`SCAN_TRUTH_REFACTOR_PLAN.md`** | Vertical deep dive: scan orchestration refactor spec |

---

## Where Everything Lives

### Documentation

```
docs/
  HANDOFF_VERIFIED_STATE.md     ← YOU ARE HERE (entry point)
  NEXT_PHASE_EXECUTION_PLAN.md  ← active execution plan
  VERIFICATION_LOG.md           ← proof + history log
  TIER_1_DOGFOOD_WEEK_LOG.md    ← Tier 1 dogfood protocol + operator log (vault closure)
  architecture.md               ← system map
  master_execution_plan.md      ← full context vault (history + ideas + backlog)
  SCAN_TRUTH_REFACTOR_PLAN.md   ← scan refactor spec (completed)
  TIER_1_4_PHASE_2_LOCAL_REVIEW_READ_PATH_SPEC.md  ← local review import contract
  TIER_1_4D_REVIEW_MONITORING_V1_SPEC.md           ← review monitoring v1 scope (1.4d)
  TIER_1_4E_REVIEW_CONNECTORS_SPEC.md             ← connector sub-spec extending 1.4d (1.4e)
  NATIVE_INGESTION_READINESS_AUDIT.md             ← Profound bridge → API/Supabase: integrity, utilization, pipeline risks, open questions
  archive/
    audits/                     ← 9 audit files from 2026-04-11 comprehensive audit
    handoffs/                   ← archived handoff snapshots
    completed-specs/            ← completed spec documents
    product/                    ← historical PRD
    research/
      profound-integration/     ← Profound CSV field notes, parsing risks, source map
```

**Repo root:** `CLAUDE.md` — portable agent rules for Claude Code / CLI; keep in sync with `.cursor/rules/core.mdc` if you use both tools.

### Code

```
src/
  app/(shell)/           ← All routes (Today, Pages, Market, Changes, Settings, etc.)
  domains/               ← 31 domain modules (attribution, scanning, pages, competitors, product, etc.)
  components/            ← UI components (shell, viz, data, display, form, today, replication)
  lib/                   ← Shared utilities (persistence, import, data-adapters, view-models, tenant)
  adapters/              ← External data adapters (Profound)
  storage/               ← Canonical persistence layer
  derivations/           ← Pure computation functions
scripts/                 ← CLI tools (scan, registry, sampling, parity)
tests/                   ← Vitest tests (domains + lib)
.data/                   ← Runtime data (gitignored)
```

### Key Config

| File | What |
|------|------|
| `.env.local` | `DATA_SOURCE`, `DUAL_WRITE`, `BEACON_TENANT` |
| `.cursor/rules/core.mdc` | Always-on Cursor rules for Beacon |
| `src/lib/navigation.ts` | 5-item nav definition |
| `src/lib/business-config.ts` | Business profile (name, domain, services, locations) |
| `src/lib/tenant.ts` | Optional multi-tenant file isolation |

---

## Rules for Future Work

1. **Read this file first** before starting any task.
2. **Do not create new planning docs.** Use the existing 6 files. Ideas go in `master_execution_plan.md`. Steps go in `NEXT_PHASE_EXECUTION_PLAN.md`. Proof goes in `VERIFICATION_LOG.md`.
3. **Do not duplicate context.** Each doc has one job (see reading order above). If you're not sure where something goes, it goes in the vault (`master_execution_plan.md`).
4. **Update this file** when the system state materially changes (new phase completed, major bug fixed, scores change).
5. **Archive, don't delete.** Old specs → `docs/archive/completed-specs/`. Old handoffs → `docs/archive/handoffs/`.
