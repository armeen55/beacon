/**
 * Body-section merge engine (BEACON_500 item 2, 2026-07-01).
 *
 * PURE and deterministic: no I/O, no clock, no server-only import. The
 * push service and the tests run the exact same merge, so what a test
 * proves is what production writes.
 *
 * Contract (non-destructive discipline):
 *   - The merge is computed LOCALLY from the full existing value and the
 *     draft; the caller writes the full new value back in one update.
 *   - prepend/append NEVER wipe the original: the merged result must
 *     still contain the original content (a configurable minimum), or
 *     the merge fails closed.
 *   - replace_section swaps exactly one heading-delimited section and
 *     preserves everything before and after it verbatim. A replacement
 *     dramatically shorter than what it replaces is treated as a
 *     deletion and fails closed.
 *   - Unrecognized field kinds fail closed with a plain receipt so the
 *     operator pastes the change instead of Beacon guessing.
 *
 * Supported kinds (the honest subset):
 *   plain - plain-text fields. Fully supported (all three modes).
 *   html  - HTML-string fields. Fully supported (all three modes).
 *   ricos - structured RICOS JSON fields. Conservative: minimal
 *           paragraph-node prepend/append built from the draft text;
 *           replace_section fails closed (we never restructure inside
 *           someone's rich-content tree).
 */

import { isWixBodyFieldKind } from "@/lib/connectors/wix/types";

export type BodyMergeMode = "prepend_answer" | "append_faq" | "replace_section";

export type BodyMergeOptions = {
  /** Heading of the section to replace (required for replace_section). */
  sectionHeading?: string;
  /** Minimum fraction of the original body length that must survive a
   *  prepend/append merge. Defaults to MIN_ORIGINAL_KEEP_RATIO. */
  minKeepRatio?: number;
};

export type BodyMergeResult =
  | { ok: true; merged: string; summary: string }
  | { ok: false; reason: string };

/** prepend/append keep the original verbatim by construction; this floor
 *  is the guard that a future refactor can never silently violate. */
export const MIN_ORIGINAL_KEEP_RATIO = 0.98;

/** A replacement this much smaller than the section it replaces is
 *  deletion-shaped and fails closed (mirrors assertNonDestructivePatch). */
const REPLACE_MIN_SIZE_RATIO = 0.2;
const REPLACE_GUARD_FLOOR_CHARS = 80;

/**
 * Which recommendation action types produce a body SECTION that Beacon can
 * merge, and how. Additive only by default:
 *   add_answer_block -> prepend_answer (answer blocks lead the page)
 *   add_faq          -> append_faq    (FAQ sections close the page)
 *   add_h2_section   -> append_faq    (a new section also appends)
 * Section REPLACEMENT is opt-in via an explicit "section:<heading>"
 * element key on the card, never inferred from an action type, because
 * most rewrite-shaped drafts carry only the new heading text, and
 * replacing a whole section with a heading would delete its body.
 */
export function bodyMergeModeForAction(actionType: string): BodyMergeMode | null {
  switch (actionType) {
    case "add_answer_block":
      return "prepend_answer";
    case "add_faq":
    case "add_h2_section":
      return "append_faq";
    default:
      return null;
  }
}

/** Operator receipt for a field kind we refuse to write. Exported so the
 *  push service and tests share the exact copy. */
export function unrecognizedKindReason(kind: string): string {
  return `I could not safely write this "${kind}" field type, so I left it for you to paste.`;
}

const normalizeHeading = (s: string): string =>
  s
    .replace(/^#+\s*/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/**
 * Never-wipe assertion for prepend/append merges: the merged value must
 * still contain the trimmed original verbatim AND be at least
 * minKeepRatio of the original length. Exported for direct testing (the
 * merge constructions cannot violate it, so tests exercise it here).
 */
export function originalContentRetained(args: {
  existing: string;
  merged: string;
  minKeepRatio?: number;
}): boolean {
  const core = args.existing.trim();
  if (core.length === 0) return true; // nothing to wipe
  const ratio = args.minKeepRatio ?? MIN_ORIGINAL_KEEP_RATIO;
  return (
    args.merged.includes(core) &&
    args.merged.length >= Math.floor(args.existing.length * ratio)
  );
}

const NEVER_WIPE_REASON =
  "The merged result would lose part of the existing page body, so I stopped and left this change for you to paste.";

// ─── plain text ───────────────────────────────────────────────────────

/** True when a line looks like a standalone plain-text heading: short,
 *  preceded by a blank line (or the top), and not sentence-ended. */
function isPlainHeadingLine(lines: string[], i: number): boolean {
  const t = (lines[i] ?? "").trim();
  if (t === "" || t.length > 90) return false;
  if (/[.!?,;]$/.test(t)) return false;
  return i === 0 || (lines[i - 1] ?? "").trim() === "";
}

function mergePlain(
  existing: string,
  draft: string,
  mode: BodyMergeMode,
  opts: BodyMergeOptions,
): BodyMergeResult {
  if (mode === "prepend_answer") {
    const merged = existing.trim() === "" ? draft : `${draft}\n\n${existing}`;
    if (!originalContentRetained({ existing, merged, minKeepRatio: opts.minKeepRatio })) {
      return { ok: false, reason: NEVER_WIPE_REASON };
    }
    return { ok: true, merged, summary: "added the new section at the top of the page body" };
  }
  if (mode === "append_faq") {
    const merged = existing.trim() === "" ? draft : `${existing}\n\n${draft}`;
    if (!originalContentRetained({ existing, merged, minKeepRatio: opts.minKeepRatio })) {
      return { ok: false, reason: NEVER_WIPE_REASON };
    }
    return { ok: true, merged, summary: "added the new section at the end of the page body" };
  }
  // replace_section
  const heading = (opts.sectionHeading ?? "").trim();
  if (heading === "") {
    return { ok: false, reason: "I was not told which section to replace, so I left this change for you to paste." };
  }
  const target = normalizeHeading(heading);
  const lines = existing.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isPlainHeadingLine(lines, i) && normalizeHeading(lines[i]!) === target) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    return {
      ok: false,
      reason: `I could not find the "${heading}" section on this page, so I left this change for you to paste.`,
    };
  }
  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) {
    if (isPlainHeadingLine(lines, j) && normalizeHeading(lines[j]!) !== target) {
      end = j;
      break;
    }
  }
  const replaced = lines.slice(start, end).join("\n");
  if (
    replaced.trim().length > REPLACE_GUARD_FLOOR_CHARS &&
    draft.length < replaced.trim().length * REPLACE_MIN_SIZE_RATIO
  ) {
    return {
      ok: false,
      reason:
        "The new section is much shorter than the one it would replace, so I treated this as a deletion and stopped. Paste it yourself if you are sure.",
    };
  }
  const before = lines.slice(0, start).join("\n");
  const after = lines.slice(end).join("\n");
  const merged = [before, draft, after].filter((p) => p.trim() !== "").join("\n");
  if (!merged.includes(before.trim()) || !merged.includes(after.trim())) {
    return { ok: false, reason: NEVER_WIPE_REASON };
  }
  return { ok: true, merged, summary: `replaced the "${heading}" section` };
}

// ─── HTML strings ─────────────────────────────────────────────────────

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Draft to HTML: pass real HTML through untouched; wrap plain prose in
 *  escaped <p> blocks (blank lines split paragraphs, single newlines
 *  become <br />). Deterministic. */
export function draftToHtml(draft: string): string {
  if (/<[a-z][^>]*>/i.test(draft)) return draft;
  return draft
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map((p) => `<p>${escapeHtml(p).replace(/\r?\n/g, "<br />")}</p>`)
    .join("\n");
}

type HtmlHeading = { level: number; text: string; start: number; end: number };

function findHtmlHeadings(html: string): HtmlHeading[] {
  const out: HtmlHeading[] = [];
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push({
      level: Number(m[1]),
      text: normalizeHeading(m[2] ?? ""),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

function mergeHtml(
  existing: string,
  draft: string,
  mode: BodyMergeMode,
  opts: BodyMergeOptions,
): BodyMergeResult {
  const draftHtml = draftToHtml(draft);
  if (mode === "prepend_answer") {
    const merged = existing.trim() === "" ? draftHtml : `${draftHtml}\n${existing}`;
    if (!originalContentRetained({ existing, merged, minKeepRatio: opts.minKeepRatio })) {
      return { ok: false, reason: NEVER_WIPE_REASON };
    }
    return { ok: true, merged, summary: "added the new section at the top of the page body" };
  }
  if (mode === "append_faq") {
    const merged = existing.trim() === "" ? draftHtml : `${existing}\n${draftHtml}`;
    if (!originalContentRetained({ existing, merged, minKeepRatio: opts.minKeepRatio })) {
      return { ok: false, reason: NEVER_WIPE_REASON };
    }
    return { ok: true, merged, summary: "added the new section at the end of the page body" };
  }
  // replace_section: swap from the matched heading tag to just before the
  // next heading of the same or higher level (or the end of the string).
  const heading = (opts.sectionHeading ?? "").trim();
  if (heading === "") {
    return { ok: false, reason: "I was not told which section to replace, so I left this change for you to paste." };
  }
  const target = normalizeHeading(heading);
  const headings = findHtmlHeadings(existing);
  const idx = headings.findIndex((h) => h.text === target);
  if (idx < 0) {
    return {
      ok: false,
      reason: `I could not find the "${heading}" section on this page, so I left this change for you to paste.`,
    };
  }
  const section = headings[idx]!;
  const next = headings
    .slice(idx + 1)
    .find((h) => h.level <= section.level);
  const sectionEnd = next != null ? next.start : existing.length;
  const replaced = existing.slice(section.start, sectionEnd);
  if (
    replaced.trim().length > REPLACE_GUARD_FLOOR_CHARS &&
    draftHtml.length < replaced.trim().length * REPLACE_MIN_SIZE_RATIO
  ) {
    return {
      ok: false,
      reason:
        "The new section is much shorter than the one it would replace, so I treated this as a deletion and stopped. Paste it yourself if you are sure.",
    };
  }
  const before = existing.slice(0, section.start);
  const after = existing.slice(sectionEnd);
  const merged = `${before}${draftHtml}${after}`;
  if (!merged.includes(before) || !merged.includes(after)) {
    return { ok: false, reason: NEVER_WIPE_REASON };
  }
  return { ok: true, merged, summary: `replaced the "${heading}" section` };
}

// ─── RICOS JSON (structured rich content) ─────────────────────────────

type RicosNode = Record<string, unknown>;
type RicosDoc = { nodes: RicosNode[] } & Record<string, unknown>;

/** Minimal valid RICOS paragraph node carrying one text run. Deterministic
 *  ids so a re-run produces byte-identical output. */
export function buildRicosParagraphNodes(
  draft: string,
  mode: BodyMergeMode,
): RicosNode[] {
  const prefix = mode === "prepend_answer" ? "beacon-answer" : "beacon-section";
  return draft
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line, i) => ({
      type: "PARAGRAPH",
      id: `${prefix}-${i + 1}`,
      nodes: [
        {
          type: "TEXT",
          id: "",
          nodes: [],
          textData: { text: line, decorations: [] },
        },
      ],
      paragraphData: {},
    }));
}

function parseRicosDoc(existing: string): RicosDoc | null {
  if (existing.trim() === "") return { nodes: [] };
  try {
    const parsed: unknown = JSON.parse(existing);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const doc = parsed as Record<string, unknown>;
    if (doc.nodes === undefined) return { ...doc, nodes: [] };
    if (!Array.isArray(doc.nodes)) return null;
    return doc as RicosDoc;
  } catch {
    return null;
  }
}

function mergeRicos(
  existing: string,
  draft: string,
  mode: BodyMergeMode,
): BodyMergeResult {
  if (mode === "replace_section") {
    return {
      ok: false,
      reason:
        "I can add new sections to this rich content field, but I cannot safely replace a section inside it, so I left that change for you to paste.",
    };
  }
  const doc = parseRicosDoc(existing);
  if (doc == null) {
    return {
      ok: false,
      reason:
        "This rich content field is not in a structure I recognize, so I left this change for you to paste.",
    };
  }
  const newNodes = buildRicosParagraphNodes(draft, mode);
  if (newNodes.length === 0) {
    return { ok: false, reason: "The draft is empty, so there is nothing to apply." };
  }
  const nodes =
    mode === "prepend_answer" ? [...newNodes, ...doc.nodes] : [...doc.nodes, ...newNodes];
  const mergedDoc: RicosDoc = { ...doc, nodes };
  // Never-wipe (structural form): every original node survives, in order.
  if (nodes.length !== doc.nodes.length + newNodes.length) {
    return { ok: false, reason: NEVER_WIPE_REASON };
  }
  if (doc.nodes.length > 0) {
    const originalRun = JSON.stringify(doc.nodes).slice(1, -1);
    if (!JSON.stringify(nodes).includes(originalRun)) {
      return { ok: false, reason: NEVER_WIPE_REASON };
    }
  }
  const where = mode === "prepend_answer" ? "top" : "end";
  return {
    ok: true,
    merged: JSON.stringify(mergedDoc),
    summary: `added ${newNodes.length} paragraph${newNodes.length === 1 ? "" : "s"} at the ${where} of the rich content body`,
  };
}

// ─── entry point ──────────────────────────────────────────────────────

/**
 * Merge a section draft into an existing body value. `existing` is the
 * SERIALIZED current value ("" when the field is empty); the caller
 * writes `merged` back as the full new value (parsing it back to an
 * object for structured fields). Deterministic; fails closed on anything
 * it cannot do safely.
 */
export function mergeBodyContent(args: {
  existing: string;
  draft: string;
  kind: string;
  mode: BodyMergeMode;
  opts?: BodyMergeOptions;
}): BodyMergeResult {
  const draft = args.draft.trim();
  if (draft === "") {
    return { ok: false, reason: "The draft is empty, so there is nothing to apply." };
  }
  if (!isWixBodyFieldKind(args.kind)) {
    return { ok: false, reason: unrecognizedKindReason(args.kind) };
  }
  const opts = args.opts ?? {};
  switch (args.kind) {
    case "plain":
      return mergePlain(args.existing, draft, args.mode, opts);
    case "html":
      return mergeHtml(args.existing, draft, args.mode, opts);
    case "ricos":
      return mergeRicos(args.existing, draft, args.mode);
  }
}
