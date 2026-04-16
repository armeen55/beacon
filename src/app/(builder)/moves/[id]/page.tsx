/**
 * Move detail — placeholder for CX3.
 *
 * CX3 replaces this with the full move detail screen:
 * headline, population evidence, paste-ready content (FAQ questions,
 * JSON-LD code block, comparison HTML), dev ticket formatter with
 * copy button, mark-done flow.
 */

export default function MoveDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Move Detail</h1>
      <p className="text-sm text-muted-foreground">
        This screen will show exactly what to do, with paste-ready content
        you can copy directly into a dev ticket.
      </p>
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
        Coming in CX3 + CX5 — guided execution with paste-ready FAQ,
        JSON-LD, and dev tickets
      </div>
    </div>
  );
}
