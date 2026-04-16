/**
 * Structured logger — tenant-aware, module-tagged.
 *
 * All Beacon server code uses this instead of console.log from CX1 onward.
 * Outputs JSON in production (parseable by log aggregators) and
 * human-readable in development.
 *
 * Usage:
 *   import { getLogger } from "@/lib/obs/logger";
 *   const log = getLogger({ module: "prompts/run-audit", tenantId });
 *   log.info({ promptCount: 100 }, "Audit run started");
 *   log.error({ err }, "Platform adapter failed");
 */

import pino from "pino";

const IS_DEV = process.env.NODE_ENV !== "production";

const baseLogger = pino({
  level: process.env.BEACON_LOG_LEVEL ?? (IS_DEV ? "debug" : "info"),
  ...(IS_DEV
    ? {
        transport: {
          target: "pino/file",
          options: { destination: 1 }, // stdout
        },
        formatters: {
          level: (label: string) => ({ level: label }),
        },
      }
    : {}),
});

/**
 * Get a child logger scoped to a module and optionally a tenant.
 *
 * Every log line emitted by the returned logger includes:
 *   - `module`: the calling module's name (e.g., "prompts/run-audit")
 *   - `tenantId`: the tenant context, when provided
 *   - Standard pino fields: level, time, msg
 */
export function getLogger(opts: {
  module: string;
  tenantId?: string;
}): pino.Logger {
  const bindings: Record<string, string> = { module: opts.module };
  if (opts.tenantId) bindings.tenantId = opts.tenantId;
  return baseLogger.child(bindings);
}

/**
 * Base logger for global (non-tenant) operations like startup, migrations.
 */
export const globalLogger = baseLogger.child({ module: "global" });
