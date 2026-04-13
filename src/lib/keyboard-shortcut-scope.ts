/**
 * Returns true when the event target is inside a field where letter shortcuts
 * should not run (Today j/k/a only — no global shortcut system).
 */
export function isKeyboardTypingTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined") return false;
  if (target === null) return false;
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true']"),
  );
}
