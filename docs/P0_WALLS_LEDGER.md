# P0 Walls — Status Ledger (2026-06-10/11)

Honest disposition of the seven P0 walls from `DREAM_GAP_INVENTORY.md`,
built this session. Status: **SOLVED** (code + tests + live-verified
where verifiable tonight) · **SOLVED (gated)** (works end-to-end the
moment a named operator input lands) · **PARTIAL** (core shipped,
named remainder). Every operator dependency is an explicit
**WAITING FOR OPERATOR** line — nothing else blocks.

Quality gates: full suite green + typecheck clean at ship time.

---

## Wall 1 — "The queue does not refill while you sleep" → SOLVED

`promoteEligibleCandidates` now runs nightly per tenant:
`.github/workflows/nightly-generation.yml` (05:30 UTC — after the
04:00 scan, before the 07:00 poll), matrix from the same DB-first
lister as scan/poll, `scripts/run-scheduled-generation.ts` runner.
Live-write defaults ON via repo var `BEACON_PROMOTION_LIVE_WRITE_ENABLED`
(queue-only writes — **the approve click remains the only publish
gate**); `BEACON_GENERATION_DISABLED` kill switch; deterministic-only
pinned (`BEACON_LLM_PROVIDER=deterministic` — the job can never spend
LLM money); idempotent re-runs; GitHub-issue failure alert; contract
pinned by `tests/architecture/nightly-generation-contract.test.ts`.

Verified: headless runner executed for both tenants against live data
(Ritz 29 candidates; Iranopedia 17 → 14 eligible after the wall-3 fix).

- Nothing waiting on the operator.

## Wall 2 — "The decide-layer is blind for any tenant but Ritz" → SOLVED

- Scan matrix is DB-driven (`scripts/list-active-tenants.ts`, same as
  the poll): a tenant set `status='active'` in Supabase is scanned the
  next night, no commit. Ritz literal guard → configurable
  `vars.BEACON_REQUIRED_TENANT_ID` (Ritz default).
- Wix sitemap-index recursion (`src/domains/scanning/sitemap-parse.ts`)
  — Iranopedia's `/sitemap.xml` is an index; the old flat parser saw 0
  URLs and aborted.
- Per-tenant crawl ceilings (`scanMaxPages` ops override → 1500
  default) + CLI timeout scaled to the ceiling (120s killed
  encyclopedia crawls).
- **Iranopedia's first crawl ran tonight: 217 pages**, dual-written to
  Supabase; triggers fired (17 candidates) on the fresh inventory.

- Nothing waiting on the operator.

## Wall 3 — "Drafting covers 3 of 19 action types" → SOLVED (13 now draft)

`draft-enrichment.ts` fills exact deterministic drafts in the nightly
promotion path for 10 more action types (edit_title, edit_meta,
change_h1, fix_canonical/robots/noindex/status_code/sitemap,
add_internal_link, add_schema) + the 3 packet generators that already
existed. All copy comes from the page's own words; thin pages refuse
honestly (instruction card, never fake content).

De-verticalization shipped with it (all caught live on Iranopedia's
first run):
- NEW `PageType "content"` via `BusinessConfig.contentSiteMode` — the
  builder-shaped classifier had been suppressing ALL content edits on
  encyclopedia pages (`skip_page_type`).
- business-config resolution bug fixed: per-tenant CLI jobs were served
  the FOUNDER tenant's config (Iranopedia classified with Ritz's URL
  patterns). Per-tenant file now wins; slug-dir support added.
- Runners get real configs via repo var
  `BEACON_BUSINESS_CONFIG_JSON_BY_TENANT` (set — names/domains/url
  patterns only, no credentials).
- Wix-reality hardening: brand-suffix inference requires path
  diversity; CMS-placeholder filter ("Page Title"); slug-derived
  titles; chrome-filtered meta fallbacks.

Verified live: Iranopedia 14 eligible → **10 drafted** with correct
copy ("Persian Last Names | Iranopedia"); 4 honest refusals (genuinely
thin/JS-rendered pages).

- Remainder (inventory items, not tonight): merge/refresh/split/cluster
  LLM generators (#55 tail), the LLM specific-edit gateway caller (#56).

## Wall 4 — "The factory and half the Wix adapter are unreachable" → PARTIAL (factory wired)

- `/diagnostics/factory` + `src/domains/push/factory-run.ts`:
  paste a cluster plan → LLM-generated `create_page` drafts land in
  the SAME approve queue; per-tenant daily budget gate; deterministic
  row ids (idempotent); spend recorded to the ledger; banned-term
  hard-rejections surfaced. Nothing ships without the approve click.
- **WAITING FOR OPERATOR (hosted use):** `BEACON_LLM_PROVIDER=openai` +
  `OPENAI_API_KEY` in Vercel env (hosted env edits are on the pause
  list — I don't touch them). Works locally today.
- **WAITING FOR OPERATOR (first real run):** Wix collection id for the
  Persian-Food cluster (the page's example plan is prefilled).
- Remainder: `wixCreateDraftPost` (blog) + `wixImportMedia` (media)
  stay written-but-unwired (#69/#59).

## Wall 5 — "The brain cannot do the cross-vertical trick" → SOLVED (gated)

`page-shape.ts` + `load-page-shape-patterns.ts`: structural-only
feature extraction (FAQ block / table / schema / long-form / rich
headings — booleans, never text/urls/tenant ids), pooled across ALL
active tenants, cited-rate lift per feature with honest gates (≥10
pages per side, no zero-baseline ratios). Surfaces as the digest's
network-insight strip. Gate: `BEACON_CROSS_TENANT_BRAIN="1"` — set as
a GH repo var tonight (runner jobs); all three tenants are
operator-owned, so no third-party privacy exposure.

- **WAITING FOR OPERATOR (optional):** same flag in Vercel env if/when
  in-app brain surfaces should light up (pause-list item).
- Data note: the pool needs Iranopedia citation observations to
  accumulate (its prompts have polled since 2026-06-10) — the insight
  line appears once a feature clears the honesty gates.

## Wall 6 — "Nothing reaches you" → SOLVED (gated on one key)

Morning digest: `.github/workflows/morning-digest.yml` (14:00 UTC ≈
7 AM PT) → `scripts/run-morning-digest.ts` → ONE email across all
businesses: pending moves (drafted first), yesterday's
shipped/verified receipts, the edit-rate learning line, the network
insight strip, one approve link. Missing delivery env is a LOUD SKIP,
not a failure; configured-send failures raise the deduped GitHub
issue. `BEACON_DIGEST_TO` + `BEACON_APP_URL` repo vars set.

- **WAITING FOR OPERATOR: `RESEND_API_KEY`** — create a free
  resend.com account with aminarmeen@gmail.com, copy the API key:
  `gh secret set RESEND_API_KEY --repo armeen55/beacon` (or paste it
  to me). With the default onboarding sender, Resend delivers to the
  account owner's inbox with zero domain setup. The first digest
  arrives the next 14:00 UTC (or fire "Morning digest" manually in
  Actions).

## Wall 7 — "Learning from you doesn't exist" → SOLVED

`edit-feedback.ts`: 90-day per-action-type edit-rate from
`verified_live_modified` vs `verified_live`; conservative deterministic
adjustment (rate >0.5 across ≥5 shipped → one-step confidence
downgrade + plain-English note on new drafts of that type); wired into
the nightly writer; the digest shows the per-business learning line
("You reworded N% of the last M drafts before shipping").

- Nothing waiting on the operator. (Deeper loop — draft/final text
  deltas as few-shot for LLM drafting — is inventory #100's tail.)

---

## WAITING FOR OPERATOR — the complete list

1. **`RESEND_API_KEY`** (wall 6) — resend.com free account → repo
   secret. The only thing between you and the morning email.
2. **Vercel env** (walls 4/5, hosted surfaces; pause-list, so yours):
   `BEACON_LLM_PROVIDER=openai`, `OPENAI_API_KEY`,
   `BEACON_CROSS_TENANT_BRAIN=1`.
3. **Wix collection id + mappings for Iranopedia** (wall 4 first
   factory run; `/diagnostics/wix` to connect + map, then
   `/diagnostics/factory`).
4. Standing items unchanged from before: SEMrush key, CallRail key,
   Finglish domain/repo decision, GSC connect for Iranopedia (#131 —
   the resurrection chart's baseline).

## What happens tonight without you

04:00 UTC — both sites scanned (Iranopedia's second crawl).
05:30 UTC — both queues refill (Iranopedia: ~14 rows, 10 with drafts).
07:00 UTC — both tenants polled across both engines.
14:00 UTC — digest job runs (skips loudly until the Resend key lands).
