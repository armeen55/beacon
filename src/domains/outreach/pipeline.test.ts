import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { mineOutreachLeadsMock } = vi.hoisted(() => ({ mineOutreachLeadsMock: vi.fn() }));
vi.mock("./mine-leads", () => ({ mineOutreachLeads: mineOutreachLeadsMock }));

const { draftOutreachPitchMock, draftOutreachFollowupMock } = vi.hoisted(() => ({
  draftOutreachPitchMock: vi.fn(),
  draftOutreachFollowupMock: vi.fn(),
}));
vi.mock("./draft-pitch", () => ({
  draftOutreachPitch: draftOutreachPitchMock,
  draftOutreachFollowup: draftOutreachFollowupMock,
}));

const {
  listOutreachRowsMock,
  upsertOutreachDraftMock,
  setOutreachStatusMock,
  updateOutreachDraftTextMock,
} = vi.hoisted(() => ({
  listOutreachRowsMock: vi.fn(),
  upsertOutreachDraftMock: vi.fn(),
  setOutreachStatusMock: vi.fn(),
  updateOutreachDraftTextMock: vi.fn(),
}));
vi.mock("./outreach-store", () => ({
  listOutreachRows: listOutreachRowsMock,
  upsertOutreachDraft: upsertOutreachDraftMock,
  setOutreachStatus: setOutreachStatusMock,
  updateOutreachDraftText: updateOutreachDraftTextMock,
  getOutreachRow: vi.fn(),
  markSent: vi.fn(),
}));

import {
  mineLeadsForTenant,
  draftPitchForLead,
  transitionOutreachStatus,
  editOutreachDraft,
  isFollowupEligible,
  draftFollowupForRow,
} from "./pipeline";
import type { OutreachLead, OutreachPipelineRow } from "./types";

const LEAD: OutreachLead = {
  id: "outreach-abc",
  targetDomain: "example.com",
  targetUrl: "https://example.com/page",
  leadSource: "profound_citation",
  evidence: "AI cited this page for topic X.",
};

const OWN = { name: "Iranopedia", domain: "iranopedia.com", context: "a Persian culture encyclopedia" };

beforeEach(() => {
  vi.clearAllMocks();
  listOutreachRowsMock.mockResolvedValue([]);
});

describe("mineLeadsForTenant", () => {
  it("reports an honest empty message when no sources are mined yet", async () => {
    mineOutreachLeadsMock.mockResolvedValue({ leads: [], sourcesChecked: { wikiGap: false, keywordGap: false, profound: false } });
    const r = await mineLeadsForTenant("tenant-x", "iranopedia.com");
    expect(r.leads).toEqual([]);
    expect(r.message).toContain("do not have");
  });

  it("counts already-tracked leads vs new ones", async () => {
    mineOutreachLeadsMock.mockResolvedValue({ leads: [LEAD], sourcesChecked: { wikiGap: false, keywordGap: false, profound: true } });
    listOutreachRowsMock.mockResolvedValue([{ id: LEAD.id } as OutreachPipelineRow]);
    const r = await mineLeadsForTenant("tenant-x", "iranopedia.com");
    expect(r.alreadyInPipeline).toBe(1);
    expect(r.message).toContain("0 new, 1 already tracked");
  });
});

describe("draftPitchForLead", () => {
  it("saves a drafted pitch as a new 'draft' row (never 'sent')", async () => {
    draftOutreachPitchMock.mockResolvedValue({
      status: "drafted",
      kind: "outreach_pitch",
      value: { subject: "Hi", body: "Body text here.", evidenceRefs: [{ source: "profound", detail: "x" }], confidence: "medium", risks: [] },
      costUsd: 0.01,
      retried: false,
    });
    upsertOutreachDraftMock.mockResolvedValue(true);
    const r = await draftPitchForLead("tenant-x", LEAD, OWN);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.status).toBe("draft");
      expect(r.row.pitchSubject).toBe("Hi");
    }
    expect(upsertOutreachDraftMock).toHaveBeenCalledWith(
      "tenant-x",
      expect.objectContaining({ status: "draft" }),
    );
  });

  it("returns an honest failure when the drafter fails closed on budget", async () => {
    draftOutreachPitchMock.mockResolvedValue({ status: "blocked_budget", reason: "cap reached" });
    const r = await draftPitchForLead("tenant-x", LEAD, OWN);
    expect(r.ok).toBe(false);
    expect(upsertOutreachDraftMock).not.toHaveBeenCalled();
  });

  it("returns an honest failure when the LLM is off", async () => {
    draftOutreachPitchMock.mockResolvedValue({ status: "off" });
    const r = await draftPitchForLead("tenant-x", LEAD, OWN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("off");
  });
});

describe("transitionOutreachStatus / editOutreachDraft - never touch 'sent'", () => {
  it("transitions to an allowed manual status (replied/won/dead/ready)", async () => {
    setOutreachStatusMock.mockResolvedValue(true);
    const ok = await transitionOutreachStatus("tenant-x", "outreach-1", "replied");
    expect(ok).toBe(true);
    expect(setOutreachStatusMock).toHaveBeenCalledWith("tenant-x", "outreach-1", "replied");
  });

  it("edits a draft's text via the store", async () => {
    updateOutreachDraftTextMock.mockResolvedValue(true);
    const ok = await editOutreachDraft("tenant-x", "outreach-1", { pitchSubject: "New" });
    expect(ok).toBe(true);
  });
});

describe("isFollowupEligible", () => {
  const now = new Date("2026-07-02T00:00:00.000Z");
  const sentRow: OutreachPipelineRow = {
    tenantId: "tenant-x",
    id: "outreach-1",
    targetDomain: "example.com",
    targetUrl: "https://example.com",
    contactEmail: "a@example.com",
    pitchSubject: "s",
    pitchBody: "b",
    status: "sent",
    leadSource: "profound_citation",
    sentAt: "2026-06-24T00:00:00.000Z", // 8 days before `now`
    lastEventAt: "2026-06-24T00:00:00.000Z",
    createdAt: "2026-06-20T00:00:00.000Z",
  };

  it("is eligible after >= 7 days of silence", () => {
    expect(isFollowupEligible(sentRow, now)).toBe(true);
  });

  it("is not eligible before 7 days", () => {
    expect(isFollowupEligible({ ...sentRow, sentAt: "2026-06-30T00:00:00.000Z" }, now)).toBe(false);
  });

  it("is not eligible for a non-sent row", () => {
    expect(isFollowupEligible({ ...sentRow, status: "draft", sentAt: null }, now)).toBe(false);
  });

  it("draftFollowupForRow refuses to draft before the silence window (never nags early)", async () => {
    const r = await draftFollowupForRow("tenant-x", { ...sentRow, sentAt: "2026-06-30T00:00:00.000Z" }, OWN, now);
    expect(r.ok).toBe(false);
    expect(draftOutreachFollowupMock).not.toHaveBeenCalled();
  });

  it("draftFollowupForRow queues a NEW draft row (id suffixed), never sends", async () => {
    draftOutreachFollowupMock.mockResolvedValue({
      status: "drafted",
      kind: "outreach_pitch",
      value: { subject: "Following up", body: "Just checking in.", evidenceRefs: [{ source: "profound", detail: "x" }], confidence: "medium", risks: [] },
      costUsd: 0.01,
      retried: false,
    });
    upsertOutreachDraftMock.mockResolvedValue(true);
    const r = await draftFollowupForRow("tenant-x", sentRow, OWN, now);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.id).not.toBe(sentRow.id);
      expect(r.row.id.startsWith(`${sentRow.id}-followup`)).toBe(true);
      expect(r.row.status).toBe("draft");
    }
  });
});
