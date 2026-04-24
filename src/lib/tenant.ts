/**
 * Multi-tenant data isolation.
 *
 * Default tenant uses the `.data/` directory at project root.
 * Named tenants use `.data/tenants/{slug}/`.
 *
 * The active tenant is determined by:
 * 1. BEACON_TENANT env var (for CLI/scripts)
 * 2. Request header x-beacon-tenant (for multi-tenant server)
 * 3. Default (single-tenant mode)
 */

import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

const ROOT_DATA_DIR = join(process.cwd(), ".data");
const TENANTS_DIR = join(ROOT_DATA_DIR, "tenants");

export function getActiveTenantSlug(): string | null {
  return process.env.BEACON_TENANT || null;
}

export function getDataDir(tenantSlug?: string | null): string {
  const slug = tenantSlug ?? getActiveTenantSlug();
  if (!slug) return ROOT_DATA_DIR;

  const dir = join(TENANTS_DIR, slug);
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
