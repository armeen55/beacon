# Beacon — instructions for Claude (Code / CLI / any agent)

**Read first:** `docs/HANDOFF_VERIFIED_STATE.md`. The full, binding development contract is **`AGENTS.md`** —
architecture, the five kernels, the foundation firewall, persistence, the growth policy, and the eight
required fields for any new feature. Read it before non-trivial work. This file holds only Claude-specific rules.

**Foundation is frozen.** `npm run gate` (guard:foundation + typecheck + test + build) must pass. The guard
(`foundation-budget.json`) mechanically caps LOC, routes, domains, file sizes, deps, public exports, and
Markdown. No new top-level domain, customer route, dependency, or Markdown plan/report without operator
approval. One customer outcome per task. See AGENTS.md for the numeric budgets and the 8-field feature rule.

**Beacon voice** (every operator-facing string): first person ("I checked"); a concrete number when one
exists; always a next step; never a raw lab word (experiment, control, baseline, treatment, SERP) on a
primary surface; wins in one sentence; misses owned plainly; no hedging; **no em or en dashes ever**.

**Operator-journey rule (before marking ANY feature complete):** code green is not done. Walk the surface on
the rendered app with real tenant data as a smart non-technical customer — "what is this telling me / what do
I do next / did my action work / is this live or planned" must be obvious, with no jargon, raw slugs, or bare
zeros. Quote the rendered copy in the report. Verify on the **main tree** (`beacon-audit`, port 3141 →
`/Users/armeen/beacon`), never a worktree. Judge performance on prod, not dev compile times.

**The $250 ritual (before any UI change is done):** does this screen convince a stranger to pay $250/mo? What
number does it show? What decision does it enable? What would you cut? A weak answer means it is not done.

**Execution contract:** an accepted plan authorizes the full landing strip — edit, test, commit (one per
coherent step), push `origin/main`, deploy, verify the exact prod SHA. Not "done" until deployed. **Pause
before** destructive ops (file/branch deletion, `rm -rf`, force-push, `git reset --hard`), Supabase data
deletion, hosted env-var changes, schema-dropping migrations, or over-budget paid runs. Report what was
committed / pushed (SHAs) / deployed / verified; truth-up if a step could not run here.

**Supabase:** agents own all Supabase work through the MCP / management connection (ref `vlxwevsdvwxvopkjsewo`);
never print secrets; pause for a human only when Supabase itself needs a login the agent cannot perform.

**Documentation policy (lean):** a completed task normally edits ZERO or ONE doc, not four. Update
`HANDOFF_VERIFIED_STATE.md` only when verified current state changes; append ONE `VERIFICATION_LOG.md` entry
per deployed slice; touch `architecture.md` only when the architecture changes. Never create task-specific
summary docs or in-repo archives — git history is the archive. Canonical doc line ceilings are guard-enforced.

**Finish every task with:** `Task completed`, 1–5 bullets, exactly one next recommendation, and
`Recommended capability for next step: [Fast / Balanced / Max]` + one-line why (Fast=Haiku, Balanced=Sonnet,
Max=Opus).
