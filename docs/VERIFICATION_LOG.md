# Beacon Verification Log

> **PURPOSE:** Dated proof of what changed, what was tested, and results. Answers "what did we verify and when?"
> **NOT FOR:** what to do next or current state (→ `HANDOFF_VERIFIED_STATE.md`).
> **POLICY:** append ONE concise entry per deployed vertical slice. Keep only the current campaign and the most
> recent meaningful deployed entries here — git history is the archive. No `docs/archive/`. Ceiling: 300 lines.

---

## Foundation Freeze campaign (2026-07)

Beacon was rebuilt from ~450k combined TypeScript to a small foundation on five kernels
(Account / Evidence / Decision / Measurement / Runtime) behind four surfaces, then mechanically
frozen. Full pre-July history and the older rebuild banks live in git history.

> 🟢 **2026-07-22 — kernel facades + recommendations-domain elimination + action-types collapse.**
> Committed `bd362b66`, prod `dpl_HQ8Jf9dtaV2WiTjnqrLn29Vg4gtQ`. Added public facades (evidence,
> decision, proof-gsc); guard bans `src/app` deep-imports of kernel internals. Eliminated the
> recommendations domain; deleted 3 dead micro-domains; collapsed `action-types.ts` 835→94. Gate green
> (tsc 0, 211 tests, build). Four surfaces walked on real Iranopedia data. Net −629.

> 🟢 **2026-07-22 — AI-visibility family merge (34→28 domains).** Committed `172abb91`, prod
> `dpl_FZGVhvb5GVbbF8tee31seHZJ7M1r`. Folded 6 native-AI-visibility micro-domains into
> `ai-visibility/`; left `observations` out (scanning concern). Store registrations preserved (keyed
> off string table names). Gate green; four surfaces walked on the real main tree (beacon-audit :3141).
> LESSON: the `beacon-iranopedia` launch config pointed at a stale worktree — verify on beacon-audit
> (main tree). Turbopack's persistent cache shows phantom module-not-found after a file move; trust
> `next build`, not the dev console.

> 🟢 **2026-07-22 — FINAL FOUNDATION LOCK. Committed `a4863a65`, prod `dpl_5ge1nr7bjWJvrKzJ7cnsocUoAh4E`,
> tag `foundation-frozen-mvp-start`.** Consolidated src/domains 28 → **5 kernels** (account, evidence,
> decision, measurement, runtime); src/app server loaders consume kernels through public facades only;
> client/presentation components import client-safe deep modules (Turbopack server-only boundary is their
> guard). Extended the firewall: domains ≤5, facade rule, kernel dependency-direction check (6 pre-existing
> leaks grandfathered, non-increasing), public-export cap (1,936→target 1,200), and a Markdown budget.
> Markdown reset: 135 files / 76,717 lines → 15 / ~1,935 (deleted docs/archive + ~40 obsolete docs; rewrote
> the canonical set accurate to the 5-kernel reality). Gate green: guard, tsc 0, 211/211 tests, build. Four
> surfaces walked on the real main tree (beacon-audit :3141): Today ("2 ideas, 15 measuring"), Changes
> (ranked queue + full New-page proposal), Results (WINS 4, directional reads), Connections ("4 of 4
> connected"). Final: prod ~70,400 / test ~3,900 / combined ~74,300 LOC; 5 domains. Combined is above the
> ≤65k goal because the six connector boundaries + persistence are mandatory working capability; the tracked
> path to ≤65k is the Supabase-only persistence cleanup (NEXT_PHASE step 1). LESSON: a kernel facade
> re-exports server-only modules, so a client-bundled component must import client-safe deep modules, not
> the facade — caught by `next build`, not tsc.
