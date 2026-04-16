/**
 * CX1.2 — Seed the Ritz Builders founder tenant.
 *
 * Idempotent: run as many times as you like. Creates or updates the
 * founder tenant in `.data/tenants.json`.
 *
 * Writes directly to disk (bypasses json-store.ts which has server-only guard).
 *
 * Usage:
 *   npx tsx scripts/seed-founder-tenant.ts
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

type BeaconTenant = {
  id: string;
  slug: string;
  business_name: string;
  domain: string;
  segment: "local_residential_builder";
  project_mix: string[];
  cities_served: string[];
  budget_range: string;
  signup_date: string;
  role: string;
  tos_accepted_at: string | null;
  discovered_competitors: string[];
  daily_budget_usd: number;
  status: string;
  email_frequency: string;
  created_at: string;
  updated_at: string;
};

const DATA_DIR = join(process.cwd(), ".data");
const TENANTS_PATH = join(DATA_DIR, "tenants.json");

const now = new Date().toISOString();

const ritzTenant: BeaconTenant = {
  id: "tenant-ritz-founder",
  slug: "ritz-builders",
  business_name: "Ritz Builders",
  domain: "ritzbuilders.com",
  segment: "local_residential_builder",
  project_mix: [
    "new_construction",
    "whole_home_remodel",
    "kitchen_bath",
    "adu_addition",
    "teardown_rebuild",
  ],
  cities_served: [
    "Atherton",
    "Menlo Park",
    "Palo Alto",
    "Los Altos",
    "Cupertino",
    "Saratoga",
    "Woodside",
    "Portola Valley",
    "Mountain View",
    "Sunnyvale",
    "San Jose",
  ],
  budget_range: "5m_plus",
  signup_date: "2026-01-01T00:00:00Z",
  role: "founder",
  tos_accepted_at: "2026-01-01T00:00:00Z",
  discovered_competitors: [],
  daily_budget_usd: 10.0,
  status: "active",
  email_frequency: "weekly",
  created_at: now,
  updated_at: now,
};

function main() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  let tenants: BeaconTenant[] = [];
  if (existsSync(TENANTS_PATH)) {
    try {
      tenants = JSON.parse(readFileSync(TENANTS_PATH, "utf-8"));
    } catch {
      tenants = [];
    }
  }

  const idx = tenants.findIndex((t) => t.id === ritzTenant.id);
  if (idx >= 0) {
    tenants[idx] = { ...ritzTenant, created_at: tenants[idx].created_at };
    console.log(`Updated existing founder tenant: ${ritzTenant.id}`);
  } else {
    tenants.push(ritzTenant);
    console.log(`Created founder tenant: ${ritzTenant.id}`);
  }

  writeFileSync(TENANTS_PATH, JSON.stringify(tenants, null, 2), "utf-8");
  console.log(`  business: ${ritzTenant.business_name}`);
  console.log(`  domain: ${ritzTenant.domain}`);
  console.log(`  cities: ${ritzTenant.cities_served.length}`);
  console.log(`  role: ${ritzTenant.role}`);
  console.log(`  saved to: ${TENANTS_PATH}`);
}

main();
