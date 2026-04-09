import type { ConfiguredCompetitorEntry } from "./universe-types";
import { computeCompetitorUniverseFingerprint } from "./universe-fingerprint";

/**
 * Explicit demo walkthrough universe when no `.data/competitor-universe.json` exists
 * and no import experiment is active. Same builders as seed `competitors` — not sample-derived.
 */
export const DEMO_CONFIGURED_COMPETITOR_ENTRIES: ConfiguredCompetitorEntry[] = [
  {
    id: "cfg-demattei",
    display_name: "De Mattei Construction",
    domain: "demattei.com",
    status: "active",
    notes: "Demo configured competitor",
    tags: ["demo"],
  },
  {
    id: "cfg-flegels",
    display_name: "Flegel's Construction",
    domain: "flegels.com",
    status: "active",
    tags: ["demo"],
  },
  {
    id: "cfg-harrell",
    display_name: "Harrell Remodeling",
    domain: "harrellremodeling.com",
    status: "active",
    tags: ["demo"],
  },
  {
    id: "cfg-pab",
    display_name: "Palo Alto Builders",
    domain: "paloaltobuilders.com",
    status: "active",
    tags: ["demo"],
  },
  {
    id: "cfg-svch",
    display_name: "Silicon Valley Custom Homes",
    domain: "svcustomhomes.com",
    status: "active",
    tags: ["demo"],
  },
];

/** Stable fingerprint for bundled demo defaults (not a workspace file version). */
export const DEMO_COMPETITOR_UNIVERSE_FINGERPRINT =
  computeCompetitorUniverseFingerprint(DEMO_CONFIGURED_COMPETITOR_ENTRIES);
