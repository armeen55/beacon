# Tier 1 — Dogfood week + final checklist log

> **Purpose:** Evidence for **real operator usage** (vault: `master_execution_plan.md` — Tier 1 closes with exit gates **plus** one internal dogfood week without P0 trust regressions).  
> **Not:** automated telemetry, fabricated rows, or AI-invented “usage.”

---

## Who fills this log

**Only the human operator** after **real** daily sessions in Beacon (browser or your normal environment).  
An AI or batch edit **cannot** substitute for 5–7 consecutive calendar days — do not pre-fill rows to “close” Tier 1 without that use.

**Rules (from product owner):**

- If something feels even slightly misleading → log it.  
- Do **not** fix anything mid-week unless it is clearly a **P0** trust issue.  
- Minor clarity issues → log; fix smallest copy/wording **after** the week (or add 1–2 extra days if you had to ship a P0 fix).

---

## Operator: smallest step-by-step (what to do with what you have)

### Do you need to “import all missing dates through last night”?

- **For this dogfood log file:** **No.** Nothing is imported into `TIER_1_DOGFOOD_WEEK_LOG.md` from Beacon. You **type** (or paste) one row per **calendar** day after you use the app.
- **For Beacon itself:** Only if **Today** is empty or useless without data. Then use **Settings → Import** (and/or **Connectors**) so Today / Changes / `/local` have something real to look at — that is **optional** and separate from the log.

### If you already used Beacon on past days but did not log them

- **Do not invent** past digest text to “fill history.”
- **Pick one path:**
  - **A — Fresh streak (simplest):** Start **today** as **Day 1** of a new 5–7 day streak. Fix the **date** in the existing Day 1 block + table row to **today’s real date**, then overwrite the text with what you **actually** do today (see “Every calendar day” below).
  - **B — Honest backfill:** Only add rows for past days you **clearly remember** (what you saw / felt). Leave gaps **out** of the streak — you still need **5–7 consecutive** logged days, so after backfill you continue forward until you have that many **in a row**.

### Before day 1 (once)

1. Open a terminal in the repo folder `beacon/`.
2. Run **`npm install`** if you never have (once).
3. Run **`npm run dev`** and wait until it says the server is ready (usually `http://localhost:3000`).
4. Open **that URL** in your browser (Chrome/Safari/etc.).
5. Open **`docs/TIER_1_DOGFOOD_WEEK_LOG.md`** in your editor **side by side** with the browser (or on a second monitor).

### Every calendar day you want to count toward Tier 1 (repeat 5–7 times in a row)

**Morning (or whenever — same local calendar day):**

1. In the browser, go to **`/`** (Today).
2. Read the **digest** line (or note “no digest line / empty state”).
3. Read **Coverage:** … and any freshness / warning box; click **What this means →** if you want the methodology anchor.
4. Decide: is there a **clear next action**, or **“You’re clear…”**, or something in between? Write **one short phrase** you would quote in the log.
5. Go to **Changes** in the nav.
6. Click tab **Replicate** (or open **one** change from the list that shows replication-style copy).
7. Read one card or block: note **one** concrete thing (e.g. pattern title, “correlates”, evidence details).
8. Go to **`/local`** in the nav.
9. Skim **Listing identity**, **Listing completeness**, **Listing health**, **Data freshness** (Google / Yelp / manual).
10. Note **one** line about NAP or timestamps that stuck out (or “nothing odd”).

**Then in `TIER_1_DOGFOOD_WEEK_LOG.md`:**

11. In the **table**, add **one new row** (or overwrite today’s row if you are correcting Day 1):  
    - **Date:** `YYYY-MM-DD` = **that calendar day** (your laptop date).  
    - **What you did:** e.g. `Today: ✓ digest read · Replicate: ✓ opened tab · /local: ✓`.  
    - **Confusion / misleading / action / verdict:** short, raw — `clean` | `minor issue` | `trust risk`.
12. Below the table, add **one** `## Daily log — YYYY-MM-DD (raw)` section (copy the Day 1 template structure from the existing **2026-04-13** block) and answer sections **1–6** in plain sentences using **only what you literally saw**.

**Mid-week rule**

13. If something feels **P0 trust** (lies, hidden limits, wrong “all clear”): stop, smallest fix in code or copy, log the fix, then add **1–2** extra clean days at the end. Otherwise **do not** “clean up” wording mid-week.

### After you have **5–7 consecutive** days in the table + raw blocks

14. Scroll to **Final Tier 1 note** in this file.
15. Replace the placeholder quote with your real summary (dates + clarity + trust + any fixes).
16. In Cursor, ask: *“Re-verify `docs/TIER_1_DOGFOOD_WEEK_LOG.md` for Tier 1 vault closure and update HANDOFF / NEXT_PHASE / master / VERIFICATION_LOG if criteria pass.”*

That is the full loop. **No step requires importing “dates” into the log** — only **honest daily rows** tied to **real** Beacon use.

---

## Daily routine (follow each day)

### 1) Open **Today**

- Read digest.  
- Check coverage state + freshness.  
- Confirm: clear next **or** true “all clear” (and that it feels appropriate).

### 2) Use **Replication** (at least once)

- Open **Changes** → **Replicate** (and/or open a **change** that surfaces replicate evidence).  
- Evaluate **evidence vs inference**.  
- Decide: act / ignore / unclear — note honestly.

### 3) Open **`/local`**

- Check NAP state, listing health, completeness.  
- Check per-source timestamps (Google / Yelp / manual).  
- Confirm nothing implies real-time or full coverage.

---

## Log — one row per calendar day

Append a new row **after each real day** (5–7 consecutive days before final note).

| Date (local) | What you did (Today / Replicate / /local) | Confusion (even small) | Misleading copy or overconfidence | Action taken (if any) | Verdict |
|--------------|--------------------------------------------|-------------------------|-----------------------------------|------------------------|---------|
| 2026-04-13 | Today: **not opened**. Replicate: **not opened**. /local: **not opened**. | No digest or coverage read — routine not run. | None observed (no UI loaded). | None | **minor issue** |

---

## Daily log — Day 1 — 2026-04-13 (raw)

**DATE:** **2026-04-13** — calendar day when this entry was recorded. *(If you actually used Beacon on a different date, change the date in the heading and in the table row above to match.)*

### 1) TODAY

- **Digest:** **Not read** — the Today page was **not opened** during this session, so there is no literal digest line to quote.
- **“All clear” (if shown):** **Not seen** — Today not loaded.
- **Next action obvious:** **N/A** — Today not loaded.

### 2) REPLICATION

- **Change opened:** **None** — did not open Changes or a change detail for replication review.
- **Evidence grounded vs weak:** **N/A** — no replication UI viewed.
- **Observed vs inferred clear:** **N/A** — no replication UI viewed.

### 3) /LOCAL

- **NAP / listing health / completeness accurate:** **N/A** — `/local` not opened.
- **Timestamps honest (not real-time):** **N/A** — `/local` not opened.
- **Misleading wording:** **None encountered** — no Local UI rendered in this session.

### 4) ISSUES (raw truth)

- **Confused by:** Nothing in-product — **dogfood minimum (Today + Replicate + /local) was not executed** for this calendar day at log-write time.
- **Felt off or misleading:** Nothing observed in UI (no UI).
- **Too smart / overconfident:** Nothing observed in UI (no UI).

### 5) ACTION

- **Actually did:** Nothing in Beacon after this check — no pages were used.
- **Nothing — correct?** **Yes** for “no mistaken product action,” **no** for dogfood discipline — the intended routine was skipped.

### 6) VERDICT

- **minor issue** — **Routine incomplete:** Beacon surfaces were not exercised, so this day **does not** count as dogfood evidence toward Tier 1 closure until you add a day where you **actually** open Today, Replicate, and `/local` and log what you saw.

---

## Verification record (vault Tier 1 closure gate)

| When | Result | Evidence checked |
|------|--------|-------------------|
| **2026-04-14** | **FAILED — Tier 1 not closed** | Log had template only; **2026-04-13** added one **honesty** row (no live session — **not** operator dogfood). Still **no** five to seven consecutive **real** walkthrough days. **Final Tier 1 note** section still has placeholders (`_YYYY-MM-DD_`, `_…_`). **P0 / repeated-pattern review:** N/A — insufficient real operator rows. |

**Conclusion:** Vault **Tier 1 closed** (`master_execution_plan.md`) **must not** be declared until this file contains the required consecutive daily rows + completed **Final Tier 1 note** below.

---

## 2026-04-13 — Static validation pass (engineering; not a substitute for 5–7 operator days)

**Context:** Single-session codebase + copy audit before calendar dogfood completes.

**1.2h (Daily ritual) — reviewed in code + prior UI review**

- `shouldShowTodayAllClear` / `computeTodayDigest` — demo blocks false “all clear”; coverage `critical` / `stale` / `partial` blocks appropriately.  
- Today visibility snapshot — coverage labels and methodology link; no performance framing found.  
- **Change:** none beyond existing product.

**1.3h (Replication) — reviewed in code + strings**

- Changes → Replicate intro and replication cards — correlational / evidence language; “outcomes not guaranteed.”  
- **Change:** typography only — em dash in two replication card strings (`replication-engine.ts`) for clarity.

**Trust / confusion scan**

- No new misleading surfaces identified in this pass.

---

## End of week — Final Tier 1 note (paste only when ALL are true)

- No **P0** trust issues during the logged days.  
- No **repeated** confusion patterns you did not log away.  
- System feels **calm, clear, and honest** on each of those days.

**Then paste below (replace dates and bullets honestly):**

> **Tier 1 closed after operator dogfood validation** (completed _YYYY-MM-DD_ to _YYYY-MM-DD_).  
> **Clarity:** _…_  
> **Trust boundaries:** _…_  
> **Misleading surfaces:** _None during the week_ (or: _minimal fixes on \<date\>: …_).

**After** that note exists with real dates, update **`HANDOFF_VERIFIED_STATE.md`**, **`NEXT_PHASE_EXECUTION_PLAN.md`**, and **`master_execution_plan.md`** (Tier 1 completion criterion) to state **vault Tier 1 closed** — until then, **do not** treat Tier 1 as fully closed for dependencies such as Track 2.1.

---

## If issues were found post-week

- Fix **only** the smallest copy or wording gap; re-run **1–2** extra logged days if needed.  
- Do **not** expand product scope.
