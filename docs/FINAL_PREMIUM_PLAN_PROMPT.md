# The execution prompt for docs/FINAL_PREMIUM_PLAN.md (paste this to the agent)

MISSION: EXECUTE THE FINAL PREMIUM PLAN. ALL 120 ITEMS. DO NOT STOP.

GOAL

Read docs/FINAL_PREMIUM_PLAN.md in this repo. It contains 120 numbered items across 10 sections
and a 3-wave sequence. Your one goal: every single item in Wave 1, Wave 2, and Wave 3 is DONE,
verified, committed, pushed to main, and deployed. You are finished when the checklist shows
120/120 done (or an item is explicitly marked BLOCKED with a reason only a human can resolve),
and not one moment before.

THE LOOP (repeat until 120/120)

1. Open docs/FINAL_PREMIUM_PLAN.md and docs/FINAL_PREMIUM_PLAN_PROGRESS.md (create the progress
   file on first run: one line per item, [ ] / [x] / [BLOCKED: reason]). Pick the next undone
   items IN WAVE ORDER (never reorder P0s; group 2-5 related items into one coherent slice).
2. Implement the slice completely. Domain logic in src/domains, pages thin, reuse existing
   patterns, consolidation over invention.
3. Gate the slice: npm run typecheck, targeted tests for everything touched, new tests where the
   plan item implies behavior.
4. Ground-truth on REAL Iranopedia data (dev server via the beacon-iranopedia launch config,
   preview tools) and VISUALLY inspect every touched route, desktop and 375px. A slice that is not
   seen rendering is not done.
5. Apply item 120 (the acceptance ritual) to every touched screen: does this screen convince a
   stranger to pay $250/mo? What number does it show? What decision does it enable? If the honest
   answer is weak, keep working the slice before moving on.
6. Update the progress file, commit logically (one commit per slice, message names the item
   numbers), push main, let Vercel deploy, smoke the hosted URLs.
7. Every 10-15 items: run the FULL test suite + build as a hard gate (never per-slice; conserve
   CI); update docs/HANDOFF_VERIFIED_STATE.md and docs/VERIFICATION_LOG.md once per wave.
8. Go back to step 1. Do not summarize and wait. Do not present a plan and pause. Do not declare
   partial success. The next undone item is always your next action.

IF YOU GET STUCK ON AN ITEM

Try at least two approaches. If it is truly blocked on something only a human can do (credentials,
a paid cap increase, a destructive/irreversible operation, a Vercel dashboard env var), mark it
[BLOCKED: exact reason + exactly what the operator must do], put it in the final report, and move
to the next item immediately. A blocked item never stops the mission.

IF CONTEXT RUNS LONG

The progress file is your memory. Keep it truthful at all times so any continuation (including a
fresh session given this same prompt) resumes at the exact next undone item with zero re-work.

HARD RULES (violating any of these means the slice is not done)

- NO em dashes or en dashes anywhere: code, copy, docs, commit messages. Hyphens only.
- Plain business language on every operator surface. No lab jargon (experiment, control, baseline,
  treatment, reservation) outside How-we-know internals. First-person assistant voice per item 111.
- Preserve all proof rows, active measurements, control reservations, and plan history. Never
  mutate measurement history. Never publish to Wix. Ritz stays publish-blocked.
- Paid APIs only within the existing caps (DataForSEO shared $50/mo, LLM budget ledger), always
  through the existing gauntlets (cache, dry-run flag, fail-closed cap, ledger).
- Additive Supabase migrations only, applied via the management connection you own; never a
  migration that drops or rewrites data.
- Full suite must be 0 failed at every wave boundary. A red gate can never reach main (use && and
  redirects, never pipes that mask exit codes).
- Every commit follows the working standard already in CLAUDE.md (deploy is part of done).

REPORT (only when the checklist is 120/120 or everything left is BLOCKED)

1. The checklist state: done count, blocked items with the exact human action each needs.
2. The five screens that changed most, each with the $250 answer (what number, what decision).
3. Full-suite + build + deploy evidence (counts, SHAs, hosted smoke results).
4. What you would fix next that was NOT on the list (be brutally honest).

START NOW. Open the plan, open or create the progress file, and begin Wave 1.
