# Beacon — 50-Issue Multi-Tenant Readiness Audit (2026-06-10)

**Bar being audited:** *"A stranger signs up and improves their app/website immediately. Nothing hardcoded. True multi-tenant."*

**Verdict up front:** Beacon is a strong **single-operator** system that we have *begun* widening to multi-tenant (segments, per-tenant features, the poll-isolation fix). It is **not yet safe for a self-serve stranger.** The architecture's core isolation guarantee is **app-layer only** (RLS is deny-all + service-role), so every cross-tenant bug is a silent data breach — and I shipped+caught one this very week. Below are 50 concrete issues, each with a file receipt, ordered by blast radius. Severity: **🔴 blocker** (data breach / money / "can't use it") · **🟠 serious** · **🟡 sharp edge**.

Receipts are `path:line` where pinned. "Stranger" = a brand-new self-serve customer who is not Ritz.

---

## A. TENANT ISOLATION & DATA BLEED — the deadliest class

1. 🔴 **All isolation is app-layer; the database has no safety net.** Every tenant table is RLS `deny_authenticated` and the app reads/writes via the **service-role key** (`src/lib/persistence/supabase.ts:28`), which bypasses RLS entirely. So tenant isolation rests *solely* on every query remembering `.forTenant(tenantId)`. One omission = full cross-tenant read/write. There is no defense in depth.

2. 🔴 **Proof this class is live, not theoretical:** the poll adapter read the **unscoped** base repo (`getRepository().getTrackedPrompts()`), and Iranopedia's first poll consumed Ritz's 100 prompts and stamped them `tenant-iranopedia` (fixed in `src/adapters/perplexity/poll.ts` this week, but it sat latent the entire single-tenant era). Any other unscoped read is the same breach, undetected.

3. 🔴 **`business-config` is a GLOBAL store** (`src/lib/persistence/store-classification.ts` GLOBAL_STORES). The loader *prefers* a per-tenant file (`business-config.ts:310`) but falls back to the shared `.data/global/business-config.json`. A stranger with no per-tenant config silently inherits **Ritz's name, domain, services, locations** → their whole app renders as Ritz.

4. 🔴 **`competitor-universe` is GLOBAL** (`universe-read.ts:67` reads one `.data/global/competitor-universe.json`). Two tenants share one competitor set. Iranopedia's competitors = Ritz's Bay-Area builders. The `/competitors` page is wrong for everyone but tenant #1.

5. 🔴 **`co-mention-matrix` is GLOBAL.** Cross-tenant competitive analytics are computed into one shared blob; tenant B sees tenant A's market.

6. 🔴 **`scan-state` + `last-scan-result` are GLOBAL** (`scan-state.ts:25`). Two tenants scanning collide on one state file — a stranger's scan overwrites Ritz's progress and vice versa; throttle/lock is shared.

7. 🔴 **`competitor-monitoring` is GLOBAL.** The sitemap-crawl snapshots + "recent changes" that feed the new "steal this move" surface are one shared object across tenants.

8. 🟠 **The cross-tenant brain's safety rests on segment-scoped pattern keys, but only 3 segments exist** (`tenants/types.ts`). Two unrelated `content_publisher` sites (a Persian encyclopedia and a cooking blog) would pool "learnings" — anonymized, but the helping-rate math mixes incomparable verticals.

9. 🟠 **`shared-brain` / `global-patterns` / `url-change-patterns` are GLOBAL by design** but were validated only at n=1. With real strangers, the anonymization scrubber is now load-bearing for privacy, not a formality — it has never run against adversarial/PII-bearing tenant data.

10. 🟠 **No automated test asserts "every repo read is tenant-scoped."** The isolation guarantee from issue #1 has no ratchet; #2 proves a human will miss one. A grep-based architecture test (no bare `getRepository().getX()` outside `forTenant`) does not exist.

---

## B. AUTH, ROLES & ACCESS

11. 🔴 **Operator mode is a single global env flag** (`src/lib/operator-mode.ts`: `BEACON_OPERATOR_MODE`). There is **no per-user / per-tenant operator role.** Consequence for self-serve: either the flag is OFF and *no customer* can reach connect/refresh/**Approve & Push** (the entire publish product is unreachable), or it's ON and *every* logged-in user shares operator surfaces. There is no middle.

12. 🔴 **The publish layer is gated ONLY by that global operator flag.** `approveAndPushRecommendedEdit` and the Wix connect/sync actions check `isOperatorModeServer()` and nothing tenant/user-specific. In a multi-tenant deploy with the flag on, a stranger could trigger pushes for whatever tenant the middleware resolved — there is no "is this user allowed to publish for this tenant" check beyond the ambient tenant header.

13. 🔴 **A user who belongs to >1 tenant is locked out.** Middleware injects `x-beacon-tenant` only when membership is **exactly 1** (`supabase-middleware.ts:23` logs ambiguity and does NOT inject); `currentTenantId()` then throws (`tenant-context.ts:45`). Agencies / multi-site owners (the literal "improve their app OR website") cannot use the product, and there is no tenant switcher.

14. 🟠 **Connector keys are tenant-scoped in the row but decrypted with one service role and stored as plaintext JSONB** (`connector_tokens.payload`). A stranger pasting a Wix API key / Google refresh token trusts that no app bug ever selects another tenant's `connector_tokens` row — and per #1 there's no RLS backstop. High-value secrets, app-layer-only isolation.

15. 🟠 **No "primary tenant" concept.** Even once multi-membership is handled, `tenant_members` has no role/primary indicator (`supabase-middleware.ts:28` says so), so there's no owner-vs-viewer distinction — any member could push.

16. 🟡 **`x-beacon-tenant` is correctly stripped from inbound requests** (`supabase-middleware.ts:63`) — good — but the env fallback (`BEACON_TENANT_ID`) still wins in any non-request context, so a mis-set Vercel env pins the whole deployment to one tenant regardless of who logs in (see #21).

---

## C. "LOG ON AND IMPROVE IMMEDIATELY" — onboarding reality

17. 🔴 **A new signup provisions a tenant hardcoded to `local_residential_builder`** (`provision-tenant.ts:11`). A Persian encyclopedia, a SaaS app, a dentist — all get the builder segment, builder feature toggles (local-service/call-tracking/geo on), and builder-shaped recommendations. "Anyone" gets Ritz's vertical.

18. 🔴 **Nothing connects a stranger's site to data on day one.** Onboarding sets `status: pending_onboarding` and stops; there's no flow that takes a domain → crawl → first prompts → first poll. "Improve immediately" has no on-ramp; today it required *me* running SQL + `cron-poll.ts` by hand for Iranopedia.

19. 🔴 **Prompts must be hand-seeded.** I inserted Iranopedia's 50 prompts via raw SQL. A stranger has zero prompts → the nightly poll measures nothing → the product is empty. There is no auto prompt-generation from a domain at signup (the onboarding `prompt-generator.ts` exists but isn't wired to provisioning).

20. 🟠 **The Wix collection mapping is a raw JSON paste** (`/diagnostics/wix` textarea of `{dataCollectionId, slugField, urlPrefix}`). A non-technical stranger cannot produce Wix collection GUIDs. The "improve your website immediately" path requires developer-grade input.

21. 🔴 **`BEACON_SITE_DOMAIN` is a deployment-wide env** (`site-config.ts:49`, `scan-site-domain.ts:12`). The scanner crawls *one* domain per deployment. A second tenant's site is never scanned unless the env changes — i.e., the scanner is fundamentally single-tenant right now.

22. 🟡 **Onboarding has no "what does your business do" → segment/feature inference.** Even the 3 segments must be set in the DB by hand (I did it via SQL for all 3 tenants). No UI path sets segment.

---

## D. THE PUBLISH LAYER AT STRANGER-SCALE

23. 🔴 **Wix is the only write adapter; `git_pr` is a stub.** A stranger on Webflow, Shopify, WordPress, or a custom React app has **no push path** — they get dev-notes only, same as Ritz. "Improve their app or website immediately" is Wix-CMS-only today.

24. 🟠 **The url-map sync derives URLs from `urlPrefix + slug` guesses, not from Wix's actual published routes.** If a tenant's dynamic-page URL pattern differs (locale prefixes, nested routers, custom router), every push resolves to the wrong item or none. No verification that the derived URL actually 200s before it's treated as pushable.

25. 🟠 **The immediate post-push "verify probe" fetches raw HTML and substring-matches** (`push-service.ts probeLiveText`). Wix dynamic pages can be slow to propagate/cache; a correct push will frequently probe-miss and mislabel itself "pending," eroding trust on the very first push a stranger does.

26. 🟠 **Field-merge update sends the *entire* item back** (read-modify-write). If two operators (or a background re-sync) touch the same item, last-write-wins clobbers concurrent field edits — no optimistic concurrency / revision check.

27. 🟠 **The 10/day push cap is global per tenant, counted in a local JSON ledger** (`push/caps.ts` `push-ledger`). On Vercel's read-only FS the ledger write is best-effort/in-memory (the known dual-write caveat), so across serverless invocations the cap may **not actually hold** — the safety cap can be silently lossy in production.

28. 🟡 **`create_page` pushes a CMS item but cannot create the dynamic-page route, menu entry, or publish state in Wix.** A created item with no bound dynamic page = an orphan row the stranger never sees live, while Beacon reports "pushed."

29. 🟡 **No rollback / undo for a push.** Once a field is overwritten on the live site, the prior value lives only in the (best-effort) ledger detail string, not as a restorable snapshot.

---

## E. COST, ABUSE & RUNAWAY SPEND

30. 🔴 **Signup has no rate-limit, captcha, invite, or allowlist** (none found in `app/(public)/signup` or `app/auth`). Anyone can create tenants in a loop. Each active tenant the cron picks up = real OpenAI/Perplexity spend on **your** keys.

31. 🔴 **The poll cron fans out to *every* `status='active'` tenant** (`daily-native-poll.yml` → `list-active-tenants.ts`). A self-serve signup that reaches `active` enters the paid nightly poll with **no per-account spend ceiling enforced at the fleet level** — N strangers = N×(~$1.30/day) on your account, unbounded.

32. 🔴 **GitHub Actions minutes are the fleet's polling substrate.** ~960 min/month/tenant (documented in the workflow header). The free tier (2,000 min) covers ~2 tenants. A handful of strangers exhausts CI minutes → **all polling stops for everyone, silently** (the same class of outage as the June 3–9 ChatGPT latch).

33. 🟠 **The page factory calls OpenAI per item with the operator's key** (`cluster-factory.ts`), capped at 10 items/run but with **no per-tenant daily generation budget**. A stranger (or a loop) can run clusters repeatedly; cost is bounded per-run, not per-day-per-tenant.

34. 🟠 **`llm-budget` and `cost-ledger` are GLOBAL stores.** The LLM spend cap is fleet-wide, not per-tenant — one heavy tenant can exhaust the shared budget and starve everyone else's recommendations (or vice-versa, mask a runaway tenant).

35. 🟡 **`daily_budget_usd` defaults to $5 (provisioning) / $10 (Ritz)** but I found no code path that *enforces* a refusal when a tenant exceeds its own `daily_budget_usd` in the poll runner — the per-run ceiling exists; the per-tenant-per-day ceiling is advisory.

---

## F. HARDCODING & SINGLE-TENANT ASSUMPTIONS

36. 🔴 **`"ritz-builders"` is a literal fallback in the hot path** (`today-data.ts:2687`: `process.env.BEACON_TENANT_SLUG ?? "ritz-builders"`). If a stranger's slug env is unset, their Today page resolves **Ritz's** command-center data.

37. 🟠 **163 references to `tenant-ritz-founder` / `ritz-builders` across src/scripts/workflows.** Several are legitimate founder-fallbacks I added (e.g. `tenant-features.ts` preserves Ritz on registry miss), but that *same* fallback means a registry hiccup gives a stranger **builder features by default** (`tenant-features.ts` → `SEGMENT_DEFAULTS.local_residential_builder` for the founder id only, `SAFE_FALLBACK` otherwise — verify each of the 163 is intentional).

37b. 🟠 **City/geo vocabularies still default to the Bay Area.** I parameterized `query-index.ts` and `opportunity-candidates/builders.ts` to take a `cities` arg, but the **defaults are still the Bay-Area list**, and most callers don't pass tenant cities yet — so a stranger's geo analysis silently uses Atherton/Palo Alto.

38. 🟠 **`SERVICE_KEYWORD_MAP` (remodel/adu/teardown) and builder topic-adjacency remain builder-shaped** (`answer-intelligence/query-index.ts`, `builders.ts`). Non-builder tenants get builder service inference.

39. 🟡 **Forbidden-vocab / brand-assertion rules reference builder framing** (`brand-assertions.ts` in the hardcode grep). Content-quality gates may misfire for a non-builder vertical.

40. 🟡 **`ops/active-tenants.json` is a committed file with Ritz hard-required** (the cron "hard guard: Ritz must be present"). Fine for you; a literal blocker to a clean multi-tenant fleet where Ritz is just one customer.

---

## G. OPERATIONS, RELIABILITY & DATA INTEGRITY

41. 🔴 **Same-day re-poll collision (just fixed for observations) is a *pattern*, not a one-off.** The `ux_pao` expression-index path forced a bespoke recovery; any other table with a uniqueness index that the dual-writer upserts on `id` has the same latent "duplicate key → mark failed → gate latches" failure. Daily-metric-snapshots, call-attribution, etc. should be audited for the same shape.

42. 🟠 **Vercel writes are best-effort/in-memory** for JSON stores (documented dual-write caveat). Any store not mirrored to Supabase loses writes on the hosted runtime between invocations — affects push-ledger (#27), scan-state, url-map, wix-collection-config. A stranger's Wix mapping could evaporate.

43. 🟠 **The poll-failure GitHub-issue alert (added this week) is per-repo, not per-tenant.** With N tenants, one tenant's failure opens one shared issue; you can't tell *which* customer's polling broke from the issue title, and a healthy-tenant green run won't auto-close it.

44. 🟠 **`citation-evidence-index` rebuild is per-tenant now** (good) but other singletons (`answer-intelligence-index`) and the `/competitors` market computation read **global** co-mention/universe data (#4, #5) — so the rebuilt per-tenant index is joined against cross-tenant inputs downstream.

45. 🟡 **No per-tenant data-retention or delete path.** A stranger who cancels leaves prompts, observations, snapshots, connector tokens (with live API keys!) in the DB indefinitely. No "delete my tenant" (GDPR/CCPA exposure given the privacy memo).

46. 🟡 **The Wix client has no rate-limit/backoff for the tenant's Wix quota.** A url-map sync over a large collection (1000-item pages) hammers Wix; a stranger with a big site could trip Wix's API limits and get their key throttled/flagged.

---

## H. CONTENT QUALITY & LLM SAFETY (stranger-facing output)

47. 🔴 **Content rules are *flagged*, not *enforced*.** The factory puts "contains 'Farsi'" / word-count violations into `risks[]` and relies on the human gate. For a self-serve stranger with no operator reviewing, "flag-only" = the violation ships. Multi-tenant self-serve needs hard rejection, not advisory flags.

48. 🟠 **`flaggedTerms` and content rules are passed in per-cluster, but there's no per-tenant content-rule store.** A stranger has no way to express "never call it X" — the Persian-never-Farsi rule is only there because I typed it into a plan object.

49. 🟠 **No fabrication/grounding check on generated CMS content.** The prompt says "only verifiable facts," but nothing verifies the model's output against a source before it becomes a pushable card. A stranger could approve a confidently-wrong fact onto their live site, attributed to Beacon.

50. 🟠 **`create_page` content is plain text into one CMS field**, with no schema/FAQ/internal-linking/structured-data generation — i.e., the AEO-optimized output the product *promises* isn't what the factory actually produces yet. A stranger "improving their site" gets a bare text blob, not an AEO-grade page.

---

## The one-line takeaways

- **#1 is the spine:** isolation is app-layer-only. Until either RLS uses `tenant_members`/`auth.uid()` *or* there's a ratcheted "all reads are scoped" test, every new query is a potential breach — and #2 proves it happens.
- **#11–13 mean a stranger literally cannot use the publish product** as built: operator-mode is global, push is operator-gated, multi-tenant users are locked out.
- **#30–32 mean self-serve signup is a direct, unbounded charge to your accounts** (API + CI minutes) with no throttle.
- **#17–21 mean "improve immediately" has no on-ramp:** new tenants are builder-shaped, prompt-less, site-disconnected, and Wix-only.

Highest-leverage fixes, in order: (1) a tenant-scope ratchet test + audit the 163 hardcodes; (2) per-tenant operator/role replacing the global flag; (3) move the 5 GLOBAL stores (`business-config`, `competitor-universe`, `co-mention-matrix`, `scan-state`, `competitor-monitoring`) to tenant-scoped; (4) signup rate-limit + per-tenant daily spend ceiling enforced in the poll runner; (5) segment selection + auto-prompt-seeding in onboarding.
