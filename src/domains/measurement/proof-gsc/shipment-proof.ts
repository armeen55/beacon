import { createHash } from "node:crypto";
import type { ShippedChangeRecord, ShipmentVerification } from "./shipped-change-store";

type Claim = Partial<Pick<ShippedChangeRecord, "page" | "actionType" | "implementedAt" | "before" | "after" | "componentsApplied">> & { verification?: Omit<Partial<ShipmentVerification>, "status"> & { status?: string | null } | null };
const digest = (text: string): string => createHash("sha256").update(text).digest("hex");
function components(r: Claim) {
  const copy = (r.after ?? "").trim(), was = (r.before ?? "").trim(), applied = r.componentsApplied ?? [];
  if (!applied.length) return copy || r.actionType ? [{ id: null, kind: r.actionType || "content", after: copy, before: was || null, anchorAfter: null, redirectTo: null }] : [];
  const lone = applied.length === 1;
  return applied.map((c) => ({ id: c.id ?? null, kind: c.kind, anchorAfter: c.anchorAfter ?? null, redirectTo: c.redirectTo ?? null,
    before: (c.before ?? "").trim() || (lone || c.kind === r.actionType ? was : "") || null,
    after: (c.appliedAfter ?? "").trim() || (c.after ?? "").trim() || (lone || c.kind === r.actionType ? copy : "") }));
}

/** One applied-unit identity and checker contract. Old observations remain history, not delivery permission. */
export const SHIPMENT_PROOF = {
  contract: 1 as const,
  components,
  of(r: Claim, inspectedEvidence?: string): NonNullable<ShipmentVerification["proof"]> | null {
    const at = Date.parse(r.implementedAt ?? ""), pieces = components(r);
    if (!r.page || !Number.isFinite(at) || !pieces.length) return null;
    const appliedHash = digest(JSON.stringify([r.page, r.implementedAt, r.actionType, pieces]));
    if (inspectedEvidence) return { appliedHash, inspectedHash: digest(inspectedEvidence) };
    const v = r.verification, checked = Date.parse(v?.checkedAt ?? ""), answers = Array.isArray(v?.components) ? v.components.filter((c) => c != null && c.kind !== "google_display") : [];
    return v?.checkerContract === SHIPMENT_PROOF.contract && v.status === "verified" && Number.isFinite(checked) && checked >= at
      && v.proof?.appliedHash === appliedHash && /^[a-f0-9]{64}$/.test(v.proof.inspectedHash)
      && answers.length === pieces.length && answers.every((c, i) => c.kind === pieces[i]!.kind && c.state === "verified") ? v.proof : null;
  },
};
