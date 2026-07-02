"use server";

/**
 * IndexNow key save action (BEACON_500 item 75, 2026-07-02).
 *
 * Operator-only, mirrors the gating on every other action in this folder.
 * Persists the opaque IndexNow key (+ optional host override) the operator
 * pastes in after uploading the key file to their site. Never validates the
 * key file is actually reachable here (no outbound probe on a form submit) -
 * the reminder copy tells the operator what to check, and the first real
 * ping's receipt (ok/failed) is the honest signal of whether it worked.
 */

import { revalidatePath } from "next/cache";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { getTenant } from "@/domains/tenants/store";
import { log } from "@/lib/logger";
import {
  getIndexNowConfig,
  saveIndexNowConfig,
} from "@/lib/connectors/indexnow/config-store";

const ROUTE = "/diagnostics/connectors";

export type SaveIndexNowKeyResult =
  | { ok: true }
  | { ok: false; reason: string };

export async function saveIndexNowKey(args: {
  key: string;
  host?: string;
}): Promise<SaveIndexNowKeyResult> {
  if (!isOperatorModeServer()) return { ok: false, reason: "not_operator" };

  const key = args.key.trim();
  if (key.length < 8) {
    return { ok: false, reason: "the key should be at least 8 characters" };
  }

  try {
    const tenantId = await currentTenantId();
    const tenant = await getTenant(tenantId).catch(() => null);
    const existing = await getIndexNowConfig().catch(() => null);
    const host = args.host?.trim() || tenant?.domain || undefined;

    await saveIndexNowConfig({
      key,
      host,
      keyLocation: existing?.keyLocation,
      bingWebmasterApiKey: existing?.bingWebmasterApiKey,
      connected_at: new Date().toISOString(),
    });

    revalidatePath(ROUTE);
    log.info("[indexnow] key saved", { tenantId, host: host ?? null });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message.slice(0, 200) : "save failed",
    };
  }
}

// Void-returning <form action> wrapper the page binds.
export async function saveIndexNowKeyFromForm(formData: FormData): Promise<void> {
  const key = String(formData.get("key") ?? "");
  const host = String(formData.get("host") ?? "");
  await saveIndexNowKey({ key, host: host || undefined });
}
