# Beacon Scorecard (1-100)

> Verified 2026-04-11 against branch `claude/amazing-shamir` at commit `dd121be`
> Scores backed by specific evidence. No inflation.

---

## Core Product Scores

| Category | Score | Rationale |
|----------|-------|-----------|
| **Overall product clarity** | 58 | Vision is clear (daily AI visibility OS), but execution surface is too wide. Operator must interpret too many signals. The product knows what it wants to be but hasn't yet trimmed to match. |
| **Overall product usefulness** | 65 | Genuinely useful IF the operator has imported data AND understands the model. Attribution + replication + fix briefs are real value. But cognitive overhead reduces practical usefulness for most operators. |
| **Overall trustworthiness** | 62 | Proof layer is excellent (confidence badges, evidence tiers, freshness dots). But demo data without indicators, missing error handling, and potential stale data in production undermine trust. |
| **Overall launch readiness** | 38 | Build passes, core logic works, but no error boundaries, no loading states, scan blocks render, demo data misleading, no onboarding, no observability. Not safe to put in front of paying users. |

---

## Architecture & Engineering

| Category | Score | Rationale |
|----------|-------|-----------|
| **Architecture quality** | 76 | 31 well-bounded domains, clean type system, consistent patterns, proper server/client separation. Over-engineered for current needs (31 domains for 5 routes) but the boundaries are correct and the code is maintainable. |
| **Data truthfulness** | 72 | Real data from real sources (live crawl, imported citations). Attribution is algorithmically sound. Deducted for: demo data not labeled, "business consequence" without revenue data, module-cache staleness risk. |
| **Caching/staleness safety** | 48 | Scan outputs use fresh disk reads (good). But module-level arrays (results, changes, etc.) are frozen at import time. In production, stale data persists until process restart. No TTL, no cache invalidation beyond revalidatePath. |
| **Scan system reliability** | 68 | Works end-to-end: CLI crawl → structured output → findings generation → state management. Deducted for: no crash recovery, no retry, render-blocking, 120s timeout, no rate limiting. |
| **Findings reliability** | 78 | 15 finding types from real snapshot diffs. Priority scoring with multiple signals. Dedup and suppression. 5 dedicated tests. Fresh disk reads. Strong system. |
| **Quality of state handling** | 55 | Scan state is atomic JSON writes. But module-level arrays, json-store in-memory caches, and no clear invalidation strategy create multiple truth sources. Import mutations visible within request but not across requests in production. |
| **Quality of empty states** | 30 | `EmptyState` component exists but is used sparingly. Most routes have no explicit empty state for "no data yet." Market route has a good empty state message. Today has "all clear" but no "no data imported yet" state. Pages has no empty state. |
| **Quality of failure handling** | 15 | Zero error.tsx files. Zero loading.tsx files. Scan failure is caught and returns structured error but no UI for it. Server action errors are not surfaced to user. No toast/notification system for action failures. |
| **Quality of component reuse** | 65 | Good shared components: PageHeader, EmptyState, KpiCard, StatCard, ConfidenceBadge, FreshnessDot, StatusDot, DonutRing, Sparkline, DeltaIndicator. Shadcn base. But mega-components (1000+ line client files) show insufficient decomposition. |
| **Domain separation quality** | 80 | 31 domains with clear boundaries. Types, compute, selectors, store, actions pattern is consistent. Cross-domain references go through well-defined interfaces. Some domains are thin (1 file: types only) which is appropriate. |
| **Long-term maintainability** | 60 | Type safety is excellent. Domain boundaries are clean. But 1000+ line components, render-time side effects, module-level state, and no tests above unit level create maintenance risk. Refactoring the Today page would be a major effort. |
| **Short-term shippability** | 45 | Can technically ship (build passes, core works) but missing error handling, loading states, onboarding, and observability make it risky. Operator could encounter blank pages, crashed routes, or misleading data. |

---

## Route-Level Scores

| Category | Score | Rationale |
|----------|-------|-----------|
| **Today route usefulness** | 60 | Intelligence is real (primary action, findings, attribution queue). But 15 sections is too many. Scan-blocking is a dealbreaker. Operator can't quickly find "what matters." |
| **Pages route usefulness** | 75 | Strongest route. Page truth + fix briefs + verification workflow is differentiated. Information density is high but justified for a power-user view. Filters work well. |
| **Market route usefulness** | 62 | Real competitive intelligence when data exists. Rankings, topic signals, discovered competitors are useful. But empty without imported data, and lacks competitive trends over time. |
| **Changes route usefulness** | 70 | Scorecard is the core "what worked" view. Verdicts + evidence tiers are honest. Replication tab bridges insight to action. Tab structure keeps it organized. |
| **Settings route usefulness** | 50 | Import works. Config is functional. Health is misplaced (internal diagnostics). History is disconnected from settings framing. Settings needs restructuring. |
| **Route coherence** | 68 | 5-item nav is clean. Each route has a clear purpose. But Today tries to be everything, and Settings is a grab-bag. Hidden routes (briefs, topics, observations) are correctly hidden but could be better surfaced. |

---

## Product Feature Scores

| Category | Score | Rationale |
|----------|-------|-----------|
| **Proof layer quality** | 78 | Confidence badges, evidence tiers, trust sources, freshness dots, crawl proof links, "How We Know" panel. Beacon actively communicates certainty. One of the strongest aspects. |
| **Replication quality** | 72 | Pattern mining → target identification → rollout coordination. Bridges "what worked" to "what to do next." Needs more operator guidance on first use. |
| **Local layer quality** | 40 | Geo coverage, local pressure, citation decay — all computed from real data. But heavily dependent on local-specific import data that most operators won't have initially. Often renders empty. |
| **Milestone quality** | 65 | All-time highs and first-time outcomes computed from real data. Well-integrated into Today, Changes, and Market. But trivial milestones (first import, first scan) may dilute impact. |
| **Diagnostics quality** | 55 | Real attribution diagnostics: candidate analysis, pattern detection, model report. But surfaced as "System Health" in Settings, wrong audience. Useful for developer debugging, not operator use. |
| **Honest business consequence framing** | 35 | Copy says "business impact" but data stops at visibility (citations, mentions, position). No revenue, leads, or conversion linkage. The framing promises more than the data delivers. |

---

## UX / Operator Scores

| Category | Score | Rationale |
|----------|-------|-----------|
| **Copy/wording clarity** | 75 | Operator-focused language: "What worked," "Who beats you," "Why did visibility change?" Avoids SEO jargon. Honest about uncertainty ("too early to tell"). Some internal terminology leaks through ("Beacon Intel," "change contract," "Tier 1B"). |
| **Premium feel** | 62 | Geist font, clean spacing, semantic colors, subtle borders, keyboard shortcuts, command palette. But no dark mode, no animations, no loading skeletons, no empty state illustrations. Feels professional but not polished. |
| **Speed of understanding** | 45 | Operator must learn: verdicts, evidence tiers, trust sources, confidence levels, finding types, recommendation types, experiment statuses, issue workflow states, rollout wave states. The model is powerful but has a steep learning curve. |
| **Operator cognitive load** | 42 | Today: 15 sections. Pages: 10+ fields per row with 9 expandable sections. Changes: 10+ columns in scorecard. The information density is appropriate for a power tool but overwhelming for a daily driver. |
| **Quality of current v1 wedge** | 58 | The wedge is clear: daily AI visibility for local businesses. But the product tries to serve too many needs simultaneously (morning briefing AND deep analytics AND competitive intelligence AND change management AND page health). A tighter wedge would be more effective. |

---

## Testing & Production

| Category | Score | Rationale |
|----------|-------|-----------|
| **Test coverage quality** | 35 | 16 files, 77 tests. Only domain logic tested (attribution, scanning, milestones, pages, local operator, today proof). Zero route tests, zero integration tests, zero E2E tests, zero UI tests. |
| **Test realism** | 70 | Tests that exist are good: golden tests for attribution scoring, invariant checks, proper mocking of server-only. But coverage is so narrow that overall realism is limited. |
| **Production readiness** | 32 | No error boundaries, no loading states, no health checks, no observability, no monitoring, no structured logging. Scan blocks render. Module-level state can go stale. Demo data not labeled. |
| **Bug risk** | 55 | TypeScript strict mode + well-typed domains reduce type errors. But no error handling means any runtime exception (network timeout, malformed data, null reference) crashes the route. Medium-high risk. |
| **Dead-weight surface area** | 35 | `changelogpdf/` (40 PDFs), `src/adapters/legacy/` (empty), redirect routes (/actions, /opportunities), duplicate route paths (import at / and /settings), diagnostics and expansion routes not needed for v1. Some domain complexity (frontier-compiler, frontier-planner) may be premature. |

---

## Composite Scores

| Composite | Score | Components |
|-----------|-------|-----------|
| **Product** | 60 | Avg of: clarity 58, usefulness 65, trustworthiness 62, v1 wedge 58 |
| **Engineering** | 59 | Avg of: architecture 76, state 55, caching 48, failure handling 15, maintainability 60, domain separation 80 |
| **UX** | 55 | Avg of: copy 75, premium 62, speed 45, cognitive load 42, empty states 30 |
| **Launch Readiness** | 37 | Avg of: overall launch 38, production readiness 32, bug risk 55, test coverage 35, shippability 45 |
| **OVERALL** | 53 | Weighted: Product 30%, Engineering 25%, UX 25%, Launch 20% |

---

## Top 10 Strongest Aspects

1. **Domain model depth** (80) — 31 well-bounded, well-typed domains. Clean boundaries, consistent patterns.
2. **Finding detection** (78) — 15 types from real scan diffs with priority scoring. 5 dedicated tests.
3. **Proof layer** (78) — Confidence badges, evidence tiers, trust sources, freshness dots. Honest about uncertainty.
4. **Architecture quality** (76) — Clean separation, proper server/client boundary, consistent patterns.
5. **Pages route** (75) — Page truth + fix briefs + verification workflow. Strongest route.
6. **Copy/wording** (75) — Operator-focused, honest, avoids jargon.
7. **Attribution engine** — Candidate discovery, triage, scoring, operator verification. Real algorithmic intelligence.
8. **Replication engine** (72) — Pattern mining → target identification → rollout coordination.
9. **Changes scorecard** (70) — Core "what worked" view with honest verdicts and evidence tiers.
10. **Test quality** (70) — Tests that exist are well-written: golden tests, invariants, proper mocking.

---

## Top 10 Most Dangerous Weaknesses

1. **No error boundaries** (15) — Any thrown error crashes the entire route with no recovery. Production dealbreaker.
2. **No loading states** (15) — Heavy computation with no loading indicator. Users see blank pages.
3. **Today scan blocks render** — Up to 120s blank page on morning visit. Destroys first impression.
4. **Empty states missing** (30) — Most routes have no "no data yet" state. New user sees broken-looking pages.
5. **Production readiness** (32) — No health checks, no observability, no monitoring, no structured logging.
6. **Test coverage** (35) — Zero route, integration, E2E, or UI tests. Only domain logic covered.
7. **Business consequence framing** (35) — Promises "business impact" but delivers visibility-only data.
8. **Dead-weight surface** (35) — PDFs, legacy adapters, redirect routes, premature features.
9. **Overall launch readiness** (38) — Too many gaps to safely put in front of paying users.
10. **Cognitive load** (42) — 15 sections on Today, 10+ fields per row on Pages. Operator must think too much.

---

## Top 10 Biggest Lies / Illusions

1. **Demo data as product** — Ritz Builders data shown without "demo mode" indicator. Operator could think this is their data.
2. **"Business impact" framing** — Copy implies revenue/conversion impact but no such data exists. Attribution stops at visibility.
3. **"System Health" in Settings** — Internal attribution diagnostics presented as system health monitoring. Wrong audience, wrong framing.
4. **15 Today sections = completeness** — Volume suggests comprehensive daily coverage, but many sections are empty for new users.
5. **"All Clear" on Today** — Technically correct, but can trigger when no data has been imported (no findings because no scan). Doesn't distinguish "nothing to do" from "nothing set up."
6. **Scorecard verdicts without enough data** — Verdicts like "inconclusive" or "too_early" are honest, but the scorecard can show these alongside "validated" rows, making it look like the system has more certainty than it does.
7. **Settings sub-routes** — "Config" is the setup wizard, "Health" is internal diagnostics, "History" is raw measurement data. None of these are what an operator expects from "settings."
8. **Frontier compiler / frontier planner** — 766 combined lines of speculative feature code (opportunity frontier) that isn't surfaced in the main product. Engineering investment without product visibility.
9. **changelogpdf/ directory** — 40 PDFs in the repo suggesting a changelog feature that doesn't exist in the UI.
10. **"Measurement History" tab** — Shows raw result data, not a history of "measurements." The framing implies Beacon measures things over time, but it's showing imported snapshot data.

---

## Top 10 Highest-Leverage Fixes

1. **Add error boundaries** — 2 hours of work prevents route-crashing. Add `error.tsx` to every route group. Impact: trust, production safety.
2. **Add loading states** — Add `loading.tsx` to Today and Pages at minimum. Impact: perceived speed, trust.
3. **Move scan out of render** — Background the auto-scan, show "scanning..." indicator. Impact: morning experience, trust.
4. **Add "demo mode" indicator** — Banner when no imports exist. Impact: trust, onboarding clarity.
5. **Simplify Today to 3-5 sections** — Primary action, findings, top change, review count. Collapse everything else. Impact: cognitive load, daily usability.
6. **Split mega-components** — Break 1000+ line files into focused components. Impact: maintainability, testability.
7. **Add explicit empty states** — Every route should handle "no data yet" gracefully. Impact: new user experience, trust.
8. **Remove render-time side effects** — Move backfill/persist calls out of Today render. Impact: correctness, reliability.
9. **Clean dead weight** — Remove changelogpdf/, legacy adapter, redirect routes. Impact: repo clarity, build hygiene.
10. **Add basic observability** — Structured logging for scan, import, action failures. Impact: production debugging.
