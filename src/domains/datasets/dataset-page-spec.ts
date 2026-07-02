/**
 * datasets/dataset-page-spec (BEACON 500 item 76) - turns a DatasetCandidate
 * into a full page brief (sortable table spec, dated methodology line, a
 * cite-this-page block, and the Dataset JSON-LD), and adapts it into the
 * page-factory's own PageCandidate shape so it rides the EXISTING new-page
 * pipeline (dedupe -> validate-demand -> batch-store -> New Pages board)
 * untouched. PURE - no I/O, no LLM.
 */

import type { PageCandidate } from "@/domains/page-factory/entity-attribute-factory";
import type { DatasetCandidate } from "./dataset-candidates";
import { composeDatasetSchema, type DatasetSchemaCreator } from "./dataset-schema";

export type DatasetTableSpec = {
  columns: { key: string; label: string }[];
  /** True - every compiled dataset table is sortable by any column; this
   *  flag exists so the page-render layer knows to wire the sort control. */
  sortable: true;
  rowCountEstimate: number;
};

export type DatasetPageBrief = {
  slug: string;
  title: string;
  description: string;
  methodologyLine: string;
  citeThisPageLine: string;
  table: DatasetTableSpec;
  /** The composed schema.org Dataset JSON-LD, or null when the tenant's
   *  domain could not be resolved into a usable origin. */
  jsonLd: Record<string, unknown> | null;
  datasetTag: "dataset_page";
};

/** "Cite this page: <title>, <site>, updated <date>." - the exact honest,
 *  dated attribution line the page itself displays for anyone quoting it. */
export function buildCiteThisPageLine(args: { title: string; siteName: string; dateModified: string }): string {
  return `Cite this page: ${args.title}, ${args.siteName}, updated ${args.dateModified}.`;
}

/**
 * Build the full page brief for one dataset candidate. `pagePath` is optional
 * (the operator has not chosen a URL yet at candidate time); when omitted the
 * JSON-LD still validates, just without a url/@id.
 */
export function buildDatasetPageBrief(args: {
  candidate: DatasetCandidate;
  creator: DatasetSchemaCreator;
  dateModified: string;
  pagePath?: string | null;
}): DatasetPageBrief {
  const { candidate, creator, dateModified } = args;
  const siteName = (creator.name ?? "").trim() || creator.domain;
  const jsonLd = composeDatasetSchema({
    candidate,
    creator,
    dateModified,
    pagePath: args.pagePath ?? null,
  });

  return {
    slug: candidate.slug,
    title: candidate.title,
    description: candidate.description,
    methodologyLine: candidate.methodologyLine,
    citeThisPageLine: buildCiteThisPageLine({ title: candidate.title, siteName, dateModified }),
    table: {
      columns: candidate.columns.map((c) => ({ key: c.key, label: c.label })),
      sortable: true,
      rowCountEstimate: candidate.rowCountEstimate,
    },
    jsonLd,
    datasetTag: "dataset_page",
  };
}

/**
 * Adapt a DatasetCandidate into the page-factory's PageCandidate shape, so
 * the weekly production line's existing dedupe -> validate-demand -> draft
 * pipeline can carry it without any change to that pipeline's own types.
 * `entity` carries the candidate's title (used only for dedupe/labeling by
 * the existing machinery); `attribute` is fixed to "dataset" so it never
 * collides with an entity-attribute-factory slug for the same topic.
 */
export function datasetCandidateToPageCandidate(candidate: DatasetCandidate): PageCandidate {
  return {
    slug: candidate.slug,
    title: candidate.title,
    entity: candidate.title,
    attribute: "dataset",
    intent: "informational",
    relevance: 1,
    needsDemandValidation: true,
    why: candidate.whyItWins,
  };
}
