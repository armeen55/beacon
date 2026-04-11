/**
 * Data Adapter Entry Point — the swap point for data sources.
 *
 * Currently returns Profound-backed adapters. When native querying
 * becomes the primary data source, create a `native-adapter.ts`
 * implementing the same interfaces and swap the import here.
 *
 * Routes should call `getAdapters()` once per render and pass
 * individual adapters to view-model functions.
 */

import "server-only";

import type { BeaconDataAdapters } from "./types";
import { createProfoundAdapters } from "./profound-adapter";

let _cached: BeaconDataAdapters | null = null;

export function getAdapters(): BeaconDataAdapters {
  if (!_cached) _cached = createProfoundAdapters();
  return _cached;
}

export type { BeaconDataAdapters } from "./types";
export type {
  VisibilityAdapter,
  GeoAdapter,
  JourneyAdapter,
  ScoreAdapter,
  CompetitiveAdapter,
  EntityAdapter,
  AttributionAdapter,
  OutcomeAdapter,
  SnippetAdapter,
  PulseAdapter,
} from "./types";
