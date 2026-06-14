# Beacon — Golden Path Setup (the 5 PM runbook)

> **Goal:** connect your 5 data sources and use Beacon **forever**, with **no
> nightly crons** (all GitHub Actions schedules + the Vercel cron are removed —
> we're not spending Actions minutes). Everything refreshes **on demand** from
> the operator cockpit. This doc is the single source of truth for that loop.
>
> Created 2026-06-15. Evidence (file:line) is cited inline so this stays
> verifiable, not aspirational.

---

## TL;DR — the whole loop

1. **One-time:** set a handful of env vars in Vercel (below).
2. **Connect** GSC, GA4, Clarity, Profound, Wix on `/settings/connectors`.
3. **Refresh** on `/diagnostics/connectors`: click **Refresh all connected
   sources**, then **Run today's AI reading** (once per platform).
4. **View** on `/today` and `/recommendations`. With the default (legacy)
   surfaces these **generate live from the data you just refreshed** — no extra
   step. That's it.

The optional **fast path** (V2 surfaces) trades one extra "rebuild the queue"
click for instant page loads. See the last section.

---

## 1. One-time env setup (Vercel → Project → Settings → Environment Variables)

> ⚠️ Claude cannot read or write your hosted env vars — **you set these once**.
> `.env.local.example` carries the same list with inline comments.

| Variable | Set to | Why | Read at |
|---|---|---|---|
| `BEACON_OPERATOR_MODE` | `true` | Unlocks the cockpit (`/diagnostics/*`). Single-user app. | `src/lib/operator-mode.ts:49` |
| `BEACON_LLM_PROVIDER` | `openai` | Real LLM recommendation drafts (you authorized LLM). Without it, only 3 of ~37 action types draft. | `src/lib/llm/config.ts:67` |
| `OPENAI_API_KEY` | *your key* | Required by the `openai` provider + AI reading poll. | `src/domains/recommendations/providers/openai.ts` |
| `DATA_SOURCE` | `supabase` | Supabase is canonical in prod (Vercel has no durable disk). | data backend selector |
| `DUAL_WRITE` | `true` | Mirror writes so nothing is lost on Vercel's ephemeral fs. | write path |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | *Supabase creds* | DB access. | repos |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `BEACON_OAUTH_STATE_SECRET` | *OAuth creds* | GSC + GA4 OAuth. | `src/lib/connectors/google-auth.ts` |
| `NEXT_PUBLIC_APP_URL` | `https://<your-vercel-domain>` | OAuth redirect target. | OAuth flow |

**Leave OFF (defaults are correct for the simplest path):**

- `BEACON_RECOMMENDATIONS_V2`, `BEACON_TODAY_V2` — unset ⇒ **legacy live-gen
  surfaces** (generate on every load; zero extra steps).
  `src/app/(shell)/recommendations/page.tsx:55`, `src/app/(shell)/page.tsx:73`.
- `BEACON_PROMOTION_LIVE_WRITE_ENABLED` — only needed for the V2 fast path.
  `src/lib/promotion-live-write.ts:13`.
- `BEACON_CRON_ENABLED` — stays `false`. No scheduler runs anything.

---

## 2. Connect the 5 sources — `/settings/connectors`

Each is self-serve on one page. Read-only where it can be; Wix is the only
writer and only on your explicit Approve & Push.

| Source | What you provide | What Beacon does with it |
|---|---|---|
| **Google Search Console** | OAuth (consent screen) | Your real search demand — impressions/clicks/queries/position. **The highest-priority signal**; it leads every recommendation. |
| **Google Analytics 4** | OAuth + property pick | Behavior/page-value weighting in the priority score. |
| **Microsoft Clarity** | API token | Page friction (rage/dead clicks, scroll). Clarity only exposes the last 1–3 days, so **refresh every couple of days** to build history without gaps. |
| **Profound** | API key | AI-visibility (how assistants mention/cite you). Secondary signal. |
| **Wix** | API key + site ID | Publish target. Used **only** when you click Approve & Push on an edit. Disconnecting stops all publishing instantly. |

(Semrush is also here — optional rank-gap evidence.)

---

## 3. Refresh on demand — `/diagnostics/connectors` (the cockpit)

Crons are off, so this page **is** the refresh button. Two gestures:

- **Refresh all connected sources** → pulls GSC + GA4 + Clarity + Profound +
  Semrush + CallRail into Supabase in one click.
  `refreshAllDataSources()` — `src/app/(shell)/diagnostics/connectors/actions.ts:122`.
  Each connector is independent: a not-connected one is skipped, a failure
  never blocks the others.
- **Run today's AI reading** → polls the AI assistants for your tracked prompts
  (the "how AI describes you" data). One button per platform (Perplexity,
  ChatGPT). `runTodaysReadingForPlatform()` — same file, line 262. A same-day
  repeat is a no-op (UTC-day budget guard), so you can't double-spend.

> Per-connector **Sync now** buttons also exist for GSC/GA4/Profound/Clarity/
> Semrush in `settings/connectors/actions.ts` if you want to refresh just one.

---

## 4. View — `/today` and `/recommendations`

With the **default legacy surfaces**, opening these pages runs the full
pipeline live (build matrix → generate → score → dedupe → safety-gate) against
the data you just refreshed. **No promotion step needed.**
`loadLiveRecommendationQueueForPage` — `src/app/(shell)/recommendations/page.tsx:241`;
live generation on `/today` — `src/app/(shell)/today-data.ts:627`.

Trade-off: live generation is the heavier render (seconds, not instant).
That's the price of zero extra setup.

---

## 5. Optional: the V2 fast path (instant loads, +1 click)

If you'd rather pages load instantly, turn on the V2 surfaces — but then the
queue is **pre-computed**, so you add one rebuild step to the loop:

1. Set `BEACON_RECOMMENDATIONS_V2=true` (and/or `BEACON_TODAY_V2=true`) **and**
   `BEACON_PROMOTION_LIVE_WRITE_ENABLED=true` in Vercel.
2. After refreshing data (step 3), go to **`/diagnostics/recommendation-triggers`**,
   type the confirmation phrase **`PROMOTE`**, and click promote.
   `promoteEligibleCandidatesAction` — `src/app/(shell)/diagnostics/recommendation-triggers/actions.ts:64`.
   This writes the persisted `recommended_edits` rows the V2 surfaces read.
3. `/today` + `/recommendations` now read those rows instantly.
   `loadPersistedRecommendationQueueForPage` — `src/domains/recommendations/load-queue.ts:865`.

The confirmation phrase and the env flag are deliberate guards — the queue is
the customer-facing artifact, so writes are never one stray click away.

---

## 6. What's OFF, and why it's safe

- **GitHub Actions cron schedules** — removed from every workflow YAML
  (`daily-native-poll`, `poll-canary`, `daily-scan`, `morning-digest`,
  `nightly-generation`); `workflow_dispatch` kept so you can still run one by
  hand. No scheduled Actions minutes burn.
- **Vercel cron** — `vercel.json` `crons: []`.
- The on-demand refresh actions are pure HTTP → Supabase, so they run fine
  inside a Vercel serverless request (one AI-reading platform for a ~50-prompt
  tenant runs well under the 300 s cap).

Nothing silently depends on a removed cron: the data refresh and the AI reading
are the cockpit buttons above, and recommendations regenerate on render
(legacy) or on your explicit rebuild (V2).

---

## Cheat sheet

```
ONE-TIME (Vercel):  BEACON_OPERATOR_MODE=true · BEACON_LLM_PROVIDER=openai ·
                    OPENAI_API_KEY=… · DATA_SOURCE=supabase · DUAL_WRITE=true ·
                    Supabase + Google OAuth creds
EVERY REFRESH:      /settings/connectors (connect, once) →
                    /diagnostics/connectors → Refresh all → Run AI reading →
                    open /today + /recommendations
FAST PATH (opt):    + BEACON_RECOMMENDATIONS_V2/TODAY_V2=true +
                    BEACON_PROMOTION_LIVE_WRITE_ENABLED=true, then
                    /diagnostics/recommendation-triggers → type PROMOTE
```
