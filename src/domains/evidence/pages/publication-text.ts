type Unit = { kind: string; text?: string; items?: readonly string[]; columns?: readonly string[]; rows?: readonly (readonly string[])[] };
export default function publicationText(value: string | Unit): string {
  const text = typeof value === "string" ? value : value.kind === "table" ? [...value.columns ?? [], ...value.rows?.flat() ?? []].join(" ") : value.kind === "ordered_list" || value.kind === "unordered_list" ? (value.items ?? []).join(" ") : value.text ?? "";
  return text.normalize("NFC").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}
