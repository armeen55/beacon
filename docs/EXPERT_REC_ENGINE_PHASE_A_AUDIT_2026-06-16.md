# Expert Recommendation Engine — PHASE A Audit (2026-06-16)

> **Mission:** turn Beacon from a data-backed recommendation *list* into a world-class,
> review-gated **SEO/AEO/GEO operator** — specific evidence, expert reasoning, query/page
> intent fit, keyword+fanout strategy, honest confidence, safe review-gated push, live
> verification, and measured learning. **No hardcoded vertical/keyword/brand rules in
> product logic** (tenant config/data + deterministic gates + LLM-over-structured-inputs only).
>
> This file is PHASE A of that directive: *read the code, assume nothing, trace and document.*
> Produced by a 10-agent read-only workflow (`wf_69ebba7a-8fb`, 9 subsystem readers + synthesis,
> ~1.0M tokens, 286 tool uses). Full per-dimension findings (entry points + every file:line):
> `tasks/w4z16l8pt.output` in the session dir.

---

## End-to-end pipeline (real files, execution order)

1. **Evidence assembly** (nightly + on-demand). Five signal sources land in Supabase and load
   per-tenant as pure Maps keyed by canonical URL: GSC (`sync-search-analytics.ts:204` → `gsc-page-signals.ts:65` via RPC `gsc_page_signals_v1`, canonicalized by `canonicalize-url.ts:61` **falling back to RAW url on failure:127**), SEMrush/Clarity/GA4/Profound parallel loaders. Page structure: `scripts/scan-owned-pages.ts:245 fetchPage` (**raw HTTP, no JS render**) → `extractor.ts:15` (cheerio). A puppeteer render-check runs on the **top-5 cited pages only**, as a console diagnostic — it does **not** feed verdict precedence.
2. **Triggers → candidates.** ~30 deterministic predicates under `recommendation-intelligence/triggers/` each emit a candidate + evidence string.
3. **Join + resolve.** `loadLiveRecommendationQueue` (`load-queue.ts:200`, 8 steps) → `generateRecommendations` (`generate.ts:137`, clusters) → `resolvePageIntent` (`resolve-page-intent.ts:84`, 3 layers: observation citations → inventory fallback → heuristics, hardcoded share thresholds) → `adjudicate-from-cache-only` (no **live** LLM on this path).
4. **Scoring.** `prioritizeRecommendations` (`prioritize.ts:202`) + `priorityScore` (`priority-score.ts:304`) blend severity + cluster + competitor pressure + upside × ga4-value × confidence ÷ effort, with **hardcoded constants**; `promotion-eligibility.ts:191` gates each (signal,action) against a **locked code table**; `safety-gates.ts:150` runs a 13-step ladder.
5. **Confidence (3 disjoint channels).** `computeRecConfidence` (`confidence.ts:202`, HIGH effectively unreachable), `deriveConfidence` (`derived-confidence.ts:112`, render-time customer label), and a per-edit hardcoded `'medium'`. **None persists; the DB column is uniformly `medium`.**
6. **Copy proposal.** `enrichPromotionRow` (`draft-enrichment.ts:1073`) → `composeTitle/Meta/H1/Schema/FixDirective`; `holdUnsafeDraft` abstains on unsafe copy. The LLM gateway (`llm-draft-gateway.ts:85`, fail-closed) is **infrastructure-only — no production caller**.
7. **Render.** `buildRecommendationActionRows` (`recommendation-action-rows.ts:1462`) flattens + attaches evidence lines; `RecommendationDetailClient` renders Acts 1–6. `checkWhyDisplaySafe` guards the `why` field **but NOT the evidence-line content**.
8. **Push.** `approveAndPushRecommendedEdit` → `executePush` (`push-service.ts:147`): status guard, Ritz hard-refuse, daily cap, non-destructive guard, pre-push snapshot, field-targeted read-modify-write (slug/url protected). `deriveWixContentFieldKey` auto-targets only `edit_title/change_h1/edit_meta`.
9. **Measure.** `probeLiveText` (120-char substring) → `verified_live`; authoritative 24h match-runner. **No feedback loop** from outcomes back into confidence/priority/LLM — every rec is one-shot.

---

## Cross-cutting risks (the mission's named problems, with evidence)

1. **[BUG] Query/page intent match is unverified end-to-end** *(mission #1).* No page-topic-fit module exists in `src/domains`. GSC may attribute a query to a wrong/stale URL (no owned-registry check; canonical falls back to raw) → `resolvePageIntent` picks a page on citation-share thresholds with no reasoning → priority floors it High on impressions → the gateway never checks the edit answers the intent → push never checks fit. Blind spot recurs across 5 subsystems with no owner.
2. **[RISK] Stale-crawl + JS-render false positives captured but never gate.** `extraction_certainty`, `mobile_usability`, `evidence_freshness_days` all computed but none gate the indexability verdict or rec confidence. Raw-HTML snapshots → an H2/FAQ edit can anchor to an element only present in static HTML; a 60-day-old snapshot can flip a verdict to "ok."
3. **[RISK] Instruction-artifact / "Add Add" copy can survive composition.** Composers embed proposed_text/instructions into `display_label`; zero-width strip runs *after*; no dedup of repeated action-word prefixes; directive types render *instructions* as paste-able "Suggested copy." `composeTitle` never clips → title+separator+brand routinely exceeds the ~60-char window; brand-strip asymmetric (`Title | Brand | Brand`).
4. **[RISK] Loose/incoherent confidence — 3 channels, none gates quality, none persists.** `deriveConfidence` can label a row with a broken/placeholder/leaked `proposed_text` "strong"; GSC demand rescues thin edits to "moderate"; HIGH structurally unreachable; low-confidence rows can still rank High on severity+obs arithmetic; no offline calibration possible.
5. **[BUG] AI-claims-without-AI-evidence + white-label leak on the unguarded evidence-line surface.** The 2026-06-15 evidence lines (GSC/SEMrush/Clarity/AEO) render **without** `checkWhyDisplaySafe`; Profound `asset_name`/`category_id` flow unvalidated into "AI assistants answer this citing {competitor}" — a UUID or the vendor's own name would render verbatim. GSC-floored confidence can read "Moderate evidence" on AEO topics with **zero** AEO grounding.
6. **[RISK] Residual hardcoded vertical/brand/keyword assumptions.** `DEFAULT_EXPANSION_CITIES` (Bay Area) reach every tenant whose caller omits a city list; live-push action whitelist baked into `url-map.ts`; eligibility table is code; title casing + `' | '` separator hardcoded; STOPWORDS/UTILITY patterns hardcoded.
7. **[RISK] No measurement→learning feedback loop.** `verified_live` produced but nothing flows back; `verified_live_modified` defined but never produced; `measurementPlan` promises watching but there's no Results surface and no threshold recalibration.
8. **[RISK] Evidence attached on the render path, not stored as intent.** A signal-fetch timeout yields empty evidence with no "should-be-here" indicator; confidence derivation depends on render-time data → labels non-reproducible offline.

---

## Proposed build order (maps to directive B–K)

| # | Phase | Depends | Reusable / Net-new |
|---|-------|---------|--------------------|
| B | **Durable evidence model** — assemble once, persist intent (values+freshness+sources), not render-time | — | reuse `evidence-packet.ts`, 5 signal loaders; net-new evidence-snapshot persistence + freshness gate |
| C | **Query fanout + page-URL ownership validation** — fix wrong attribution at the join | B | promote `query-fanout-audit.ts` to live path; net-new owned-registry membership check in `gsc-page-signals.ts` |
| D | **Keyword merge** — unify GSC+SEMrush into one striking-distance portfolio | B,C | reuse both signal loaders; net-new dedupe/reconcile module |
| E | **Page-topic fit scoring** — the missing intent-match metric (mission #1) | C,D | extend `match-engine/similarity.ts`+`normalize-text.ts`; net-new pure topical-fit scorer that gates resolution confidence |
| F | **Opportunity scoring w/ per-tenant tuning + stale/render gating** | E,B | reuse `priority-score.ts`/`prioritize.ts`; net-new per-tenant threshold config + freshness/extraction gates |
| G | **LLM strategist/editor/AEO/critic passes** — wire the gateway + intent & artifact validation | E,F | reuse `llm-draft-gateway.ts`, `specific-edit-validator.ts`; net-new intent-coherence + artifact + length + critic + full-bundle validation |
| H | **Confidence model rebuild** — one coherent, persisted, abstention-enforcing label | E,F,G | reuse `confidence.ts`/`derived-confidence.ts`; net-new persistence + validity gate + abstention |
| I | **Reasoning packet + UI upgrade** — surface the WHY, fix render guards | G,H | reuse Acts 1–6, `why-display-guard.ts`; net-new `reasoning-packet.ts` + evidence-line guard + results surface |
| J | **Push schema validation + live-render verify + measurement loop** | H,I | reuse `push-service.ts`, `render-check.ts`; net-new Wix schema introspection + dry-run wiring + feedback recompute |
| K | **Tests, architecture pins, de-verticalize close-out** | B–J | reuse pin patterns; net-new pins per contract + hardcoded-assumption catalog |

---

## Execution decision (what to build first, and why)

The dependency-correct foundation is **B**, but it is a persistence refactor of the hot path —
a **major change**, so it is planned with the operator before landing (per CLAUDE.md).

Several mission-named **bugs/risks are fully deterministic, self-contained, and independent of
B/LLM** — they are built first as a "display-safety + copy-safety hardening" phase, each
gated + committed + architecture-pinned:

- **Slice 1 — Evidence-line display-safety guard** (closes cross-cutting BUG #5 / risk #5): run every rendered evidence-line string through the same display guard as `why`; suppress a line that fails. Adds the missing architecture pin.
- **Slice 2 — Copy-artifact gate** (cross-cutting RISK #3): deterministic detector for instruction-text-as-title, repeated action-word prefixes ("Add Add"), and title/meta length over budget; wire into the existing copy guards (abstain, never fabricate).
- **Then:** Slice 3 — pure **page-topic intent-fit scorer** (Phase E, mission #1), surfaced read-only in the brief first, wired into confidence/gating in a later, planned slice.

**Gated/paused:** PHASE B (major refactor — plan first); PHASE G live-LLM (confirm OpenAI
quota — earlier this session the account returned `429 insufficient_quota`, vs the directive's
"credits available"; no paid calls until confirmed). No live Wix pushes, no env/secret changes,
no destructive migrations, review-gated publishing preserved throughout.
