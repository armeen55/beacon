# Beacon v2 Rollout — Internal Release Notes

**Date locked:** 2026-05-11
**Production deploy:** `beacon-8rm9bjaqr` aliased to `https://beacon-bice.vercel.app` · `bb8975b` on `main`
**Test baseline:** 7801/7801 across 412 files · 2350/2350 architecture invariants · forbidden-vocab guardrail green
**Branches:** all 4 v2 env flags ON in Vercel Production

---

## What changed from old Beacon → new Beacon

The Beacon customer app was rebuilt from an operator categorization tool into a customer-facing decision loop. Every primary route now answers a customer question first, with the operator-internal details either suppressed or moved behind an opt-in `?legacy=1` view.

### Before (legacy)
- `/` showed 19 stacked sections (Morning Brief, Visibility Hero, Data Freshness Heartbeat, Today Lifecycle Strip, Today Scan Strip, Today Action Queue, Poll Health Block, Top Pick Card, Prompts Teaser, Today Primary Action, Secondary Action, More Actions, Measured Wins, Today Metrics Disclosure, Visibility Score Chart, Visibility Leaderboard, Command Center, Change Review, Live Changes Block, Today Implementation Queue, Today Do Next Card).
- `/recommendations` was a dense table with a per-row drawer and operator-mode debug fields.
- `/changes` was an 11-column table where Attribution Status, Impact Direction, and Z-score Verdict competed for attention; the per-change detail was 8 stacked operator cards.
- `/prompts` rendered raw `change_description` text with prompt UUIDs, "packet" vocabulary, and example URL lists leaking into customer copy.
- Cron times (`07:00, 08:30, 10:00 UTC`), "Z-score engine", "evidence_tier", "lifecycle classification", and other operator vocabulary were visible across the customer surfaces.

### After (v2 default)
- `/` is one hero strip + 3 cards (Do today / Working / Recent wins) + a disclosure for everything else.
- `/recommendations` is a stack of customer-facing cards with one CTA per row; per-rec detail is a 5-act brief with inline accept / defer / dismiss / mark-shipped / restore / promote actions.
- `/changes` is a vertical proof timeline with 3 calendar-free counters (Recent changes / Watching for signal / Needs attention) + a "Waiting for signal" right rail. Per-change detail is a 5-act proof brief.
- `/prompts` is a strategic surface with 5 customer-safe categories (Winning / Almost there / Missing / Outranked / Still learning) + per-platform badges + competitor + cluster chips. Per-prompt detail is a 5-act brief.
- Forbidden-vocabulary architecture guardrail (23 invariants) blocks operator vocabulary from rendering in any customer-facing source file at build time.

---

## Routes rebuilt

| Route | v2 layout marker (data-attr) | v2 default | Legacy escape |
|---|---|---|---|
| `/` | `data-today-layout="v2-bundle1"` | ✅ `BEACON_TODAY_V2=true` | `/?legacy=1` |
| `/recommendations` | `data-recommendations-layout="v2-card-stack"` | ✅ `BEACON_RECOMMENDATIONS_V2=true` | `/recommendations?legacy=1` |
| `/recommendations/[id]` | `data-recommendations-detail-layout="v2-brief"` | ✅ `BEACON_RECOMMENDATIONS_V2=true` | `/recommendations/[id]?legacy=1` |
| `/changes` | `data-changes-layout="v2-proof-timeline"` | ✅ `BEACON_CHANGES_V2=true` | `/changes?legacy=1` |
| `/changes/[id]` | `data-change-detail-layout="v2-proof-brief"` | ✅ `BEACON_CHANGES_V2=true` | `/changes/[id]?legacy=1` |
| `/prompts` | `data-prompts-layout="v2-strategic-surface"` | ✅ `BEACON_PROMPTS_V2=true` | `/prompts?legacy=1` |
| `/prompts/[id]` | `data-prompt-detail-layout="v2-prompt-brief"` | ✅ `BEACON_PROMPTS_V2=true` | `/prompts/[id]?legacy=1` |

One env flag flip per surface area. Detail pages share their parent's flag (`/changes` + `/changes/[id]` both flip on `BEACON_CHANGES_V2`; same for `/prompts`).

---

## Rollback

**Per-request, instant, no deploy:** Append `?legacy=1` to any v2 route URL. Wins over the env flag on every route — pinned by switcher tests on each surface (e.g. `tests/routes/changes-v2-switcher.test.ts`: "?legacy=1 wins over BEACON_CHANGES_V2=true (escape hatch overrides env)").

**System-wide per-surface, ~2 min:** Unset the env flag for the surface in question + redeploy. Example for changes:
```bash
vercel env rm BEACON_CHANGES_V2 production --yes
vercel redeploy https://beacon-bice.vercel.app --target production \
    --scope armeen-5267s-projects
```
Once removed, default routes for that surface fall back to legacy; `?v2=1` continues to work as preview hatch; `?legacy=1` becomes redundant.

Both legacy code paths are fully preserved in source — never deleted. Every v2 client renders alongside its legacy counterpart in the same `page.tsx` file, gated by the switcher.

---

## Automation in place

- **Daily native AI polling** runs via GitHub Actions on a 3x morning schedule. Every poll writes fresh `prompt_answer_observations` rows to Supabase.
- **Vercel cron watchdog** (`/api/cron/poll-watchdog`, fires at `0 11 * * *` daily) detects skipped GH Actions schedules within the trailing 24h window and dispatches the daily-native-poll workflow via the GitHub API. Gated by `CRON_SECRET` (Vercel-injected) + `BEACON_GH_WORKFLOW_DISPATCH_PAT` (fine-grained PAT).
- **Single-tenant auth** via Supabase. Anonymous requests redirect to `/login`. The middleware exact-match-allowlist exposes `/api/poll/run` + `/api/cron/rebuild-citation-evidence-index` + `/api/cron/scan` + `/api/cron/poll-watchdog` for machine-auth callers (each enforces its own bearer-token check).

---

## Intentionally legacy / fallback

- **`/changes/dedupe`** — operator-only flow for resolving CSV+PDF duplicate changelog entries. Not part of the v2 customer loop; deliberately kept as the legacy-style review surface.
- **`/changes/[id]?legacy=1` "Open the full record"** — Act 5 secondary CTA on every v2 change brief. Customer can always drop into the legacy operator drilldown for the per-event Z-score math.
- **`/recommendations` "Open legacy view"** — footer link on the v2 card stack.
- **`/prompts` "Open legacy view"** — footer link on the v2 strategic surface.
- **Operator-mode debug toggles (`NEXT_PUBLIC_OPERATOR_MODE`)** — leave operator-only fields gated behind the env flag, never rendered in customer mode.
- **`/diagnostics/*`** — operator surface, never linked from customer routes.

---

## Quality gates at lock

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ clean |
| `tests/architecture/` (88 files) | ✅ 2350/2350 |
| `tests/architecture/forbidden-customer-vocabulary-contract.test.ts` | ✅ 23/23 invariants — no operator vocabulary leaks in any customer-facing source |
| `npm run test` (full suite, 412 files) | ✅ **7801/7801** |
| Production deploy | ✅ Ready, aliased to `https://beacon-bice.vercel.app` |
| All 6 v2 routes + 6 legacy escape routes | ✅ HTTP 307 → /login (expected single-user auth gate) |
| Watchdog cron `/api/cron/poll-watchdog` | ✅ HTTP 401 anon (expected — `CRON_SECRET` gate intact) |

---

## Known deferred polish (not blocking)

- **P2-1**: Today hero "Closest challenger" sub-line wording when brand has no rank yet. Current copy reads as "Closest challenger / 78.0% visibility" — reader can mistake the competitor's score for their own. Pure copy fix; deferred per QA spec.
- **P2-4**: Changes next-action resolver `?legacy=1` href footgun. Currently safe (page.tsx stamps the full path before render); flagged because the helper's default `href: "?legacy=1"` would soft-fail if a future caller forgot to stamp. Refactor opportunity; deferred per QA spec.

Both are non-blocking and can wait for the next polish window.
