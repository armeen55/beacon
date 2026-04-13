import "server-only";

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import path from "path";

export interface BusinessConfig {
  name: string;
  domain: string;
  industry: string;
  phone: string;
  address: string;
  /** Yelp Fusion business id or alias (used by Settings → Connectors → Yelp sync). */
  yelpBusinessId: string;
  locations: string[];
  services: string[];
  primaryCompetitors: string[];
  keyPages: string[];
  locationTerms: string[];
  serviceTerms: string[];
  directoryDomains: string[];
  /** Duplicate of `.data/scan-settings.json` — not read by the scan CLI; prefer `getScanSettings()` for runtime truth. */
  scanSettings: {
    preferredHour: number;
    timezone: string;
    scope: "priority" | "full";
    enabled: boolean;
  };
}

const DATA_DIR = path.join(process.cwd(), ".data");
const CONFIG_PATH = path.join(DATA_DIR, "business-config.json");

const DEFAULT_CONFIG: BusinessConfig = {
  name: "Ritz Builders",
  domain: "ritzbuilders.com",
  industry: "home-builder",
  phone: "",
  address: "",
  yelpBusinessId: "",
  locations: [
    "Palo Alto",
    "Menlo Park",
    "Atherton",
    "Los Altos",
    "Cupertino",
    "Saratoga",
    "Woodside",
    "Portola Valley",
    "Mountain View",
    "Sunnyvale",
    "San Jose",
    "Bay Area",
    "Silicon Valley",
    "Emerald Hills",
  ],
  services: [
    "custom home",
    "remodel",
    "renovation",
    "new construction",
    "teardown",
    "rebuild",
    "home builder",
    "general contractor",
    "addition",
    "ADU",
    "design-build",
  ],
  primaryCompetitors: [],
  keyPages: ["/", "/luxury-home-builder-bay-area", "/locations"],
  locationTerms: [],
  serviceTerms: [],
  directoryDomains: [
    "houzz.com",
    "yelp.com",
    "angi.com",
    "reddit.com",
    "diamondcertified.org",
    "bbb.org",
    "thumbtack.com",
    "homeadvisor.com",
    "buildzoom.com",
  ],
  scanSettings: {
    preferredHour: 9,
    timezone: "America/Los_Angeles",
    scope: "full",
    enabled: true,
  },
};

let _cached: BusinessConfig | null = null;

export function getBusinessConfig(): BusinessConfig {
  if (_cached) return _cached;

  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = readFileSync(CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw) as Partial<BusinessConfig>;
      _cached = { ...DEFAULT_CONFIG, ...parsed };
      return _cached;
    } catch {
      // Fall through to default
    }
  }

  _cached = DEFAULT_CONFIG;
  return _cached;
}

export function saveBusinessConfig(patch: Partial<BusinessConfig>): BusinessConfig {
  const current = getBusinessConfig();
  const updated = { ...current, ...patch };

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2));
  _cached = updated;
  return updated;
}

export function getLocationRegex(config?: BusinessConfig): RegExp {
  const cfg = config ?? getBusinessConfig();
  const terms =
    cfg.locationTerms.length > 0
      ? cfg.locationTerms
      : cfg.locations;
  if (terms.length === 0) return /(?!)/g;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
}

export function getServiceRegex(config?: BusinessConfig): RegExp {
  const cfg = config ?? getBusinessConfig();
  const terms =
    cfg.serviceTerms.length > 0
      ? cfg.serviceTerms
      : cfg.services;
  if (terms.length === 0) return /(?!)/g;
  const escaped = terms.map((t) =>
    t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]?"),
  );
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
}

export function isDirectoryDomain(domain: string, config?: BusinessConfig): boolean {
  const cfg = config ?? getBusinessConfig();
  const norm = domain.toLowerCase().replace(/^www\./, "");
  return cfg.directoryDomains.some((d) => norm === d || norm.endsWith(`.${d}`));
}
