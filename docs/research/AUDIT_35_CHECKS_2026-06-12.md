# 35-check review-only OS audit — 2026-06-12 evening run

Multi-agent audit (4 parallel auditors + adversarial verification of
every fail/partial; 11 agents, 0 findings refuted). Verdict:
**28/35 pass — including ALL TEN P0 checks** (no hardcoding outside
config; Accept-gated publishing; provenance on every rec; no SEO-magic
claims; first-party-over-third-party encoded; canonicalized joins;
fail-closed snapshots + revert; no fabricated facts; rate/unit/cost
guards; no PII to LLMs).

Confirmed issues (fix ledger):
- **#23 (high → resolved this slice):** priority-score header docs were
  stale (omitted UPSIDE_BONUS + VALUE_WEIGHT) — synced; documented why
  `risks` is post-promotion metadata, not a scoring input.
- **#30 (medium → resolved this slice):** Clarity had no connector —
  self-serve token card added; nightly harvester next.
- **#13 (medium, open):** no originality/depth scoring vs competitor
  corpus before content-generation candidates; no G-E-A-T tracking.
- **#26 (✅ RESOLVED 2026-06-12, PR #81):** treatment dates anchor to
  the linked edit's `live_at` instead of changelog accept-time, so the
  post-window no longer counts pre-live days (was diluting lift).
- **#33 (✅ RESOLVED 2026-06-12, PR #83):** push routing map doc
  (create→insert / add_schema→product seoData PATCH / field:→CMS PUT
  read-modify-write / blog→adapter), Wix ≤5-markups enforced on the
  merged tag set, 1MB CMS-item ceiling.
- **#35 (✅ RESOLVED 2026-06-12, PRs #83 + connector tests):** GSC got
  429 exponential backoff (backfill volume warranted it); the
  low-volume connectors (SEMrush 1 req/night, Profound 2+2·cat/night)
  deliberately fail-soft-skip then idempotently re-pull next night
  rather than retry — a 429 there is near-impossible and skip-repull
  is simpler + safe. Malformed-response coverage: SEMrush (non-2xx,
  200-ERROR-body, network fault, garbage CSV) + Profound (non-2xx,
  unparseable 200 body, network fault, arity-broken envelope rows) all
  proven fail-soft-null. Idempotent-sync contracts documented on the
  GSC + SEMrush sync headers.
- **#13 (✅ RESOLVED 2026-06-12, PR #84):** originality guard — a
  keyword-gap brief that topically duplicates an existing page flips
  to expanding that page (add_h2_section) instead of a new page.
- **#16 (open, LLM-gated):** 8 AEO action types staged but
  generator-less — gated by the operator-locked LLM-nightly policy
  decision (PR #74 / branch claude/llm-flip-on). The deterministic
  directive path now covers add_answer_block + add_proof_section
  (#87/#94) without an LLM. The remaining generator-backed types await
  the policy decision. This is the ONLY open audit item, and it is
  operator-gated by design.

Full machine-readable findings: the workflow run wf_58c89c84-98a
output (session artifacts).
