/**
 * Audit summary — placeholder for CX3.
 *
 * CX3 replaces this with the full builder-grade audit screen:
 * one big number (AI mention rate), top competitor comparison,
 * 3 move cards, platform breakdown strip.
 */

export default function AuditPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Your AI Visibility Audit</h1>
      <p className="text-sm text-muted-foreground">
        This screen will show your AI mention rate, top competitors, and
        the 3 most impactful moves you can make right now.
      </p>
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
        Coming in CX3 — audit summary with paste-ready moves
      </div>
    </div>
  );
}
