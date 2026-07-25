# Beacon — instructions for Claude (Code / CLI / any agent)
**Read first, in order:** `docs/PRODUCT_TRUTH.md`, `docs/HANDOFF_VERIFIED_STATE.md`, then **`AGENTS.md`**.
Product Truth is operator-controlled; propose amendments but never edit it without explicit operator approval.
This file holds only Claude-specific rules.
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

**Documentation policy (lean):** a completed task normally edits ZERO docs. Update
`HANDOFF_VERIFIED_STATE.md` only when verified current state changes. Never create task-specific summaries,
architecture duplicates, verification logs, roadmaps, or in-repo archives. Git history is the archive.
Canonical doc line ceilings are guard-enforced.

**Research before judgment:** when a material choice is not fully established, inspect primary documentation and
multiple best-in-class products first. Label fact versus inference and say when evidence is inconclusive. Research
must reduce uncertainty, never create scope. **No bloat theater:** prefer deletion and replacement; never reward
files, abstractions, agents, tests, or lines. DataForSEO is external research; OpenAI is structured reasoning.
Fable may assist bounded approved UI, never an alternate product, extra routes, or parallel component system.

**Finish every task with:** `Task completed`, 1–5 bullets, exactly one next recommendation, and
`Recommended capability for next step: [Fast / Balanced / Max]` + one-line why (Fast=Haiku, Balanced=Sonnet,
Max=Opus).
