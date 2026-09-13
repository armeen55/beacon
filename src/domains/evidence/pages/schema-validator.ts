/**
 * Schema.org / JSON-LD validator vs Google rich-result requirements.
 *
 * For each recognized @type on a page, checks that the structured-data block
 * carries the fields Google's Rich Results test expects before it will fire
 * rich snippets. Returns plain-English warnings that feed into the page
 * snapshot's `schema_validation_warnings` array (see types.ts).
 *
 * Pure — walks the JSON-LD object graph, emits strings, touches nothing else.
 * Used by `extractPageSnapshot` at parse time.
 *
 * Sources:
 *   - https://developers.google.com/search/docs/appearance/structured-data
 *   - https://schema.org/FAQPage, HowTo, Product, Article, LocalBusiness,
 *     BreadcrumbList, Service, Organization
 *
 * Green-field: zero existing schema validation in the codebase (the extractor
 * only counts types and extracts FAQs). This module is additive, not a rewrite.
 */

type SchemaWarningSeverity = "critical" | "warning" | "info";

type SchemaWarning = {
  type: string; // @type of the offending block
  severity: SchemaWarningSeverity;
  message: string; // plain-English diagnosis
};

type Validator = (node: Record<string, unknown>) => SchemaWarning[];

// ---------------------------------------------------------------------------
// Small helpers — test individual field presence + content
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function isNonEmptyArray(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.length > 0;
}

// ---------------------------------------------------------------------------
// Per-type validators
// ---------------------------------------------------------------------------

const validateFAQPage: Validator = (node) => {
  const warnings: SchemaWarning[] = [];
  const entities = node.mainEntity;
  if (!isNonEmptyArray(entities)) {
    warnings.push({
      type: "FAQPage",
      severity: "critical",
      message: "FAQPage has no mainEntity array — rich results won't fire.",
    });
    return warnings;
  }
  let missingNameCount = 0;
  let missingAnswerCount = 0;
  for (const entity of entities) {
    if (!entity || typeof entity !== "object") continue;
    const e = entity as Record<string, unknown>;
    if (!isNonEmptyString(e.name)) missingNameCount += 1;
    const accepted = e.acceptedAnswer;
    if (!accepted || typeof accepted !== "object") {
      missingAnswerCount += 1;
      continue;
    }
    const a = accepted as Record<string, unknown>;
    if (!isNonEmptyString(a.text)) missingAnswerCount += 1;
  }
  if (missingNameCount > 0) {
    warnings.push({
      type: "FAQPage",
      severity: "critical",
      message: `${missingNameCount} of ${entities.length} questions missing name — Google will skip these.`,
    });
  }
  if (missingAnswerCount > 0) {
    warnings.push({
      type: "FAQPage",
      severity: "critical",
      message: `${missingAnswerCount} of ${entities.length} questions missing acceptedAnswer.text — rich results won't fire for these.`,
    });
  }
  return warnings;
};

const validateHowTo: Validator = (node) => {
  const warnings: SchemaWarning[] = [];
  if (!isNonEmptyString(node.name)) {
    warnings.push({
      type: "HowTo",
      severity: "critical",
      message: "HowTo missing name — required for rich results.",
    });
  }
  const steps = node.step;
  if (!isNonEmptyArray(steps)) {
    warnings.push({
      type: "HowTo",
      severity: "critical",
      message: "HowTo has no step[] array — rich results won't fire.",
    });
    return warnings;
  }
  let missingStepName = 0;
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const s = step as Record<string, unknown>;
    if (!isNonEmptyString(s.name) && !isNonEmptyString(s.text)) missingStepName += 1;
  }
  if (missingStepName > 0) {
    warnings.push({
      type: "HowTo",
      severity: "warning",
      message: `${missingStepName} of ${steps.length} steps missing name or text.`,
    });
  }
  return warnings;
};

const validateProduct: Validator = (node) => {
  const warnings: SchemaWarning[] = [];
  if (!isNonEmptyString(node.name)) {
    warnings.push({
      type: "Product",
      severity: "critical",
      message: "Product missing name.",
    });
  }
  const offers = node.offers;
  if (!offers || typeof offers !== "object") {
    warnings.push({
      type: "Product",
      severity: "warning",
      message: "Product missing offers block — price/availability rich results won't fire.",
    });
  } else {
    const offersArr = Array.isArray(offers) ? offers : [offers];
    for (const o of offersArr) {
      if (!o || typeof o !== "object") continue;
      const off = o as Record<string, unknown>;
      // audit-wave4 #11: an offer expressed purely as an @id reference resolves
      // elsewhere in the JSON-LD graph — its price lives on the referenced node,
      // so don't flag price/currency as missing here.
      const refOnly =
        Boolean(off["@id"]) &&
        Object.keys(off).every((k) => k === "@id" || k === "@type");
      if (refOnly) continue;
      // AggregateOffer carries lowPrice/highPrice instead of a single price.
      const hasAggregatePrice =
        isNonEmptyString(off.lowPrice) ||
        typeof off.lowPrice === "number" ||
        isNonEmptyString(off.highPrice) ||
        typeof off.highPrice === "number";
      const hasPrice =
        isNonEmptyString(off.price) || typeof off.price === "number";
      if (!hasPrice && !hasAggregatePrice) {
        warnings.push({
          type: "Product",
          severity: "warning",
          message: "Product offers.price missing — won't show price in rich snippet.",
        });
      }
      if (!isNonEmptyString(off.priceCurrency)) {
        warnings.push({
          type: "Product",
          severity: "warning",
          message: "Product offers.priceCurrency missing — ISO currency code required (e.g. USD).",
        });
      }
    }
  }
  return warnings;
};

const validateArticle: Validator = (node) => {
  const warnings: SchemaWarning[] = [];
  if (!isNonEmptyString(node.headline)) {
    warnings.push({
      type: "Article",
      severity: "critical",
      message: "Article missing headline — required by Google.",
    });
  }
  const author = node.author;
  const authorOk =
    isNonEmptyString(author) ||
    (typeof author === "object" &&
      author !== null &&
      (isNonEmptyString((author as Record<string, unknown>).name) ||
        (Array.isArray(author) && author.length > 0)));
  if (!authorOk) {
    warnings.push({
      type: "Article",
      severity: "warning",
      message: "Article missing author — E-E-A-T signal lost.",
    });
  }
  if (!isNonEmptyString(node.datePublished)) {
    warnings.push({
      type: "Article",
      severity: "warning",
      message: "Article missing datePublished — freshness signal lost.",
    });
  }
  return warnings;
};

const validateLocalBusiness: Validator = (node) => {
  const warnings: SchemaWarning[] = [];
  if (!isNonEmptyString(node.name)) {
    warnings.push({
      type: "LocalBusiness",
      severity: "critical",
      message: "LocalBusiness missing name.",
    });
  }
  const address = node.address;
  if (!address || typeof address !== "object") {
    warnings.push({
      type: "LocalBusiness",
      severity: "warning",
      message: "LocalBusiness missing address block.",
    });
  } else {
    const a = Array.isArray(address)
      ? (address[0] as Record<string, unknown>)
      : (address as Record<string, unknown>);
    if (!isNonEmptyString(a.streetAddress)) {
      warnings.push({
        type: "LocalBusiness",
        severity: "warning",
        message: "LocalBusiness address missing streetAddress.",
      });
    }
  }
  if (!isNonEmptyString(node.telephone)) {
    warnings.push({
      type: "LocalBusiness",
      severity: "info",
      message: "LocalBusiness missing telephone — useful for 'call now' surfaces.",
    });
  }
  return warnings;
};

const validateBreadcrumbList: Validator = (node) => {
  const warnings: SchemaWarning[] = [];
  const items = node.itemListElement;
  if (!isNonEmptyArray(items)) {
    warnings.push({
      type: "BreadcrumbList",
      severity: "critical",
      message: "BreadcrumbList has no itemListElement[] array.",
    });
    return warnings;
  }
  let missingPos = 0;
  let missingName = 0;
  let missingItem = 0;
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const i = it as Record<string, unknown>;
    if (typeof i.position !== "number") missingPos += 1;
    if (!isNonEmptyString(i.name)) missingName += 1;
    if (!isNonEmptyString(i.item) && !(typeof i.item === "object" && i.item)) {
      missingItem += 1;
    }
  }
  if (missingPos > 0) {
    warnings.push({
      type: "BreadcrumbList",
      severity: "warning",
      message: `${missingPos} breadcrumb(s) missing position.`,
    });
  }
  if (missingName > 0) {
    warnings.push({
      type: "BreadcrumbList",
      severity: "warning",
      message: `${missingName} breadcrumb(s) missing name.`,
    });
  }
  if (missingItem > 0) {
    warnings.push({
      type: "BreadcrumbList",
      severity: "warning",
      message: `${missingItem} breadcrumb(s) missing item URL.`,
    });
  }
  return warnings;
};

const validateService: Validator = (node) => {
  const warnings: SchemaWarning[] = [];
  if (!isNonEmptyString(node.name)) {
    warnings.push({
      type: "Service",
      severity: "critical",
      message: "Service missing name.",
    });
  }
  if (!node.provider) {
    warnings.push({
      type: "Service",
      severity: "warning",
      message: "Service missing provider — rich result won't link back to you.",
    });
  }
  return warnings;
};

const validateOrganization: Validator = (node) => {
  const warnings: SchemaWarning[] = [];
  if (!isNonEmptyString(node.name)) {
    warnings.push({
      type: "Organization",
      severity: "critical",
      message: "Organization missing name.",
    });
  }
  if (!isNonEmptyString(node.url)) {
    warnings.push({
      type: "Organization",
      severity: "info",
      message: "Organization missing url.",
    });
  }
  return warnings;
};

// Registry keyed by recognized @type.
const VALIDATORS: Record<string, Validator> = {
  FAQPage: validateFAQPage,
  HowTo: validateHowTo,
  Product: validateProduct,
  Article: validateArticle,
  NewsArticle: validateArticle,
  BlogPosting: validateArticle,
  LocalBusiness: validateLocalBusiness,
  BreadcrumbList: validateBreadcrumbList,
  Service: validateService,
  Organization: validateOrganization,
};

// ---------------------------------------------------------------------------
// Walker — handles arrays + @graph recursion
// ---------------------------------------------------------------------------

/**
 * Walk a parsed JSON-LD document and return all accumulated warnings.
 * Handles:
 *   - top-level array of nodes
 *   - objects with @graph arrays
 *   - nested types (validates the outermost recognized type per node)
 *
 * Does NOT mutate input.
 */
function validateSchema(data: unknown): SchemaWarning[] {
  const warnings: SchemaWarning[] = [];
  walk(data, warnings);
  return warnings;
}

function walk(data: unknown, out: SchemaWarning[]): void {
  if (!data || typeof data !== "object") return;

  if (Array.isArray(data)) {
    for (const node of data) walk(node, out);
    return;
  }

  const node = data as Record<string, unknown>;

  // Run per-type validators. A node with multiple @types is validated against each.
  const typeField = node["@type"];
  const types =
    typeof typeField === "string"
      ? [typeField]
      : Array.isArray(typeField)
        ? (typeField.filter((t) => typeof t === "string") as string[])
        : [];
  for (const type of types) {
    const v = VALIDATORS[type];
    if (v) out.push(...v(node));
  }

  // Recurse into @graph — top-level container used by many CMSes.
  if (Array.isArray(node["@graph"])) {
    for (const child of node["@graph"]) walk(child, out);
  }
}

// ---------------------------------------------------------------------------
// Format helpers for surfacing in `schema_validation_warnings`
// ---------------------------------------------------------------------------

/**
 * Render a SchemaWarning as a single plain-English string suitable for the
 * `schema_validation_warnings: string[]` field on PageSnapshot.
 * Format: `schema_<severity>:<type>: <message>`
 */
function formatWarning(w: SchemaWarning): string {
  return `schema_${w.severity}:${w.type}: ${w.message}`;
}

/** Convenience — validate + format in one shot. */
export function validateSchemaToStrings(data: unknown): string[] {
  return validateSchema(data).map(formatWarning);
}
