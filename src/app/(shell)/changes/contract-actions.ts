"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import {
  getChangeContracts,
  persistChangeContracts,
  validateContract,
  scoreAttributionReadiness,
  generateVerificationChecks,
  suggestOutcomeWindow,
  type ChangeContract,
  type ChangeType,
  type PageType,
  type SourceInputType,
} from "@/domains/changelog/change-contract";
import { absoluteUrlForPath } from "@/lib/site-config";
import { currentTenantId } from "@/lib/tenant-context";

export type VerificationCheckRow = {
  id: string;
  label: string;
  status: "matched" | "did_not_match" | "not_checked";
  note?: string;
};

function isNewPageType(ct: ChangeType): boolean {
  return (
    ct === "new_page_creation" ||
    ct === "guide_page_creation" ||
    ct === "project_page_creation"
  );
}

function buildVerificationCheckRows(
  contract: ChangeContract,
  snap: {
    url: string;
    faqs: { question: string }[];
    schema_types: string[];
    h1: string | null;
    http_status: number;
  } | null,
  matched: string[],
  missing: string[],
  skipped: string[]
): VerificationCheckRow[] {
  const rows: VerificationCheckRow[] = [];
  const skipText = skipped.join(" · ");
  const notScanned = skipped.some((s) => s.includes("not been scanned"));

  // ── Page in scan ──
  if (snap) {
    rows.push({
      id: "page_scan",
      label: "Page found in latest Beacon scan",
      status: "matched",
      note: snap.url,
    });
  } else if (notScanned) {
    rows.push({
      id: "page_scan",
      label: "Page found in latest Beacon scan",
      status: "not_checked",
      note: skipText || "Run a site scan, then check again.",
    });
  } else if (missing.some((m) => m.includes("does not exist"))) {
    rows.push({
      id: "page_scan",
      label: "Page found in latest Beacon scan",
      status: "did_not_match",
      note: missing.find((m) => m.includes("does not exist")),
    });
  } else {
    rows.push({
      id: "page_scan",
      label: "Page found in latest Beacon scan",
      status: "did_not_match",
      note: missing[0] ?? skipText,
    });
  }

  const canReadSnap = !!snap;

  // ── Q&A count ──
  if (contract.faqCountExpected != null) {
    const exp = contract.faqCountExpected;
    if (!canReadSnap) {
      rows.push({
        id: "faq_count",
        label: `Q&A blocks (expect at least ${exp})`,
        status: "not_checked",
        note: "No scan data for this URL.",
      });
    } else if (snap!.faqs.length >= exp) {
      rows.push({
        id: "faq_count",
        label: `Q&A blocks (expect at least ${exp})`,
        status: "matched",
        note: `Found ${snap!.faqs.length}.`,
      });
    } else {
      rows.push({
        id: "faq_count",
        label: `Q&A blocks (expect at least ${exp})`,
        status: "did_not_match",
        note: `Found ${snap!.faqs.length}.`,
      });
    }
  } else {
    rows.push({
      id: "faq_count",
      label: "Q&A block count",
      status: "not_checked",
      note: "Not specified on this contract.",
    });
  }

  // ── Structured data types ──
  if (contract.schemaTypesExpected.length > 0) {
    const expected = contract.schemaTypesExpected;
    if (!canReadSnap) {
      rows.push({
        id: "schema",
        label: `Structured data types (${expected.join(", ")})`,
        status: "not_checked",
        note: "No scan data for this URL.",
      });
    } else {
      const notFound = expected.filter((t) => !snap!.schema_types.includes(t));
      if (notFound.length === 0) {
        rows.push({
          id: "schema",
          label: `Structured data types (${expected.join(", ")})`,
          status: "matched",
          note: `Present in crawl snapshot.`,
        });
      } else {
        rows.push({
          id: "schema",
          label: `Structured data types (${expected.join(", ")})`,
          status: "did_not_match",
          note: `Missing: ${notFound.join(", ")}.`,
        });
      }
    }
  } else {
    rows.push({
      id: "schema",
      label: "Structured data types",
      status: "not_checked",
      note: "Not specified on this contract.",
    });
  }

  // ── H1 ──
  if (contract.h1Expected) {
    if (!canReadSnap) {
      rows.push({
        id: "h1",
        label: "Page heading (H1)",
        status: "not_checked",
        note: "No scan data for this URL.",
      });
    } else {
      const h1Miss = missing.some(
        (m) => m.startsWith("Page heading") || m.startsWith("No page heading")
      );
      const h1Match = matched.some((m) => m.startsWith("Page heading"));
      rows.push({
        id: "h1",
        label: "Page heading (H1)",
        status: h1Miss ? "did_not_match" : h1Match ? "matched" : "not_checked",
        note: snap!.h1 ? `Snapshot: "${snap!.h1}"` : "No H1 in snapshot.",
      });
    }
  } else {
    rows.push({
      id: "h1",
      label: "Page heading (H1)",
      status: "not_checked",
      note: "Not specified on this contract.",
    });
  }

  // ── New / updated page HTTP ──
  if (isNewPageType(contract.changeType)) {
    if (!canReadSnap) {
      rows.push({
        id: "http_200",
        label: "Page responds with HTTP 200",
        status: "not_checked",
        note: "No scan data for this URL.",
      });
    } else if (snap!.http_status === 200) {
      rows.push({
        id: "http_200",
        label: "Page responds with HTTP 200",
        status: "matched",
      });
    } else {
      rows.push({
        id: "http_200",
        label: "Page responds with HTTP 200",
        status: "did_not_match",
        note: `HTTP ${snap!.http_status}.`,
      });
    }
  } else {
    rows.push({
      id: "http_200",
      label: "HTTP status (new page check)",
      status: "not_checked",
      note: "Only applies to new page change types.",
    });
  }

  // ── Not implemented in this verifier (explicit not_checked) ──
  rows.push({
    id: "title",
    label: "HTML title tag",
    status: "not_checked",
    note: contract.titleExpected
      ? "You set an expectation, but Beacon does not compare title in this check yet."
      : "Not specified on this contract.",
  });

  rows.push({
    id: "meta",
    label: "Meta description",
    status: "not_checked",
    note: contract.metaExpected
      ? "Meta comparison is not part of this scan check yet."
      : "Not specified on this contract.",
  });

  rows.push({
    id: "internal_links",
    label: "Internal links to specific URLs",
    status: "not_checked",
    note:
      contract.internalLinksExpected.length > 0
        ? "Link targets are not verified in this scan yet."
        : "Not specified on this contract.",
  });

  rows.push({
    id: "sitemap",
    label: "Listed in sitemap",
    status: "not_checked",
    note: isNewPageType(contract.changeType)
      ? "Sitemap membership is not verified in this run."
      : "Not applicable for this change type.",
  });

  rows.push({
    id: "rendered_dom",
    label: "Rendered page matches raw HTML (render check)",
    status: "not_checked",
    note:
      contract.changeType === "prerender_fix" ||
      contract.changeType === "technical_rendering_fix"
        ? "Render checks are separate from this snapshot step."
        : "Not applicable unless you flagged a rendering fix.",
  });

  return rows;
}

export async function createChangeContract(
  input: {
    accountId: string;
    pageUrl: string;
    pageType: PageType;
    changeType: ChangeType;
    changeSummary: string;
    businessGoal: string;
    intendedHypothesis: string;
    dateRequested: string;
    dateLive?: string;
    city?: string;
    service?: string;
    topic?: string;
    faqCountExpected?: number;
    schemaTypesExpected?: string[];
    h1Expected?: string;
    titleExpected?: string;
    metaExpected?: string;
    internalLinksExpected?: string[];
    sourceDocument?: string;
    sourceInputType?: SourceInputType;
    notes?: string;
  }
): Promise<{ success: boolean; contractId?: string; errors?: string[]; warnings?: string[] }> {
  const action = "createChangeContract";
  const t0 = Date.now();
  log.info("Action started", {
    action,
    params: {
      changeType: input.changeType,
      pageUrlLength: input.pageUrl.length,
    },
  });
  const now = new Date().toISOString();

  const draft: Partial<ChangeContract> = {
    pageUrl: input.pageUrl,
    changeType: input.changeType,
    changeSummary: input.changeSummary,
    businessGoal: input.businessGoal,
    intendedHypothesis: input.intendedHypothesis,
    dateRequested: input.dateRequested,
    city: input.city,
    service: input.service,
    topic: input.topic,
    faqCountExpected: input.faqCountExpected,
    schemaTypesExpected: input.schemaTypesExpected,
  };

  const validation = validateContract(draft);
  if (!validation.valid) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: validation.errors[0] ?? "validation failed",
    });
    return { success: false, errors: validation.errors, warnings: validation.warnings };
  }

  const { score, issues } = scoreAttributionReadiness(draft);
  const verificationChecks = generateVerificationChecks(draft as ChangeContract);

  const contractId = `cc-${Date.now()}`;
  const contract: ChangeContract = {
    contractId,
    accountId: input.accountId,
    dateRequested: input.dateRequested,
    dateLive: input.dateLive ?? null,
    sourceDocument: input.sourceDocument ?? null,
    sourceInputType: input.sourceInputType ?? "manual",
    pageUrl: input.pageUrl,
    pageType: input.pageType,
    city: input.city ?? null,
    service: input.service ?? null,
    topic: input.topic ?? null,
    changeType: input.changeType,
    changeSummary: input.changeSummary,
    businessGoal: input.businessGoal,
    intendedHypothesis: input.intendedHypothesis,
    faqCountExpected: input.faqCountExpected ?? null,
    schemaTypesExpected: input.schemaTypesExpected ?? [],
    h1Expected: input.h1Expected ?? null,
    titleExpected: input.titleExpected ?? null,
    metaExpected: input.metaExpected ?? null,
    internalLinksExpected: input.internalLinksExpected ?? [],
    expectedVerification: verificationChecks,
    expectedOutcomeWindowDays: suggestOutcomeWindow(input.changeType),
    attributionReadiness: score,
    linkedIssueId: null,
    linkedPlanId: null,
    linkedWaveId: null,
    linkedFrontierId: null,
    linkedChangelogEntryId: null,
    verificationStatus: "pending",
    verificationResult: null,
    verifiedAt: null,
    createdAt: now,
    updatedAt: now,
    notes: input.notes ?? null,
    tenant_id: "",
  };

  (await getChangeContracts()).push(contract);
  await persistChangeContracts(await currentTenantId());
  revalidatePath("/", "layout");

  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return {
    success: true,
    contractId,
    warnings: [...validation.warnings, ...issues],
  };
}

export async function verifyChangeContract(
  contractId: string
): Promise<{
  success: boolean;
  status: string;
  matched: string[];
  missing: string[];
  skipped: string[];
  summary: string;
  checkRows: VerificationCheckRow[];
}> {
  const action = "verifyChangeContract";
  const t0 = Date.now();
  log.info("Action started", { action, params: { contractId } });
  const contract = (await getChangeContracts()).find((c) => c.contractId === contractId);
  if (!contract) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "contract not found",
    });
    return {
      success: false,
      status: "error",
      matched: [],
      missing: [],
      skipped: [],
      summary: "Contract not found",
      checkRows: [],
    };
  }

  const { existsSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");

  // Load page snapshots
  let snapshots: { url: string; faqs: { question: string }[]; schema_types: string[]; h1: string | null; word_count: number; http_status: number }[] = [];
  try {
    const snapPath = join(process.cwd(), ".data", "page-snapshots.json");
    if (existsSync(snapPath)) {
      snapshots = JSON.parse(readFileSync(snapPath, "utf8"));
    }
  } catch {}

  const normUrl = contract.pageUrl.replace(/\/+$/, "").toLowerCase();
  const fullUrl = normUrl.startsWith("http")
    ? normUrl
    : absoluteUrlForPath(normUrl.startsWith("/") ? normUrl : `/${normUrl}`);
  const snap =
    snapshots.find((s) => s.url.replace(/\/+$/, "").toLowerCase() === fullUrl) ?? null;

  const matched: string[] = [];
  const missing: string[] = [];
  const skipped: string[] = [];

  if (!snap) {
    if (contract.changeType === "new_page_creation" || contract.changeType === "guide_page_creation" || contract.changeType === "project_page_creation") {
      missing.push("Page does not exist yet — Beacon could not find it in the latest scan");
    } else {
      skipped.push("Page has not been scanned yet — run a scan to check");
    }
  } else {
    // FAQ count
    if (contract.faqCountExpected != null) {
      if (snap.faqs.length >= contract.faqCountExpected) {
        matched.push(`Found ${snap.faqs.length} Q&A items (expected ${contract.faqCountExpected})`);
      } else if (snap.faqs.length > 0) {
        missing.push(`Found ${snap.faqs.length} Q&A items, but expected ${contract.faqCountExpected}`);
      } else {
        missing.push(`No Q&A items found — expected ${contract.faqCountExpected}`);
      }
    }

    // Schema types
    if (contract.schemaTypesExpected.length > 0) {
      const found = contract.schemaTypesExpected.filter((s) => snap.schema_types.includes(s));
      const notFound = contract.schemaTypesExpected.filter((s) => !snap.schema_types.includes(s));
      if (found.length > 0) matched.push(`Found structured data: ${found.join(", ")}`);
      if (notFound.length > 0) missing.push(`Missing structured data: ${notFound.join(", ")}`);
    }

    // H1
    if (contract.h1Expected) {
      const snapH1 = (snap.h1 ?? "").trim().toLowerCase();
      const expectedH1 = contract.h1Expected.trim().toLowerCase();
      if (snapH1 === expectedH1) {
        matched.push("Page heading matches");
      } else if (snapH1.includes(expectedH1.slice(0, 30)) || expectedH1.includes(snapH1.slice(0, 30))) {
        matched.push(`Page heading is similar: "${snap.h1}"`);
      } else if (snap.h1) {
        missing.push(`Page heading is "${snap.h1}" — expected "${contract.h1Expected}"`);
      } else {
        missing.push("No page heading found");
      }
    }

    // Page exists (for new page creation)
    if (contract.changeType === "new_page_creation" || contract.changeType === "guide_page_creation" || contract.changeType === "project_page_creation") {
      if (snap.http_status === 200) {
        matched.push("Page exists and is live");
      } else {
        missing.push(`Page returned HTTP ${snap.http_status}`);
      }
    }

    // No specific checks but page exists
    if (contract.faqCountExpected == null && contract.schemaTypesExpected.length === 0 && !contract.h1Expected) {
      if (snap.http_status === 200) {
        matched.push("Page is live and scannable");
        if (snap.faqs.length > 0) matched.push(`Page has ${snap.faqs.length} Q&A items`);
        if (snap.schema_types.length > 0) matched.push(`Page has structured data: ${snap.schema_types.join(", ")}`);
      }
      skipped.push("No specific verification expectations were set — showing what Beacon found");
    }
  }

  // Determine status
  let status: "verified_match" | "verified_mismatch" | "pending";
  let summary: string;

  if (missing.length === 0 && matched.length > 0) {
    status = "verified_match";
    summary = `Latest scan matches your contract (${matched.length} check${matched.length !== 1 ? "s" : ""} passed).`;
  } else if (missing.length > 0 && matched.length > 0) {
    status = "verified_mismatch";
    summary = `Partly shipped — ${matched.length} check${matched.length !== 1 ? "s" : ""} passed, ${missing.length} still missing`;
  } else if (missing.length > 0) {
    status = "verified_mismatch";
    summary = `Not yet shipped — ${missing.length} expected element${missing.length !== 1 ? "s" : ""} not found`;
  } else {
    status = "pending";
    summary = skipped.length > 0 ? skipped[0]! : "Not enough data to verify yet";
  }

  const checkRows = buildVerificationCheckRows(contract, snap, matched, missing, skipped);

  // Save result
  contract.verificationStatus = status;
  contract.verificationResult = JSON.stringify({
    matched,
    missing,
    skipped,
    summary,
    checkRows,
  });
  contract.verifiedAt = new Date().toISOString();
  contract.updatedAt = contract.verifiedAt;

  await persistChangeContracts(await currentTenantId());
  revalidatePath("/", "layout");

  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true, status, matched, missing, skipped, summary, checkRows };
}
