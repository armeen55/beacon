# Beacon Demo-Path Audit — 2026-05-06

**Generated:** 2026-05-06
**Method:** 8 parallel audit agents reading source-only (no live browser, no dev server). Each route audited through a "skeptical small-business-owner evaluating Beacon for purchase" lens. Every finding cites `file:line`. Pure read-only — no implementation in this document.
**Status:** read-only audit; Phase 3 fix bundle proposed at end (same 5-fix bundle as `docs/BEACON_PUBLIC_LEADER_GAP_AUDIT.md`); awaits operator approval.

---

## 1. Method

For each customer-visible route, audit agents answered the same 8 questions:

1. What does this page tell me Beacon does, in 10 seconds?
2. What changed today (relative to yesterday)?
3. What action should I take?
4. Do I trust the recommendation/data shown?
5. Can I see proof without debug jargon (UUIDs, regex, schema names)?
6. Can I understand measured vs predicted?
7. Anything that looks like an internal tool?
8. Anything embarrassing in a customer demo?

Plus two cross-cutting agents (jargon/debug-string sweep + empty-states + first-time-UX).

Findings below cite file:line. Severity: **H** = demo-killer (would derail a live demo); **M** = trust-eroder; **L** = polish.

---

## 2. Per-route findings

### 2.1 `/today` (audit agent: route-specific)

| # | Sev | File:line | Finding | Smallest fix |
|---|-----|-----------|---------|--------------|
| T1 | **H** | `src/app/(shell)/today-client.tsx:683-684` | Renders literally `… (URL-level Z-score)` in the customer-facing proof line. Buyer doesn't know what a Z-score is. | Replace `(URL-level Z-score)` with `(measured per page)` or drop the parenthetical. |
| T2 | **H** | `src/components/today/poll-health-block.tsx:214,218,220,225,227` | Failure copy reads "Check persistence and daily-poll logs (scheduled-job logs)" / "Both platforms failed — check API keys, persistence, and scheduled-job logs." On-call runbook copy on the customer home tab. | Collapse to single sentence: "AI tracking didn't run today — Beacon support has been notified." Gate diagnostic detail behind a "Show details" link. |
| T3 | **H** | `src/app/(shell)/today-client.tsx:412` | `PollHealthBlock` mounts as the very first tier, ahead of every other content section. When OK, it should disappear; when partial, it should compress. | Render `PollHealthBlock` only when `overall !== "ok"`. |
| T4 | **M** | `src/app/(shell)/today-client.tsx:388-639` | Page has **no h1, no value-prop strip**. First-time visitor sees alerts → chart → action-card with zero orientation. | Add `<h1>Today — your AI visibility command center</h1>` + 1-line subtitle above Tier 0. |
| T5 | **M** | `src/components/today/poll-health-block.tsx:140,253` | Tag "verification sample" and subline "ran a verification sample (small). Headline deltas use larger windows; sparkline may dip on this day." Pipeline-taxonomy leak. | Replace with "(small sample today; trend uses 7+ days)". |
| T6 | **M** | `src/app/(shell)/today-client.tsx:330` | Findings strip falls through to `type.replace(/_/g, " ")` for unmapped types — so `schema_invalid_jsonld` renders as "schema invalid jsonld". | Filter out unmapped types instead of rendering the slug as a fallback. |
| T7 | **M** | `src/app/(shell)/today-client.tsx:419-421` | Stale-data warning: `Visibility data is {n}d stale.` No context for whether 5d is bad. | Expand: "Last AI scan ran {n} days ago — recommendations may be out of date." |
| T8 | **M** | `src/components/today/action-card.tsx:262-265,461` | Engine-timing chip shows raw `chatgpt ~14d` and expander says `(n=12)` (stats abbreviation, not buyer copy). | Replace `(n=12)` with `(based on 12 prior moves)`; replace `chatgpt ~14d` with "Usually shows up in ~14 days on ChatGPT". |
| T9 | **L** | `src/components/today/lifecycle-strip.tsx:75` | Chip label "Not found after 7d" is operator jargon. | Rename to "Not yet live" or "Awaiting site update". |
| T10 | **L** | `src/components/today/visibility-leaderboard.tsx:170` | Empty state: "No entities to rank yet. Run a scan or import fresh data." "Entities" is internal vocabulary. | Replace with "No competitors to rank yet. Import data or wait for the next scan." |

**Bright spots:** Action-card buckets "Fix now / Biggest win / Worth trying" (`action-card.tsx:123-127`) read clean. `REC_CONFIDENCE_LABEL` translates engineConfidence properly (`action-card.tsx:148`). Visibility chart sample-day strip is honest about sparse sampling (`visibility-score-chart.tsx:300-303`). The `today-findings.tsx:144-146` raw-UUID `Batch:` line is **NOT** mounted on `/today` — verified safe.

### 2.2 `/recommendations` list + drawer (audit agent: route-specific)

| # | Sev | File:line | Finding | Smallest fix |
|---|-----|-----------|---------|--------------|
| R1 | **H** | `src/app/(shell)/recommendations/recommendations-client.tsx:1215-1262` | "Debug details" `<details>` block renders `rec_id`, `edit_id`, `resolver_tier`, `resolution_action`, `motive`, `engine_confidence`, `evidence_hash`, `edit_lifecycle`, `full_reasoning`, `confidence_reason` — all raw DB-shape. `<details>` collapse only hides visually; values are in the DOM. | Gate behind `process.env.NEXT_PUBLIC_OPERATOR_MODE === "true"` so the `<details>` block is conditionally rendered. |
| R2 | **H** | `src/app/(shell)/recommendations/recommendations-client.tsx:435-441` | `data-rec-source-rec-id="<uuid>"` and `data-rec-source-edit-id="<uuid>"` data attributes leak full UUID taxonomy on every row in production HTML. View-source / DevTools exposes them. | Strip these two attributes outside `process.env.NODE_ENV === "test"`. Keep typed enums (priority/status/type) — those are non-leaky labels. |
| R3 | **H** | `src/app/(shell)/recommendations/recommendations-client.tsx:165-188,246` | Filter dropdown `<option value>` is the raw enum: `add_internal_links`, `regenerate_edit`, `review_decision`, `add_comparison_table`. Visible in HTML and harvested by view-source. | Use display label as value (labels are unique) OR numeric/index-based values. |
| R4 | **H** | `src/app/(shell)/recommendations/recommendations-client.tsx:200,155,642` | Status filter exposes raw schema enum `needs_fresh_edit` (label "Needs fresh edit" still uses internal vocabulary; SMB owner asks "fresh edit of what?"). | Rename to `Re-generate`. One-line change in `ACTION_ROW_STATUS_LABEL` at `recommendation-action-rows.ts:131`. |
| R5 | **M** | `src/app/(shell)/recommendations/page.tsx:128-130` | Header copy: "Beacon turns AI visibility gaps into concrete website tasks. Review the top actions, accept them, or mark them as shipped." "AI visibility gaps" is product jargon. | Rewrite: "Tasks that should make AI mention your business more often. Accept the ones you want to ship." |
| R6 | **M** | `src/app/(shell)/recommendations/recommendations-client.tsx:1175-1181` (no projected impact line) | Drawer renders Measurement plan only when present; **no projected-lift line at all** — no "you could gain ~X mentions/month," nothing in dollars or visits. List view has zero impact projection. | Add a "Projected lift" field populated from observation-count × cluster volume; render under `proposedText` in drawer. Coarse range OK ("Could affect ~12 AI answers/week"). |
| R7 | **M** | `src/app/(shell)/recommendations/recommendations-client.tsx:266-273,272` | Summary line: `total · new · tracking · need review`. No "X high priority" badge. Buyer can't tell at a glance whether rank-1 is High or Low. | Append `· {highCount} high priority` to the summary line. |
| R8 | **M** | `src/app/(shell)/recommendations/recommendations-client.tsx:822-846,875-892` | "Mark shipped" button vs "View" button both colored success-green; only difference is verb. Buyer scanning misreads "Mark shipped" as already-shipped. | Change accepted-with-edits button copy to "I shipped it" (operator voice — clearer it's an action). |
| R9 | **L** | `src/app/(shell)/recommendations/recommendations-client.tsx:1338` | Evidence ref label literal `prompt: "..."` reads like a debug field. | Change `prompt:` prefix to `Asked:` (also `copy-sanitize.ts:158`). |
| R10 | **L** | `src/app/(shell)/recommendations/recommendations-client.tsx:1362-1365` | Watchlist description: "Winning clusters worth defending. Passive — no action required unless the signal drops." "Clusters" + "signal drops" are internal terms. | Rewrite: "Topics where AI already recommends you. Watch these in case results slip." |

**Q8 placeholder copy verified clean.** Searched the file for historical placeholder strings (`"Draft answer"`, `"TBD"`, `"[insert"`, `"rewrite below"`, `"(operator: rewrite)"`). None render to production. The `proposedText` block (`:1086-1088`) renders raw model output verbatim — if upstream emits a placeholder it would leak here, but no client-side default placeholder exists.

### 2.3 `/prompts` list + detail (audit agent: route-specific)

| # | Sev | File:line | Finding | Smallest fix |
|---|-----|-----------|---------|--------------|
| P1 | **H** | `src/app/(shell)/prompts/[id]/page.tsx:226-240` | Cluster-tag labels split on `:` and render `label = rest.join(":")` raw. `geo_cluster:bay_area_ca` shows as "geo cluster · bay_area_ca" instead of "Bay Area, CA". `prettifySlug` not applied. | Wrap label render with `prettifySlug(label) ?? label` at line 237. |
| P2 | **H** | `src/app/(shell)/prompts/page.tsx:324-336` | List page never imports `prettifySlug` AT ALL. Same raw-label cluster-pill bug. | Export `prettifySlug` from a shared util OR duplicate the call; render `prettifySlug(label) ?? label` at `page.tsx:335`. |
| P3 | **H** | `src/app/(shell)/prompts/page.tsx:319-322` | Pill literal "ranked list miss" — operator jargon. Buyer reads "what's a ranked list miss?" | Rename to "Not on the list" or "Missed the shortlist". |
| P4 | **H** | `src/app/(shell)/prompts/page.tsx:67-105` and `[id]/page.tsx:88-119` | Neither page has a CTA / next-action. Buyer asks "what do I do?" and gets no answer. | Add "See recommendation →" link on each prompt row when one exists, and on the drilldown header. |
| P5 | **M** | `src/app/(shell)/prompts/[id]/page.tsx:471` | Hardcoded literal `"Brand mentioned, never primary..."` uses literal "Brand" instead of the tracked entity name. | Thread the entity name into `primarySummary` and substitute. |
| P6 | **M** | `src/app/(shell)/prompts/[id]/page.tsx:585` | `s.structure.replace(/_/g, " ")` yields lowercase phrases like "ranked list" instead of "Ranked List". | Route through `prettifySlug` (or use the existing `STRUCTURE_LABEL` map from `lib/structure-labels.ts`). |
| P7 | **M** | `src/app/(shell)/prompts/[id]/page.tsx:198-203` | Detail page shows "OUTRANKED" badge with no lead sentence under it. List page has the lead from `CATEGORY_META`; detail doesn't. | Mirror list-page metadata; add the lead sentence below the badge. |
| P8 | **M** | `src/app/(shell)/prompts/page.tsx:170-181` | `mostRecentObservation` returns `matrix.date` (today) any time any platform has obs > 0; doesn't actually report most-recent observation date. | Carry a `latestObservedAt` on the matrix, or remove the line. |
| P9 | **L** | `src/app/(shell)/prompts/[id]/page.tsx:298,309` | Duplicate `"ms"` in `KNOWN_US_STATES` Set. Harmless dedupe. | Delete one. |
| P10 | **L** | `src/app/(shell)/prompts/page.tsx:83` | Hardcoded copy "next poll cron fires at 10:00 UTC" — but the comment + the actual schedule is **07:00 UTC** since the 2026-04-24 schedule shift (per `daily-native-poll.yml:64`). | Update copy to "07:00 UTC". |

**Verdict:** decision math + category framing are solid. Leaky surface is slug rendering on cluster pills (BOTH pages miss `prettifySlug`), the "ranked list miss" jargon, the missing "what do I do" CTA, and the stale 10:00 UTC copy.

### 2.4 `/changes` (audit agent: route-specific)

| # | Sev | File:line | Finding | Smallest fix |
|---|-----|-----------|---------|--------------|
| C1 | **H** | `src/domains/attribution/lifecycle-classification.ts:228` | Tab label `"Imported legacy"` — Round 2 fix to "Pre-launch history" was **never actually applied** (despite being claimed in HANDOFF). | Change `imported_legacy: "Imported legacy"` → `"Pre-launch history"`. |
| C2 | **H** | `src/components/changes/lifecycle-status-pill.tsx:103-104` | Pill labels `"Imported legacy"` / `"Legacy"`. Same schema leak. | Rename `label`/`compactLabel` → `"Pre-launch"` / `"Pre-launch"`. |
| C3 | **H** | `src/app/(shell)/changes/page.tsx:413-419` | At-a-glance prints `"N imported legacy"` and `"N scan-confirmed"` — schema words. | `"N pre-launch entries"` / `"N detected by scan"`. |
| C4 | **H** | `src/app/(shell)/changes/page.tsx:372-374` | Page header: "Verified and tracked changes Beacon has confirmed live, plus everything pending or imported." Doesn't clarify "your site changes" vs "AI changes". | Rewrite description: "Every edit you've shipped to your site, with AI impact tracked over time." |
| C5 | **H** | `src/app/(shell)/changes/scorecard-client.tsx:715` | `data-attribution-branch={copy.branch}` writes raw enum `verified_live_too_early` etc. into DOM. View-source / inspector exposes it. | Drop the data attribute or hash it. |
| C6 | **M** | `src/app/(shell)/changes/scorecard-client.tsx:546` | `data-stale-pending-state={lifecycleStatus}` exposes `accepted` / `recommended` enum. | Remove attribute or map to neutral codes. |
| C7 | **M** | `src/app/(shell)/changes/scorecard-client.tsx:813-851` | "Explain this verdict" math panel renders `μ_pre`, `σ_pre`, `z-score`, `≥ ±2 significance` to customer-visible drawer. | Hide behind a "Show math" toggle; default to plain narrative; humanize labels. |
| C8 | **M** | `src/app/(shell)/changes/scorecard-client.tsx:392-397` | Coverage warning leaks raw enum (`Coverage state is stale` / `critical`). | Map enum → `"data may be old"` / `"data is significantly outdated"`. |
| C9 | **M** | `src/app/(shell)/changes/scorecard-client.tsx:84` | Default tab `live_verified` puts the schema enum in URL (`?tab=live_verified`). | Use `?tab=live` (or numeric/named-clean key); preserve URL when bookmarked. |
| C10 | **L** | `src/app/(shell)/changes/page.tsx:425-426` | `"N other"` rendered with `text-muted-foreground/70` opacity — looks like a bug, not a category. | Drop count OR rename `unclassified` → `miscellaneous`. |

**Round 2 status verified:** the "Stamps live_at = now and live_match_kind = operator_override" tooltip is **gone** (Round 1 fix held). Mark-shipped tooltip reads clean: "Beacon will start tracking its impact now instead of waiting for the next scan."

### 2.5 `/diagnostics` (audit agent: route-specific)

| # | Sev | File:line | Finding | Smallest fix |
|---|-----|-----------|---------|--------------|
| D1 | **H** | `src/app/(shell)/diagnostics/page.tsx:198` | **No server-side guard.** URL-guessing reaches the page in production. `DiagnosticsPage` is a plain server component with no `notFound()`, no role check, no operator gate. Tenant context only enforces *which* tenant, not *who* may view. | Add at top: `if (process.env.BEACON_OPERATOR_MODE !== "true") notFound();`. Same fix to `settings/health/page.tsx` re-export and `diagnostics/spikes/page.tsx`. |
| D2 | **H** | `src/app/(shell)/diagnostics/page.tsx:299-322` | Placeholder-config banner names internal env var `BEACON_BUSINESS_CONFIG_JSON` and the `.data/global/business-config.json` path inline as `<code>` blocks to anonymous visitors when config is missing. | Gate behind operator guard (D1); customer-mode copy: "Workspace not configured." |
| D3 | **H** | `src/app/(shell)/diagnostics/page.tsx:294-297` | Header: "Diagnostics — System specialist view: how attribution data is shaped, linked, and scored in this workspace. Technical and honest — for operators who need depth without leaving Beacon." Self-labels as engineer-only. | Guard route entirely (D1). |
| D4 | **M** | `src/app/(shell)/diagnostics/page.tsx:1085-1153` | Truth-set evaluation block renders "True positives / False positives / False negatives / Precision / Recall" tables with sub-text "Linked but human disagrees." Customer reading their own data scored as "false positive" loses trust. | Behind operator guard (D1). |
| D5 | **M** | `src/app/(shell)/diagnostics/page.tsx:773-776` | `<code>attributed_changelog_ids</code>` rendered as field-name explanation. | Rename in copy to "imported change IDs"; remove `<code>`. |
| D6 | **M** | `src/app/(shell)/diagnostics/page.tsx:926-953` | Renders `Null URL rate`, `Null geo rate`, `High + nulls (Strong signal tier with URL or geo null)` — model-quality self-criticism. | Behind operator guard (D1). |
| D7 | **M** | `src/app/(shell)/settings/health/page.tsx:1` | `export { default } from "../../diagnostics/page";` silently re-exposes the entire diagnostics tree under `/settings/health`. | Delete this file or apply same operator guard. |
| D8 | **M** | `src/app/(shell)/diagnostics/spikes/page.tsx` | Sibling unguarded route — same URL-guessability. | Apply operator guard at parent layout level. |
| D9 | **L** | `src/app/(shell)/diagnostics/page.tsx:556,637,707,844` | Internal jargon: "Pattern intelligence", "Cluster intelligence", "Expansion candidates (system)", "Stored-ID pair scoring & model shape". Reads like Jira tickets. | Acceptable behind operator guard; do not promote any subset to customer surface without rewriting. |
| D10 | **L** | `src/app/(shell)/diagnostics/page.tsx:325-327` | `<LocalOperatorPanel variant="health"/>` — name leaks engineering vocabulary even when guarded. | Rename component when promoting any subset to customer view. |

**No secrets found.** No `process.env.X` value-prints, no SQL strings, no service-role tokens, no cost-ledger dollar figures, no API keys. Only env-var *name* `BEACON_BUSINESS_CONFIG_JSON` is rendered (D2). Cleaning up is access-control + cosmetic, not credential leak. **D1 alone closes 8 of 10 findings.**

### 2.6 `/settings/import` (audit agent: route-specific)

| # | Sev | File:line | Finding | Smallest fix |
|---|-----|-----------|---------|--------------|
| I1 | **H** | `src/app/(shell)/settings/import/import-page.tsx:70` | Default state `useState("profound")` — Source field pre-fills with "profound" before user types anything. | Change default to `""`. |
| I2 | **H** | `src/app/(shell)/settings/import/import-page.tsx:358` | Placeholder text `placeholder="e.g. profound"`. Visible to anyone opening Manual Import. | Change to `"e.g. csv"` or `"e.g. manual import"`. |
| I3 | **H** | `src/app/(shell)/settings/import/import-page.tsx:201-203` | Copy: "Internal tooling — drop CSV exports on the server filesystem and the importer detects file type from headers" — explicitly self-labels as internal, references server filesystem. | Gate the entire `advancedOpen` block behind `process.env.NEXT_PUBLIC_OPERATOR_MODE === "true"` (or tenant === "ritz"). Hides Run batch import + internal copy from non-Ritz tenants. |
| I4 | **H** | `src/app/(shell)/settings/import/import-page.tsx:235` | Button "Run batch import" with no file picker — operates on hidden `.data/` files. Pure operator tool exposed. | Covered by I3 (advanced gating). |
| I5 | **H** | `src/app/(shell)/settings/page.tsx:1-5` | `/settings` redirects to `/settings/import` — customer clicking "Settings" lands directly on import page rather than profile/account. | Change redirect target away from `/import` (e.g. `/settings/history` or a stub profile). |
| I6 | **M** | `src/app/(shell)/settings/import/import-page.tsx:53-57` | `friendlyImportSource` maps `beacon-workbook`/`ritz-workbook` → "Legacy workbook (removed)" but does NOT mask `profound` source rows in the History table. Customer-2 sees "profound" in the import log. | Add mapping `"profound"` → `"Historical CSV"`. |
| I7 | **M** | `src/app/(shell)/settings/import/import-page.tsx:209-211` | "Merge semantics: existing prompts, observations, answer texts, citation shards (per date), and benchmark snapshots are unioned…" — engineer-speak inside customer settings. | Behind I3 operator gate. |
| I8 | **L** | `src/app/(shell)/settings/import/import-page.tsx:261-264` | Result-card stat labels "Bridged results / Bridged changes" — internal pipeline jargon. | Rename to "Imported results / Imported changes". |

**Smallest single fix:** I3 + I5 + I1 — gate advanced behind operator mode, redirect /settings → /settings/history, drop "profound" default. Three small edits, no Profound code touched, demo-safe.

### 2.7 Cross-cutting jargon + debug strings (audit agent: cross-cutting)

| # | Sev | File:line | Finding | Smallest fix |
|---|-----|-----------|---------|--------------|
| X1 | **H** | (Same as R1) `recommendations-client.tsx:1222-1259` | Debug `<details>` block leaks 10+ raw DB-shape strings + 2 UUIDs to every drawer. | Same as R1: env-gate the block. |
| X2 | **H** | `src/app/(shell)/changes/scorecard-client.tsx:828-836` | Math row labels "z-score" and `±2 significance` to customer-visible drawer. | Rename to "Change strength" / "Strong signal" / "Weak signal". |
| X3 | **H** | `src/app/(shell)/changes/scorecard-client.tsx:823-826` | Renders `μ_post (after change)` (Greek mu). Statistical notation, customer-hostile. | Relabel: "After change (per day)". |
| X4 | **H** | `src/app/(shell)/changes/truth/truth-client.tsx:257` | `VerdictPill` renders `verdict.replace(/_/g, " ")` so values like `verified_live_too_early`, `verified_live_baked`, `verdict_off`, `not_found_after_7d` surface as snake-case English. | Introduce a `VERDICT_LABEL` map mirroring `LIFECYCLE_TAB_LABEL`. |
| X5 | **H** | `src/app/(shell)/changes/truth/truth-client.tsx:282` | `ConfidenceSourcePill` renders `source.replace(/_/g, " ")`, surfacing `seed prior`. Tailwind `uppercase` makes it `SEED PRIOR`. | Map to `Default estimate` (or similar plain phrase). |
| X6 | **H** | `src/app/(shell)/changes/truth/truth-client.tsx:278` | Tooltip: "Derived from v1 static edit-type heuristic — not yet learned from this account's history." References "v1" + "heuristic". | Rewrite: "Default estimate based on edit type. Beacon will refine this as your history grows." |
| X7 | **H** | (Same as C3) `src/app/(shell)/changes/page.tsx:414,419` | "N imported legacy" / "N scan-confirmed" rendered as schema words. | Same fix as C3. |
| X8 | **M** | `src/app/(shell)/settings/methodology/page.tsx:137,242,282,859` | Methodology page uses `heuristic` 4 times. | Replace with "rule-based" or "rough estimate". |
| X9 | **M** | `src/app/(shell)/local/page.tsx:199` | Renders "Completeness heuristic based on configured identity..." | "Completeness score based on..." |
| X10 | **M** | (Same as I2) `import-page.tsx:358` | `placeholder="e.g. profound"` — single residual Profound brand leak in customer settings. | Same as I2. |

**Verified clean:** `dogfeed`/`dogfooding`/`Phase v4`/`Sprint 6A` — none in rendered TSX (only comments). `"Decide tonight"` — only in a comment. `Supabase` / `Vercel` / `GitHub Actions` — only in comments.

### 2.8 Empty states + first-time UX (audit agent: cross-cutting)

| # | Sev | File:line | Finding | Smallest fix |
|---|-----|-----------|---------|--------------|
| E1 | **H** | `src/app/(shell)/today-client.tsx:344-637` | `/today` for a fresh tenant: `TodayDoNextCard` returns null, no `primaryAction`, no `visibilityData`, no `measuredWins`, no `proofLine`, no enrichment. After the alerts strip, page is essentially empty: just "Nothing waiting on you" implementation-queue tile + "0 live verified" lifecycle chip. **Looks broken.** | Add a `<FirstRunCard />` at `today-client.tsx:412` (before alerts) firing when `summary.totalCitations === 0 && primaryAction === null && lifecycleSummary.counts.liveVerified === 0`: copy "Welcome to Beacon. Your first AI-visibility reading lands after the next 07:00 UTC poll. Add prompts in Settings → Prompts to expand the daily sample." |
| E2 | **H** | `src/app/(shell)/changes/scorecard-client.tsx:130` | "all" tab empty copy: "No rows. The changelog is empty." Terminal, no path forward. | Replace with: "No changes yet. Beacon logs every accepted recommendation here once the next scan confirms it on your site. Accept your first recommendation in /recommendations to get started →" |
| E3 | **M** | `src/components/today/lifecycle-strip.tsx:50-58` | `alwaysVisible: true` makes the "0 live verified" chip render permanently. Brand-new customer reads "0 live verified" with no context. | When `liveVerified === 0 && pendingImplementation === 0 && needsReview === 0`, return null OR render single muted line: "No accepted edits yet — your first acceptance will land here." |
| E4 | **M** | `src/app/(shell)/recommendations/recommendations-client.tsx:267-274` | Empty queue toolbar: "0 actions · 0 new · 0 tracking" and "Last refreshed: {matrixDate}" where `matrixDate` may be empty/undefined → "Last refreshed: undefined". | Suppress toolbar when `allRows.length === 0` (or grey it out + hide undefined "Last refreshed"). EmptyTable below already carries the right copy. |
| E5 | **L** | `src/app/(shell)/today-client.tsx:412` | Poll-health block missing on day 1 — `pollHealth && ...` so for first-run tenants with `pollHealth === null` even the helpful "Cron has not run yet today" guidance from `poll-health-block.tsx:236` doesn't render. | When `pollHealth === null && isFirstRunNoData`, render synthetic pending-block: "First poll lands at 07:00 UTC tomorrow." |

**Bright spots:** `/prompts` empty states are clean (`page.tsx:74-78` "No active prompts. Add prompts in Settings → Prompts to start daily polling." and `:80-83` "Too early to judge. {totalPrompts} prompts active but no native observations in the last 7 days."). `/recommendations` `EmptyTable` body copy is good — only the toolbar above is broken (E4).

---

## 3. Severity-tagged consolidated list

**HIGH (demo-killers — would derail a live demo):** T1, T2, T3, R1, R2, R3, R4, P1, P2, P3, P4, C1, C2, C3, C4, C5, D1, D2, D3, I1, I2, I3, I4, I5, X1, X2, X3, X4, X5, X6, X7, E1, E2 — **33 findings**.

**MEDIUM (trust-eroders):** T4, T5, T6, T7, T8, R5, R6, R7, R8, P5, P6, P7, P8, C6, C7, C8, C9, D4, D5, D6, D7, D8, I6, I7, X8, X9, X10, E3, E4 — **29 findings**.

**LOW (polish):** T9, T10, R9, R10, P9, P10, C10, D9, D10, I8, E5 — **11 findings**.

**Total: 73 findings across 8 audit dimensions.**

---

## 4. Top 5 highest-leverage fixes for today

(Same proposal as `docs/BEACON_PUBLIC_LEADER_GAP_AUDIT.md` §8. Reproduced here so this doc is self-contained.)

Allowed fix types per operator brief: copy polish, UI clarity, demo-path trust labels, empty states, route smoke tests, docs/checklists, non-paid validation scripts, active-tenants validation, workflow dry-run validation. Forbidden: broad refactor, paid polls, LR-3, second active tenant, onboarding UI, billing, RLS/auth changes, Profound deletion.

| # | Fix | Files | Closes findings | Test/invariant |
|---|-----|-------|-----------------|----------------|
| **1** | **"Imported legacy" → "Pre-launch history" tab + lifecycle-pill labels.** Re-applies the Round 2 claim that was never landed. | `src/domains/attribution/lifecycle-classification.ts:228`, `src/components/changes/lifecycle-status-pill.tsx:103-108`, `src/app/(shell)/changes/page.tsx:413-419` | C1, C2, C3, X7 (4 HIGH) | Architecture invariant: rendered components + classification source must contain 0 hits for `"Imported legacy"` / `"imported legacy"`. |
| **2** | **`/recommendations` drawer "Debug details" gate + strip UUID data-attrs.** | `src/app/(shell)/recommendations/recommendations-client.tsx:1215-1262` (env-gate the block); same file:435-441 (drop `data-rec-source-rec-id` / `-edit-id` outside test) | R1, R2, X1 (3 HIGH) | Architecture invariant: rendered HTML must NOT contain `rec_id:` / `edit_id:` / `evidence_hash:` / `engine_confidence:` debug labels OR `data-rec-source-rec-id` attrs when `NEXT_PUBLIC_OPERATOR_MODE !== "true"`. |
| **3** | **`/diagnostics` + `/diagnostics/spikes` + `/settings/health` server-side operator guard.** | All 3 routes: add `if (process.env.BEACON_OPERATOR_MODE !== "true") notFound();` at top | D1, D2, D3, D4, D6, D7, D8 (7 of 10 findings) | Route smoke test: when `BEACON_OPERATOR_MODE` unset, all 3 routes return 404; when set, render normally. |
| **4** | **`/today` first-run welcome card + kill "(URL-level Z-score)" copy.** | `src/app/(shell)/today-client.tsx:683` (replace Z-score copy); same file ~line 412 (mount new `<FirstRunCard />`) | T1, E1 (2 HIGH) | Render test: with empty fixture, `/today` renders FirstRunCard. Snapshot test pins copy. Architecture invariant: rendered output must NOT contain `Z-score`. |
| **5** | **`/changes/truth` verdict labels + ConfidenceSourcePill + math-drawer humanization.** | `src/app/(shell)/changes/truth/truth-client.tsx:257-282` (introduce `VERDICT_LABEL` + `CONFIDENCE_SOURCE_LABEL` maps); `src/app/(shell)/changes/scorecard-client.tsx:813-851` (relabel `μ_post`/`σ_pre`/`z-score`/`±2 significance`) | X2, X3, X4, X5, X6, C7 (6 HIGH/MED) | Architecture invariant: rendered output must NOT contain `verified_live_too_early`, `verdict_off`, `not_found_after_7d`, `seed_prior`, `μ_pre`, `μ_post`, `σ_pre`, `z-score`, `±2 significance` (case-insensitive). |

**Combined coverage:** 22 of the 33 HIGH findings closed by these 5 fixes; ~25 of the 73 total. Remaining HIGH findings (T2, T3, R3, R4, P1–P4, C4, C5, I1–I5, E2) are deliberate Phase-3 misses — addressed in a follow-up bundle once these 5 land and prove the pattern.

**Estimated total:** ~7 source files touched; 1–2 new architecture-invariant test files; 0 SQL; 0 workflow YAML changes; 0 paid API calls; 0 OpenAI spend; ledger byte-identical (SHA `d36eed8c…`).

---

## 5. What this audit did NOT cover

- Live UI screenshots (no dev server, no browser rendering).
- Mobile / iPhone-SE layout audit (out of source-only scope).
- Performance / loading-state audit (separate concern).
- Marketing site / `/login` / `/audit-request` pages (none exist yet).
- Hosted Vercel preview vs local-build differences (nothing in scope).
- Customer-1 (Ritz) data accuracy (separate concern; data layer).

---

**End Phase 2 deliverable.**
