# Recommendation Lifecycle OS — Locked Contract (Phase 0)

> **Status:** LOCKED 2026-04-27 (Phase 0 sign-off pending operator).
> **Source plan:** `/Users/armeen/.claude/plans/you-are-taking-over-cryptic-brooks.md`.
> **Purpose:** This file is the single source of truth for Beacon's recommendation → implementation → verified-live → tracked loop. Engine, schema, and UI work in Phases 1–11 must conform to this contract. Anything that deviates requires updating this doc first, then re-signing.

> **NOT FOR:** Implementation steps (→ source plan), historical context (→ `master_execution_plan.md`), proof of changes (→ `VERIFICATION_LOG.md`).

---

## 1. The Golden Path (one paragraph)

Operator clicks **Accept** on a recommendation. The N specific edits inside that recommendation move into `accepted` state. The operator (or their dev) implements the edits on the live website on their own schedule. Beacon's daily scheduled scan re-fetches the page, extracts its element inventory, and runs a deterministic match engine. **HIGH-confidence matches auto-flip the edit to `verified_live` with no operator action required.** **MEDIUM-confidence matches surface a single "is this your edit?" card on Today.** **LOW-confidence (no match found) keep the edit pending until 7 days elapse, then transition to `not_found_after_7d`.** Once an edit is `verified_live`, the attribution engine starts the post-change baseline split from `live_at` (the scan timestamp), not from `accepted_at`. Verdicts crystallize over 14–30 days using the existing Z-score engine. The operator never clicks an "I implemented this" button on a normal day.

---

## 2. The State Machine (formal)

### 2.1 States

There are exactly **8 terminal-or-transitive states** for a `recommended_edit` row.

| # | State | Meaning | Set by | UI label |
|---|---|---|---|---|
| 1 | `recommended` | Engine generated this edit; operator hasn't responded yet | Match-engine creation (`runProviderAndPersist`) | **Recommended** (gray) |
| 2 | `accepted` | Operator clicked Accept on the parent rec; tracking begins on next scan | `acceptRecommendation` server action | **Tracking** (blue) |
| 3 | `verified_live` | Latest scan found exact key + text match; attribution clock started | Match engine (HIGH confidence, exact) | **Live ✓** (green) |
| 4 | `verified_live_modified` | Latest scan found key match but text differs within tolerance | Match engine (HIGH confidence, modified) | **Live ✓ (modified)** (green-yellow) |
| 5 | `needs_review` | Latest scan found a candidate match below auto-confirm threshold | Match engine (MEDIUM confidence) | **Needs review** (orange) |
| 6 | `wrong_page` | Text matched on a non-target URL only | Match engine (LOW confidence, wrong location) | **Wrong page** (orange) |
| 7 | `partially_implemented` | Compound edit (e.g. FAQ Q+A); some sub-elements matched, others didn't | Match engine (MEDIUM, structural partial) | **Partial** (orange) |
| 8 | `not_found_after_7d` | Edit accepted ≥7 days ago; no match in any subsequent scan | Match engine (LOW, time-elapsed) | **Not found** (red, soft) |
| 9 | `dismissed` | Operator explicitly rejected (either on /recommendations or via "No, different change") | Manual server action | **Dismissed** (gray strike-through) |

> **Note:** `recommendation_responses.status` (rec-level: accepted / dismissed / deferred) **stays unchanged**. The new lifecycle lives on `recommended_edits`. Rec-level state is the operator's intent; edit-level state is the engine's verdict.

### 2.2 Transitions

The transition table is **exhaustive**. Any transition not listed below is FORBIDDEN and must throw a fail-loud error in the engine.

| From | To | Trigger | Idempotent? |
|---|---|---|---|
| (none) | `recommended` | Engine creates row in `runProviderAndPersist` | Yes (deterministic id) |
| `recommended` | `accepted` | `acceptRecommendation` fan-out fires for this edit | Yes |
| `recommended` | `dismissed` | Operator dismisses the parent rec (cascades to all edits) | Yes |
| `accepted` | `verified_live` | Match engine: HIGH confidence + exact text | Yes (re-asserts same state) |
| `accepted` | `verified_live_modified` | Match engine: HIGH confidence + text within tolerance | Yes |
| `accepted` | `needs_review` | Match engine: MEDIUM confidence | Yes |
| `accepted` | `wrong_page` | Match engine: text matched on different URL | Yes |
| `accepted` | `partially_implemented` | Match engine: compound edit, partial match | Yes |
| `accepted` | `not_found_after_7d` | Daily scan AFTER 7 days from `accepted_at` produces no match | Yes |
| `needs_review` | `verified_live` | Operator clicks "Yes — that's my edit" | Once |
| `needs_review` | `dismissed` | Operator clicks "No — different change" | Once |
| `verified_live_modified` | `verified_live` | Subsequent scan finds exact match (operator cleaned up text) | Yes |
| `verified_live` | `verified_live_modified` | Subsequent scan finds text drift (regression detected) | Yes |
| `not_found_after_7d` | `verified_live` | Operator extended deadline OR a late scan eventually matched | Yes |
| `not_found_after_7d` | `dismissed` | Operator archives the rec | Once |
| ANY → ANY (manual) | — | `manualOverrideEdit(editId, status, reason)` server action — operator escape hatch | Yes (logs reason) |

### 2.3 Forbidden transitions (call out explicitly to prevent bugs)

- `recommended` → `verified_live` directly. Must go through `accepted` first. (Prevents auto-confirming edits the operator hasn't accepted.)
- `verified_live` → `accepted`. Once live, `live_at` is locked; you can't un-verify. The escape hatch is `manualOverrideEdit` with explicit reason.
- `dismissed` → any other state. Dismissal is final. Operator must re-accept via `manualOverrideEdit`.
- Any state → state without a row update. Every transition writes `updated_at` and (where applicable) the live_* columns.

### 2.4 Rec-level state (rolled up from edits)

The parent recommendation's lifecycle is **derived**, not stored:

- `fully_live` — all edits in `verified_live` or `verified_live_modified`.
- `partially_live` — at least one edit in `verified_live*`, at least one in `accepted` / `needs_review` / `wrong_page`.
- `tracking` — all edits in `accepted` (none verified yet).
- `stalled` — at least one edit in `not_found_after_7d`, none in `verified_live*`.
- `mixed` — anything else.
- `dismissed` — `recommendation_responses.status === 'dismissed'`.

UI computes this on the fly from the edit rows. No storage of rec-level rollup state.

---

## 3. The Confidence Rubric (locked thresholds)

### 3.1 The three tiers

| Tier | Action | Operator sees |
|---|---|---|
| **HIGH** | Auto-mark `verified_live` (or `verified_live_modified`) | Inline pill update + Today lifecycle strip count bumps |
| **MEDIUM** | Mark `needs_review` (or `partially_implemented` / `wrong_page`) | "Beacon thinks you implemented X — confirm?" card on Today with diff |
| **LOW** | Stay `accepted` for 7 days, then `not_found_after_7d` | Quiet; surfaces as "3 edits never landed; archive?" card after deadline |

### 3.2 Per-action-type match contract

Reference: `ACTION_TYPE_REGISTRY` in `src/domains/recommendations/action-type-registry.ts`. The 13 active extractors live in `src/domains/scanning/extractors/registry.ts`.

| `action_type` | Element source | HIGH (exact) | HIGH (modified) | MEDIUM | Notes |
|---|---|---|---|---|---|
| `edit_title` | `title` (singleton) | `normalizeText(inv.text) === normalizeText(edit.proposed)` | Levenshtein ≤ 8 OR Jaccard ≥ 0.85 | similarity ∈ [0.5, 0.7) | Singleton element |
| `edit_meta_description` | `meta` (singleton) | exact normalized match | similarity ≥ 0.85 | similarity ∈ [0.5, 0.85) | Singleton |
| `change_h1` | `h1` (singleton) | exact normalized match | similarity ≥ 0.85 | similarity ∈ [0.5, 0.85) | Singleton |
| `add_h2_section` | `h2` (positional) | New `h2` element exists with text matching `edit.proposed` heading | similarity ≥ 0.7 | similarity ∈ [0.5, 0.7) | New-element key |
| `add_faq` | `faq_question` + `faq_answer` (positional) | Both Q and A present with similarity ≥ 0.85 | Q ≥ 0.85, A ∈ [0.7, 0.85) | Q ∈ [0.7, 0.85) | Q-only match → `partially_implemented` |
| `add_schema_type` | `schema_type` (singleton-by-type) | `schema_types_added` includes target type | superset includes target type | partial (delegates to existing 5-rung ladder) | Reuses `match-schema-experiment.ts` |
| `add_internal_link` | `internal_link` (positional) | New link with same anchor text + same target href | anchor similar OR href exact | only one of (anchor, href) matches | URL canonical match required |
| `body_paragraph` | (extractor not active in v1) | DEFERRED to Phase 6+ | — | — | Requires extractor 14 |

**Out-of-scope action types for v1** (Phase 0 lock): anything not in the table above. Document a clear "deferred" reason if the engine encounters one.

### 3.3 `normalizeText()` (canonical)

```text
1. NFC unicode normalize
2. Collapse all whitespace runs (incl. \n, \t, NBSP) → single ' '
3. Strip leading/trailing whitespace
4. Smart quotes (" " ' ') → straight (" ')
5. Em/en dashes (— –) → hyphen-minus (-)
6. Strip trailing punctuation (.!?) before comparison
7. For exact comparison: preserve case
8. For similarity scoring: lowercase
```

This is the canonical implementation. Phase 2 builds it as `src/domains/recommendations/match-engine/normalize-text.ts`.

### 3.4 Wrong-page guard

Before declaring HIGH or MEDIUM, the engine checks:

```text
edit.target_url path === inventory.page_url path  (after URL normalization)
```

If false:
- Text matches on the non-target URL → `wrong_page` (operator sees a card with both URLs).
- No text match anywhere → standard `accepted` → `not_found_after_7d` flow.

### 3.5 Text similarity functions (locked)

For Phase 1–6, similarity uses **token Jaccard + Levenshtein hybrid**:

```text
similarity(a, b) = max(
  jaccard(tokenize(normalizeText(a, lowercase)), tokenize(normalizeText(b, lowercase))),
  1 - (levenshtein(normalizeText(a, lowercase), normalizeText(b, lowercase)) / max(len(a), len(b)))
)
```

No embedding-based similarity in v1 (defer to Phase 10 if needed). Pure functions only — no model calls during scan.

---

## 4. The Attribution Rule (locked)

### 4.1 Baseline-split timestamp

> **Attribution baseline-split uses `live_at`, falling back to `timestamp` only for legacy entries created before this contract shipped.**

Concretely:

```text
changeDate = changelogEntry.live_at ?? changelogEntry.timestamp
```

**Why:**
- `accepted_at` (today's `timestamp`) pollutes the pre-window with "implementation lag" days during which the page hasn't actually changed.
- Industry precedent: GSC, Semrush, all re-validation-based systems attribute from verified state, not intent.
- Backwards compatible: legacy entries without `live_at` keep their existing math.

### 4.2 Suppression rule for `not_found_after_7d`

> **Edits in `not_found_after_7d` have `attribution_suppressed = true`. The verdict engine returns the new label `not_implemented` instead of `nothing_yet`.**

This is critical for trust: an operator who never implemented an edit should see "not implemented" — never a confusing "nothing yet" that implies the edit is being measured.

### 4.3 Verdict label changes

`url-verdict.ts` `VerdictLabel` union extends with one new value:

```text
"helping" | "hurting" | "nothing_yet" | "too_early" |
"not_enough_data" | "not_enough_native_baseline" |
"not_implemented"   ← NEW
```

UI styling: `not_implemented` renders gray + de-emphasized (matches the soft-red `not_found_after_7d` lifecycle pill on `/recommendations`).

### 4.4 Polling cadence (unchanged)

> **Daily native poll cron remains the only poll trigger. `verified_live` does NOT trigger an immediate ad-hoc poll.**

**Why:** Sprint 6A.3 already locked the cost architecture around the daily cadence. The next-day poll is sufficient signal for Z-score; immediate polls would burn budget without changing verdict timing materially (post-window math caps at 30 days regardless).

The only exception: Phase 8 will surface `affected_prompt_ids` so the operator knows *which* prompts are being watched — but the polling itself stays daily.

### 4.5 Confidence-source pill

Existing `confidence_source` pill on `/changes` (Phase 0.5 work) keeps its existing labels. New addition: when an outcome's source change has `live_at !== timestamp`, pill suffix shows " (from live_at)" so the operator can distinguish lifecycle-OS-attributed outcomes from legacy.

---

## 5. Manual vs Automated Boundary

| Action | Owner | Why |
|---|---|---|
| Editing the actual website | **Operator (or their dev)** | Beacon does not write to customer sites. Out of scope forever. |
| Triggering scans | **Automated (daily cron + manual override)** | Removes the "I forgot to scan" failure mode. Manual button stays for impatience. |
| HIGH-confidence implementation confirmation | **Automated** | The deterministic key + exact text match has no failure mode that an operator click would catch. |
| MEDIUM-confidence confirmation | **Operator (one click on Today card)** | The diff is shown inline; operator needs ~5 sec to decide. |
| LOW / not-found cleanup | **Operator (one batch click after 7 days)** | "Archive these 3 edits that never landed?" — single batch action. |
| Attribution computation | **Automated** | Already is. Z-score engine runs every 6h via `materializeUrlOutcomes`. |
| Verdict crystallization | **Automated** | Already is. |
| Polling re-trigger after live | **NOT TRIGGERED — uses next daily cron** | Cost architecture locked. |
| Learning loop influence on rec ranking | **NOT YET (Phase 10 read-only inline copy only)** | Needs ≥30 days of dogfeed before closing the loop. |

**The litmus test:** an operator who edits Ritz at 11pm should wake up to a green "Live ✓" pill on `/today` the next morning, with the diff inline, and never have clicked anything but the original Accept button.

---

## 6. Glossary (single source of truth)

| Term | Meaning | Code reference |
|---|---|---|
| **Recommendation** | The high-level proposal generated by the rec engine, identified by `stable_key` | `src/domains/recommendations/types.ts` |
| **Recommended edit** | A specific actionable change, child of a recommendation; row in `recommended_edits` table | `src/domains/recommendations/recommended-edits-persistence.ts:69-95` |
| **Accepted** | Operator clicked Accept on the parent rec; per-edit state machine moved from `recommended` → `accepted` | `src/app/(shell)/recommendations/actions.ts:365-555` |
| **Verified live** | Latest scan's element inventory matched the edit per the §3 rubric at HIGH confidence | (Phase 3 deliverable) |
| **`live_at`** | The `fetched_at` timestamp of the scan snapshot in which the edit was first detected as live | (Phase 1 schema addition) |
| **`element_key`** | Stable per-element identifier in `page_element_inventory` — built via `positionalKey` / `singletonKey` / `newElementKey` / `schemaTypeKey` / `schemaPropertyKey` | `src/domains/scanning/extractors/element-key.ts` |
| **`target_element_key`** | The element_key the engine is targeting for an edit | `recommended_edits` schema |
| **Match engine** | Pure function that consumes `recommended_edits` + `page_element_inventory` and emits `MatchResult` | (Phase 2 deliverable) |
| **`attribution_suppressed`** | Flag on changelog entries with state `not_found_after_7d`; the verdict engine skips Z-score and returns `not_implemented` | (Phase 4 deliverable) |

---

## 7. Out of Scope (explicit non-goals to prevent scope creep)

The following are **not** part of Phases 1–11. Document and defer.

1. **Embedding-based similarity** — token Jaccard + Levenshtein is sufficient for v1. Revisit only if MEDIUM matches exceed 20% of accepted edits.
2. **Cross-tenant pattern transfer** — shared-brain stays read-only per existing `project_shared_brain_privacy` memory.
3. **Auto-implementing edits on the customer site** — Beacon never writes to customer sites. Forever non-goal.
4. **Real-time notifications (email/SMS) when an edit goes live** — Today page is the surface. Notifications are post-launch territory.
5. **Multi-step edit workflows (e.g., "first add H2, then internal link from new section")** — every edit is independent in v1.
6. **Operator-defined custom matchers** — the per-action-type contract in §3.2 is closed. Adding action types requires updating this spec.
7. **Streaming match results during scan** — the match engine runs synchronously after `regenerateScanFindings` in the same dual-write block.
8. **Reverting a `verified_live` flip without operator intervention** — even if a subsequent scan loses the element, the existing `verified_live` row stays; the new finding is recorded as a regression (`verified_live_modified` if text drifted) or surfaced as a separate scan finding (if element disappeared entirely). The existing `live_at` is never re-stamped.

---

## 8. Sign-off

> **Operator sign-off mechanism:** record approval in `.data/exit-gates.json` under the new gate key `lifecycle_os_phase0` with shape `{ status: "passed", notes: "<date> + initials", recordedAt: "<ISO>" }`. This follows the existing pattern from `daily_ritual` / `replication` / `local_layer` gates.

> **Phase 0 sign-off does NOT permit any code or migration changes.** It only authorizes Phase 1 (the schema-free `implementation_status` field) to begin. Each subsequent phase requires its own gate.

| Gate key | What it authorizes | Required for |
|---|---|---|
| `lifecycle_os_phase0` | Lock of this contract document; nothing else | Beginning Phase 1 |
| `lifecycle_os_phase1` | Schema-free `implementation_status` + `live_at` columns on `recommended_edits` and `changelog_entries` | Beginning Phase 2 |
| `lifecycle_os_phase2` | Pure match engine (no I/O) | Beginning Phase 3 |
| `lifecycle_os_phase3` | Wire match engine into scan dual-write block (BEHIND `BEACON_LIFECYCLE_ENABLED=1` flag) | Beginning Phase 4 |
| `lifecycle_os_phase4` | Verdict engine reads `live_at` + new `not_implemented` label | Beginning Phase 5 |
| `lifecycle_os_phase5` | Daily scheduled scan cron | Beginning Phase 6 |
| `lifecycle_os_phase6` | UI surfacing | Beginning Phase 7 |
| `lifecycle_os_phase7` | Auto-confirm gating + manual override | Beginning Phase 8 |
| `lifecycle_os_phase8` | Affected-prompt selection + post-live block | Beginning Phase 9 |
| `lifecycle_os_phase9` | Per-edit verdict roll-up | Beginning Phase 10 |
| `lifecycle_os_phase10` | Learning loop integration (read-only) | Beginning Phase 11 |
| `lifecycle_os_phase11` | Legacy cleanup classification doc | (terminal) |

**Operator action to sign Phase 0:** read this entire doc, then either:

- (a) Add the `lifecycle_os_phase0` gate to `.data/exit-gates.json` with `status: "passed"` (authorizes Phase 1), OR
- (b) Reply with corrections to this contract; this doc is updated and re-signed.

---

## 9. Change Log

| Date | Change | Author |
|---|---|---|
| 2026-04-27 | Initial lock per `you-are-taking-over-cryptic-brooks.md` plan | Claude (Opus Max) |

---

## 10. Source Traceability

- **Audit (read-only):** Three parallel Explore agents on 2026-04-27 (recommendation lifecycle / scan system / attribution+UI). Findings preserved in `/Users/armeen/.claude/plans/you-are-taking-over-cryptic-brooks.md` §2.
- **Industry research:** §1 of source plan — GSC, GitHub deploys, Linear, Semrush/Ahrefs, PagerDuty.
- **Five-options comparison:** §3 of source plan.
- **Code citations:** all file:line refs in this doc are verifiable as of 2026-04-27. Re-verify before Phase 1 (claims drift over time).
