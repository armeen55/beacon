import { z } from "zod";

export const publicationUnits = z.array(z.union([
  z.object({ kind: z.literal("paragraph"), text: z.string().min(1), links: z.array(z.object({ text: z.string().min(1), href: z.string().min(1) })).nullable().optional() }),
  z.object({ kind: z.literal("heading"), level: z.number().int().min(1).max(6), text: z.string().min(1) }),
  z.object({ kind: z.literal("ordered_list"), items: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal("unordered_list"), items: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal("table"), columns: z.array(z.string().min(1)).min(2).max(8), rows: z.array(z.array(z.string().min(1)).min(2).max(8)).min(1).max(30) }),
])).min(1).superRefine((units, ctx) => {
  for (const [i, unit] of units.entries()) {
    if (unit.kind === "table") for (const [r, row] of unit.rows.entries()) if (row.length !== unit.columns.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "rows", r], message: "table rows must match the declared columns" });
    if (unit.kind !== "paragraph") continue;
    const spans = (unit.links ?? []).map(link => ({ ...link, at: unit.text.indexOf(link.text) })).sort((a, b) => a.at - b.at);
    if (spans.some((link, at) => !link.text.trim() || unit.text.split(link.text).length !== 2 || at > 0 && link.at < spans[at - 1]!.at + spans[at - 1]!.text.length)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "links"], message: "paragraph links require unique nonoverlapping exact anchor words" });
  }
});
