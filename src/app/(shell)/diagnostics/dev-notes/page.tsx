/**
 * Operator Dev-Notes Surface — 2026-06-10 (§push, advise mode).
 *
 * EVERY actionable Change Card for the current tenant, formatted as a
 * paste-ready dev ticket. This is RITZ'S ONLY OUTPUT PATH (Invariant 2 —
 * no push path to Ritz exists anywhere in the codebase) and the export
 * surface for git_pr tenants until the git adapter lands.
 *
 * Operator-only. Read-only (export, never a write).
 * Pinned by tests/app/diagnostics/dev-notes-page.test.tsx.
 */

import { notFound } from "next/navigation";
import { canPublishForCurrentTenant } from "@/lib/auth/can-publish";
import { PageHeader } from "@/components/data/page-header";
import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import { formatDevNote } from "@/domains/push/dev-note";

export const dynamic = "force-dynamic";

const ACTIONABLE = new Set(["recommended", "accepted", "push_failed"]);

export default async function DevNotesPage() {
  // Night-shift #126 (2026-06-11): gate by PER-TENANT publish auth
  // (operator mode OR owner/admin/founder of the current tenant) —
  // pre-fix this page 404'd for a tenant OWNER unless the GLOBAL
  // operator env flag was set. Same authority the actions enforce.
  if (!(await canPublishForCurrentTenant())) notFound();

  let notes: Array<{ id: string; label: string; note: string }> = [];
  let tenantId = "";
  try {
    tenantId = await currentTenantId();
    const edits = await getRepository().forTenant(tenantId).getRecommendedEdits();
    notes = edits
      .filter((e) => ACTIONABLE.has(e.implementation_status ?? "recommended"))
      .slice(0, 25)
      .map((e) => ({
        id: e.id,
        label: e.display_label ?? e.action_type,
        note: formatDevNote(e),
      }));
  } catch {
    notes = [];
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Dev notes"
        description="Every actionable Change Card as a paste-ready ticket for a developer (or a PR description). This surface only exports — it never writes to any site."
      />
      <p className="text-xs text-muted-foreground">
        tenant: <span className="font-mono">{tenantId || "(unresolved)"}</span> ·{" "}
        {notes.length} actionable card{notes.length === 1 ? "" : "s"}
      </p>
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No actionable cards. New recommendations land here automatically.
        </p>
      ) : (
        notes.map((n) => (
          <section
            key={n.id}
            className="rounded-lg border border-border/40 bg-surface-inset/30 p-4"
          >
            <h2 className="mb-2 text-sm font-semibold">{n.label}</h2>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-bg/40 p-3 font-mono text-xs leading-relaxed">
              {n.note}
            </pre>
          </section>
        ))
      )}
    </div>
  );
}
