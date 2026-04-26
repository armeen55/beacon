/**
 * Multi-tenant `.data/` directory routing.
 *
 * Sprint 7 Phase 7.3 (2026-04-25): the `BEACON_TENANT` slug env var was
 * dropped (it duplicated `BEACON_TENANT_ID` at a different identifier
 * shape — slug vs id — and silently let production fall back to flat
 * `.data/` mode). Now callers pass the slug explicitly via the
 * `tenantSlug` param. Phase 7.8 will flip the flat-default to per-tenant
 * subdirectories; until then `getDataDir()` with no slug still routes
 * to the flat `.data/` for Ritz compatibility.
 *
 * Resolution paths:
 *   - Default `.data/` directory at project root  (Phase 7.3 default).
 *   - Named tenant `.data/tenants/{slug}/` when caller passes a slug.
 *
 * The active tenant ID is resolved by `currentTenantId()` in
 * tenant-context.ts; this file only handles directory layout.
 */

import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

const ROOT_DATA_DIR = join(process.cwd(), ".data");
const TENANTS_DIR = join(ROOT_DATA_DIR, "tenants");

export function getDataDir(tenantSlug?: string | null): string {
  if (!tenantSlug) return ROOT_DATA_DIR;

  const dir = join(TENANTS_DIR, tenantSlug);
  // Vercel FS read-only; skip mkdir (callers must handle missing dir).
  if (process.env.VERCEL !== "1" && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function createTenant(slug: string): string {
  const dir = join(TENANTS_DIR, slug);
  if (process.env.VERCEL !== "1" && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function listTenants(): string[] {
  if (!existsSync(TENANTS_DIR)) return [];
  const { readdirSync } = require("fs");
  return (readdirSync(TENANTS_DIR, { withFileTypes: true }) as { name: string; isDirectory: () => boolean }[])
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}
