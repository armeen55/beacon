# LLM Budget Ledger — Cutover Plan (2026-05-09)

## 1. Current state — verified, not assumed

Two separate budget systems exist today; both are JSON-on-disk; the polling loop's enforcement is effectively absent. Verified by reading source.

### 1a. Adjudicator monthly cap
- **File:** `src/domains/recommendations/adjudicator-budget.ts` + `.data/global/llm-budget.json`.
- **Shape:** one row per month, `{ monthKey, spendUsd, calls, capUsd, updatedAt }`. Default cap **$10/month**.
- **Scope:** the adjudicator + specific-edit LLM calls in rec generation (gpt-4o). NOT the poll runner.
- **Enforcement:** `checkBudget()` is called by `run-provider-and-persist-llm` before each adjudicator request; `recordSpend()` is called after.
- **Per-tenant:** No. Single global row.
- **Per-platform:** No. Single global row.

### 1b. Cost ledger (per-tenant daily)
- **File:** `src/lib/cost/budget.ts` + `.data/cost-ledger.json`.
- **Shape:** append-only event log of `{ tenant_id, date, amount_usd, label, timestamp }`.
- **Scope:** designed for the native polling loop (Perplexity / ChatGPT).
- **Caps (env):** `BEACON_DAILY_BUDGET_USD_PER_TENANT` ($10), `BEACON_DAILY_BUDGET_GLOBAL_USD` ($20), `BEACON_PER_RUN_BUDGET_USD` ($8).
- **Per-tenant:** Yes.
- **Per-platform:** No (label is freeform, not partitioned).
- **Enforcement:** **NOT WIRED.** Source comment: *"Sprint 6A.3a/b status: helpers exist + tested. Polling-loop wiring lands in 6A.3c. Until then `checkTenantBudget` / `checkPerRunBudget` have zero callers in production code."*  `run-poll.ts` does not import either helper.

### 1c. Failure modes today
1. **Vercel ephemeral FS:** `ensureDataDir()` returns early when `process.env.VERCEL === "1"`, so any write attempt from a Vercel runtime is a no-op. Cost is not tracked from the web app.
2. **GH Actions ephemeral FS:** the runner's `.data/` is wiped at job exit. Each run starts with an empty ledger; the daily cap is effectively a per-run cap.
3. **Adjudicator file at risk:** `.data/global/llm-budget.json` is local-only; if it's lost between deploys, the monthly cap silently resets to $0 spent and the cap loses its memory.
4. **No per-platform tracking:** today's poll cost $0.09 (Perplexity) + $2.88 (ChatGPT) = $2.97. ChatGPT is **31× more expensive per 100-prompt run.** A single-cap model cannot price-discriminate; the cap that protects ChatGPT is wasteful for Perplexity.
5. **No actual enforcement on the poll path:** the only "guard" preventing cost runaway is the UTC-day budget guard (which prevents same-day double-runs) and the persistence-failure gate. Neither is a spend cap.

### 1d. Where spend is read / written
| Code path | Reads | Writes | Path |
|---|---|---|---|
| Adjudicator (rec gen) | `.data/global/llm-budget.json` | `.data/global/llm-budget.json` | `adjudicator-budget.ts` |
| Cost-ledger helpers (unwired) | `.data/cost-ledger.json` | `.data/cost-ledger.json` | `src/lib/cost/budget.ts` |
| `run-poll.ts` (the actual poll runner) | nothing | nothing | poll path is uncapped today |

## 2. Proposed Supabase ledger

### 2a. Table

```sql
CREATE TABLE public.llm_budget_ledger (
  tenant_id      text         NOT NULL,
  date_utc       date         NOT NULL,
  platform       text         NOT NULL,        -- perplexity | openai | adjudicator-openai | other
  spent_usd      numeric(12,6) NOT NULL DEFAULT 0,
  call_count     integer      NOT NULL DEFAULT 0,
  prompt_count   integer      NOT NULL DEFAULT 0,
  chunk_count    integer      NOT NULL DEFAULT 0,
  daily_cap_usd  numeric(12,6),                -- per-row override; NULL = use env default
  last_run_id    text,
  metadata       jsonb,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, date_utc, platform),
  CHECK (tenant_id <> ''),
  CHECK (platform IN ('perplexity','openai','adjudicator-openai','other')),
  CHECK (spent_usd     >= 0),
  CHECK (call_count    >= 0),
  CHECK (prompt_count  >= 0),
  CHECK (chunk_count   >= 0),
  CHECK (daily_cap_usd IS NULL OR daily_cap_usd >= 0)
);
```

### 2b. Indexes
- `(tenant_id, date_utc DESC)` — common dashboard reads.
- `(date_utc DESC)` — global "today's spend" canary aggregation.

### 2c. RLS posture
- `ENABLE` + `FORCE` ROW LEVEL SECURITY (matches Cat-A1/A2/B precedent).
- `deny_anon` (false / false).
- `tenant_authenticated_rw` (`public.is_tenant_member(tenant_id)` in USING + WITH CHECK).
- Service-role bypasses RLS — the cron writer keeps using it.

### 2d. Decisions made
1. **One row per `(tenant_id, date_utc, platform)`** — the smallest grain that still answers every operational question. Per-call detail belongs in a future event table only if needed; aggregate is enough for enforcement and dashboards.
2. **Default budget stays in env** (`BEACON_DAILY_BUDGET_USD_PER_TENANT`, `BEACON_DAILY_BUDGET_GLOBAL_USD`, `BEACON_PER_RUN_BUDGET_USD`). The per-row `daily_cap_usd` is an override, NULL = "use env default." Operators can raise/lower a tenant's cap without redeploying.
3. **Missing rows = $0 spent, default cap.** No magic.
4. **Local file fallback during migration:** the existing JSON ledgers stay untouched until Stage B is fully verified. Stage A is shadow-only.
5. **No double-counting of retries:** Stage B's `recordSpend()` will UPSERT atomically; retries that re-call after a successful API hit are the writer's responsibility to dedupe via `last_run_id` check (stamp the run id, then increment, in the same transaction).
6. **Index/constraint set:** PK covers the natural read pattern; nonempty + nonnegative checks are the same defense-in-depth shape that Stage C added to Cat-A2 tables.

## 3. Read / write path (Stage B, NOT this turn)

### 3a. Writers
- `runNativePoll` (`src/domains/observations/run-poll.ts`) — after each successful provider call, UPSERT a row keyed on `(tenant_id, today_utc(), platform)` with incremented counters and `spent_usd += <call cost>`.
- `runProviderAndPersistLLM` (rec generation pipeline) — same UPSERT shape against `platform = 'adjudicator-openai'`.

### 3b. Readers
- **Enforcement (BEFORE paid API calls):** `checkBudget(tenant_id, platform)` reads the row, compares `spent_usd` to `coalesce(daily_cap_usd, env_default)`, returns `{ allowed, spent_usd, cap_usd, percent }`.
- **Canary:** `scripts/check-yesterday-poll.ts` should add a "spend snapshot" line per platform alongside its existing chunk/prompt accounting.
- **Dashboard surfaces:** `/today` operator-mode block ("today's LLM spend by platform") and `/diagnostics`.

### 3c. Enforcement point
```ts
// In runNativePoll, after persistence-gate, before adapter call:
const guard = await checkSupabaseBudget(tenantId, platform);
if (!guard.allowed) {
  return { status: "skipped_budget_exhausted", note: guard.reason, ... };
}
```
A new `NativePollStatus` value: `"skipped_budget_exhausted"`.

## 4. Dual-write transition (Stage B)

| Step | What | Reversible? |
|---|---|---|
| **B.1** | Apply Stage A migration (this draft). Table empty. | Yes — DROP TABLE in rollback. |
| **B.2** | Add `recordSpendDualWrite(...)` that writes BOTH the JSON ledger AND the Supabase row. Wire it into `runNativePoll`. | Yes — flag-gated by `BEACON_BUDGET_LEDGER_DUAL_WRITE=1`. Default off. |
| **B.3** | Run for 3+ days. Reconcile: `SUM(spent_usd) FROM llm_budget_ledger WHERE date_utc = today` should match `SUM(amount_usd) FROM cost-ledger.json` for the same date. Any drift = bug; do not advance. | Yes — flip flag off. |
| **B.4** | Add `checkSupabaseBudget(...)` enforcement in `runNativePoll` BEFORE the adapter call. Initially in **shadow** mode — log allow/deny but do not actually skip the call. | Yes — flag `BEACON_BUDGET_ENFORCE_SHADOW`. |
| **B.5** | After 3+ days of shadow agreeing with the JSON-ledger guard, flip enforcement to **active** (`BEACON_BUDGET_ENFORCE=1`). Skip paid calls when the cap is reached. | Yes — flag flip. |
| **B.6** | Once stable, mark JSON-ledger write paths as deprecated. Keep them readable for one more cycle for emergency rollback. | One-way after this. |
| **B.7** | (Future, not Phase 2) Remove JSON-ledger writers entirely. | One-way. |

## 5. Rollback

Migration: single `DROP POLICY` × 2 + `DROP TABLE` in the commented rollback block. Safe at every stage of B because:
- B.1: nothing reads the table; drop is harmless.
- B.2: dual-write is flag-gated; flip flag and drop.
- B.4: shadow only logs; flip flag and drop.
- B.5: flipping `BEACON_BUDGET_ENFORCE=0` reverts to JSON-ledger enforcement immediately. Drop after.

## 6. Canary / poll-health display + post-poll verifier

### 6a. Inline canary spend snapshot
The canary script `scripts/check-yesterday-poll.ts` now appends a
read-only spend snapshot per platform when ledger rows exist for the
date being checked. Empty/unavailable table prints
`spend snapshot: ledger empty for {date} (shadow mode)`. The snapshot
is informational only — it cannot fail the canary.

### 6b. Standalone verifier (Stage B.2 add-on)
For deeper post-poll attestation, run:

```
npx tsx --require ./scripts/mock-server-only.cjs scripts/verify-budget-ledger.ts [YYYY-MM-DD]
```

This compares `llm_budget_ledger` rows for the date against:
- `observation_runs` for the matching `(source, completed_at)` plus
  parsed `cost=$N` from `scope_label`
- `prompt_answer_observations` count by platform label
  (`perplexity` / `chatgpt`)

Per-platform statuses:
| status | meaning |
|---|---|
| `ok` | ledger row matches runs + observations within $0.01 |
| `warn` | drift in cost / prompt_count / chunk_count / last_run_id |
| `failed` | spent_usd ≤ 0, ledger row missing for completed runs, or orphan ledger row |
| `pending` | no runs and no ledger row (e.g. before the daily poll fires) |

Exit codes: 0 for ok/pending, 1 for warn/failed, 2 for runtime error.

### 6c. Future extension (B.4+)
Add to `src/domains/observations/poll-health.ts`:
- New field per platform: `spendToday: { tenant_usd, cap_usd, percent }`.
- Include in `check-yesterday-poll.ts` output:
  ```
  ✓ perplexity ok       1/1 chunks, 100 prompts, $0.09 / $10.00 (1%)
  ✓ chatgpt    ok       1/1 chunks, 100 prompts, $2.88 / $10.00 (29%)
  ```
  When > 80% the glyph becomes ▲; when ≥ 100% it becomes ✗.
- This makes "we're 90% of the way to the cap" a green-line warning, not an after-the-fact 0-chunk RED.

## 7. Rollout order

1. **This bundle (today):** Stage A migration + tests + this plan, drafted and committed. **Not applied.**
2. **Tomorrow / next bundle:** apply Stage A. Single `db query --file`. Rollback is a single `DROP TABLE`. Risk: zero — table is shadow-only.
3. **B.2 (dual-write):** ~½ day of code; ship the writer behind a flag.
4. **B.3 reconciliation:** 3+ days of natural cron cycles.
5. **B.4 shadow enforcement:** 3+ more days.
6. **B.5 active enforcement:** flip flag; the cap is real for the first time.
7. **B.6 deprecate JSON writers.**

## 8. Why this matters for customer #2

- Today's $2.97 single-tenant single-day was uncapped in the loop. A misconfigured customer-2 prompt set or a runaway provider failure could spend $50/day with no automatic stop.
- Per-platform asymmetry (~31×) means a single global cap either over-protects Perplexity or under-protects ChatGPT.
- The cap that exists in env (`BEACON_DAILY_BUDGET_USD_PER_TENANT=$10`) is honor-system today. Stage B is the first point where a code path actually skips a paid API call when the cap is hit.

## 9. What this plan does NOT do
- Does not build a per-call event table (separate concern; Stage C if needed).
- Does not migrate historical JSON-ledger spend into Supabase (Stage A is shadow-only; B.2 starts dual-write going forward).
- Does not change the rec-generation adjudicator path in Stage A. Stage B includes wiring `platform = 'adjudicator-openai'`; until then, that ledger keeps using `.data/global/llm-budget.json`.
- Does not remove the `.data/cost-ledger.json` writer until B.6 confirms 3+ days of clean enforcement.
