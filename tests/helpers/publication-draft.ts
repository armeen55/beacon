/** Scripted publication response; legacy flat fixtures remain usable as saved-copy inputs, never as gateway responses. */
export function publicationDraft<T extends Record<string, unknown>>(draft: T) {
  const { before: _before, after, ...metadata } = draft;
  return { preservation: [], ...metadata, units: [{ kind: "paragraph" as const, text: after }] };
}
