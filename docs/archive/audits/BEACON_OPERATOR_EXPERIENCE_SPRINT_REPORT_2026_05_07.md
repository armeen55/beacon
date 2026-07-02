# Beacon Operator Experience Sprint — Report (2026-05-07)

> **Trigger:** operator feedback that despite 9 commits since the cron fix, /today and /recommendations still felt visually unchanged for Ritz. Backend infrastructure had been compounding; the customer-facing surface had not.
>
> **Outcome:** /today now opens with a Beacon Command Center; /recommendations opens with an Executive Strip; the customer-default verdict labels are softer and more decisive. Ritz mature-render contracts preserved by integrity scripts + architecture invariants.

---

## TL;DR

| Surface | Before | After |
|---|---|---|
| `/today` (Ritz) | 7-tier dashboard. No top-of-page summary. Operator scanned past the alerts strip and hunted for the next move. | New **Beacon Command Center** at the top: 4 cards (Brain readiness · Latest reading · Top movement · Next best action) + tiny operator-only link to `/diagnostics/brain`. Existing 7-tier layout still renders below, untouched. |
| `/today` (new tenant w/ 0 obs) | Gap F.1 first-reading waiting card | Unchanged — F.1 early-return still fires before the Command Center. |
| `/today` (helping_verdict cards) | "Measured win" | **"Measured lift"** |
| `/recommendations` | Toolbar (search + filters + 1-line summary) → table. | New **Executive Strip** above the toolbar: 4 cards (Monitored · Need review · Top opportunity · Evidence strength distribution) + a "Why this order?" inline disclosure. Toolbar + table unchanged below. |
| `/recommendations` derived `needs_review` pill | "Needs review" | **"Needs more evidence"** + tooltip says Beacon doesn't yet have enough evidence to recommend shipping this. |
| `/changes` AttributionStatusPill | "Too early" / "No signal" | **"Still watching"** / **"No movement yet"** |
| `/changes/truth` weak_signal | "Early signs of lift" | **"Early signal"** |

Plus 5 commits earlier (`e37d358`) the friend-test playbook landed. This sprint sits on top of that.

---

## What was built

### UX.1 — Audit (no code; diagnosis only)

Confirmed the operator's "nothing changed visually" feeling was correct: every commit since the cron fix on the morning of 2026-05-07 (`147bd79` → `e37d358`, 9 commits) was either self-serve onboarding scaffolding or friend-test docs. **None touched the Ritz mature-tenant render path.** Gap F.1 only fires when `observationCount === 0` — Ritz has 16,521 → never sees it.

Available data for new surfaces (all read-only, all pre-existing):
- Brain readiness: `.data/_reports/brain-health-*.json` (Grade B, 4 sub-grades, one-line summary).
- AEO manifest: `.data/tenants/ritz-builders/brain/manifest.json`.
- Latest reading: `pollHealth` already in `TodayPageData`.
- Top movement: `urlVerdictProof` already in `TodayPageData`.
- Next best action: `primaryAction` already in `TodayPageData`.

### UX.2 — `/today` Command Center

New top-of-page section above the existing 7-tier dashboard.

**Files added:**
- `src/domains/today/command-center-data.ts` — pure resolver. Reads brain-health + manifest from disk. Fail-soft: any read failure returns null fields → cards render empty states.
- `src/components/today/command-center.tsx` — pure presentation. 4 cards (Brain readiness · Latest reading · Top movement · Next best action) + operator-only `/diagnostics/brain` link.

**Files modified:**
- `src/app/(shell)/today-data.ts` — wires the resolver into `loadTodayPageData()`. Threads `commandCenter` + `commandCenterIsOperator` into `TodayPageData`.
- `src/app/(shell)/today-client.tsx` — accepts the new props with safe defaults; renders `<CommandCenter>` immediately after the demo + first-reading early returns, BEFORE Tier 0 alerts.

**Cards:**
1. **Brain readiness** — letter grade ("B"), one-line summary, 4 sub-section grades (Data / Score / Recommendation / Attribution health), source-observation count.
2. **Latest reading** — last reading date, per-platform pill (Perplexity · ChatGPT) showing Full/Partial/Sample badges with observation counts, "Next: tomorrow morning", refreshed-at timestamp.
3. **Top movement** — biggest +/- delta (color-coded), page path (protocol stripped), linked-change date.
4. **Next best action** — top recommendation headline + rationale + confidence pill + target page + "Open recommendation →" CTA.
5. **Operator-only link** — small `/diagnostics/brain` link rendered when `BEACON_OPERATOR_MODE === "true"`. Customer mode never sees it.

**Tests:** 17 behavioral (`command-center-data.test.ts`) + 20 invariants (`today-command-center-contract.test.ts`).

**Ritz preservation guarantees (pinned):**
- Command Center renders AFTER the demo + first-reading early returns (so Ritz never loses the regular dashboard, and brand-new tenants still see the F.1 waiting card first).
- Existing Tier 0–7 layout (Visibility / DoNext / Lifecycle / Wins / Metrics / Scan) renders below the Command Center, unchanged.
- Render guard requires at least one of `commandCenter.hasAnyData / pollHealth / primaryAction / topMovement` so the section doesn't render an empty container on a brand-new tenant.

### UX.3 — `/recommendations` Executive Strip

New top-of-page summary above the existing Toolbar + ActionTable.

**Files added:**
- `src/components/recommendations/executive-strip.tsx` — pure component + `buildExecutiveStripData()` helper. 4 cards (Monitored · Need review · Top opportunity · Evidence strength) + a "Why this order?" inline disclosure.

**Files modified:**
- `src/app/(shell)/recommendations/recommendations-client.tsx`:
  - Imports + renders `<ExecutiveStrip>` above the Toolbar.
  - Updates `DERIVED_PILL_LABEL.needs_review` from `"Needs review"` → `"Needs more evidence"`.
  - Updates the derived pill's tooltip to mention "shipping" semantics for `needs_review` rows ("Beacon doesn't yet have enough evidence to recommend shipping this").

**Top-pick selection logic (pure helper):**
- Filters out terminal-status rows (shipped / dismissed / deferred / measuring).
- Prefers a strong/moderate row over a higher-ranked needs-review row.
- Falls back to the top needs-review when no strong/moderate exists.
- Returns null on empty input.

**Tests:** 12 behavioral (`executive-strip.test.tsx`) + 12 invariants (`recommendations-executive-strip-contract.test.ts`).

### UX.4 — Customer-safe verdict labels

Three surface-level copy changes plus negative invariants.

**Files modified:**
- `src/components/today/action-card.tsx` — `HELPING_VERDICT_STYLE.label`: `"Measured win"` → `"Measured lift"`.
- `src/app/(shell)/changes/truth/truth-client.tsx` — `VERDICT_LABEL.weak_signal`: `"Early signs of lift"` → `"Early signal"`.
- `src/app/(shell)/changes/attribution-status-pill.tsx`:
  - `STATUS_LABEL.insufficient_post_data`: `"Too early"` → `"Still watching"`.
  - `STATUS_LABEL.zero_signal`: `"No signal"` → `"No movement yet"`.

**Files modified (test sync):**
- `tests/architecture/demo-path-fixes-2026-05-06.test.ts` — pin updated from old `"Early signs of lift"` to new `"Early signal"`.

**What was deliberately NOT changed:**
- The `<WhyThisNumber>` trust-level labels ("Trustworthy" / "Directional" / "Unreliable"). These live behind a `<details>` disclosure (operator-only contract pinned by `tests/architecture/score-provenance-trust-labels.test.ts`). The brief said "do not hide uncertainty by lying" — these honest labels stay.
- All semantic enum values. Only the rendered labels changed; the underlying state machine is identical.

**Tests:** 9 invariants (`ux4-customer-safe-labels-contract.test.ts`).

---

## Before / after route summaries

### `/today` (Ritz mature)

**Before** (top to bottom):
1. Tier 0 — Critical alerts (poll banner, stale-data, scan strip, needs-review link)
2. Since-last-visit delta
3. Tier 1.5 — Visibility chart + leaderboard
4. Tier 1 — Do Next card
5. Tier 2 — Lifecycle strip
6. Tier 3 — Implementation queue
7. Tier 4 — Action queue
8. Tier 5 — Wins
9. Tier 6 — Metrics disclosure
10. Tier 7 — Scan diffs

**After**:
1. **NEW Beacon Command Center** — 4 cards (Brain readiness · Latest reading · Top movement · Next best action) + small operator link
2. Tier 0 — Critical alerts (unchanged)
3. (everything else, unchanged in order or styling)

### `/recommendations`

**Before**:
1. Toolbar — search + filters + 1-line summary + last-refreshed
2. Action table

**After**:
1. **NEW Executive Strip** — 4 cards (Monitored · Need review · Top opportunity · Evidence strength distribution) + "Why this order?" disclosure
2. Toolbar (unchanged)
3. Action table (with `needs_review` pill reframed to "Needs more evidence" + clarified tooltip)

### `/changes`

**Before**: pills said "Too early", "No signal".
**After**: pills say "Still watching", "No movement yet".

### `/changes/truth`

**Before**: weak_signal verdict pill said "Early signs of lift".
**After**: "Early signal".

### Wins on `/today`

**Before**: helping_verdict cards labeled "Measured win".
**After**: "Measured lift".

---

## What now feels visibly different

1. **Open `/today` and you see the Command Center first.** Brain Grade B in 28pt type, the latest reading status with platform pills, the biggest mover with a green/red delta, and the top recommendation with a one-click "Open recommendation →" CTA. Four cards across, executive feel.
2. **`/recommendations` opens with a 4-card answer to "what's the queue's state?"** rather than dumping you straight into the table. Top opportunity surfaces as a deep-link card. Evidence strength is visualized as a small bar (strong / moderate / thin proportions).
3. **The "Why this order?" line under the strip explains ranking without a settings page** — answers "why is this row first?" in a sentence.
4. **`needs_review` rows feel less like errors.** "Needs more evidence" + a tooltip that says "Beacon doesn't yet have enough evidence to recommend shipping this" reframes them as patient-watch rather than broken-rec.
5. **Verdict pills feel less alarmist.** "Still watching" beats "Too early"; "No movement yet" beats "No signal"; "Measured lift" beats "Measured win"; "Early signal" beats "Early signs of lift".

---

## What still feels like old Beacon

1. **Tier 1.5 visibility chart styling** — unchanged. The chart is still the same shape; UX.2 only added a Brain Readiness card above it. A future polish pass could merge the visibility chart into the Command Center if the operator wants a single unified scoreboard.
2. **The Action Table on `/recommendations`** — unchanged. UX.3 added a strip ABOVE it; the table itself still has the same columns + row hierarchy. Per the brief I did not introduce a separate "TOP OPPORTUNITY" callout below the strip — the strip's Top opportunity card already deep-links to the row, which avoided rendering the same content twice.
3. **`/diagnostics/brain` is still operator-only** and the operator-link in the Command Center is intentionally muted. The brief asked for it to "not be loud" — it's a small lowercase footer link.
4. **`/changes` table layout** — unchanged. UX.4 only swapped pill labels; the row structure, columns, and tab navigation are identical.
5. **Drawer / "Why this verdict?" affordances** — still in their existing places. The brief said "make accessible but not dominant" — they already were behind disclosures + drawer panels.

---

## Quality gates (UX.5)

| Gate | Result |
|---|---|
| `npm run typecheck` | CLEAN |
| `npm run test` (6314 tests) | 6314 PASS (+104 vs pre-sprint baseline 6210) |
| Targeted UX (Command Center + Executive Strip + UX.4 labels) | 70/70 PASS |
| `npm run build` | exit 0; all routes ƒ Dynamic |
| `verify-tenant-data-integrity` | PASS — Ritz row counts UNCHANGED (9896/16521/28) |
| `verify-observation-dedup-integrity` | PASS |
| `verify-verdict-rematerialization-integrity` | PASS — drift=0 |
| `npm run verify:brain-health` | YELLOW — 7 PASS / 1 WARN (queue idle, pre-existing) |
| LLM budget SHA `5303c16f04…` | byte-identical |
| Zero OpenAI / paid polling / production data mutations | confirmed |

---

## Next 3 UX upgrades (recommended order)

1. **Visibility chart hero treatment.** The current Tier 1.5 chart is functional but doesn't pop. Consider promoting it into the Command Center as a 5th card, OR enlarging it as the second-tier element below the four-card grid. Operator preference call.
2. **Top opportunity row emphasis on `/recommendations`.** UX.3 added the strip's Top opportunity card with a deep link, but the row in the table itself still looks like every other row. A subtle elevation (border accent + 2px padding bump + a small "Top pick" chip) on the rank-1 row would close the loop visually.
3. **`/today` empty-state composability.** Today the Command Center hides itself when ALL of `commandCenter.hasAnyData / pollHealth / primaryAction / topMovement` are null. For tenants in the awkward in-between state (have observations but the brain-health JSON hasn't been generated yet — possible during the first 24h after Launch), some cards render real data while others show empty states. A pass to make the empty-state copy more cohesive across the four cards would help.

(Out of scope for this sprint per the brief: F.2 immediate-poll trigger, billing, RLS/auth, Profound cleanup, broader refactors, more onboarding.)
