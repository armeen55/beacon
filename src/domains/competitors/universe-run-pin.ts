import "server-only";

import { loadCompetitorUniverseRuntime } from "./universe-read";
import type {
  CompetitorUniverseOrigin,
  ObservationCompetitorUniverseFields,
} from "./universe-types";

function scopeFromOrigin(o: CompetitorUniverseOrigin): ObservationCompetitorUniverseFields["competitor_universe_scope"] {
  if (o === "configured_file") return "configured_file";
  if (o === "demo_defaults_explicit") return "demo_defaults";
  return "empty";
}

/** Snapshot current workspace universe for pinning a new run (crawl, verify, import). */
export async function universeFieldsForObservationPersistence(): Promise<ObservationCompetitorUniverseFields> {
  const rt = await loadCompetitorUniverseRuntime();
  return {
    competitor_universe_version: rt.pin.universe_version,
    competitor_universe_fingerprint: rt.pin.universe_fingerprint,
    competitor_universe_scope: scopeFromOrigin(rt.origin),
    competitor_universe_pin_status: "pinned",
  };
}
