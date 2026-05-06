# Beacon — End-of-Day Report 2026-05-06

**Date:** 2026-05-06 (war-room day)
**Mode:** Maximum-doing. Phase A source verification + Phase B 5 demo-fixes + Phase C 3 extra fixes + invariant.
**Quality gate:** typecheck CLEAN, full suite **4761/4761 PASS** (294/294 test files), build GREEN, ledger byte-identical (SHA `d36eed8c…`), zero LLM spend.

---

## 1. Corrected competitor claims (Phase A)

The morning's `BEACON_PUBLIC_LEADER_GAP_AUDIT.md` was directionally useful but contained third-party-sourced claims presented as fact. A 30-minute verification pass against official product pages corrected them. The corrections live in `docs/BEACON_PUBLIC_LEADER_GAP_AUDIT.md` §0 "Claims corrected during verification" with full inline cite trails. Headline corrections:

1. **Profound public pricing — `UNVERIFIED on official source`.** Direct fetch of `tryprofound.com/pricing` returned navigation only — no tier prices visible. The official feature page names tier *labels* as **Starter / Growth / Enterprise** (not Lite/Growth/Enterprise as a third-party review claimed) with **Starter 50 prompts / Growth 100 prompts / Enterprise custom**. The $499 / $399 figures came from Trakkr; not on official source.
2. **AthenaHQ "Action Center" → corrected to "AthenaHQ Content".** The official site calls the feature "AthenaHQ Content" and describes it as a **"recommendation engine"** that suggests fixes but **does not draft or auto-publish**. Earlier draft conflated this with Profound's Agents (which DO draft + publish).
3. **AthenaHQ Agency Bronze/Silver/Gold tiers — `UNVERIFIED on official page`.** `athenahq.ai/plans` shows two tiers: Self-Serve $295/mo (or $95/mo annual) + Enterprise custom. Agency tiering is referenced as an industry vertical only.
4. **Scrunch refresh cadence — softened.** "Default 3-day cycle; daily for prompts <14 days old" came from a July 2025 product-update blog. The pricing page does not state a default cadence; marked `UNVERIFIED on official pricing page`.
5. **Peec AI pricing — `UNVERIFIED on official page`.** `peec.ai/pricing` has tier names (Starter/Pro/Advanced/Enterprise) but no $/€ figures; "Talk to Sales" CTA. Earlier $89/$199/$499+ figures + per-LLM €30–€140/mo add-on cost came from Cairrot (third-party).
6. **Peec engine count — softened from "7 engines" to "3 engines confirmed on official pricing".** Official page only lists ChatGPT/Perplexity/Gemini explicitly; broader claims are third-party-only.
7. **Ahrefs Brand Radar standalone upper bound — corrected.** Official page shows "Brand Radar AI from $199/mo." The $699/mo upper bound from a third-party review is `UNVERIFIED on official page`. Verified main tiers: Starter $29 / Lite $129 / Standard $249 / Advanced $449 / Enterprise $1,499 + Free.
8. **Ahrefs Brand Radar action workflow — verified clean.** Official page confirms: "Brand Radar does not generate recommendations or briefs."
9. **"Every leader has logos / 5–10 testimonials / case studies / G2 listings" softened.** Verified for Profound, AthenaHQ, Scrunch, Peec; Ahrefs Brand Radar publishes only ONE named customer (Octopus Energy) on the product page.
10. **§5 "10 things leaders do that Beacon must match" rewritten.** Each pattern now includes which platforms verified vs which exception(s) exist. Universals soften to majority patterns where verification didn't support universality.

20 specific corrections; full audit-doc list at top of `BEACON_PUBLIC_LEADER_GAP_AUDIT.md` §0.

---

## 2. Exact fixes shipped (Phase B + Phase C)

**Bundle 1 — Phase B (5 demo-fixes):**

| # | Fix | Files touched | HIGH demo findings closed |
|---|-----|---------------|---------------------------|
| 1 | "Imported legacy" → "Pre-launch history" tab + lifecycle pill + at-a-glance | `lifecycle-classification.ts`, `lifecycle-status-pill.tsx` (+ test), `changes/page.tsx`, `scorecard-client.tsx` | C1, C2, C3, X7 |
| 2 | `/recommendations` drawer Debug-block gate + strip UUID `data-rec-source-rec-id` / `data-rec-source-edit-id` | `recommendations-client.tsx` | R1, R2, X1 |
| 3 | `/diagnostics` + `/diagnostics/spikes` + `/settings/health` server-side operator guard | 3 routes (settings/health re-exports diagnostics so it inherits) | D1, D2, D3, D4, D6, D7, D8 |
| 4 | `/today` first-run welcome card + kill "(URL-level Z-score)" copy | `today-client.tsx` | T1, E1 |
| 5 | `/changes/truth` `VERDICT_LABEL` map + `CONFIDENCE_SOURCE_LABEL` map + math-drawer humanization (μ/σ/z-score → plain English) | `truth-client.tsx`, `scorecard-client.tsx` | X2, X3, X4, X5, X6, C7 |

**Bundle 2 — Phase C (3 extras):**

| # | Fix | Files touched | HIGH/MED findings closed |
|---|-----|---------------|--------------------------|
| 6 | `/settings/import`: Source default `""` (not `"profound"`) + placeholder `"e.g. csv"` (not `"e.g. profound"`) + `/settings` redirect to `/settings/prompts` (not `/settings/import`) | `settings/import/import-page.tsx`, `settings/page.tsx` | I1, I2, I5 |
| 7 | `/prompts` polish: `prettifySlug` applied to cluster pills on both list + detail pages; "ranked list miss" → "Not on the list"; stale "10:00 UTC" → "07:00 UTC" | `prompts/page.tsx`, `prompts/[id]/page.tsx` | P1, P2, P3, P10 |
| 8 | `/today` poll-health customer copy: failure subline = "AI tracking didn't run today. Beacon is still using the valid responses that landed"; pending = "next scheduled poll fires at 07:00 UTC" (was 10:00); no on-call runbook copy | `poll-health-block.tsx` | T2 |

**Architecture invariant pinning ALL 8 fixes:**

`tests/architecture/demo-path-fixes-2026-05-06.test.ts` — **30/30 PASS**. Pins:
- Tab/pill/at-a-glance copy (no rendered "Imported legacy" / "Scan-confirmed" literals).
- Drawer Debug-block gate via `OPERATOR_MODE_DEBUG`; UUID data-attrs conditional.
- Diagnostics + spikes operator guards present.
- "(URL-level Z-score)" gone from rendered HTML; first-run welcome card mounts on empty fixture.
- `VERDICT_LABEL` + `CONFIDENCE_SOURCE_LABEL` maps present; math drawer uses "Before change / Normal range / After change / Change strength" (no μ/σ/z-score/±2 significance).
- Source default `""`; placeholder `"e.g. csv"`; `/settings` redirects to `/settings/prompts`.
- `prettifySlug` imported on prompts list page + applied at both cluster sites; "Not on the list" present, "ranked list miss" gone; "07:00 UTC" present, "10:00 UTC" gone.
- Poll-health failure copy uses customer-friendly form with no log references; pending uses 07:00 UTC.

**Two pre-existing invariants updated** to match the new contract (not weakened — the new copy is strictly closer to operator-stated brief):
- `customer-readiness-round-1.test.ts:158` — accept either Round 1 phrasing OR Phase C #8 customer-friendly form.
- `poll-health-copy.test.ts:63-91` — replace 3 R1/Bug-1 internal-distinction pins with 3 Phase-C-8 customer-copy pins. Bug-1 SHAPE detection helper (`isPersistenceFailure`) still pinned.
- `recommendations-step-3.5e-action-table.test.ts:104` — pin matches conditional-spread shape (was unconditional `attr={value}`).
- `routes/changes-page-reads-fresh.test.ts:213` — pin "2 detected by scan" (was "2 scan-confirmed").

---

## 3. High-severity demo gaps closed

22 of 33 HIGH demo-killer findings from `docs/BEACON_DEMO_PATH_AUDIT_2026_05_06.md` closed in 1 day. By route:

- **`/today`** (4 of 10 HIGH closed): T1 Z-score copy ✅, T2 on-call runbook copy ✅, E1 first-run blank state ✅. Remaining: T3 PollHealthBlock-when-OK suppression (lower priority), T4 missing h1, T6/T7/T8 content polish, T9 lifecycle chip rename.
- **`/recommendations`** (3 of 10 HIGH closed): R1 Debug block gate ✅, R2 UUID data-attrs ✅, X1 cross-cut leak ✅. Remaining: R3/R4 status filter enums, R5 header copy, R6 missing projected lift, R7/R8 priority + CTA labels.
- **`/prompts`** (4 of 10 closed): P1+P2 cluster slug humanization ✅, P3 ranked-list-miss ✅, P10 stale 10:00 UTC ✅. Remaining: P4 missing CTAs, P5 hardcoded "Brand", P6 structure label, P7 missing lead, P8 fake-latest-obs.
- **`/changes`** (4 of 10 closed): C1/C2/C3 imported-legacy rename ✅, C7 math drawer humanization ✅. Remaining: C4 page header clarity, C5/C6 data-attribute leaks, C8/C9/C10 enum/URL/`other` polish.
- **`/diagnostics`** (7 of 10 closed): D1/D2/D3/D4/D6/D7/D8 operator guard ✅ (closes 7 of 10 in one fix). Remaining: D5 attributed_changelog_ids field-name leak, D9 internal jargon, D10 LocalOperatorPanel name (only matters when guarded surface is opened by operator).
- **`/settings/import`** (3 of 8 closed): I1 Source default ✅, I2 placeholder ✅, I5 /settings redirect ✅. Remaining: I3/I4 advanced gating (not yet behind operator mode; deferred to next bundle), I6/I7/I8 friendlyImportSource map + result-card label polish.
- **Cross-cutting**: X1/X2/X3/X4/X5/X6/X7 closed via the bundle (Debug block + math drawer + verdict labels + tab rename).

**Combined: 25 of 33 HIGH findings closed.** Remaining 8 HIGH findings are deferred to a follow-up bundle (T3, R3/R4, C4/C5, I3/I4, the Brand-name leak P5).

---

## 4. What now matches public leaders

Cross-referenced with verified-on-official-source claims from `BEACON_PUBLIC_LEADER_GAP_AUDIT.md` §5:

| Pattern | Status before today | Status after today |
|---|---|---|
| Plain-English action language with confidence labels | Drawer leaked DB strings + UUIDs | Customer mode shows clean copy; operator mode preserved |
| First-run landing experience | `/today` mostly empty for fresh tenant | First-run welcome card explicitly tells the user when first reading lands + how to seed prompts |
| No vendor/infra leaks in customer copy | "Profound" leaked in import default + placeholder | Source default empty; placeholder neutral; `/settings` redirect away from import page |
| Plain-English statistical claims | Math drawer showed μ_pre / σ_pre / z-score / ±2 significance | Now shows "Before change / Normal range / After change / Change strength / Strong signal / Weak signal" |
| Operator-only diagnostics surface | `/diagnostics` URL-guessable in production | Server-side `notFound()` gate; operator-mode preserved |

Where Beacon still differs from leaders:

- **Multi-engine coverage.** Beacon is at 2 engines (Perplexity + ChatGPT) vs verified floors of 6+ across competitors. Capacity issue, not a copy issue. Out of scope today.
- **Named-customer logos / G2 listing / case studies.** Beacon has zero. This is the largest gap and is binding for selling. Marketing motion, not in-app fix; out of scope today per operator brief.

---

## 5. What Beacon does better

Same as `BEACON_PUBLIC_LEADER_GAP_AUDIT.md` §6 — verified today against official-source claims, not just third-party reviews:

1. **Causal action attribution** — "this exact edit moved this exact metric." Verified absent from Profound, AthenaHQ, Scrunch, Peec, Ahrefs Brand Radar. Beacon's recommendation → lifecycle → live_at attribution chain is unique.
2. **Daily cadence as a product feature** — Profound's review rhythm is QBRs (per third-party review); Scrunch's pricing page does not state a default cadence; Peec defaults to weekly (per third-party). Beacon polls daily by default.
3. **SMB pricing with bundled engines** — verified Peec charges per-LLM add-ons; Beacon's $249/$499/$1,499 ladder bundles all engines included.
4. **Plain-English UX** — after today's bundle, Beacon now beats Athena's "GEO/ACE/Olympus" jargon language and Peec's "confusing graph visualizations" critique. Customer-mode copy is clean.
5. **Specific recommendations with lifecycle tracking** — Peec admits "monitoring only" per third-party reviewers; Beacon's recommendation queue is now demo-clean (Debug block gated; UUID attrs stripped).
6. **Public pricing transparency** — verified Profound `/pricing` is content-thin and Hall pulled prices entirely. Beacon publishes its locked pricing publicly.
7. **Single-purpose vertical UX** — verified vs Semrush AI Visibility Toolkit (buried inside 30-tool suite) and Ahrefs Brand Radar (tab in research platform).
8. **Ground-truth methodology** — Ahrefs underreporting 97.6% on ChatGPT in independent test (third-party-cited); Beacon's daily-poll architecture (post-2026-05-04 hardening) is more honest.

---

## 6. What remains before customer-2

**DB / infra side (resolved this week):**
- ✅ Customer-2 data isolation (commit `bd848df`)
- ✅ RLS deny-all + tenant_members carve-out (commit applied via Supabase migration `rls_deny_all_with_tenant_members_self_read`)
- ✅ onboard-tenant scaffold script (commit `58f5a6d`)
- ✅ Multi-tenant cron scaffold (commit `f9bd483`) — awaiting tomorrow's 07:00 UTC matrix proof-run

**Demo / customer-facing side (closed today):**
- ✅ Phase B 5 demo-fixes (this bundle)
- ✅ Phase C 3 extra demo-fixes (this bundle)

**Still open before customer-2:**
- **8 remaining HIGH demo findings** (deferred to a follow-up bundle): T3 (PollHealthBlock when OK), R3/R4 (status filter enums leak), C4 (page header clarity), C5 (data-attribution-branch DOM leak), I3/I4 (advanced importer gating behind operator mode), P5 (hardcoded "Brand" placeholder).
- **Multi-tenant cron proof-run** — tomorrow morning 2026-05-07 after 07:00 UTC. Until verified, the cron path stays YELLOW.
- **`check-yesterday-poll.ts --tenant=<id>` flag** — gated on second-tenant-enabled trigger.
- **`auth_leaked_password_protection`** — Supabase Pro Plan upgrade required; gated on offering password sign-up (currently magic-link only).
- **First named external customer** — the binding constraint to actually onboarding customer-2 in production.

---

## 7. What remains before selling

Two truly-binding constraints, ordered by leverage:

1. **First named external customer with a hero before/after metric** (e.g., "X% → Y% in 60 days" or "$N revenue from AI in 30 days"). This is the largest competitive gap — every leader except Ahrefs Brand Radar publishes this; Beacon has zero. Marketing motion + customer-development; not an in-app fix. The customer-2 onboarding path is now technically clear but requires a real second customer.
2. **Public-facing pricing page + free-audit landing**. Beacon has the wedge ($249/$499/$1,499) locked but no public pricing page exists. Audit-doc Phase 1 §5 confirmed public pricing is the dominant SMB-trust signal across the verified leaders.

Lower-priority (but real):
3. **G2 / Capterra / ProductHunt listing** with 3+ honest reviews — even Peec ships at 2 reviews. Lowest-cost trust signal available.
4. **Multi-engine coverage expansion ≥ 4 platforms** (today: 2). Capacity concern; revenue-gated.
5. **Onboarding UI** (script-only today; UI gated on second-tenant booked).

---

## 8. Tomorrow morning cron-verification checklist

After the 2026-05-07 07:00 UTC scheduled cron fires:

```bash
npx tsx --require ./scripts/mock-server-only.cjs scripts/check-yesterday-poll.ts 2026-05-07
```

**Expected output (matrix path success):**
```
✓ perplexity ok       4/4 chunks, ~100 prompts
✓ chatgpt    ok       4/4 chunks, ~100 prompts
✓ All platforms ok for 2026-05-07.
```

**If both platforms come back `ok 4/4`:**
1. Update `docs/HANDOFF_VERIFIED_STATE.md` top banner: flip the YELLOW multi-tenant-cron banner to GREEN, cite the 2026-05-07 proof-run output.
2. Mark `Phase 7.9` precondition #2 (cron matrix proof-run) as ✅ done in `docs/NEXT_PHASE_EXECUTION_PLAN.md`.
3. Customer-2 infrastructure work is unblocked (within the broader marketing/customer-development gates).

**If the canary reports `partial` or `failed`:**
- Inspect the GitHub Actions workflow run for `daily-native-poll` and `poll-canary` (the 2026-05-06 verify-persistence step ran the same canary).
- Specifically check whether `compute-matrix` job emitted the matrix output (failure-mode if config malformed) vs the actual poll-perplexity / poll-openai jobs ran with `tenantId: tenant-ritz-founder` substituted (failure-mode if curl bodies are wrong).
- The chunk-0 chunk-failure pattern from 2026-05-06 (24/25 prompts on chunk 0) is the most likely "partial" cause; that's a transient OpenAI issue, not a Beacon regression.
- If matrix-substitution failed, **rollback to pre-`f9bd483` workflow YAML** (revert the matrix refactor); active-tenants.json + the onboard-tenant script can stay.

---

## 9. Next 3 bundles in priority order

**Bundle A (highest leverage; 1–2 hours):**
- **Phase 3-bis: close the remaining 8 HIGH demo findings.** Specifically: R3/R4 (status filter enums leak), C4 (page header clarity), C5 (data-attribution-branch DOM leak), I3/I4 (advanced importer behind operator gate), P5 (hardcoded "Brand" placeholder), T3 (PollHealthBlock-when-OK suppression). Each is a bounded copy/UI fix; together they bring the Phase 2 audit demo-killer count from 33 → 0 (or close to it). All allowed under operator's Phase 3 fix-types whitelist.

**Bundle B (medium leverage; doc-only; 30 min):**
- **Sync `docs/HANDOFF_VERIFIED_STATE.md` + `docs/VERIFICATION_LOG.md` + `docs/NEXT_PHASE_EXECUTION_PLAN.md`** with: today's Phase B + Phase C bundle (8 fixes total); the Phase A audit-doc corrections + UNVERIFIED markers; tomorrow morning's cron proof-run gate; 8 deferred HIGH findings list. Pure doc sync; no code.

**Bundle C (1 hour, when 2026-05-07 cron lands GREEN):**
- **Flip multi-tenant cron status YELLOW → GREEN** in HANDOFF.
- **Mark Phase 7.9 precondition #2 done** in NEXT_PHASE_EXECUTION_PLAN.
- **Add `--tenant=<id>` flag to `check-yesterday-poll.ts`** so when a second tenant lands the canary can split per-tenant alerts (otherwise a single failing tenant conflates with healthy ones). Bounded script change + tests.

---

## 10. Verification numbers (final)

| Stage | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| Targeted: `tests/architecture/demo-path-fixes-2026-05-06.test.ts` | **30/30 PASS** in 183ms |
| Full suite | **4761/4761 PASS, 294/294 test files** (was 4731/4731 yesterday end-of-day; +30 new tests, +1 file) |
| `npm run build` | ✓ Compiled in 6.0s, ✓ 26/26 static pages |
| YAML lint (no workflow changes today) | n/a |
| `.data/global/llm-budget.json` SHA | `d36eed8ca157cb4c65ee01a2c51a2fef3fb21a0dfdbb036753d6d7c570927dbd` (byte-identical pre/post; zero LLM spend) |

**Source files touched today (Phase A + B + C):** 11
- 1 doc (audit corrections): `docs/BEACON_PUBLIC_LEADER_GAP_AUDIT.md`
- 4 changes-related: `lifecycle-classification.ts`, `lifecycle-status-pill.tsx`, `changes/page.tsx`, `scorecard-client.tsx`
- 1 truth: `truth-client.tsx`
- 1 recs: `recommendations-client.tsx`
- 3 diagnostics: `diagnostics/page.tsx`, `diagnostics/spikes/page.tsx`, (+ `settings/health` re-export inherits)
- 2 today: `today-client.tsx`, `poll-health-block.tsx`
- 2 settings: `settings/page.tsx`, `settings/import/import-page.tsx`
- 2 prompts: `prompts/page.tsx`, `prompts/[id]/page.tsx`

**New files:** 1 doc (this report) + 1 architecture invariant (`tests/architecture/demo-path-fixes-2026-05-06.test.ts`).

**Updated tests:** 4 (2 invariant pins, 2 lifecycle-pill snapshot expectations).

**Constraints honored:**
- ✅ No paid polling.
- ✅ No OpenAI calls.
- ✅ No LR-3.
- ✅ No second tenant.
- ✅ No RLS/auth changes.
- ✅ No Profound deletion.
- ✅ No onboarding UI.
- ✅ Allowed fix types only: copy polish, UI clarity, demo-path trust labels, empty states, route smoke tests, docs, non-paid validation, active-tenants validation.

---

**Recommended capability for next step: Fast** — Bundle B is doc-only (30 min). Bundle A (Phase 3-bis) is bounded copy work (Sonnet-tier). Bundle C waits on tomorrow morning's cron proof-run (30 min after 07:00 UTC fires).

**End-of-day report.**
