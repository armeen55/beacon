# Beacon — Golden Path Setup

> **Goal:** connect your data sources and use Beacon forever, with no crons. Everything refreshes on demand
> from an ordinary signed-in visit. This is the single source of truth for that loop. Ceiling: 120 lines.

## The whole loop

1. **One-time:** set the env vars below in Vercel.
2. **Connect** your sources on `/settings/connectors` (the Connections surface).
3. **Use it.** Open Today, Changes, Results. A normal signed-in visit schedules a bounded, once-per-day
   background refresh that pulls fresh evidence and re-ranks your changes. No cron, no manual "refresh" ritual.
4. **Ship changes manually.** Beacon prepares exact copy; you apply it in your CMS and mark it implemented.
   Beacon then measures the lift over 7/14/28 days on Results.

## One-time env setup (Vercel → Project → Settings → Environment Variables)

> Claude cannot read or write your hosted env vars — you set these once. `.env.local.example` carries the
> same list with inline comments.

| Variable | Set to | Why |
|---|---|---|
| `DATA_SOURCE` | `supabase` | Supabase is the production repository (Vercel has no durable disk). |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase creds | Database access. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `BEACON_OAUTH_STATE_SECRET` | OAuth creds | Google Search Console + GA4 OAuth. |
| `OPENAI_API_KEY` | your key | Drafting exact change copy. |
| `NEXT_PUBLIC_APP_URL` | `https://<your-vercel-domain>` | OAuth redirect target. |
| `BEACON_OPERATOR_MODE` | `true` | Single-user operator app. |

## Connect the sources — `/settings/connectors`

Each source is self-serve on one page. Read-only where possible; Wix is the only writer, and only when you
explicitly approve a change.

| Source | You provide | What Beacon does with it |
|---|---|---|
| **Google Search Console** | OAuth | Your real search demand (impressions / clicks / queries / position). The highest-priority signal; it leads every recommendation. |
| **Google Analytics 4** | OAuth + property | Behavior and page-value weighting. |
| **Microsoft Clarity** | API token | Page friction (rage / dead clicks, scroll). Clarity exposes only the last 1–3 days, so it refreshes on each visit to build history without gaps. |
| **DataForSEO** | API key | Keyword volume and SERP evidence (paid; cache- and cap-guarded). |
| **Native AI visibility** | (built in) | How AI assistants mention and cite you. Polled on visit. |
| **Wix** | API key + site ID | Publish target. Reads your live pages so Beacon knows what to change; writes only on your explicit approval. Disconnecting stops all publishing instantly. |

## What is OFF, and why it is safe

- **No crons.** GitHub Actions schedules and the Vercel cron are empty. Refresh happens inside a normal
  signed-in request (bounded, once per tenant per day, cost-capped). Nothing customer-facing depends on or
  infers a cron.
- **No render-time paid calls.** Proposal generation and paid provider reads run in the background refresh,
  never on the page render path.
- **Publishing is never one stray click.** Beacon never edits the live site on its own; a crawl/index
  directive is always held for review.

## Cheat sheet

```
ONE-TIME (Vercel):  DATA_SOURCE=supabase · Supabase creds · Google OAuth creds ·
                    OPENAI_API_KEY · NEXT_PUBLIC_APP_URL · BEACON_OPERATOR_MODE=true
EVERY DAY:          open Today → Changes → Results. A visit refreshes evidence and re-ranks.
SHIP:               apply the exact copy in your CMS → Mark implemented → watch Results.
```
