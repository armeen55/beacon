# Beacon — Materializer Demotion Semantics Preflight (Trust Sprint T6.7)

**Date:** 2026-05-06 PT (2026-05-07 UTC)
**Author:** Claude (Trust Sprint executor)
**Tenant:** `tenant-ritz-founder`
**Source script:** [`scripts/preflight-materializer-demotion.ts`](../scripts/preflight-materializer-demotion.ts)
**Implementation surface:** [`src/domains/attribution/url-change-outcome.ts`](../src/domains/attribution/url-change-outcome.ts) — `recordUrlOutcome`
**Outcome:** **Implemented + applied.** 1 row demoted on Ritz; integrity drift = 0 post-apply.

---

## 0. TL;DR

The materializer's pre-T6.7 gate `if (!isTerminalVerdict(v.verdict)) return null;` was one-way: helping/hurting/nothing_yet/not_implemented could be written; pre-landing verdicts (too_early, not_enough_data, not_enough_native_baseline) AND `weak_signal` were dropped. This meant once a row crossed to a terminal verdict, the engine couldn't follow a recompute back to a non-terminal state, so the menlo-park drift surfaced in T5.3 (helping z=4.07 persisted; T5.2 recomputes too_early z=0.41) sat there unfixed.

T6.7 replaces the gate with `existingIdx`-aware logic:
- **Fresh inserts** of pre-landing verdicts are still skipped (no signal to record).
- **Fresh inserts** of `weak_signal` are now allowed (T5.2's directional tier).
- **Updates** of existing records on ANY recompute are allowed (the demotion path).

Apply on Ritz: 1 row demoted (menlo-park). Backup verified. Integrity drift = 0 post-apply.

---

## 1. Trace of the materializer flow

```
computeUrlVerdict (pure)
  → produces UrlVerdict { verdict, z, sustain, ... }
  ↓
materializeUrlOutcomes (per change × URL)
  → for each (change, owned URL):
      ↓
    recordUrlOutcome
      ↓
    [GATE] isTerminalVerdict?
      ↓ pre-T6.7: !terminal → return null (drops everything non-terminal)
      ↓ post-T6.7: existingIdx-aware (see §2)
      ↓
    findIndex by (change_id, url)
      → existing?
        ↓ no:  push nextRecord
        ↓ yes: materialChange? → upsert in place + transitions++
  ↓
syncUrlChangeOutcomes (dual-write to Supabase)
```

Lifecycle copy consumers downstream:
- `WATCHING_VERDICTS` (for recordUrlOutcome's READ path) — already includes `weak_signal` per T5.2.
- `/changes/scorecard-client.tsx` MathRow + tone — already handles all verdict labels.
- T5.3 integrity script — uses the same `computeUrlVerdict`; verifies persisted matches recompute.
- T6.1 brain-health Attribution Health section — reports verdict mix + drift count.

No downstream consumer breaks on a `verdict: "too_early"` row replacing a previous `verdict: "helping"` — the type is `VerdictLabel` everywhere; the new value is just a different label in the same union.

---

## 2. Drift classification on Ritz (preflight result)

```
Persisted outcomes:           131
Recomputed under T5.2 logic:  131
Drift count:                    1

Drift class:
  terminal_demote_to_non_terminal   1   (menlo-park)

Drift detail:
  /locations/menlo-park (cl-real-224)
    persisted=helping (z=4.07)
    computed =too_early (z=0.41)
    preFullPolls=n/a
    class=terminal_demote_to_non_terminal
```

Five drift classes the preflight script tracks:

| Class | Meaning | Pre-T6.7 behavior | Post-T6.7 behavior |
|---|---|---|---|
| `no_drift` | persisted == recomputed | no-op (correct) | no-op (correct) |
| `terminal_demote_to_non_terminal` | helping → too_early/not_enough_data | gate skipped → drift persists | demote written |
| `weak_signal_emerge` | non-watching → weak_signal | gate skipped → never written | written (fresh or update) |
| `non_terminal_promote_to_terminal` | too_early → helping (recovery) | already worked (no existing row) | unchanged |
| `terminal_to_terminal_change` | helping → nothing_yet | already worked (materialChange path) | unchanged |
| `other` | catch-all | n/a | n/a |

Ritz preflight had 1 row in `terminal_demote_to_non_terminal` and 0 in everything else. Tightly bounded scope.

---

## 3. Proposed write semantics — and why this version is bounded

**Decisions made:**

| Question | Decision | Reason |
|---|---|---|
| Allow terminal → non-terminal demotion? | **Yes**, when an existing record exists. | Closes the T5.3 drift; brain needs to see "this row used to land helping, now T5.2 says too_early." |
| Allow fresh inserts of pre-landing verdicts? | **No.** | "We don't have data yet" rows pollute the brain; verdict engine emits them every cron run for any URL with sparse history. |
| Allow fresh inserts of `weak_signal`? | **Yes.** | T5.2 made it a watching verdict; brain needs to track directional signals from day 1. |
| Preserve transition history? | **Yes.** | Existing materialChange + transitions++ logic carries through. |
| Stamp explicit demotion reason? | **No (deferred).** | Implicit via the new verdict label. Adding an explicit field requires a Supabase column add; out of T6.7's bounded scope. The verdict transition (helping → too_early) plus the `transitions` counter and `updated_at` ISO together form the audit signal. |
| Keep `recorded_at` or update it? | **Keep.** | Existing logic preserves it on update; only `updated_at` refreshes. |
| How to avoid noisy daily flip-flops? | **Accept day-N fluctuation; brain reads `transitions` counter for signal-vs-noise.** | If a row demotes one day and re-promotes the next (e.g., sampling-status flap), the transitions counter inflates. A future "sticky demotion" rule could throttle this; out of T6.7 scope. The Ritz preflight showed 1 stable demotion, no flap risk. |

**What was NOT changed:**
- `TERMINAL_VERDICTS` set membership (pinned in invariant tests). T6.7 fixes the persistence gate, not the verdict taxonomy.
- `WATCHING_VERDICTS` set (already correct post-T5.2).
- `findLandingDay` (still helping/hurting only — null for other verdicts).
- Schema fields (`UrlChangeOutcome` shape unchanged).
- Supabase column set (no migration required).

---

## 4. Implementation diff

```diff
-  if (!isTerminalVerdict(v.verdict)) return null;
+  const existingIdx = urlChangeOutcomes.findIndex(
+    (o) => o.change_id === input.change.id && o.url === input.normalizedUrl,
+  );
+  // T6.7: skip fresh inserts of pre-landing verdicts (no existing row
+  // to demote, and the verdict carries no signal worth persisting).
+  if (existingIdx === -1 && !FRESH_INSERT_VERDICTS.has(v.verdict)) {
+    return null;
+  }
```

Plus:
```ts
const FRESH_INSERT_VERDICTS: ReadonlySet<VerdictLabel> = new Set<VerdictLabel>([
  "helping", "hurting", "nothing_yet", "not_implemented", "weak_signal",
]);
```

The rest of `recordUrlOutcome` is unchanged. `nextRecord` was already verdict-agnostic (`landing_day_n` and `landing_z` are nulled for non-helping/hurting verdicts); the materialChange predicate already detects verdict transitions.

---

## 5. Apply on Ritz — backup, run, verify

**Backup**: `.data/_backups/url-change-outcomes-pre-t5_3-2026-05-07T05-39-53.json` (SHA on disk).

**Apply**: `npx tsx --require ./scripts/mock-server-only.cjs scripts/rematerialize-verdicts-t5.ts --apply`

```
Pre-apply on-disk:  helping=118, nothing_yet=13                  (TOTAL 131)
materializeUrlOutcomes report: processed=153, newlyRecorded=0, transitionsAdded=1
Post-apply on-disk: helping=117, nothing_yet=13, too_early=1     (TOTAL 131)
```

The 1 transition is the menlo-park row.

**Integrity verify** (post-apply): `scripts/verify-verdict-rematerialization-integrity.ts`
```
recomputed: 131
drift detected: 0
INTEGRITY OK — every persisted verdict matches T5.2 recomputation.
```

**Re-preflight** (post-apply): `scripts/preflight-materializer-demotion.ts`
```
drift count: 0
No drift detected.
```

T5.3's documented finding ("1 expected drift; menlo-park") is now closed.

---

## 6. Rollback path

Restore the backup file and re-run any cron — the materializer is idempotent.

```bash
cp .data/_backups/url-change-outcomes-pre-t5_3-2026-05-07T05-39-53.json \
   .data/tenants/ritz-builders/url-change-outcomes.json
```

Optional: `git revert` the T6.7 commit to also revert the gate change.

---

## 7. Out of scope (deferred future mini-phases)

1. **Explicit demotion reason field** — would let the brain trivially answer "why did this row demote?". Requires Supabase column add. Not blocking; the implicit verdict-transition signal is sufficient for the current attribution surface.
2. **Sticky demotion (anti-flap)** — would throttle daily oscillation if a row demotes and re-promotes within N days. Not needed at current Ritz data shape; revisit if the brain-health report's transitions counter starts inflating noisy.
3. **Materializer-level write of `weak_signal` on a fresh row that has never had any other verdict** — already enabled by T6.7. This is a passive new behavior; future mini-phase could add a brain-health metric tracking the weak_signal count separately from helping count.

---

## 8. Verification

- ✅ Preflight script runs in <30s on Ritz canonical store.
- ✅ Bounded scope: 5-line gate change + 1 new constant set + 4 source-text invariant tests + 0 schema changes.
- ✅ Apply ran cleanly: 1 transition, backup verified.
- ✅ Post-apply integrity: 0 drift.
- ✅ Quality gates green (typecheck CLEAN, full suite 312/312 files / 5044/5044 tests, build green, integrity PASS, dedup PASS, LLM budget SHA byte-identical).
- ✅ No second tenant. No RLS / auth / Profound / onboarding / billing.
- ✅ No paid APIs. No OpenAI calls.
- ✅ Production row mutation (1 row demoted) explicitly authorized by the T6.7 brief AND backed up before apply.
- ✅ No customer-visible UI changes; no copy changed.

---

## 9. References

- T5.2 (commit `d316858`) — added sparse-pre-window precondition + `weak_signal` tier.
- T5.3 (commit `6b1d3cd`) — surfaced the menlo-park drift; documented the materializer's one-way gate as the root cause.
- T6.1 (commit `d9bf5f4`) — Brain Health Index reports drift count as Attribution Health metric.
- T6.7 (this phase) — closes T5.3's drift via the bounded gate fix.
