# Customer-One Tracker

Source plan: `plans/curried-strolling-backus.md`.

One row per phase. Update at the end of each implementation chat. Do not duplicate this in other systems.

| Phase | Title                  | Status    | Merged | Dogfooded | Note |
|-------|------------------------|-----------|--------|-----------|------|
| 1     | Render existing fields | shipped   | 2026-04-20 | –       | `confidenceReason` + expander blocks live on action-card.tsx and today-primary-action.tsx. |
| 2     | Evidence basis pill    | shipped   | 2026-04-20 | –       | 4-tier classifier + pill live on Today. 18 unit tests pass. Current distribution: 2× Measured on your site, 1× Early signal, 1× Heuristic, 0× Cross-site pattern (honest — no BrainPattern backing). |
| 3A    | Wording trust guard    | shipped   | 2026-04-20 | –       | Generic guard on literal keyword insertion/positioning recs. `src/lib/text-normalize.ts` + 23 unit tests. Suppresses when concept already present in the exact target field (H1/H2/title) after lightweight normalization + contiguous-subsequence match. Verified: "Custom Homes" redundant card gone; genuine gap ("Major Structural Home Renovation" on /locations/los-altos) survives. |
| 3B    | Stack split            | shipped   | 2026-04-20 | –       | `decideTonightActions` vs `measuredWins` partition in today-data.ts; two-section render in today-client.tsx. No helping_verdict cards in the action queue; wins live in a visibly-secondary stripe with its own heading. |
| 3C    | Label cleanup          | shipped   | 2026-04-20 | –       | Render-time `HELPING_VERDICT_STYLE` override in action-card.tsx — helping_verdict cards read "Measured win" (muted green). No new bucket enum. |
| 3D    | Spotlight (decide if still needed) | deferred | – | –     | Operator direction: hold — rec quality work taking priority. |
| 3-post router | Page-placement router (keep / move / new_page / suppress) | shipped | 2026-04-20 | – | `src/lib/page-job-fit.ts` pure 4-way classifier; 22 unit tests. Tenant-scope built from pages + service_terms + URL slugs + business-config. Strict reroute (≥2 absolute + ≥2 margin). Route reasoning logged per finding. |
| Plan C | Declarative customer-facing copy | shipped | 2026-04-20 | – | Replaced engineer-speak templates ("Position X in your H2", "Reframe… preserving brand voice") with declarative ones. Move-mode leads with target: `Best current page for "X": /path`. Amber `Better fit than /x` badge removed from card face; context moved to a neutral bullet in the "Why we suggest this" expander. Zero hits on forbidden substrings in rendered DOM. |
| 4     | Drilldown hygiene      | pending   | –      | –         |      |
| 5     | Thin operator memory   | pending   | –      | –         |      |
| 6     | Nightly loop polish    | deferred  | –      | –         |      |

**Status legend:** `pending` · `in_progress` · `shipped` · `dogfooded` · `parked`.

**Rules:**
- A phase becomes `shipped` when code merges.
- A phase becomes `dogfooded` only after the operator has used it on Today for at least 2 nights.
- Do not advance to the next phase until the current phase is at least `shipped`.
