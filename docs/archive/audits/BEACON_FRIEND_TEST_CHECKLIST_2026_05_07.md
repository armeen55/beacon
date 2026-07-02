# Beacon Friend-Test Checklist (2026-05-07)

> **Purpose:** Walk one trusted friend through the self-serve onboarding flow end-to-end without you (the operator) touching infrastructure mid-test. Verify every step, capture screenshots, and reset cleanly afterward.
>
> **Status as of 2026-05-07:** All eight self-serve gaps shipped (`f724957..e7d9a75`). Beacon is friend-test ready.

---

## TL;DR

1. **Pre-flight** the deploy + secrets + Ritz-still-green. (Section 1.)
2. **Send** the friend `https://<your-vercel-domain>/signup` and the message template in Section 3.
3. **Watch** them complete the flow (Section 4 — expected screens).
4. **Verify** rows in Supabase after each milestone (Section 5).
5. **Wait** for the next 07:00 UTC cron, then verify their first reading (Section 6).
6. **Reset** the test tenant (Section 7) when done.

If the friend hits any failure mode, Section 8 has the recovery playbook.

---

## 1. Operator pre-flight (5 min, do these IN ORDER)

### 1.1 Confirm the latest commit is deployed to Vercel

```bash
git log --oneline -1
# Expected: e7d9a75 feat(onboarding): Gap F.1 — first-reading waiting state on /today
```

Open Vercel dashboard for the Beacon project. Confirm:
- Latest production deployment shows commit hash `e7d9a75` (Gap F.1) — or whatever the most recent self-serve commit on `main` is at the time of the test.
- Build status: green.
- Last deploy time: within the last 24h ideally.

### 1.2 Confirm the daily cron is green

GitHub → repo → Actions → "Daily native poll" workflow.
- Last 2 scheduled runs (07:00 UTC) should be green.
- If either is red, **abort** — the friend's first reading won't land. Investigate cron first.

### 1.3 Confirm Ritz is still healthy (regression guard)

```bash
npx tsx --require ./scripts/mock-server-only.cjs scripts/verify-tenant-data-integrity.ts
# Expected: PASS — all tenant-ownership invariants satisfied
#           Ritz row counts: daily_metric_snapshots ≈ 9896, prompt_answer_observations ≈ 16521, recommended_edits ≈ 28
```

If counts have drifted significantly without explanation, **abort** and investigate.

### 1.4 Confirm required Vercel env vars are set

Vercel project → Settings → Environment Variables. Required for production:

| Variable | Purpose | Sensitive? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Auth + DB read/write | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon read (RLS-enforced) | Public |
| `SUPABASE_SERVICE_ROLE_KEY` | Tenant provisioning, prompt insert, status flip | **YES — service role** |
| `BEACON_TENANT_ID` | Fallback tenant resolution (used by middleware-less paths) | No |
| `BEACON_TENANT_SLUG` | Slug fallback for build-time prerender | No |

If any are missing, the signup magic-link flow OR the auth-callback provisioner OR the Launch action will fail.

### 1.5 Confirm required GitHub Actions secrets are set

GitHub → repo → Settings → Secrets and variables → Actions:

| Secret | Used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `compute-matrix` job (lister) + `cron-poll` runners |
| `SUPABASE_SERVICE_ROLE_KEY` | `compute-matrix` + `cron-poll` runners + `rebuild-citation-evidence-index` |
| `PERPLEXITY_API_KEY` | `cron-poll` Perplexity job |
| `OPENAI_API_KEY` | `cron-poll` ChatGPT job |
| `BEACON_URL` | `verify-persistence` job (calls hosted endpoint) |
| `CRON_SECRET` | `verify-persistence` bearer auth |

### 1.6 Confirm no other active second tenant exists in production

Run in Supabase SQL editor:

```sql
SELECT id, slug, business_name, status, created_at
FROM tenants
WHERE status = 'active'
ORDER BY created_at DESC;
```

Should return exactly **one row**: Ritz (slug `ritz-builders`, id `tenant-ritz-founder`). If any other `active` tenant exists from a prior aborted test, run the reset script (Section 7) before proceeding — otherwise the next 07:00 UTC cron will poll BOTH tenants and consume budget.

### 1.7 Confirm no orphaned `pending_onboarding` tenants from prior tests

```sql
SELECT id, slug, business_name, status, created_at
FROM tenants
WHERE status = 'pending_onboarding'
ORDER BY created_at DESC;
```

Pending tenants are invisible to cron, so they don't burn budget. But they clutter the registry. Reset any leftovers using Section 7's script before sending the link.

---

## 2. Confirm the signup URL

Default Vercel domain pattern: `https://<project>-<owner>.vercel.app`
Custom domain (if configured): whatever you pointed at the Vercel project.

Open `<your-deployed-domain>/signup` in an incognito window. Expected:
- Page loads (HTTP 200).
- Headline: **"Create your Beacon account"**.
- Sub: "See how AI search engines describe your business. Magic-link sign-in — no password."
- Single email input + a "Send link" button.
- "Already have an account? Sign in" link.
- **No tenant/admin/RLS/schema/Supabase/cron/GitHub language anywhere.**

If the page 404s or shows an error, **abort** and check the Vercel deployment.

---

## 3. What to send the friend

Pick a friend who has a real business (a real builder is ideal; any small business works) and is comfortable typing a few cities + services.

**Email/DM template** (customer-safe — no internal language):

```
Hi <name>,

I'd like to test something I've been building called Beacon. It tracks
how AI search engines describe your business — when someone asks
ChatGPT or Perplexity "best builder in <your city>", does your
business come up?

It takes about 3 minutes to set up. You'll:
1. Enter your email and get a magic link.
2. Tell us your business name + website.
3. Pick the cities and services you focus on.
4. Pick 1-5 competitors you want to track against.
5. Click Launch.

Your first reading lands tomorrow morning — no work for you in between.

Sign up here: <your-deployed-domain>/signup

If anything looks weird or unclear, screenshot it and send back. I'm
expecting a few rough edges and want to fix them before launching wider.

Thanks!
```

**Things you should NOT include in this message:**
- ~~"This is in beta"~~ → makes them think it's flaky.
- ~~"Sign up here on Vercel"~~ → exposes infrastructure.
- ~~"It uses Supabase auth"~~ → exposes infrastructure.
- ~~"You'll be the second tenant"~~ → exposes data model.

---

## 4. Expected onboarding screens (what they'll see; capture these)

### 4.1 `/signup`

- Premium centered card.
- Single email input.
- "Send link" button.
- After submit: success state "Check your email" with a small note.

**Screenshot to capture: signup-1-form.png** (the empty form), **signup-2-sent.png** (the success state).

### 4.2 Email magic link

Magic-link email arrives within ~30 seconds (Supabase sends from a verified address). Subject line is set by Supabase template.

**Screenshot to capture: signup-3-email.png** (without revealing real email).

### 4.3 Click magic link → `/auth/callback?signup=1&code=...`

Browser briefly loads the callback URL. Behind the scenes:
- Supabase exchanges the code for a session cookie.
- Auth-callback resolves the user.
- `provisionTenantForNewUser()` runs (Gap B): inserts a `tenants` row with `status='pending_onboarding'`, `role='beta_customer'`, `daily_budget_usd=5`. Inserts a `tenant_members` row.
- Redirect to `/onboard/business`.

If anything fails here, redirect goes to `/signup?error=provisioning_<phase>`.

**No screenshot needed** (transient).

### 4.4 `/onboard/business` (Step 1 of 4)

- Step indicator: "Step 1 of 4" with the first segment filled.
- Heading: "Set up your business".
- Two inputs: business name (organization autocomplete), website.
- "Continue" button (disabled while empty/invalid).

**Things to verify:**
- Business name accepts up to 80 chars.
- Website normalizes correctly: `https://www.acme.com/about?utm=x` → saved as `www.acme.com`.
- Invalid input ("javascript:alert(1)" or just "localhost") shows a clear error.

**Screenshots to capture: onboard-1-business-empty.png, onboard-1-business-filled.png.**

### 4.5 `/onboard/scope` (Step 2 of 4)

- Step indicator: 2 of 4.
- Heading: "Service area and services".
- "Saved so far" panel echoing business name + website.
- Multi-line textarea for cities. Hint: "One city per line — or comma-separated. To include a state, add a comma: Atherton, CA."
- 6 project-mix checkboxes (New construction / Whole-home remodel / Kitchen & bath / ADUs / additions / Teardown / rebuild / Mixed-use commercial / residential).
- "Continue" disabled until ≥1 city + ≥1 service.

**Things to verify:**
- Cities title-case correctly: "atherton" → "Atherton".
- "Atherton, CA" as a single newline-separated entry preserves the state abbreviation.
- ≥1 of each required.

**Screenshots: onboard-2-scope-empty.png, onboard-2-scope-filled.png.**

### 4.6 `/onboard/competitors` (Step 3 of 4)

- Step indicator: 3 of 4.
- "Saved so far" panel: business + website + cities + services.
- Single multi-line textarea for 1-5 competitor names.
- Hint: "Up to 5 company names — one per line, or comma-separated. Names work best, not website URLs."
- Continue disabled until ≥1 competitor.

**Things to verify:**
- Pasting "demattei.com" rejects with a clear error (URLs not allowed; ask for the company name).
- Pasting "Houzz" works (single-word brands accepted).
- Up to 5 entries; 6th rejected.

**Screenshots: onboard-3-competitors-empty.png, onboard-3-competitors-filled.png.**

### 4.7 `/onboard/review` (Step 4 of 4)

- Step indicator: 4 of 4.
- "Your business" panel echoing all 5 fields (business + website + cities + services + competitors).
- "Starter prompts (N)" — generated preview list, grouped by family:
  - **Brand searches** (2)
  - **Head-to-head with competitors** (≤5)
  - **City + service queries** (multiple)
  - **Cost questions** (1 per service)
  - Total ≤ 25.
- "Beacon will start tracking these prompts on the next daily reading." copy.
- TOS checkbox: "I agree that Beacon will start tracking these prompts on the next daily reading. I can edit or pause them anytime."
- "Launch Beacon" button: disabled until TOS checked.

**Things to verify:**
- Prompt preview is non-empty (else there's a profile completeness issue from steps 1-3).
- Prompts mention the friend's actual business name in the brand-discovery + competitor lines.
- Prompts include the friend's actual city names.
- TOS checkbox unlocks the Launch button.

**Screenshots: onboard-4-review.png** (full page, scroll if needed).

### 4.8 Click "Launch Beacon"

Behind the scenes (Gap C.4):
1. `launchTenant()` runs.
2. Re-generates prompts server-side (does not trust client).
3. SELECTs existing `tracked_prompts` for the tenant slug → builds case-insensitive dedup set.
4. INSERTs new prompt rows (`is_active=true`).
5. UPDATEs `tenants` SET `status='active'`, `tos_accepted_at=now()`, `updated_at=now()` WHERE id=? AND status='pending_onboarding' AND tos_accepted_at IS NULL.
6. Redirects to `/today`.

**Screenshot to capture: launch-1-loading.png** (the brief "Launching…" state if you can grab it).

### 4.9 `/today` first-reading waiting state (Gap F.1)

- Headline: **"Beacon is preparing your first AI visibility reading."**
- Subtitle: "Your first dashboard will appear after the next daily reading. We'll start tracking how AI search engines describe your business tomorrow morning."
- "What's already set up" panel: business + website + prompts tracked (count) + next reading: "tomorrow morning".
- "What happens next" 3-step list.
- CTAs: "Review tracked prompts" → /prompts; "Recommendations (available after first reading)" → /recommendations (de-emphasized).

**Things to verify:**
- The "What's already set up" panel shows the friend's real business name + website + correct prompt count.
- ZERO scary/internal language: no cron, Supabase, GitHub, tenant, schema, poll, 07:00, UTC anywhere.
- "Review tracked prompts" link works → opens /prompts.

**Screenshot to capture: today-1-first-reading.png.**

---

## 5. Operator-side DB verification (after each milestone)

Run these in Supabase SQL editor (or via MCP) at each milestone. Replace `<friend-email>` with their actual email.

### 5.1 After signup magic-link click (auth-callback completed)

```sql
SELECT id, slug, business_name, status, role, daily_budget_usd,
       tos_accepted_at, created_at
FROM tenants
WHERE id LIKE 'tenant-%'
  AND id <> 'tenant-ritz-founder'
ORDER BY created_at DESC
LIMIT 5;
```

Expected: 1 row. `business_name` is the auto-derived placeholder ("Acme Builders" if email is `joe@acme-builders.com`, else "New Beacon Account"). `status='pending_onboarding'`. `role='beta_customer'`. `daily_budget_usd=5`. `tos_accepted_at=NULL`.

```sql
SELECT user_id, tenant_id, role, created_at
FROM tenant_members
WHERE tenant_id = '<the new tenant id>';
```

Expected: 1 row. `role='owner'`.

### 5.2 After Step 1 (business profile saved)

```sql
SELECT business_name, domain, updated_at
FROM tenants
WHERE id = '<new tenant id>';
```

Expected: real `business_name` + normalized `domain` from the form. `updated_at` advanced.

### 5.3 After Step 2 (scope saved)

```sql
SELECT cities_served, project_mix, updated_at
FROM tenants
WHERE id = '<new tenant id>';
```

Expected: arrays populated. Cities are title-cased + deduped. `project_mix` contains valid `ProjectMixTag` values only.

### 5.4 After Step 3 (competitors saved)

```sql
SELECT discovered_competitors, updated_at
FROM tenants
WHERE id = '<new tenant id>';
```

Expected: array of 1-5 names.

### 5.5 After Launch (Gap C.4 fired)

```sql
SELECT id, slug, business_name, status, tos_accepted_at, updated_at
FROM tenants
WHERE id = '<new tenant id>';
```

Expected: `status='active'`, `tos_accepted_at` is a recent timestamp.

```sql
SELECT id, account_id, text, location_scope, service_scope,
       intent_type, platforms, tags, is_active
FROM tracked_prompts
WHERE account_id = '<new tenant slug>'
ORDER BY tags;
```

Expected: 1-25 rows. All `is_active=true`. `account_id` matches the new tenant's slug. Tags include `starter_v0` + a cluster name + `priority-N`. `intent_type='recommendation'`. `platforms=['perplexity','chatgpt']`.

### 5.6 Confirm cron will pick them up

```sql
SELECT id, slug, business_name, status
FROM tenants
WHERE status = 'active'
ORDER BY created_at DESC;
```

Expected: 2 rows now — Ritz + the new test tenant.

The next 07:00 UTC scheduled run of `daily-native-poll.yml` will include the new tenant in its matrix.

---

## 6. Tomorrow morning (after the first cron)

### 6.1 Confirm the cron job ran

GitHub → Actions → "Daily native poll" → most recent scheduled run.
- Should be green.
- Matrix expanded to **2 tenants** (Ritz + the new one).
- Both Perplexity + ChatGPT chunks completed for the new tenant.

### 6.2 Confirm observations landed

```sql
SELECT COUNT(*) AS observations
FROM prompt_answer_observations
WHERE tenant_id = '<new tenant id>';
```

Expected: equal to (number of prompts) × (number of platforms polled) — typically 2× the prompt count if both Perplexity and ChatGPT ran.

### 6.3 Confirm /today now shows the regular dashboard

The friend reloads `/today`. Expected:
- The waiting card is **gone**.
- The regular dashboard renders: visibility chart, leaderboard, "DO THIS RIGHT NOW" card (or empty state for now), enrichment, etc.
- Some sections may be sparse on day 1 (only one day's data) — that's normal.

**Screenshot to capture: today-2-first-real-reading.png.**

### 6.4 Confirm Ritz still rendering normally

Open `/today` while logged in as the Ritz operator (or use BEACON_TENANT_ID=tenant-ritz-founder in a local checkout). Expected: identical to pre-Gap-F.1 — visibility chart populated, lifecycle strip non-empty, etc. No regression.

---

## 7. Reset / rollback

### 7.1 Preferred: `scripts/reset-test-tenant.ts` (after the friend test ends)

```bash
# Make sure .env.local has NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
source .env.local

# Step 1 — dry-run first to see what will be deleted
npx tsx --require ./scripts/mock-server-only.cjs \
  scripts/reset-test-tenant.ts --slug=<friend-slug>
# Expected output: "Reset plan ... DRY RUN. Re-run with --confirm to execute."

# Step 2 — execute
npx tsx --require ./scripts/mock-server-only.cjs \
  scripts/reset-test-tenant.ts --slug=<friend-slug> --confirm
# Expected output: "✓ Deleted N tracked_prompts rows. ✓ Deleted 1 tenant_members rows. ✓ Deleted tenants row id=..."
```

**Safety guards (the script REFUSES to run if):**
- `--slug` not provided.
- Slug matches `/ritz/i` or starts with `tenant-ritz-`.
- Tenant status is `paused` or `cancelled` (operator-set; manual SQL only).
- Tenant has more than 100 `prompt_answer_observations` (looks like a real customer).
- Required Supabase env vars not set.

**What the script does NOT touch:**
- `prompt_answer_observations` (kept; manual cleanup only).
- `daily_metric_snapshots`, `recommended_edits`, `changelog_entries`, `tracked_entities`.
- `auth.users` (clean up via Supabase Dashboard → Auth → Users if needed).

### 7.2 Manual SQL fallback (if the script refuses or there are observations)

```sql
-- Replace <slug> and <id> with the test tenant's values.
-- Pin the WHERE clause to the test tenant — never copy-paste without verifying.

-- 1. Delete prompts
DELETE FROM tracked_prompts WHERE account_id = '<slug>';

-- 2. Delete observations + snapshots (only if at least one cron ran)
DELETE FROM prompt_answer_observations WHERE tenant_id = '<id>';
DELETE FROM daily_metric_snapshots WHERE tenant_id = '<id>';

-- 3. Delete tenant_members (membership)
DELETE FROM tenant_members WHERE tenant_id = '<id>';

-- 4. Delete the tenant row itself
DELETE FROM tenants WHERE id = '<id>';

-- 5. Verify Ritz unaffected
SELECT slug, COUNT(*) FROM tracked_prompts GROUP BY slug;
-- Expected: only ritz-builders should have prompts after step 1.

-- 6. Clean up the auth user manually via Supabase Dashboard → Auth → Users.
```

### 7.3 Mid-test recovery (if the friend's flow breaks)

If the friend reports an error mid-flow, do NOT panic-reset. First diagnose:

1. Ask them to screenshot the error.
2. Check `/signup?error=...` URL params for a structured `provisioning_<phase>` error.
3. Check Supabase logs for the user's auth.users row + tenant row state.
4. If the issue is recoverable (e.g., they hit `provisioning_member_insert` once, retry will heal the orphan), ask them to click the magic link again — Gap B's provisioner is idempotent.
5. If the issue is unrecoverable (e.g., they used an email that already exists with stale state), reset their tenant via Section 7.1, then have them retry with a fresh email.

---

## 8. Failure modes to watch for

| Symptom | Likely cause | Recovery |
|---|---|---|
| Friend doesn't get magic link in email | Supabase email config; or rate-limited; or wrong email | Ask them to check spam. Ask them to click "Send link" again — Supabase rate-limits at ~once/min. |
| Magic link 404s after click | Vercel deploy stale; missing `NEXT_PUBLIC_SUPABASE_URL` | Section 1.1 + 1.4. |
| `/signup?error=provisioning_lookup` | Supabase RLS policy or service role key issue | Section 1.4 — verify SUPABASE_SERVICE_ROLE_KEY. |
| `/signup?error=provisioning_tenant_insert` | DB constraint failure (e.g., status enum drift) | Check Supabase logs. Verify `tenants_status_check` constraint allows `pending_onboarding`. |
| `/signup?error=provisioning_member_insert` | First write succeeded, second failed | Have friend click magic link AGAIN — provisioner is idempotent and will heal the orphan. |
| Wizard step crashes on submit | Form validation rejected the input | Friend's screenshot will show the field error. Common: domain like `localhost` (no TLD), business name > 80 chars. |
| Launch shows "Something went wrong launching" | `tenant_activation_failed` (DB connection blip) | Friend retries Launch — action's dedup catches the prior partial insert + retries the status flip. |
| `/today` shows blank instead of waiting card | Detector returned `isFirstReading: false` for an active+0-obs tenant | Verify with `npx vitest run src/domains/onboarding/first-reading-state.test.ts` — should be 20/20 green. Check tenant.business_name isn't crashing the renderer. |
| Tomorrow morning, no observations | Cron didn't pick them up (lister bug, or Ritz-only matrix); or polling failed | Section 1.2 — check the cron run. Re-run via `workflow_dispatch` if needed. |

---

## 9. What to capture for the post-test review

Folder structure: `.data/_friend-test/<friend-slug>/<date>/`

- All screenshots from Section 4 (8 files: signup-1, signup-2, signup-3, onboard-1-empty/filled, onboard-2-empty/filled, onboard-3-empty/filled, onboard-4, today-1-first-reading, today-2-first-real-reading).
- Friend's verbatim feedback (DM thread copy-paste OR a 1-page transcript).
- Time-on-task per step (rough: how long from signup click to Launch click).
- Any errors observed (URL + screenshot).
- The friend's final dashboard rendering tomorrow (today-2).

After cleanup (Section 7), keep the test artifact folder. It's the source of truth for "is the wizard working today?"

---

## 10. Decision: send the link or hold?

**Send the link if all of the following are true:**

- [ ] Section 1.1: latest commit deployed to Vercel.
- [ ] Section 1.2: last 2 cron runs green.
- [ ] Section 1.3: Ritz integrity green.
- [ ] Section 1.4: all 5 Vercel env vars set.
- [ ] Section 1.5: all 6 GitHub secrets set.
- [ ] Section 1.6: only Ritz is `status='active'`.
- [ ] Section 1.7: no orphan `pending_onboarding` tenants.
- [ ] Section 2: `/signup` loads cleanly in incognito.

**Hold if any are false.** Each unchecked item is a known way the friend test fails.

---

## 11. After the friend test — what to do with what you learned

- If the wizard worked end-to-end without intervention: ship to a second friend, then a third, before announcing.
- If a copy or UX rough edge appeared: capture in `docs/IDEAS_PARKING_LOT.md` with a Honest Claude Take + status, then schedule a polish pass (Fast tier).
- If a real bug surfaced: open a GitHub issue, prioritize, and re-test with the same friend OR a fresh one after the fix.
- If the friend's first reading on day 2 looked sparse / confusing: that's Gap F.2 territory (immediate-poll trigger) or a UX polish on the day-1 dashboard. Capture the evidence; don't ship F.2 reactively.

---

## 12. Hard nos during a friend test

- **Do not** click Launch on their behalf — the contract is "they self-serve."
- **Do not** edit their `tenants` row mid-flow to "fix" something — break the test, capture it, fix the code path.
- **Do not** trigger an out-of-band poll for them (no `workflow_dispatch` mid-day for one tenant). Wait for the natural 07:00 UTC.
- **Do not** delete their data without telling them — coordinate the reset.
- **Do not** add a second friend's signup before the first friend's test is fully wrapped up. Two concurrent test tenants double the failure-mode surface.

---

**Ready to send.** When sections 1 + 2 + 10's checklist all green, paste the message from Section 3 into a DM and watch.
