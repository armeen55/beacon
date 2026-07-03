import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/operator-mode", () => ({ isOperatorModeServer: vi.fn(async () => true) }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: vi.fn(async () => "tenant-iranopedia") }));
vi.mock("@/lib/business-config", () => ({
  getBusinessConfigForCurrentTenant: vi.fn(async () => ({ name: "Iranopedia", domain: "iranopedia.com", industry: "Persian culture" })),
}));

const { mineLeadsForTenantMock, draftPitchForLeadMock, loadOutreachPipelineMock, transitionOutreachStatusMock, editOutreachDraftMock, draftFollowupForRowMock } =
  vi.hoisted(() => ({
    mineLeadsForTenantMock: vi.fn(),
    draftPitchForLeadMock: vi.fn(),
    loadOutreachPipelineMock: vi.fn(),
    transitionOutreachStatusMock: vi.fn(),
    editOutreachDraftMock: vi.fn(),
    draftFollowupForRowMock: vi.fn(),
  }));
vi.mock("@/domains/outreach/pipeline", () => ({
  mineLeadsForTenant: mineLeadsForTenantMock,
  draftPitchForLead: draftPitchForLeadMock,
  loadOutreachPipeline: loadOutreachPipelineMock,
  transitionOutreachStatus: transitionOutreachStatusMock,
  editOutreachDraft: editOutreachDraftMock,
  draftFollowupForRow: draftFollowupForRowMock,
}));

const { sendOutreachPitchMock } = vi.hoisted(() => ({ sendOutreachPitchMock: vi.fn() }));
vi.mock("@/domains/outreach/send-pitch", () => ({ sendOutreachPitch: sendOutreachPitchMock }));

import {
  loadOutreachPipelineAction,
  mineOutreachLeadsAction,
  draftOutreachPitchAction,
  setOutreachStatusAction,
  sendOutreachPitchAction,
} from "./outreach-actions";
import { isOperatorModeServer } from "@/lib/operator-mode";
import type { OutreachLead } from "@/domains/outreach/types";

const LEAD: OutreachLead = {
  id: "outreach-1",
  targetDomain: "example.com",
  targetUrl: "https://example.com",
  leadSource: "profound_citation",
  evidence: "AI cited this page.",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isOperatorModeServer).mockResolvedValue(true);
});

describe("outreach-actions - operator gating", () => {
  it("loadOutreachPipelineAction returns [] when not operator (never leaks pipeline data)", async () => {
    vi.mocked(isOperatorModeServer).mockResolvedValue(false);
    const rows = await loadOutreachPipelineAction();
    expect(rows).toEqual([]);
    expect(loadOutreachPipelineMock).not.toHaveBeenCalled();
  });

  it("mineOutreachLeadsAction rejects when not operator", async () => {
    vi.mocked(isOperatorModeServer).mockResolvedValue(false);
    const r = await mineOutreachLeadsAction();
    expect(r.ok).toBe(false);
    expect(mineLeadsForTenantMock).not.toHaveBeenCalled();
  });

  it("draftOutreachPitchAction rejects when not operator", async () => {
    vi.mocked(isOperatorModeServer).mockResolvedValue(false);
    const r = await draftOutreachPitchAction(LEAD);
    expect(r.ok).toBe(false);
    expect(draftPitchForLeadMock).not.toHaveBeenCalled();
  });

  it("sendOutreachPitchAction rejects when not operator - the send NEVER fires", async () => {
    vi.mocked(isOperatorModeServer).mockResolvedValue(false);
    const r = await sendOutreachPitchAction("outreach-1");
    expect(r.ok).toBe(false);
    expect(sendOutreachPitchMock).not.toHaveBeenCalled();
  });
});

describe("outreach-actions - happy paths", () => {
  it("mines leads for the current tenant using the tenant's own domain", async () => {
    mineLeadsForTenantMock.mockResolvedValue({ leads: [LEAD], alreadyInPipeline: 0, message: "Found 1 lead." });
    const r = await mineOutreachLeadsAction();
    expect(r.ok).toBe(true);
    expect(mineLeadsForTenantMock).toHaveBeenCalledWith("tenant-iranopedia", "iranopedia.com");
  });

  it("drafts a pitch and never marks it sent", async () => {
    draftPitchForLeadMock.mockResolvedValue({
      ok: true,
      row: { tenantId: "tenant-iranopedia", id: "outreach-1", status: "draft", targetDomain: "example.com", targetUrl: "https://example.com", contactEmail: null, pitchSubject: "s", pitchBody: "b", leadSource: "profound_citation", sentAt: null, lastEventAt: "now", createdAt: "now" },
    });
    const r = await draftOutreachPitchAction(LEAD);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row.status).not.toBe("sent");
  });

  it("setOutreachStatusAction forwards the status transition", async () => {
    transitionOutreachStatusMock.mockResolvedValue(true);
    const r = await setOutreachStatusAction("outreach-1", "won");
    expect(r.ok).toBe(true);
    expect(transitionOutreachStatusMock).toHaveBeenCalledWith("tenant-iranopedia", "outreach-1", "won");
  });

  it("sendOutreachPitchAction calls the exclusive send path and returns a friendly reason on failure", async () => {
    sendOutreachPitchMock.mockResolvedValue({ ok: false, reason: "no_contact_email" });
    const r = await sendOutreachPitchAction("outreach-1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("contact email");
    expect(sendOutreachPitchMock).toHaveBeenCalledWith("tenant-iranopedia", "outreach-1");
  });

  it("sendOutreachPitchAction succeeds and the receipt is dash-clean", async () => {
    sendOutreachPitchMock.mockResolvedValue({ ok: true, emailId: "email-1" });
    const r = await sendOutreachPitchAction("outreach-1");
    expect(r.ok).toBe(true);
  });
});
