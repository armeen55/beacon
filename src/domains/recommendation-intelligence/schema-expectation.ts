import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";
import type { AssetType } from "@/lib/constants";
import {
  CONTENT_PAGE_BIOGRAPHY_EXPECTED_SCHEMA,
  CONTENT_PAGE_EXPECTED_SCHEMA,
  diffSchemaCoverage,
  diffSchemaCoverageForSpec,
  type SchemaCoverageDiff,
} from "@/domains/pages/expected-schema";
import { detectBiographyPage } from "@/domains/pages/biography-detector";
import { classifyPageType, isNonHtmlAsset, type PageType } from "./page-classifier";

export type PageSchemaExpectation = {
  pageType: PageType;
  assetLabel: string;
  coverage: SchemaCoverageDiff;
};

function pageTypeToAssetType(pageType: PageType): AssetType | null {
  switch (pageType) {
    case "homepage": return "homepage";
    case "city": return "city_page";
    case "service": return "service_page";
    case "project": return "project_page";
    case "hub": return "hub_page";
    default: return null;
  }
}

/** One universal page-classification → schema expectation decision. */
export function schemaExpectationForSnapshot(
  snapshot: PageSnapshot,
  businessConfig: BusinessConfig,
): PageSchemaExpectation | null {
  if (isNonHtmlAsset(snapshot.url) || snapshot.extraction_certainty === "uncertain") {
    return null;
  }

  const pageType = classifyPageType(snapshot.url, businessConfig);
  if (pageType === "content") {
    const hasProduct = snapshot.schema_types.some(
      (type) => type.trim().toLowerCase() === "product",
    );
    if (hasProduct) {
      return {
        pageType,
        assetLabel: "store product page",
        coverage: diffSchemaCoverageForSpec(
          { required: ["BreadcrumbList"], recommended: [] },
          snapshot.schema_types,
        ),
      };
    }

    const biography = detectBiographyPage(snapshot);
    return {
      pageType,
      assetLabel: biography.isBiography ? "biography content page" : "content page",
      coverage: diffSchemaCoverageForSpec(
        biography.isBiography
          ? CONTENT_PAGE_BIOGRAPHY_EXPECTED_SCHEMA
          : CONTENT_PAGE_EXPECTED_SCHEMA,
        snapshot.schema_types,
      ),
    };
  }

  const assetType = pageTypeToAssetType(pageType);
  if (!assetType) return null;
  return {
    pageType,
    assetLabel: assetType.replace(/_/g, " "),
    coverage: diffSchemaCoverage(assetType, snapshot.schema_types),
  };
}
