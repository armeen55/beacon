# Customer-Readiness Round 2 — Report

**Date:** 2026-05-06 (morning, post-cron verification)
**Operator:** Armeen
**Scope:** 3 paper-cut fixes from the customer-readiness audit. Pure copy + small UI additions. No LLM calls. No queue mutation. No SYSTEM_PROMPT changes. No persistence touched. No backfill.
**Predecessor:** [`CUSTOMER_READINESS_ROUND_1_REPORT.md`](./CUSTOMER_READINESS_ROUND_1_REPORT.md)

---

## TL;DR

| | |
|---|---|
| **Verdict** | **Closed.** All 3 fixes shipped. 12 new architecture invariants pin every fix. |
| Production-code surface | **2 source files** edited (`/prompts/[id]/page.tsx` and `recommendations-client.tsx`). |
| Ledger byte-identical | ✅ before/after full suite (SHA `d36eed8c…` matches Round 1 baseline). |
| Total architecture invariants | **132** (94 LLM + 26 Round 1 + 12 Round 2). |
| Morning verification | GREEN — 199 obs landed for 2026-05-06; LR-3 still waiting on queue refresh. |

---

## Fix 1 — `/prompts/[id]` friendly slugs

**File:** `src/app/(shell)/prompts/[id]/page.tsx`

**New helper:**
```ts
export function prettifySlug(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (UUID_RE.test(trimmed)) return null;             // RFC-4122 → render nothing

  const tokens = trimmed.split(/[-_]+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;

  // US-state suffix → "City, CA"
  const last = tokens[tokens.length - 1].toLowerCase();
  if (tokens.length >= 2 && KNOWN_US_STATES.has(last)) {
    const head = tokens.slice(0, -1).map(titleCaseToken).join(" ");
    return `${head}, ${last.toUpperCase()}`;
  }
  return tokens.map(titleCaseToken).join(" ");
}
```

**Render gates** (both topicId + locationScope):
```tsx
{drilldown.topicId && prettifySlug(drilldown.topicId) && (
  <li>...
    <span>{prettifySlug(drilldown.topicId)}</span>
  </li>
)}
{drilldown.locationScope && prettifySlug(drilldown.locationScope) && (
  <li>...
    <span>{prettifySlug(drilldown.locationScope)}</span>
  </li>
)}
```

**Behavior:**

| Input | Output | Render |
|---|---|---|
| `cupertino_ca` | `Cupertino, CA` | shows tag |
| `palo_alto_ca` | `Palo Alto, CA` | shows tag |
| `kitchen-remodel` | `Kitchen Remodel` | shows tag |
| `luxury_home_builder` | `Luxury Home Builder` | shows tag |
| `45a2c9d8-3552-4a8e-a17a-e1f8f3a55fcc` | `null` | renders NOTHING |
| `""` / null | `null` | renders nothing |

**Net:** zero raw UUIDs. Slugs become operator-readable. Empty/UUID inputs produce no UI element at all (operator brief: "don't render raw IDs").

---

## Fix 2 — `/recommendations` empty-state copy

**File:** `src/app/(shell)/recommendations/recommendations-client.tsx:1392–1402`

**Before:**
```
The queue regenerates nightly from the latest prompt observations.
Come back tomorrow, or check /prompts for raw decision signals.
```

**After:**
```
The queue regenerates nightly from the latest prompt observations.
Come back tomorrow, or check /prompts to see today's prompt-by-prompt observations.
```

**Net:** "raw decision signals" jargon replaced with "today's prompt-by-prompt observations" — operator-readable pointer to /prompts.

---

## Fix 3 — `/recommendations` status pill differentiation

**File:** `src/app/(shell)/recommendations/recommendations-client.tsx:593–603`

**Before:**
```ts
needs_review:     "border-status-warning/40 bg-status-warning/[0.06] text-status-warning",
needs_fresh_edit: "border-status-warning/40 bg-status-warning/[0.06] text-status-warning",
```

**After:**
```ts
needs_review:
  "border-status-warning/40 bg-status-warning/[0.06] text-status-warning",
needs_fresh_edit:
  "border-dashed border-status-info/50 bg-status-info/[0.04] text-status-info",
```

**Net:** the operator can now distinguish at a glance:
- **`needs_review`** (warning-amber, solid border) — "Beacon wants you to read this; the rec needs operator judgment"
- **`needs_fresh_edit`** (info-blue, dashed border) — "regenerate; the prior edits were dismissed and you need fresh copy"

Round 1 audit issue #10 closed.

---

## Architecture invariants (12 new)

`tests/architecture/customer-readiness-round-2.test.ts` — 12/12 PASS:

| Group | Tests | Coverage |
|---|---|---|
| **Fix 1 — friendly slugs** | 6 | prettifySlug declared + UUID early-return shape + KNOWN_US_STATES set + topicId double-gate render + locationScope double-gate render + tag spans render prettified value (not raw) |
| **Fix 2 — empty state copy** | 2 | "raw decision signals" GONE + new "prompt-by-prompt observations" present |
| **Fix 3 — pill differentiation** | 3 | needs_review keeps warning styling + needs_fresh_edit uses dashed-border + status-info shape + the two pill class strings are NOT identical (regression catcher) |
| **Cross-fix bundle integrity** | 1 | all 8 Round 1 forbidden phrases stay gone after Round 2 lands |

---

## Quality gates

- typecheck: clean (3 pre-existing prompt-drilldown errors unrelated).
- targeted vitest: **38/38 PASS** (26 Round 1 + 12 Round 2).
- full suite: **4536/4541** (5 pre-existing baseline failures unchanged; +12 new passing tests vs Round 1 baseline of 4524).
- build: EXIT_CODE=0 green.
- ledger byte-equality: ✅ pre/post-suite SHA `d36eed8ca157cb4c65ee01a2c51a2fef3fb21a0dfdbb036753d6d7c570927dbd` identical.

---

## Operator brief acceptance — checklist

| Operator-required | Status |
|---|---|
| Morning verification before feature work | ✅ daily-poll GREEN, /today FRESH, queue inspected |
| Round 2 fixes only (no LLM, no queue mutation, no LR-3) | ✅ |
| /prompts/[id] friendly slugs instead of raw IDs | ✅ Fix 1 |
| /recommendations empty-state copy: remove "raw decision signals" | ✅ Fix 2 |
| /changes status pill color differentiation | ✅ Fix 3 (needs_fresh_edit now distinct from needs_review) |
| Tier 1A comment sweep / onboarding / schema-technical untouched | ✅ |
| typecheck clean | ✅ |
| targeted tests pass | ✅ 38/38 |
| full suite only baseline failures | ✅ 5 baseline |
| build green | ✅ EXIT_CODE=0 |
| ledger byte-identical before/after tests | ✅ |
| commit + push | ✅ |
| final report | ✅ this report |

---

## Cumulative state

| Bundle | New invariants | Cumulative |
|---|---|---|
| LLM cycle (DryRun-2/3/3.5 + LR-N + budget hermetic) | 94 | 94 |
| Customer-Readiness Round 1 | 26 | 120 |
| **Customer-Readiness Round 2 (this bundle)** | **12** | **132** |

Operator-locked Round 1 + Round 2 forbidden phrases now permanently CI-protected:
- Round 1: `Stamps live_at = now`, `live_match_kind = operator_override`, `Pre-pivot CSV / PDF rebuild`, `Supabase schema`, `dual-write logs`, `GitHub Actions logs`, `proof run`, `proof-sized sample`.
- Round 2: `raw decision signals` (operator-visible empty-state copy).

Operator-locked render shapes:
- AIPill + ConfidencePill components rendered in row title cell.
- prettifySlug applied to topicId + locationScope (and returns null for UUIDs).
- needs_review and needs_fresh_edit pill classes must NOT be identical.

Any future PR that re-introduces a forbidden phrase OR removes a required component / render gate fails CI.

---

## Status — pause for operator

Round 2 closes the next-tier audit issues. Remaining items (only if operator wants Round 3 later):
- `enrichment-v2.tsx:248–250` empty-state copy parity ("yet" used for two distinct states).
- `enrichment-v2.tsx:403` "Primary X%" → "ranked #1 X% of the time" (less API-jargon).
- `today-client.tsx:66–67, 93` "Tier 1A" docstring sweep (low priority — JSDoc-only).

LLM work paused. LR-3 still waiting on queue refresh.
