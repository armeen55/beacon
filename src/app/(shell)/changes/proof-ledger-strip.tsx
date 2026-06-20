import Link from "next/link";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { loadProofLedger } from "@/domains/proof-gsc/load-ledger";

/**
 * Operator-only GSC Proof ledger summary strip for /changes (Phase 5, Path B).
 * Read-only: a compact roll-up of shipped changes being measured vs controls,
 * linking to the full ledger on /proof. Renders null for customers / empty
 * ledger so the customer timeline is untouched. Mounted in a Suspense boundary.
 */
export async function ProofLedgerStrip() {
  if (!isOperatorModeServer()) return null;
  let ledger;
  try {
    const tenantId = await currentTenantId();
    ledger = await loadProofLedger(tenantId);
  } catch {
    return null;
  }
  if (!ledger || ledger.length === 0) return null;

  const measuring = ledger.filter((l) => l.verdict === "measuring").length;
  const won = ledger.filter((l) => l.verdict === "won").length;
  const lost = ledger.filter((l) => l.verdict === "lost").length;
  const inconclusive = ledger.filter((l) => l.verdict === "inconclusive").length;

  return (
    <Link
      href="/proof"
      prefetch={false}
      className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-surface-inset/30 px-4 py-2.5 text-[12px] hover:border-border"
    >
      <span className="font-semibold text-foreground">Proof ledger</span>
      <span className="text-muted-foreground">{ledger.length} shipped &amp; tracked</span>
      {measuring > 0 ? <span className="text-blue-700">{measuring} measuring</span> : null}
      {won > 0 ? <span className="text-emerald-700">{won} won</span> : null}
      {lost > 0 ? <span className="text-rose-700">{lost} lost</span> : null}
      {inconclusive > 0 ? (
        <span className="text-muted-foreground">{inconclusive} inconclusive</span>
      ) : null}
      <span className="ml-auto text-accent-primary">Open Proof →</span>
    </Link>
  );
}
