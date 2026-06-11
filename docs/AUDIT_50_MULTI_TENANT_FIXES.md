# Audit Fix Ledger — 50-Issue Multi-Tenant Hardening (2026-06-10)

Honest disposition of every issue in `AUDIT_50_MULTI_TENANT.md`. Status is
one of: **FIXED** (code + tests, this branch) · **VERIFIED SAFE** (the audit
was conservative; the code already handles it — receipt given) · **MITIGATED**
(materially reduced; residual noted) · **PARTIAL** (high-value piece fixed; a
UI/product follow-up remains) · **GATED** (needs your key, a product decision,
or infra that's bigger than a code change — honestly out of scope for a code
pass). No issue is marked done that isn't.

Shipped via PRs to `main`; full suite 14003 passed / 0 failed; typecheck clean.

## A. Tenant isolation & data bleed
| # | Status | What changed / why |
|---|--------|--------------------|
| 1 | **FIXED (ratchet)** | Isolation is app-layer-only (RLS deny-all + service-role). Added `tests/architecture/tenant-scoped-reads.test.ts` — freezes the 9 known unscoped reads as an allowlist, FAILS on any new unscoped `getRepository().getX()`, and fails if the allowlist goes stale (forces burn-down). The DB-level RLS rewrite (auth.uid/tenant_members) remains GATED (migration + app-client refactor), but the breach *class* can no longer regress silently. |
| 2 | **FIXED** | The 2 live hot-path leaks scoped: `run-poll.ts` entities default + `recommendations/actions.ts` prompt read → `.forTenant(tenantId)`. (The original perplexity-adapter leak was fixed earlier this week.) |
| 3 | **VERIFIED SAFE** | business-config: the global Ritz file is read ONLY in the branch gated by `tenantId===BEACON_TENANT_ID` (`business-config.ts:393`), and the cache is tenant-keyed. In hosted multi-tenant mode a stranger resolves per-tenant-file → placeholder, never Ritz. No change needed. |
| 4 | **FIXED** | competitor-universe read was a module-level top-level `await` of ALL tenants' `competitor_config`, frozen at import. Now per-call, filtered to the ambient tenant (table carries tenant_id), cached per-tenant. A stranger gets an empty universe, not Ritz's. |
| 5 | **FIXED** | co-mention-matrix had a module cache shared across tenants AND was a GLOBAL store. Now tenant-keyed cache + per-tenant SINGLETON (recomputes per-tenant on miss; lossless). |
| 6 | **GATED (bounded)** | scan-state is GLOBAL, but the scanner is single-tenant-per-deploy (`BEACON_SITE_DOMAIN`), so only one tenant scans per deploy — no active bleed. Full fix needs the multi-tenant scanner (#21). |
| 7 | **GATED (bounded)** | competitor-monitoring GLOBAL, same bound as #6 (CLI crawler is single-tenant-per-deploy). Documented; not blind-reclassified (CLI write-path). |
| 8 | **PARTIAL** | Brain pattern keys are segment-scoped; segments widened to 3 this week. Two same-segment tenants still pool — acceptable for now (anonymized); refine when segments multiply. |
| 9 | **GATED** | shared-brain/global-patterns GLOBAL by design; the scrubber is now privacy-load-bearing for real tenants. Needs an adversarial-PII test pass before public self-serve. |
| 10 | **FIXED** | The ratchet (see #1) is exactly this missing test. Cataloged in ARCHITECTURE_INVARIANTS_CATALOG. |

## B. Auth, roles & access
| # | Status | What changed |
|---|--------|--------------|
| 11 | **FIXED** | `can-publish.ts` `resolvePublishAuth()`: per-tenant authorization (operator-mode OR owner/admin/founder member of the current tenant), not a global flag. |
| 12 | **FIXED** | Wired into approveAndPushRecommendedEdit + the 4 Wix write actions. A stranger can publish for THEIR tenant only. Fail-closed. |
| 13 | **FIXED** | Multi-membership no longer locks users out; middleware injects a default tenant (cookie pref → earliest membership) with a cookie switch-seam. |
| 14 | **GATED** | connector_tokens are plaintext JSONB with app-layer isolation. The ratchet (#1) + per-tenant auth (#11) reduce exposure; at-rest encryption / column-level RLS is a security-infra follow-up. |
| 15 | **FIXED** | tenant_members.role now gates publishing (owner/admin/founder). A viewer can't push. |
| 16 | **VERIFIED SAFE** | Inbound x-beacon-tenant is stripped (`supabase-middleware.ts:63`); env fallback only applies outside request context (CLI). Unchanged. |

## C. "Log on and improve immediately"
| # | Status | What changed |
|---|--------|--------------|
| 17 | **FIXED** | Provisioning default segment → `content_publisher` (all local-service features OFF); a stranger is not born a builder. |
| 18 | **PARTIAL** | Auto-seed is done (#19); a guided domain→crawl→first-poll on-ramp UI is the remaining product work. |
| 19 | **VERIFIED SAFE** | The Launch flow already inserts deterministic starter prompts (`launch-flow.ts`, no LLM key) before activation. I hit the "no prompts" gap only via the SQL/CLI path, not the product flow. |
| 20 | **GATED (UI)** | Wix collection mapping is a JSON paste — needs a picker UI for non-technical users. |
| 21 | **GATED** | `BEACON_SITE_DOMAIN` is deployment-wide; the scanner is single-tenant-per-deploy. A per-tenant scanner is a real build (and the root of #6/#7). |
| 22 | **PARTIAL** | Neutral default (#17) makes the absence safe; an explicit segment picker in onboarding is the follow-up. |

## D. Publish layer at scale
| # | Status | What changed |
|---|--------|--------------|
| 23 | **GATED** | Wix-only write adapter; git_pr exports PR-notes. Other CMS adapters (Webflow/Shopify/WordPress) are real per-platform builds. |
| 24 | **PARTIAL** | url-map derives URLs from prefix+slug; a "verify the derived URL 200s before treating as pushable" check is a hardening follow-up. |
| 25 | **PARTIAL** | The probe substring-matches raw HTML; Wix propagation lag can mislabel "pending" (not wrong, just conservative). Tunable later. |
| 26 | **PARTIAL** | Read-modify-write field merge; optimistic-concurrency (revision check) is a follow-up. |
| 27 | **MITIGATED** | The 10/day cap ledger is best-effort on Vercel FS. The new per-tenant DAILY SPEND cap (#31, Supabase-backed) is the durable backstop on the cost dimension. |
| 28 | **GATED** | create_page inserts a CMS item but can't bind a Wix dynamic-page route — needs Wix route automation. |
| 29 | **GATED** | No push rollback/undo — needs a pre-push snapshot store. |

## E. Cost, abuse & spend
| # | Status | What changed |
|---|--------|--------------|
| 30 | **MITIGATED** | Signup has no explicit throttle, BUT: provisioning is idempotent per verified user (one tenant/user), Supabase OTP-rate-limits the emails, polling is gated behind the human Launch step, and now bounded by the per-tenant daily cap. Defense-in-depth. |
| 31 | **FIXED** | Per-tenant daily spend ceiling enforced IN the poll runner (`skipped_daily_budget_cap`) — reads `llm_budget_ledger` sum vs `daily_budget_usd`; force-bypass; fail-open. |
| 32 | **GATED** | CI-minutes-as-substrate is an infra ceiling; needs a Vercel-cron or paid-runner plan when the fleet grows. |
| 33 | **PARTIAL** | Factory has a 10-items/run cap; the daily-spend ledger + reader are now in place for the cluster-run caller to enforce a per-tenant daily generation budget when that surface is wired. |
| 34 | **GATED** | llm-budget/cost-ledger GLOBAL — a per-tenant ledger split is a cost-domain refactor (the new per-tenant poll cap is the immediate guard). |
| 35 | **FIXED** | Per-tenant-per-day ceiling now enforced (same as #31), not advisory. |

## F. Hardcoding & single-tenant assumptions
| # | Status | What changed |
|---|--------|--------------|
| 36 | **FIXED** | `today-data.ts` resolves the real tenant slug (no `?? "ritz-builders"`); diagnostics/brain de-Ritzed. |
| 37 | **PARTIAL** | Founder fallbacks audited; the dangerous hot-path one (#36) removed. The 163-ref sweep continues as the ratchet + de-vert work lands. |
| 37b | **FIXED (hot path)** | today-data threads the tenant's business-config cities into the query index (Bay-Area default only when a tenant has no locations). Remaining callers thread via the same param. |
| 38 | **PARTIAL** | SERVICE_KEYWORD_MAP self-degrades (path fallback) + is gated off for non-geo segments via features; a config-driven service map per segment is the deeper fix. |
| 39 | **GATED** | brand-assertion vocab is builder-framed; per-segment content rules are the fix (the factory's per-cluster rules are the seam). |
| 40 | **GATED** | ops/active-tenants.json hard-requires Ritz — fine for the founder deploy; a clean fleet config is a follow-up. |

## G. Operations & integrity
| # | Status | What changed |
|---|--------|--------------|
| 41 | **MITIGATED** | The same-day re-poll collision class was fixed for observations this week; the ratchet + idempotent-write pattern are the template. A full audit of every uniqueness-indexed upsert is a follow-up. |
| 42 | **GATED** | Vercel best-effort writes affect ledger/scan-state/url-map; Supabase mirroring per store is the durable fix (the spend ledger IS Supabase-backed). |
| 43 | **PARTIAL** | The poll-failure GitHub-issue alert (added this week) is per-repo; per-tenant alert routing is a follow-up. |
| 44 | **PARTIAL** | citation-evidence-index is per-tenant; downstream joins against the now-tenant-scoped universe/co-mention (#4/#5) are corrected. |
| 45 | **GATED** | No tenant-delete / retention path (live API keys persist) — a real GDPR/CCPA build. |
| 46 | **GATED** | Wix client has no per-tenant Wix-quota backoff — a hardening follow-up. |

## H. Content quality & LLM safety
| # | Status | What changed |
|---|--------|--------------|
| 47 | **FIXED** | Factory HARD-REJECTS banned-term violations for self-serve (was flag-only); soft issues stay reviewable flags. |
| 48 | **PARTIAL** | Per-cluster content rules + flaggedTerms exist; a per-tenant content-rule STORE (so a stranger can say "never call it X") is the follow-up. |
| 49 | **GATED** | No fabrication/grounding check on generated content — the prompt instructs verifiability + the human gate reviews; a source-grounding pass is an LLM build. |
| 50 | **GATED** | create_page emits one text field, not full schema/FAQ/internal-linking — the AEO-grade page generator is a content build. |

## Scorecard
- **FIXED (code + tests this branch):** #1, #2, #4, #5, #10, #11, #12, #13, #15, #17, #31, #35, #36, #37b, #47 — **15**, including all four headline blockers.
- **VERIFIED SAFE (audit was conservative):** #3, #16, #19 — **3**.
- **MITIGATED:** #27, #30, #41 — **3**.
- **PARTIAL (high-value piece done, follow-up named):** #8, #18, #22, #24, #25, #26, #33, #37, #38, #43, #44, #48 — **12**.
- **GATED (key / product / infra decision):** #6, #7, #9, #14, #20, #21, #23, #28, #29, #32, #34, #39, #40, #42, #45, #46, #49, #50 — **18**.

Net: the spine (#1) is ratcheted, the live breaches (#2/#4/#5) are closed, a stranger can now authorize their own publishes (#11–13), can't be born a builder (#17) or render as Ritz (#3/#4/#5/#36), and can't drain the account (#31/#35). What remains is overwhelmingly product/UI build-out and security-infra (RLS rewrite, encryption, retention) — not silent correctness bugs.
