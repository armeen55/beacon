# Derivations

Pure functions that compute derived data from canonical Beacon entities.

Examples:
- `detect-events.ts` — derives OutcomeEvents from observation time series
- `compute-snapshots.ts` — rolls up daily metric snapshots from observations
- `discover-candidates.ts` — generates CandidateCauses from events + changes

Rules:
1. Derivations are pure functions (no side effects, no persistence)
2. Derivations consume only canonical types
3. Derivations never import from adapters
4. Output types are either canonical entities or view models
