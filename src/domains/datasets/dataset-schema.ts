/**
 * datasets/dataset-schema (BEACON 500 item 76) - PURE schema.org Dataset
 * JSON-LD composer for a citable dataset page. No I/O, no LLM. Kept in the
 * datasets domain (does not touch expected-schema.ts / draft-enrichment.ts -
 * those are owned by a different in-flight item).
 *
 * A Dataset schema block is the strongest machine-readable signal that a page
 * IS a primary data source, not a summary of one - it names the variables the
 * table measures, when it was last refreshed, and who compiled it. This is
 * what lets an AI engine's retrieval step recognize "this page is the
 * dataset" versus "this page mentions the topic".
 */

import type { DatasetCandidate } from "./dataset-candidates";

export type DatasetSchemaCreator = {
  /** The tenant's own site name (business config `name`). */
  name: string;
  /** The tenant's own domain or full URL (business config `domain`). */
  domain: string;
};

/** Normalize a domain-or-URL into a clean https origin, no trailing slash. */
function toOrigin(domain: string): string | null {
  const d = (domain ?? "").trim();
  if (!d) return null;
  const host = d.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/\/+$/, "");
  if (!host || !host.includes(".")) return null;
  return `https://${host}`;
}

export type ComposeDatasetSchemaInput = {
  candidate: Pick<DatasetCandidate, "title" | "description" | "columns" | "slug" | "methodologyLine">;
  creator: DatasetSchemaCreator;
  /** ISO date (YYYY-MM-DD) this dataset was last compiled/refreshed. */
  dateModified: string;
  /** Page path this dataset will live at, e.g. "/data/rice-history-facts" -
   *  combined with the creator's origin for the dataset's url/@id. Optional -
   *  when omitted, the schema still validates without a url field. */
  pagePath?: string | null;
};

/**
 * Compose a valid schema.org Dataset JSON-LD object for one dataset
 * candidate. Returns null only when the creator's domain is unusable (no
 * origin can be built) - every other field degrades gracefully.
 */
export function composeDatasetSchema(input: ComposeDatasetSchemaInput): Record<string, unknown> | null {
  const origin = toOrigin(input.creator.domain);
  if (!origin) return null;
  const creatorName = (input.creator.name ?? "").trim() || origin.replace(/^https?:\/\//, "");

  const variableMeasured = input.candidate.columns.map((col) => ({
    "@type": "PropertyValue",
    name: col.label,
    description: col.source,
  }));

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: input.candidate.title,
    description: input.candidate.description,
    dateModified: input.dateModified,
    creator: {
      "@type": "Organization",
      name: creatorName,
      url: origin,
    },
    license: "https://creativecommons.org/licenses/by/4.0/",
    isAccessibleForFree: true,
    variableMeasured,
  };

  if (input.pagePath) {
    const path = input.pagePath.startsWith("/") ? input.pagePath : `/${input.pagePath}`;
    schema.url = `${origin}${path}`;
    schema["@id"] = `${origin}${path}#dataset`;
  }

  // The methodology line is honest, dated provenance - carried into the
  // schema's own description-of-method field (schema.org's `measurementTechnique`
  // is the closest fit for "how this was compiled", used here as free text).
  schema.measurementTechnique = input.candidate.methodologyLine;

  return schema;
}

/** The ready-to-paste <script> tag wrapping the dataset schema (or null when
 *  composeDatasetSchema itself returns null). */
export function composeDatasetSchemaScript(input: ComposeDatasetSchemaInput): string | null {
  const schema = composeDatasetSchema(input);
  if (!schema) return null;
  return `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;
}
