# /today Complete Touchpoint Audit (Ritz mature tenant)

> **Generated:** 2026-05-07
> **Page audited:** `/` (the /today route, served by `src/app/(shell)/page.tsx` → `today-data.ts` → `today-client.tsx`)
> **Tenant scope:** `tenant-ritz-founder` / `ritz-builders` (mature: 16,521 observations, ~25 prompts, full poll history).
> **Deploy state:** commit `68adb4d` (post-EGRESS-P0 mitigations).
> **Methodology:** end-to-end source read of every component on the render path, cross-referenced against the operator's screenshot description; no simulated browser; no implementation in this pass.

---

## TL;DR — Verdict

**/today today is a polished-looking SCAFFOLD wrapped around a stack of internal widgets.** The new Beacon Command Center looks premium for ~3 seconds, then the eye drops past it into a concatenation of legacy tier strips that read like an operator dashboard, not an executive command center. The single highest-impact bug: **Brain readiness card always shows "Waiting for next reading" on production for Ritz** because its data source (`.data/_reports/brain-health-*.json`) is gitignored and inaccessible from Vercel's filesystem — the card has never worked in prod. The second-highest: **the same scan_findings table is rendered as three different scary numbers (775 page issues, 133 important scan diffs, 7 in the review block)** with three different names, communicating panic instead of a clear next move. The page is **not friend-test ready** in its current state.

---

## 0. Page render order (ground truth)

Every visible band on /today, in source order, with the file that owns it:

```
1.  Beacon Command Center                    src/components/today/command-center.tsx
        — gated by commandCenter.hasAnyData || pollHealth || primaryAction || topMovement
2.  First-run welcome card                   inline in today-client.tsx (line 488)
        — only when no pollHealth, no primaryAction, empty lifecycle (Ritz NEVER hits this)
3.  PollHealthBlock                          src/components/today/poll-health-block.tsx
        — only when ANY platform.status !== "ok"
4.  Stale-data banner                        inline (line 519)
5.  TodayScanStrip                           src/components/today/today-scan-strip.tsx
6.  Needs-review link                        inline (line 543)
7.  SinceLastVisit                           src/components/today/since-last-visit.tsx
8.  AI Visibility hero header                inline (line 588) [UX.5B.1]
9.  VisibilityScoreChart                     src/components/today/visibility-score-chart.tsx
10. VisibilityLeaderboard                    src/components/today/visibility-leaderboard.tsx
11. TodayDoNextCard                          src/components/today/today-do-next-card.tsx
12. TodayLifecycleStrip                      src/components/today/lifecycle-strip.tsx
13. TodayImplementationQueue                 src/components/today/implementation-queue.tsx
14. Action queue header + count              inline (line 653)
15. TodayActionQueue (or MorningBrief fallback)  src/components/today/today-action-queue.tsx
        — contains the "775 page issues — N urgent · See on Pages →" strip
16. Wins to learn from                       inline (line 692) wrapping ActionCard
17. Latest signal proof line                 inline (line 717)
18. TodayMetricsDisclosure                   src/components/today/today-metrics-disclosure.tsx (collapsed)
        wraps EnrichmentV2 + PromptsTeaser
19. ChangeReview ("Scan diffs to review")    src/components/today/change-review.tsx (collapsed accordion)
```

19 distinct visible bands. That is at least 7 too many for a "command center."

---

## 1. Page-level narrative

### What is the page trying to tell me in the first 5 seconds?

Operator's eye lands on:
1. "Brain readiness · Waiting for next reading." (broken — see §3)
2. "Latest reading · Perplexity / ChatGPT pills"
3. "Top movement · ↑X% page Y"
4. "Next best action · headline + Open recommendation →"

This is a coherent executive frame. Then the eye drops past it and immediately sees:

5. A poll-health alert if the day's poll hasn't run yet (alarming).
6. AI Visibility chart (the actual product heartbeat, but visually demoted under all the alerts).
7. A "Do next: 133 important scan diffs · 775 total diffs" row (operator-language, bordering on internal).
8. A repetition of the next best action in the action queue.
9. "775 page issues — N urgent · See on Pages →" (different label, same data).
10. The same recommendation appears for the THIRD time as a card.

**By second 5, the page has communicated: "Beacon's brain is broken (waiting), there are 775 of something wrong, and here's a recommendation we can't decide whether to elevate three times or once."** That is not a premium command-center experience.

### Hierarchy

Wrong on three axes:
- **Quantity of bands** — 19. The eye treats this as 19 demands.
- **Repetition** — top recommendation appears 3× (Command Center → Do Next → Action Queue) without a visual link between the three.
- **Loud-when-quiet** — counts like "775" and "133" earn the most visual weight even though they are aggregate noise, not directives.

### Does it answer "what happened, why it matters, what should I do next"?

Partially. The Command Center attempts the right framing, but each card answers ~30% of the question and the answers don't compose. The Do-Next card answers "what should I do" twice (once via topPick, once via scan-diff escalation) and they often disagree.

### Premium feel? **No.**
### Trustworthy feel? **Compromised by the broken Brain card.** Operator who notices "Waiting for next reading" on a tenant that's been running 60+ days will lose trust immediately.
### Too internal? **Yes** — 775/133/7 numerics, "scan diffs," "implementation queue," "lifecycle strip" are all developer vocabulary.
### Too long? **Yes, by ~50%.** Probably 8-10 bands max for an executive surface.

---

## 2. Above-the-fold audit

### 2.1 Beacon Command Center title + "Today at a glance"

| Field | Value |
|---|---|
| Visible copy | "Beacon Command Center" / "Today at a glance" |
| Source | `src/components/today/command-center.tsx:54-66` |
| Click targets | None on header itself; link "internal: brain diagnostics →" rendered at bottom only when operator |
| Hidden states | None |
| Empty states | Whole section hides when all 4 inputs are null |
| Loading | None (server-rendered) |
| Error | None (failures resolve to empty cards) |
| Logical correctness for Ritz | ✅ |
| Customer-safe | ✅ |
| Should | **Stay** but tighten "Today at a glance" — too generic. |
| Read cost | 0 Supabase (resolver only reads disk JSON for brain + manifest) |
| **Severity** | LOW |
| Fix | Optional: subtitle to "Today's read on AI visibility · {date}" so the header carries information density. |

### 2.2 Brain readiness card

| Field | Value |
|---|---|
| Visible copy | "Brain readiness" / "Waiting for next reading." / "Beacon scores its own brain after enough readings stack up." |
| Source | `src/components/today/command-center.tsx:97-138` reads `brain` from resolver |
| Data source | `.data/_reports/brain-health-*.json` (newest by filename) — read by `loadBrain()` in `command-center-data.ts:97` |
| Click targets | Operator-only "internal: brain diagnostics →" footer link |
| Empty state | "Waiting for next reading." — **what Ritz is currently seeing in production** |
| Logical correctness for Ritz | ❌ **WRONG** — Ritz has Grade B brain readiness on disk locally, but the prod card shows the empty state |
| Customer-safe | ✅ in copy, but factually misleading |
| Should | **Stay** + fix the data-source bug |
| Read cost | 0 Supabase, ~1 KB disk JSON read (when reachable) |
| **Severity** | **HIGH** — premium-feel killer; operator-trust killer |
| Fix | **Move source from disk JSON to Supabase, OR ship the brain-health report as a build-time artifact, OR provide a "brain not yet generated" state that's distinct from "Waiting for next reading."** Detail in §3.1. |

### 2.3 Latest reading card

| Field | Value |
|---|---|
| Visible copy | "Latest reading" / `Last read May X.` / per-platform pills (Full · N obs / Partial · N / Sample · N / Retry pending / Pending) / `Next: tomorrow morning` |
| Source | `src/components/today/command-center.tsx:142-200` reads `pollHealth` from `today-data.ts` |
| Data source | `loadPollHealth(...)` → Supabase `observation_runs` filtered to today's date |
| Click targets | None (display only) |
| Empty state | "Waiting for next reading. Your first dashboard lands tomorrow morning." |
| Logical correctness for Ritz | ✅ when poll has run; ⚠️ when intra-day (operator's screenshot showed "not yet run") |
| Customer-safe | ✅ |
| Should | **Stay** but consider: when both platforms are pending and time is < scheduled-reading-time, label as "Next reading scheduled" not "Waiting" |
| Read cost | tiny — observation_runs filtered by date |
| **Severity** | MED — copy is technically accurate but reads as "we have no data" when it should read as "today's reading hasn't fired yet, here's yesterday's" |
| Fix | When all platforms are status=pending AND today's date hasn't reached the scheduled cron time (07:00 UTC), surface yesterday's reading + "Next: 07:00 UTC tomorrow" instead of today's "Waiting." Mention "yesterday" instead of "today." |

### 2.4 Top movement card

| Field | Value |
|---|---|
| Visible copy | 24pt color-coded delta · "rising / falling citations" · `Page: <path>` · `Linked to a change shipped <date>` |
| Source | `src/components/today/command-center.tsx:204-237` reads `topMovement` from urlVerdictProof |
| Data source | `urlVerdictProof` resolved in `today-data.ts:2396+` from `topHelpingUrls[0]` (Z-score engine output) |
| Click targets | None (no link to /changes for the change date) |
| Empty state | "Watching for movement. We'll spotlight your biggest mover once a few days of readings stack up." |
| Logical correctness for Ritz | ✅ when a top helping URL exists in the Z-score engine output |
| Customer-safe | ✅ |
| Should | **Stay** + add a click target to the linked change |
| Read cost | derived from already-loaded url-change-outcomes |
| **Severity** | MED |
| Fix | (a) Make the page-path + change-date a deep-link to `/changes#change-<id>`. (b) When biggest mover is NEGATIVE, consider whether to suppress (it shouldn't be the headline if the news is bad — show top POSITIVE mover or "Watching" instead). |

### 2.5 Next best action card

| Field | Value |
|---|---|
| Visible copy | headline · rationale (3 lines) · confidence pill ("Strong/Moderate/Light evidence") · target page · "Open recommendation →" CTA |
| Source | `src/components/today/command-center.tsx:241-275` reads `primaryAction` from `today-data.ts` |
| Data source | `primaryAction` from `pickPrimaryAction(...)` — same source as the Action Queue's primary card |
| Click targets | "Open recommendation →" → `action.href` (typically `/recommendations#rec-<id>`) |
| Empty state | "No action queued yet. Beacon will surface one as new readings come in." |
| Logical correctness for Ritz | ✅ |
| Customer-safe | ✅ |
| Should | **Stay** but resolve the duplication — see §8. |
| Read cost | derived from already-loaded recommendation queue |
| **Severity** | MED — duplication with Action Queue is the real problem |
| Fix | Reframe as the SINGLE source of truth: kill the standalone Action Queue card on /today (move it to /recommendations); Command Center's Next-best-action card becomes the only action surface on this page. |

### 2.6 Poll health strip (PollHealthBlock)

| Field | Value |
|---|---|
| Visible copy | (operator's screenshot) "Poll (May 8): not yet run" / "Perplexity pending" / "ChatGPT pending" / "AI tracking has not run yet today..." |
| Source | `src/components/today/poll-health-block.tsx` |
| Render gate | Only when ANY platform.status !== "ok" — so a healthy day is silent |
| Data source | `pollHealth` from `loadPollHealth(...)` |
| Click targets | None |
| Logical correctness for Ritz | ⚠️ — fires while waiting for the day's scheduled poll, even though that's normal |
| Customer-safe | ⚠️ "AI tracking has not run yet today" reads as a fault, not a schedule |
| Should | **Hide-by-default until past scheduled time** + fold into Latest Reading card |
| **Severity** | **HIGH** — duplicates the Latest Reading card and surfaces an alarming "not yet run" message that's actually normal scheduling |
| Fix | (1) Suppress this strip entirely for the window between midnight UTC and 07:00 UTC + 1h grace (i.e., 0-8 UTC). (2) When it does fire, copy should be "Today's reading was incomplete: Perplexity OK · ChatGPT failed → retry scheduled" rather than "AI tracking has not run yet today." (3) Long-term: kill the standalone strip and merge its signal into the Latest Reading Command Center card. |

### 2.7 AI Visibility header (UX.5B.1)

| Field | Value |
|---|---|
| Visible copy | "AI Visibility" / "How often Ritz Custom Builders appears across tracked AI answers." |
| Source | inline in today-client.tsx:588-601 |
| Should | **Stay**; copy is good. |
| **Severity** | LOW |

### 2.8 VisibilityScoreChart

| Field | Value |
|---|---|
| Visible copy | tabs (7d/14d/30d/60d × Overall/Mentions/Citations) · score number · delta · "Why this number?" · chart · sampled-day footer |
| Source | `src/components/today/visibility-score-chart.tsx` |
| Data source | `visibilityData.brandSeriesByMetric` + `chartEvents` from `today-data.ts` (computed from `prompt_answer_observations` + `daily_metric_snapshots`) |
| Click targets | tab buttons, "Why this number?" disclosure, hover tooltip on chart points, optional checkboxes (Compare competitors / Split by platform) |
| Logical correctness | ✅ math; ⚠️ delta interpretation (see below) |
| Should | **Stay; promote to true hero** — see §5 |
| Read cost | observations + snapshots already loaded for the page |
| **Severity** | MED |
| Fix | Move ABOVE the Command Center as the page's literal centerpiece (operator brief: "Should this become the real hero?" — yes). |

### 2.9 VisibilityLeaderboard

| Field | Value |
|---|---|
| Visible copy | rows of competitor names + score + delta · column header "Visibility score rank" |
| Source | `src/components/today/visibility-leaderboard.tsx` |
| Data source | `visibilityData.leaderboardByMetricAndWindow.composite[window]` |
| Logical correctness | ⚠️ — Houzz appears in the leaderboard (it's a directory, not a competitor) |
| Customer-safe | ⚠️ "Visibility score rank" is jargony; Houzz contamination is operator-confusing |
| Should | **Stay** + entity-pollution fix + rename column |
| **Severity** | HIGH (Houzz issue is on the master plan but not yet shipped) |
| Fix | (a) Filter Houzz / Yelp / Angi-shaped directory entities out of the leaderboard at the data layer (pinned in master plan §5.4). (b) Rename "Visibility score rank" → "How AI ranks builders this week." |

---

## 3. Command Center deep audit

### 3.1 Brain readiness — root cause investigation

**The bug:** the BrainStatusCard renders the empty state ("Waiting for next reading.") on Ritz in production, even though Ritz has a Grade B brain readiness report on the operator's local machine.

**Investigation:**

```ts
// src/domains/today/command-center-data.ts:82-96
function findLatestBrainHealthReport(): string | null {
  const reportsDir = join(REPO_ROOT, ".data", "_reports");
  try {
    if (!existsSync(reportsDir)) return null;
    // ...
  } catch {
    return null;
  }
}
```

```
# .gitignore (line 6)
.data
```

**Conclusion:** `.data/` is gitignored → the brain-health JSON is NEVER bundled with the Vercel deploy → `existsSync(reportsDir)` returns false in production → `findLatestBrainHealthReport()` returns null → `loadBrain()` returns null → `commandCenter.brain` is null in `TodayPageData` → BrainStatusCard's `if (!brain)` early-return fires → "Waiting for next reading." is displayed for every operator on production.

The card has never worked on production for ANY tenant. It only works in local dev where `.data/_reports/` exists.

The same issue applies to the manifest (Latest reading's "Intelligence index refreshed X" sub-line) which reads from `.data/tenants/<slug>/brain/manifest.json` — also gitignored.

**Severity:** HIGH. This is the single most damaging trust issue on the page. An operator who knows their brain is healthy will lose confidence in everything else they see when this card lies to them.

**Recommended fixes (in ascending invasiveness):**
1. **Quick fix:** when neither brain nor manifest can be read, render a different copy: "Brain reports are generated by overnight cron — they'll appear here after the next run." (honest about the data plane, doesn't claim "waiting" when actually inaccessible).
2. **Better:** persist brain-health to Supabase as a row (e.g., `brain_health_reports` table with `generated_at`, `tenant_id`, `payload jsonb`); resolver reads from Supabase like everything else; survives Vercel's gitignored `.data`.
3. **Best:** combine (2) with making the brain-health watchdog write a row at the end of every cron run — single source of truth.

### 3.2 Per-card stale/live/derived analysis

| Card | Source | Live? | Stale-risk | Degrades correctly? | Should be operator-only? |
|---|---|---|---|---|---|
| Brain readiness | disk JSON written by watchdog script (overnight) | ❌ on Vercel | always-empty in prod | ❌ | No — but currently broken |
| Latest reading | Supabase `observation_runs` (today) | ✅ | minutes | ✅ | No |
| Top movement | derived from `topHelpingUrls` (computed in today-data) | ✅ | hours | ✅ | No |
| Next best action | derived from `primaryAction` (rec queue) | ✅ | hours | ✅ | No |

### 3.3 Should any card be merged?

- **Latest reading + Top movement** could fold into a single "What we just measured" card with two data points (most-recent reading + its top mover). Saves one card slot.
- **Brain readiness + Latest reading** are conceptually distinct — keep separate.
- **Next best action** belongs on a hero level, not as a peer card — see §8 and §20.

---

## 4. Poll health audit

### Operator's screenshot

> "Poll (May 8): not yet run / Perplexity pending / ChatGPT pending / AI tracking has not run yet today..."

### Why it appears

`today-client.tsx:514` — `<PollHealthBlock>` renders ONLY when `pollHealth.platforms.some(p => p.status !== "ok")`. Pre-7am UTC on a fresh day, both platforms are `status="pending"` → strip fires.

### Is it normal?
**Yes.** Pre-cron on the current UTC day, "not yet run" is the literal truth.

### Is it too alarming?
**Yes.** It uses warning styling (the `PollHealthBlock` component's amber/red variant) for what is normal scheduling. A user seeing this thinks something is broken.

### Should it collapse if yesterday has good data?
**Yes.** The Latest Reading Command Center card already shows yesterday's poll. The standalone strip is a duplicate.

### Should it say "Next reading scheduled"?
**Yes.** Pre-scheduled time, the message should be "Today's AI reading runs overnight — last reading was {yesterday}." Post-scheduled time + still pending, THEN it can sharpen to "Today's reading is late. Investigating."

### Should it be lower on the page?
**Or eliminated.** The Latest Reading card subsumes it.

### Recommendation

**HIGH severity.** Three nested fixes:
1. Time-gate: do not render between 00:00 UTC and 08:00 UTC (the 1h grace post 07:00 UTC scheduled cron).
2. Copy: never use "AI tracking has not run yet today" — say "Tomorrow's reading hasn't started yet" or surface yesterday's status instead.
3. Long-term: delete the standalone strip; the Latest Reading Command Center card carries the entire signal.

---

## 5. AI Visibility section audit

### 5.1 Title / subtitle (UX.5B.1)
✅ Both good. "AI Visibility" is the right framing word; "How often Ritz Custom Builders appears across tracked AI answers" answers the operator's first question.

### 5.2 Tabs

`7d / 14d / 30d / 60d` × `Overall / Mentions / Citations` — 12 combinations. Operator can split by platform too.

| Question | Answer |
|---|---|
| Does 58.0% and -6.5pt make sense for Ritz? | The math is correct (composite = average per-platform citation rate over the selected window vs prior window). The label is fine. **What's missing**: confidence — is -6.5pt a real change or sampling noise? Today the chart implicitly conveys this via point density but doesn't label it. |
| Does #1 with -2.4pt communicate the right thing? | Mixed. "#1 with -2.4pt" reads "you're in the lead but slipping." That's ACCURATE for Ritz right now. But the leaderboard delta column should clarify "vs prior 7d window" so the operator knows the time scope of -2.4pt. |
| Houzz as a competitor? | ⚠️ **No.** Houzz is a directory site, not a builder. Master plan §5.4 has the entity-pollution-filter fix that solves this. Not yet shipped. |
| Rename "Visibility score rank"? | **Yes.** "How AI ranks builders this week" is operator-friendly. |
| Are deltas scary or useful? | Useful in absolute terms; sometimes scary in tone. A -6.5pt week could be sampling noise — should annotate small-sample windows differently. |
| Chart legible? | Yes for desktop. Mobile readability not yet audited. |
| Sampled-day clarity? | Existing footer copy explains "X out of N polled days have full coverage" — operator-friendly. ✅ |
| Should this become the real hero? | **Yes.** Promote above Command Center cards or merge them. |

### 5.3 Should-be-the-hero recommendation

Promote AI Visibility to the page's literal centerpiece. Today the order is Command Center → AI Visibility. Reverse it OR consume the Command Center's Brain/Latest-reading/Movement cards INTO the AI Visibility section as sub-panels.

---

## 6. Do Next / Scan diffs audit

### Operator's screenshot

> "Do next · review scan diffs / 133 important scan diffs / 775 total diffs waiting / Review scan diffs ↓"
> "Scan diffs to review (7) · View all in Pages"

### Where the numbers come from

| Number | Source | Meaning |
|---|---|---|
| 775 | `findingsData.totalCount` in today-client.tsx:332+ | total `pendingFindings` (i.e., scan_findings rows where `status='pending'`) |
| 133 | `findingsData.importantCount` | subset where `priority='important'` |
| 7 | `<ChangeReview findings={pendingFindings.slice(0, ?)}>` | a capped review queue (typically the top 7 pending) |
| Action queue's "775 page issues" | `findings.totalCount` again — same source as the 775 above | renamed to "page issues" inside the action queue strip |

**All four numbers are the SAME table (scan_findings) viewed four different ways.** Two of them ("scan diffs" and "page issues") use different vocabulary for the same rows.

### Why this is a problem

1. **Three big numbers stacked like a panic dashboard.** "775 total diffs waiting" reads like a bug ticket, not a directive.
2. **Inconsistent vocabulary.** "Scan diffs" → "scan diffs" → "page issues" → "scan diffs" within ~200px of vertical real estate. The operator wonders if these are different things.
3. **Raw counts buried the call to action.** "Review scan diffs ↓" is the only directive; it's small.
4. **Operator-only language leaking.** "Scan diffs" is a developer term.

### Recommendations (HIGH severity)

1. **One name for one thing.** Pick "page issues" (customer-safer) and use it everywhere. Retire "scan diffs" from the customer surface.
2. **Suppress raw counts on /today.** The operator doesn't need to see "775 total diffs waiting" on the home page. A single sentence like "23 page issues need confirmation today" + a deep-link to /pages is enough.
3. **Group into actions.** Each scan finding maps to a specific page + a specific issue type. Group by page on /today: "12 pages have new schema issues since the last scan — review →". That reads as a watchlist, not a backlog.
4. **Operator-mode-only for raw counts.** Surface "775 / 133 / 7" only when `BEACON_OPERATOR_MODE=true`.

This is the second-highest trust killer on the page after Brain readiness.

---

## 7. Lifecycle audit

### Operator's screenshot

> "Lifecycle: 1 live verified / Nothing waiting on you / accepted edits live here until next scan finds them"

### Source

`<TodayLifecycleStrip counts={lifecycleSummary.counts}>` from `lifecycle-strip.tsx`. Counts come from `recommended_edits` reductions in today-data.ts.

### Findings

- "1 live verified" is a single number from a table that has 4 status buckets (live_verified / pending_implementation / needs_review / not_found_after_7d).
- "Nothing waiting on you" is friendly but redundant — the strip exists to display the same info /changes shows.
- "accepted edits live here until next scan finds them" is operator-shaped explanation copy that wouldn't make sense to a non-developer.

### Should this section deserve page real estate?

**Mostly no.** It's a duplicate of /changes. On /today it's a 2-line strip showing "1 live verified" — that's information density of one fact per 80 vertical pixels.

### Recommendation

- **Merge into the Command Center as a fifth tile?** No — it doesn't carry enough signal.
- **Hide when all counts are 0 OR only "live verified" is non-zero**. Currently it always renders if `lifecycleSummary` exists.
- **Keep when "needs review" or "pending implementation" is non-zero** — those ARE actionable.
- **Severity:** MED.

### Implementation Queue (Tier 3)

- Renders top 3 pending implementation edits.
- Useful when there's something to ship; pure noise when there's nothing.
- **Recommendation:** hide the section header + box entirely when `pendingImplementation === 0`. Today it renders even when empty.

---

## 8. Action Queue audit

### What renders

`<TodayActionQueue>` (Tier 4) renders:
- Action queue header + count
- Primary action card: "Biggest win" / headline / expected impact / rationale / Apply / Not now / Dismiss / "Why we suggest this" toggle
- Secondary action(s)
- More actions accordion
- Findings strip ("775 page issues — N urgent · See on Pages →") — see §6 + §9

### The duplication problem

The same `primaryAction` object renders THREE times on /today:
1. As the **Next best action** card in the Command Center (Tier above Tier 1).
2. As the headline of the **Do Next** card (Tier 1) when `topPick` is set.
3. As the **primary action** in the Action Queue (Tier 4).

For a mature tenant with 30 pending recs, these usually all resolve to the same top recommendation, but the picker logic differs slightly across the three (Command Center uses `primaryAction`; Do Next uses `topPick` from the resolved recommendation queue; Action Queue uses `primaryAction` again). Sometimes they disagree, which is even worse.

### Findings

- "Biggest win" pill is loud styling for what may be a marginal moderate-evidence rec.
- "Add schema to /our-partners" (operator's example) — compelling depends entirely on whether the operator believes it'll move the needle. The card SHOULD show before/after evidence; today it shows a 1-2 line rationale.
- Apply / Not now / Dismiss buttons — Apply mutates state via `acceptRecommendation`; Not now / Dismiss are faded which reads as disabled but they DO function.
- "Why we suggest this" toggle — opens an evidence drawer with topic + topic descriptors + competitor citations. This is the most valuable hidden UI on the page.

### Recommendations

1. **Pick one home for the recommendation surface.** Either the Command Center's Next-best-action card OR the Action Queue's primary card — not both. My recommendation: keep the Command Center card (executive surface), kill the Tier-4 Action Queue's primary card on /today, move that depth to /recommendations.
2. **Reframe the disabled-look on Not now / Dismiss.** They're not disabled; they're secondary. Use a different visual idiom (smaller text + outlined button) instead of the faded-disabled look.
3. **"Biggest win" needs a confidence guard.** Render only if derived confidence ≥ Moderate.
4. **Severity:** HIGH for the duplication; MED for the others.

---

## 9. Page issues block audit

### Operator's screenshot

> "775 page issues / See on Pages"

### What are these?

Same `pendingFindings` array as §6's "scan diffs." Different label, same rows.

### Recommendations

- **Severity:** HIGH (consistency with §6 fix).
- Pick "page issues" as the canonical name, retire "scan diffs."
- Cap the headline number — never show "775" as the lead. Show actionable subset only (e.g., "23 critical page issues need confirmation today").
- **Question for the operator: does this section belong on Today at all?** /pages is two clicks away. /today should host directives, not aggregate counters.

---

## 10. Wins to learn from audit

### What renders

```
Wins to learn from               2 measured
[Win card 1]
[Win card 2]
```

Each card has: label · headline · "expected" pill · body · "Replicate this win →" CTA · Acknowledge button · "Why we suggest this" toggle.

### Findings

| Question | Answer |
|---|---|
| Should wins be this low? | Mixed. They're learning material, not directives. Low is fine. But two wins shouldn't be visually weighted like two recommendations. |
| Is "not proof of causation" too weak for default? | Yes. Operators reading "Beacon detected a +X% lift after this change but cannot prove causation" walk away thinking nothing on the page is reliable. The caveat belongs in the drawer. |
| Should "Replicate this win" generate recs or go to related rec? | Today it's an `acknowledge` action that records the operator-acknowledgment. It does NOT generate a follow-up rec. Brief promised "replicate" — implementation is misleading. |
| Cards too tall? | Yes. Each ~120px. Two of them = 240px of "learning" on a /today page that already has 19 bands. |
| Are wins duplicates of latest signal? | Often yes. The "Latest signal" proof line below the wins frequently restates the SAME URL+delta in a different format. |
| Should weak_signal appear here? | Yes — UX.4 already mapped weak_signal to "Early signal." But weak_signal cards SHOULD be visually demoted (not equal-weight to confirmed wins). |
| Old March/April wins aged down? | The win selection logic cap is "last 14 days" by default. Older wins shouldn't appear, but if they do (operator hasn't visited in a week), age-discount the visual prominence. |

### Recommendations

- **Collapse wins into a one-line "X wins this week →" link to /changes?tab=wins** when there are >0 wins.
- **Move "not proof of causation" caveat into the drawer.** Default copy: "Citations on /service-X up 12% after the {change-date} update."
- **Implement true "Replicate this win"**: clicking should pre-fill a recommendation generator with the change's pattern (a follow-up backlog item).
- **Severity:** MED.

---

## 11. Topic + prompt depth audit (TodayMetricsDisclosure)

### What renders (when expanded)

`<EnrichmentV2 data={enrichmentV2} />` renders a 4-section bundle:
1. How AI described you this week — descriptors near brand
2. How AI described {competitor} this week — descriptors near competitor (dropdown)
3. Where AI ranks you — per-platform primary % + sparkline
4. What format wins — "ChatGPT prefers Ranked list (62%)..."

Then `<PromptsTeaser />` renders prompt-by-prompt summaries.

### Findings

| Question | Answer |
|---|---|
| Are descriptors useful enough? | Mixed. Words like "results / search / based" appear in the descriptor cloud — these are stopwords from the source AI answers, not meaningful descriptors of the brand. |
| Stopword cleanup needed? | Yes — see master plan §4.2 for the operator-locked vocabulary expansion. Not yet shipped. |
| Should this section be higher? | Possibly. The "How AI described you" surface is the operator's most-loved view per their feedback ("FUCKING AMAZING"). Hiding it behind a click on /today wastes its impact. |
| Should it feed recommendations? | YES — descriptors should clickthrough to filter /recommendations to "show me recs that target descriptor X." Existing backlog item. |
| Are competitor comparisons useful? | Yes — when stopwords are cleaned. Today the side-by-side comparison can show "results · based · search" for both brand AND competitor, which carries zero comparison signal. |

### Recommendations

- **Promote section 1 (How AI described you) above the metrics disclosure** — make it visible by default, not behind a click.
- **Stopword cleanup** at the descriptor extraction layer (descriptor-window-extractor.ts).
- **Make descriptors clickable** to filter /recommendations.
- **Severity:** MED-HIGH (this is the operator's favorite surface; underserving it is a missed opportunity).

---

## 12. Navigation / click audit

| # | Element | Click action | Mutates? | Drawer? | Safe? | Notes |
|---|---|---|---|---|---|---|
| 1 | Command Center "Open recommendation →" | Navigate to `/recommendations#rec-<id>` | No | No | ✅ | Good — no mutation, simple anchor |
| 2 | "internal: brain diagnostics →" footer link | Navigate to `/diagnostics/brain` | No | No | ✅ operator-only | Tiny, muted; doesn't leak in customer mode |
| 3 | Poll health strip (PollHealthBlock) | None (display only) | No | No | ✅ | But probably should link to /diagnostics/brain when operator |
| 4 | AI Visibility chart tab buttons (7d/14d/30d/60d) | `setVisibilityWindow(N)` | No | No | ✅ | |
| 5 | AI Visibility metric tabs (Overall/Mentions/Citations) | Internal state update | No | No | ✅ | |
| 6 | "Why this number?" (chart) | Toggle disclosure | No | No (inline expand) | ✅ | |
| 7 | "Compare competitors" checkbox | Toggle visibility of competitor lines on chart | No | No | ✅ | |
| 8 | "Split by platform" checkbox | Toggle per-platform line breakdown | No | No | ✅ | |
| 9 | Visibility leaderboard "Why this number?" | Toggle disclosure | No | No | ✅ | |
| 10 | Do Next "Review scan diffs ↓" | Anchor scroll to ChangeReview accordion | No | No | ✅ | Good UX |
| 11 | Lifecycle strip chips | Deep-link to /changes?tab=<status> | No | No | ✅ | |
| 12 | Implementation queue rows | Open /changes#change-<id> | No | No | ✅ | |
| 13 | "Action queue · N to review" header | None (display only) | No | No | ✅ | |
| 14 | Apply (action queue primary) | `acceptRecommendation` server action | **YES** | No | ✅ — has confirmation via "Are you sure?" | |
| 15 | Not now (action queue) | `deferRecommendation` server action | **YES** | No | ✅ | Faded look misleads |
| 16 | Dismiss (action queue) | `dismissRecommendation` server action | **YES** | No | ✅ but irreversible | Faded look misleads |
| 17 | "Why we suggest this" toggle | Open inline evidence drawer | No | Yes | ✅ | Good drawer; under-discovered |
| 18 | "775 page issues — See on Pages →" | Navigate to /pages | No | No | ✅ | |
| 19 | "Replicate this win →" | Navigate to related recommendation | No | No | ✅ | But name is misleading — see §10 |
| 20 | "Acknowledge" (wins) | `acknowledgeMeasuredWin` server action | **YES** | No | ✅ | Mutation but minor |
| 21 | "Latest signal" proof line | Navigate to /changes | No | No | ✅ | |
| 22 | TodayMetricsDisclosure show/hide | Toggle local state + persist to localStorage | No | No | ✅ | |
| 23 | EnrichmentV2 competitor dropdown | Select competitor to compare against | No | No | ✅ | |
| 24 | ChangeReview "Confirm" button | `confirmFindingAsChange` server action | **YES** | No | ⚠️ no preview of what gets created | |
| 25 | ChangeReview "Dismiss" button | `dismissFinding` server action | **YES** (resolveFinding) | No | ✅ | |

### Findings

- **No genuinely unsafe clicks.** All mutations have proper feedback.
- **Disabled-look secondary buttons (15, 16) read wrong.** They're functional but look off.
- **The most-valuable hidden surface (#17 "Why we suggest this") is invisible.** Should be visible by default OR promoted with a clearer affordance.
- **Two surfaces lack click targets that should have them.** Top movement card (#3) and Latest reading card per-platform pill — both should deep-link.

---

## 13. State audit

| Tenant state | What renders today | Correct? |
|---|---|---|
| Mature tenant + full latest poll | All 19 bands render normally | ⚠️ — Brain card lies (§3.1) |
| Mature tenant + before today's poll | PollHealthBlock fires with "not yet run" | ❌ — overly alarming (§4) |
| Mature tenant + partial poll | PollHealthBlock fires with partial badges | ✅ |
| Mature tenant + failed poll | PollHealthBlock + stale-data banner | ✅ |
| **New active tenant + prompts + 0 obs** | Gap F.1 first-reading waiting card; Command Center NEVER renders for them | ✅ (early-return short-circuits) |
| Pending tenant | Should be redirected by middleware/access guard, but if they reach /today: Command Center + everything else, all empty | ⚠️ — no explicit redirect |
| No recommendations | Command Center "No action queued yet" empty state ✅; Tier 4 Action Queue hides | ✅ |
| No scan diffs (no findings) | Findings strip hides; Do Next falls through to "calm" mode | ✅ |
| No wins (last 14d) | Wins section hides | ✅ |
| **No brain report** (current Vercel state) | "Waiting for next reading" forever | ❌ — see §3.1 |
| No page snapshots | Top-pick page-inventory falls through to "no inventory" → topPick null | ✅ |
| Supabase slow/failing | Caught by today-data.ts try/catches; sections degrade to empty/null individually | ✅ — fail-soft works |
| Operator mode on | Renders the tiny "internal: brain diagnostics →" link | ✅ |
| Operator mode off | Suppresses operator link | ✅ |

### Highest concerns

- The "No brain report" state is the production state for every tenant on Vercel. This is essentially the only state today.
- The pending-tenant state is undefined — relies on middleware/access guard.

---

## 14. Data provenance audit

| Section | Source file/table | Read window | Cap | Egress risk | Cached? |
|---|---|---|---|---|---|
| Command Center brain | `.data/_reports/brain-health-*.json` | n/a | n/a | 0 (disk-only) — but unreachable on prod | one-shot per render |
| Command Center manifest | `.data/tenants/<slug>/brain/manifest.json` | n/a | n/a | 0 (disk-only) — same issue | one-shot per render |
| Command Center pollHealth | Supabase `observation_runs` | today | one day | low | one-shot per render |
| Command Center topMovement | Derived from `topHelpingUrls[0]` | uses url-change-outcomes | computed | low | n/a |
| Command Center primaryAction | Derived from rec queue | rec queue is cached upstream | n/a | low | useMemo upstream |
| AI Visibility chart | `prompt_answer_observations` (60d) + `daily_metric_snapshots` (120d) | 60d / 120d | bounded | **MED** post-EGRESS-P0 | per-render |
| AI Visibility leaderboard | derived from chart's data | n/a | n/a | piggy-backs on chart | useMemo |
| Lifecycle / Implementation queue | `recommended_edits` (full table read for tenant) | unbounded | uncapped | LOW (small table) | one-shot |
| Action Queue primary | `primaryAction` from rec queue | n/a | n/a | low | useMemo |
| Findings strip ("775 page issues") | `scan_findings` filtered by status='pending' | unbounded | uncapped — **risk** | LOW today (small) but can grow | one-shot |
| Wins | derived (helping_verdicts within 14d) | 14d | uncapped | LOW | n/a |
| EnrichmentV2 | derived from observations + descriptor windows | uses observations array | n/a | piggy-backs on existing read | computed |
| PromptsTeaser | derived from prompt_answer_observations | uses observations array | n/a | piggy-backs | computed |
| ChangeReview | `pendingFindings` (top N) | n/a | typically 7 | low | already-loaded |
| Page snapshots (used by topPick + general) | Supabase `page_snapshots` | none | LIMIT 500 (post-EGRESS-P0) | LOW post-fix | **NEW: memoized in today-data** |

### Risks remaining post-EGRESS-P0

1. **`recommended_edits` is read full-table** in `buildTodayLifecycleSummary` for the tenant. As tenants accumulate edits, this can grow.
2. **`scan_findings` is read full-table for status='pending'.** Same risk.

---

## 15. Performance / egress audit

### Estimated read sizes per /today render (post-EGRESS-P0)

| Section | Est. payload | Notes |
|---|---|---|
| Command Center brain (when reachable) | ~2 KB | Local disk JSON |
| Command Center manifest | ~5-10 KB | Local disk JSON |
| Poll health (observation_runs today) | ~5 KB | Bounded by date |
| Visibility chart (observations 60d) | ~2-5 MB | Bounded |
| Visibility chart (snapshots 120d) | ~3-6 MB | Bounded |
| Page snapshots (capped 500 + projected) | ~1-3 MB | Memoized — single fetch |
| Recommended_edits (full table) | ~500 KB - 2 MB | Unbounded but small currently |
| Scan findings (status=pending, full) | ~200 KB - 1 MB | Unbounded but small |
| Tracked entities | ~50 KB | Tenant-scoped, small |
| Tracked prompts | ~20 KB | Small |
| Citation evidence index | ~500 KB | Single row JSON |
| **Total per /today render** | **~7-18 MB** | Down from ~150-260 MB pre-EGRESS-P0 |

### Top 5 remaining egress risks

1. **`recommended_edits` full-table read** in lifecycle summary — bound to grow with tenant age.
2. **`scan_findings` pending-status read** — same risk.
3. **`citation_evidence_index` single-row JSON** — large blob; could grow with prompt count × competitors.
4. **Visibility chart `daily_metric_snapshots`** — 120-day window grows linearly with poll history.
5. **Visibility chart `prompt_answer_observations`** — 60-day window grows with prompt count × platforms × days.

### Should anything be lazy-loaded?

- **TodayMetricsDisclosure** is collapsed-by-default but its data is still loaded on first render. Lazy-load EnrichmentV2 + PromptsTeaser data on disclosure-open. Saves ~2 MB per render for operators who never open it.
- **ChangeReview** is a `<details>` accordion — its `pendingFindings` are already loaded server-side. Fine for now; revisit if scan_findings grows.

### Is /today safe after EGRESS-P0?

**Yes, for now.** ~7-18 MB per render × ~20 renders/day per operator = ~150-360 MB/day per operator. Comfortably under the 5 GB Free Plan cap with one operator. Will become tight with customer-2.

---

## 16. Copy audit

### KEEP

- "AI Visibility" + "How often {brand} appears across tracked AI answers"
- "Beacon Command Center" / "Today at a glance"
- Command Center "Open recommendation →" CTA
- "Watching for movement." empty state
- "No action queued yet." empty state
- "Why this number?" disclosure trigger
- "internal: brain diagnostics →" muted operator link

### REWRITE

- **"Waiting for next reading"** → context-aware: "Yesterday's reading: Grade B" when reachable; "Brain reports generated overnight" when unreachable. **NEVER** the bare "Waiting" when the data exists but the disk file is unreachable.
- **"AI tracking has not run yet today"** → "Today's reading runs at 7am UTC. Yesterday's reading: …"
- **"775 page issues" + "133 important scan diffs" + "775 total diffs waiting"** → unify to ONE phrase, ONE number, hidden behind a deep-link.
- **"Lifecycle: 1 live verified"** → "1 edit live this week." Drop the word "lifecycle."
- **"accepted edits live here until next scan finds them"** → operator-shaped explanation; remove from /today, move to /changes intro tooltip.
- **"Biggest win" pill on action queue primary** → only render when derived confidence ≥ Moderate AND expected impact ≥ baseline.
- **"Replicate this win →"** → either implement true replication OR rename to "Note this win" / "View change."

### REMOVE

- The standalone PollHealthBlock when `pollHealth.platforms.every(p => p.status === "pending")` AND time is < 08:00 UTC (normal pre-cron state).
- "Action queue · N to review" header when N ≤ 1 (the Command Center already shows the top action).
- "775 page issues — N urgent · See on Pages →" strip from /today (move to /pages).
- The redundant primary action card in TodayActionQueue when Command Center's Next-best-action is showing the same row.

### MOVE TO PROOF DRAWER / OPERATOR DETAIL

- All raw `criticalCount` / `importantCount` / `totalCount` numerics from the Do-Next card.
- "Beacon detected a +X% lift after this change but cannot prove causation" — move to drawer; default copy is the win itself.
- "(measured per page)" in latest-signal proof line — move to tooltip.
- All `data-rec-*` debug attribute strings (operator-mode-only is correct; verify they're stripped in customer mode).

### Flagged

| Flag | Example |
|---|---|
| Internal language | "scan diffs," "lifecycle," "implementation queue," "action queue," "needs review" (status enum), "verdict" |
| Weak language | "Watching for movement," "No action queued yet" (mostly OK; cohesive empty states) |
| Scary language | "Waiting for next reading" (when actually working), "AI tracking has not run yet today," "775 page issues" |
| Vague labels | "Visibility score rank" (what scope?), "Top movement" (positive only? all?) |
| Inconsistent labels | scan diffs / page issues / pending findings — same data |
| Too much caveating | "(measured per page)" tail on the proof line; "not proof of causation" on win cards |
| Unexplained metrics | "58.0% / -6.5pt" — no definition near the number |

---

## 17. Design / layout audit

| Issue | Severity | Fix |
|---|---|---|
| 19 visible bands stacked vertically | HIGH | Cut to 8-10 |
| Same recommendation rendered 3× (Command Center / Do Next / Action Queue) | HIGH | Kill 2 of 3 |
| Top-of-page hierarchy lacks weight differentiation (everything 14px font) | MED | Use heading scale; AI Visibility headline at 18-20px |
| Wins cards are full-width, ~120px tall, but contain ~30px of usable info | MED | Collapse to one-line summary |
| Lifecycle strip + Implementation queue render even when both are empty/single-row | MED | Hide when ≤1 actionable row |
| Mobile responsive | UNAUDITED | Need a mobile pass |
| Chart legibility at 320px viewport | UNAUDITED | Likely needs a stacked variant |
| Contrast on muted-foreground/40 text on surface-inset/30 backgrounds | LOW | Some text in 11-12px is borderline accessible |
| Cards too tall in Command Center on desktop — they get to ~180px because of `min-h-[180px]` | LOW | Drop the min-height; let content size them |
| Duplicate sections (poll health alerts vs latest reading card) | HIGH | Merge |

---

## 18. Trust / action audit

### Does the page make me trust Beacon?

**Mixed.** The Command Center looks premium for a moment. Then "Brain readiness · Waiting for next reading" lies to me. Then "775 page issues" panics me. Then the same recommendation appears three times in slightly different forms. By scroll-line 600 I'm wondering if Beacon knows what it knows.

### Does it make me want to take action?

**Sort of.** The Command Center's Next-best-action card with its CTA is the clearest call. The Do-Next card competes with it. The Action Queue duplicates it. I end up clicking "Open recommendation →" because it's the most prominent button, but I'm not sure it's the same recommendation as what Do Next is pointing me at.

### Single highest-priority action?

For Ritz today: the top recommendation in the Command Center's Next-best-action card. That should be the ONLY action surface above the fold.

### Does the page over-focus on scan diffs?

**Yes.** Scan-diff counts appear in 3 distinct places (Do Next, Action Queue findings strip, ChangeReview accordion). That's at least 2 too many.

### Does the page under-surface recommendations?

**Yes**, paradoxically. Despite recs appearing 3×, none of them carry the depth that /recommendations does. The Command Center's Next-best-action card shows ~3 lines of rationale; the drawer in the Action Queue would show evidence depth + competitor citations + before/after copy — but the operator has to click "Why we suggest this" to see it.

### Does the page communicate ROI?

**No.** Wins are demoted to a low section and caveated. There's no "since you started using Beacon, X has happened" framing. No counter of "edits shipped this month" or "citations recovered." The win cards don't say "this saved you N hours" or "this would cost $X to discover yourself."

---

## 19. Severity-ranked findings

| ID | Surface | Issue | Severity | Evidence | Fix | Effort | Risk | Dependencies |
|---|---|---|---|---|---|---|---|---|
| F1 | Brain readiness card | Always shows "Waiting for next reading" on Vercel because `.data/_reports/` is gitignored | HIGH | `command-center-data.ts:82-96` + `.gitignore` | Move source from disk to Supabase OR ship JSON as build artifact OR distinguish "unreachable" from "waiting" copy | M | LOW (read-only fix) | None |
| F2 | Scan-diff naming + count duplication | Same `scan_findings` table presented as 4 different numbers with 3 different names ("scan diffs", "page issues", "pending findings") | HIGH | today-do-next-card.tsx + today-action-queue.tsx + change-review.tsx | Pick "page issues" as canonical; cap headline number to actionable subset; remove raw counters from /today | S | LOW | None |
| F3 | PollHealthBlock pre-cron alert | Fires "AI tracking has not run yet today" between midnight UTC and 7am UTC scheduled cron time | HIGH | today-client.tsx:514 + poll-health-block.tsx | Time-gate the strip; reword to "Today's reading runs at 7am UTC" | S | LOW | None |
| F4 | Recommendation duplication (3×) | Same primaryAction renders in Command Center, Do Next, Action Queue with slightly different picker logic | HIGH | today-client.tsx:627-688 | Pick Command Center as the only action surface on /today; demote/remove the other two | M | MED (other two have keyboard nav, secondary actions, etc.) | F2 |
| F5 | AI Visibility hierarchy | The product's core question is buried under Command Center cards | MED | today-client.tsx:578-622 | Promote AI Visibility above Command Center OR fold Command Center brain/movement cards INTO AI Visibility section | M | MED (layout shift) | F1 |
| F6 | Houzz in competitor leaderboard | Directory site treated as a competitor | HIGH | visibility-leaderboard data | Apply entity-pollution-filter (already specified in master plan §5.4) | S | LOW (filter at data layer) | None |
| F7 | Wins section weight | "2 measured" cards with caveat copy take 240px of vertical | MED | today-client.tsx:691-716 | Collapse to one-line "X wins this week →" link; move full cards to /changes?tab=wins | S | LOW | None |
| F8 | "Replicate this win" misleading | Button labels suggest replication but action is just acknowledge | MED | action-card.tsx:308-310 | Either implement true replication OR rename to "Note this win" | S | LOW | None |
| F9 | Disabled-look secondary buttons | Not now / Dismiss are functional but visually faded → look broken | MED | action-card.tsx | Change to outlined-button style (less faded) | XS | LOW | None |
| F10 | Stopwords in descriptors | "results / search / based" appear in How AI Described You | MED | descriptor-window-extractor | Expand stopword vocabulary | S | LOW | None |
| F11 | Empty Lifecycle / Implementation Queue render | Tier 2 + Tier 3 render even when nothing actionable | MED | today-client.tsx:637-647 | Hide when counts are 0 or only `liveVerified > 0` | XS | LOW | None |
| F12 | Mobile responsiveness | Unaudited | UNK | n/a | Mobile pass | M | UNK | None |
| F13 | Top movement card lacks click target | Page path + change date display only | LOW | command-center.tsx:204-237 | Wrap in `<Link href="/changes#change-<id>">` | XS | LOW | None |
| F14 | Latest reading "Next: tomorrow morning" inaccurate when intra-day before cron | Always says tomorrow even at 02:00 UTC when next is "today 07:00" | LOW | command-center.tsx LatestReadingCard | Compute relative time; say "in N hours" | S | LOW | None |
| F15 | "Visibility score rank" label | Jargony header on leaderboard | LOW | visibility-leaderboard.tsx | Rename "How AI ranks builders this week" | XS | LOW | None |
| F16 | Operator-only "internal: brain diagnostics" link | Tiny but renders inside Command Center; could be elevated for operator use | LOW | command-center.tsx | Acceptable as is; consider a dedicated operator strip | XS | LOW | None |
| F17 | TodayMetricsDisclosure is closed-by-default but data is loaded on every render | Egress for data the operator never opens | LOW | today-data.ts loads enrichmentV2 + promptsTeaser unconditionally | Lazy-load on disclosure open | M | MED (changes hydration shape) | None |
| F18 | "(measured per page)" tail on proof line | Honest but reads as caveat | LOW | today-client.tsx:813 | Move to tooltip on the proof line | XS | LOW | None |
| F19 | Wins acknowledge mutates without preview | Single-click mutation, no confirmation | LOW | action-card.tsx | Add confirm-dialog OR undo-toast | S | LOW | None |
| F20 | Wins copy "not proof of causation" too weak | Default-visible caveat undermines trust | MED | win cards | Move caveat to drawer; default copy is the win | XS | LOW | F7 |

---

## 20. Recommended next implementation plan

### Top 5 fixes for immediate UX.6

1. **F1 — Fix Brain readiness card** so it shows real data on production (write brain-health to Supabase row OR ship as build artifact OR fix copy to distinguish unreachable-from-empty).
2. **F3 — Time-gate / suppress the PollHealthBlock pre-cron alert.** Stops the false-alarm "AI tracking has not run yet today" panic.
3. **F4 — Kill recommendation duplication.** Pick the Command Center Next-best-action as the only home; remove from Do Next + Action Queue.
4. **F2 — Unify scan-diff vocabulary** and remove raw counters from /today (move to /pages where they belong).
5. **F6 — Apply entity-pollution-filter to leaderboard** (Houzz issue).

### Top 5 fixes for data/trust

1. **F1** (same — single biggest trust killer).
2. **F2** (same — three numbers for one thing kills trust).
3. **F20 / F7 — Reframe wins copy** to lead with the win, not the caveat.
4. **Add ROI surface** — "since launching: N edits shipped, X% citations recovered" as a Command Center 5th card or AI Visibility annotation.
5. **F15 — Rename "Visibility score rank"** + better delta scope copy.

### Top 5 fixes to defer

1. F12 — Mobile responsive pass (do after the desktop layout is stable).
2. F17 — Lazy-load TodayMetricsDisclosure data (premature optimization until egress shows it matters).
3. F19 — Wins acknowledge confirmation (low frequency action; current state is OK).
4. F16 — Operator strip elevation (works as is).
5. F14 — Latest reading "Next:" relative-time copy (cosmetic; current is OK).

### Exact mini-phase order

**UX.6.1 (Hierarchy + Trust):**
- Fix Brain readiness card (F1).
- Suppress PollHealthBlock pre-cron noise (F3).
- Reframe wins copy (F20).

**UX.6.2 (Vocabulary + Hierarchy):**
- Unify scan-diff naming → "page issues" everywhere (F2).
- Remove raw counters from /today (F2).
- Kill recommendation duplication; Command Center wins (F4).

**UX.6.3 (AI Visibility + Leaderboard):**
- Promote AI Visibility above Command Center OR fold cards in (F5).
- Apply entity-pollution-filter (F6).
- Rename "Visibility score rank" (F15).
- Add deltas-vs-noise annotation.

**UX.6.4 (Cleanup):**
- Hide empty Lifecycle + Implementation Queue (F11).
- Collapse wins to one-line link (F7).
- Replace "Replicate this win" with implemented action OR rename (F8).
- Fix disabled-look secondary buttons (F9).
- Add Top movement click target (F13).

**UX.6.5 (ROI surface):**
- Add a "Since you started" Command Center surface OR AI Visibility annotation showing cumulative wins, edits shipped, citations recovered.
- Add stopword cleanup to descriptors (F10).
- Promote "How AI described you" out from behind the metrics disclosure.

---

## A. Top 10 issues

1. **Brain readiness card always shows "Waiting for next reading" on production for ALL tenants** — broken since launch (F1).
2. **Same recommendation rendered 3× with subtly different picker logic** (Command Center, Do Next, Action Queue) (F4).
3. **Same scan_findings table rendered as 4 different numbers with 3 different names** ("775 page issues", "133 important scan diffs", "775 total diffs waiting", "Scan diffs to review (7)") (F2).
4. **PollHealthBlock fires alarming "AI tracking has not run yet today" between midnight and 7am UTC** when this is normal scheduling (F3).
5. **Houzz appears as a competitor in the leaderboard** (F6).
6. **AI Visibility — the product's core question — is visually demoted below Command Center** (F5).
7. **"Replicate this win" button doesn't actually replicate** (F8).
8. **Wins copy leads with caveats** ("not proof of causation") instead of the win (F20).
9. **"Visibility score rank" + delta scope are jargony / unexplained** (F15).
10. **19 visible bands** — page is at least 7 too long for an executive surface.

## B. Top 10 things already working

1. **Command Center 4-card layout is premium-looking on first glance** — the structural bet is right.
2. **AI Visibility hero header copy** ("How often Ritz Custom Builders appears across tracked AI answers.") is dynamic + customer-safe.
3. **Empty-state vocabulary** ("Waiting for next reading", "Watching for movement", "No action queued yet") is consistent and premium.
4. **Operator-only "internal: brain diagnostics" link** is properly muted and gated — doesn't leak.
5. **"Open recommendation →" CTA** is the clearest action on the page.
6. **TodayMetricsDisclosure** correctly defaults closed and persists state in localStorage.
7. **"Why we suggest this" drawer** carries genuine evidence depth — best hidden surface on the page.
8. **All mutation actions (Apply / Dismiss / Acknowledge / Confirm)** have proper feedback + don't fire unsafe actions.
9. **Fail-soft pattern across today-data.ts** — every section has a try/catch + degrades to empty rather than crashing.
10. **First-reading early-return for new tenants** correctly short-circuits to the Gap F.1 waiting card.

## C. Exact next 3 mini-phases

**UX.6.1 — Trust restoration (estimate: 3-4h)**
- Fix Brain readiness card (F1) — the highest single-issue trust hit.
- Suppress PollHealthBlock pre-cron noise (F3).
- Reframe wins copy: lead with the win, move caveats to drawer (F20).
- Add 1 architecture invariant per fix.
- Quality gates + commit.

**UX.6.2 — Vocabulary + Hierarchy (estimate: 4-5h)**
- Unify scan-diff naming → "page issues" everywhere (F2).
- Remove raw counters (775/133/7) from /today; deep-link to /pages instead.
- Kill duplicated recommendation card in TodayActionQueue + Do Next (F4).
- Hide empty Lifecycle + Implementation Queue (F11).
- Architecture invariants + tests.

**UX.6.3 — Hero promotion (estimate: 4-6h)**
- Promote AI Visibility section above Command Center OR fold Brain/Movement cards into AI Visibility's frame (F5).
- Apply entity-pollution-filter to remove Houzz from leaderboard (F6).
- Rename "Visibility score rank" → "How AI ranks builders this week" (F15).
- Add Top movement click target (F13).
- Architecture invariants + tests.

After UX.6.1-3 (≈12 hours of focused work), /today should feel coherent, premium, and trustworthy enough for a friend test.

## D. Is /today good enough for a friend / customer demo today?

**No.** Three blockers:

1. **The Brain readiness card lies to the operator on every page load.** A non-technical friend signing up can't be expected to know that's a deploy-shape bug. They'll lose trust in everything else they see.
2. **Scan-diff numbers (775/133/7) read as panic.** A friend's first impression: "this product wants me to do 775 things." The actual reality (most of those are auto-detected page issues that don't need operator review) is hidden.
3. **The same recommendation appears 3 times with subtle variations.** A friend will wonder if Beacon is decisive about what they should do.

**Verdict:** /today shows the bones of a premium command center but is not yet ready to convince a non-technical operator that Beacon is reliable. Ship UX.6.1-3 before sending the signup link.

---

## Appendix: Files touched by this audit

| File | Read for |
|---|---|
| src/app/(shell)/page.tsx | Entry point |
| src/app/(shell)/today-data.ts | Data resolver, all `loadX()` calls |
| src/app/(shell)/today-client.tsx | Render order, all section gates |
| src/components/today/command-center.tsx | All 4 Command Center cards + operator link |
| src/domains/today/command-center-data.ts | Brain + manifest resolver — confirmed disk-source bug |
| src/components/today/poll-health-block.tsx | Poll health strip rendering |
| src/components/today/today-do-next-card.tsx | Decision tree for "Do next" + scan-diff counts |
| src/components/today/today-action-queue.tsx | Action queue + findings strip |
| src/components/today/action-card.tsx | Per-recommendation card + Apply/Dismiss/Acknowledge |
| src/components/today/change-review.tsx | ChangeReview accordion (Scan diffs to review) |
| src/components/today/visibility-score-chart.tsx | Chart |
| src/components/today/visibility-leaderboard.tsx | Leaderboard |
| src/components/today/lifecycle-strip.tsx | Tier 2 strip |
| src/components/today/implementation-queue.tsx | Tier 3 queue |
| src/components/today/enrichment-v2.tsx | "How AI described you" 4-section bundle |
| src/components/today/today-findings.tsx | Findings strip helpers |
| src/domains/pages/issues.ts | page_issues source |
| .gitignore | Confirmed `.data/` is gitignored — root cause of F1 |
