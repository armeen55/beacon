# Beacon Verified State

`PRODUCT_TRUTH.md` defines the target. This page records established behavior and the material gaps that still prevent MVP completion. The external [MVP closure register](/Users/armeen/Beacon-MVP-Audit-2026-09-22.md) holds item-level evidence and exact hosted deployment checks.

## Working foundation

- Beacon uses tenant-scoped Supabase persistence, one approved Supabase-scheduled dispatcher, and the five customer surfaces: Today, Visibility, Changes, Results, and Connections. Publishing is manual.
- The canonical research and Decision path stores page snapshots, query comparisons, assignments, proposal versions, and review receipts. Structured OpenAI responses and server validation protect drafts. Paid work is bounded by account limits and a durable ledger.
- A Shipment records a manual change; verification and 7/14/28-day Results have explicit evidence and maturity states. These mechanisms do not by themselves prove a useful delivery stream or a defensible win.

## Last observed production state (September 22, 2026)

- One factual correction was Ready. There were 173 active needs-review proposals and 105 pending-verification proposals. The latter joined 87 stored verified, 12 blocked, and 6 differing shipment results; their proof versions and statuses still need reconciliation.
- Inventory held 224 URLs and 1,550 snapshots. The latest inventory captures included 10 complete structured captures, 3 incomplete captures, and 211 without `content_capture`. Legacy text can be useful context, but it cannot prove whole-page absence or placement.
- Research was paused at the existing $4 daily limit. The latest five rendered-page attempts failed before drafting; provider-reported DataForSEO charges totaled $0.0075 across those attempts, with no substantive Ready output. Further paid work has a $0 ceiling until the operator authorizes a new bounded run.
- Local Supabase access works; local OpenAI and DataForSEO credentials are absent. Hosted provider configuration was observed working, but the rendered acquisition failure remains. Production `/api/version` is the exact deployed SHA; the closure register records each checked SHA and smoke result.

## Current repair boundary

- Canonical page readback distinguishes complete structure from partial or legacy text, inventory recovery selects unresolved page identities, and per-URL holds leave unrelated pages eligible. Saved assignments retain exact evidence text. Source expansion requires support for the actual proposition. These contracts passed the gate and were deployed at the SHA in the closure register; authenticated behavior remains unproved.
- The rendered-page transport saves the paid Instant Pages task and uses its free task-ID Raw HTML read to recover one bounded, corroborated page. Cache replay and mismatch/charge holds passed local tests and the exact-SHA deployment passed public smoke. Hosted readback and post-JavaScript fidelity are not yet established; the current paid ceiling remains $0.
- Manual implementation intent names the selected version and components; a concurrent redraft cannot mark the newer proposal done. Verification requires co-captured, matching structure and JSON-LD. External title, meta, and H1 edits use the canonical Shipment writer, stable event IDs, and timezone-qualified implementation instants; local tests and exact-SHA public deployment passed, while authenticated behavior is unproved. A Shipment written just before a concurrent redraft can still be orphaned; atomic recording remains open.
- Live rendered capture, complete reader-task delivery, earned new pages, whole-page preservation, queue/ranking coherence, fair runtime progression, historical reconciliation, atomic ownership, two-archetype onboarding, and sustained manual-use proof remain open. A local passing test is not hosted or live-provider proof.

## Operating constraints

- Reuse saved evidence before provider calls. Do not raise budgets, reset production, discard historical receipts, add another scheduler, or automate publication.
- Run `npm run gate` before a coherent landing. Report the committed and pushed SHA, Vercel build result, exact-SHA hosted smoke, provider charges, and material infrastructure use. The closure register distinguishes local, hosted, live-provider, and pilot evidence.
