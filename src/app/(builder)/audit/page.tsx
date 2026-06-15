/**
 * Audit summary — not yet built.
 *
 * Until the audit screen ships, this route returns 404 rather than
 * showing a placeholder. The live audit lives on /today and
 * /recommendations.
 */
import { notFound } from "next/navigation";

export default function AuditPage() {
  notFound();
}
