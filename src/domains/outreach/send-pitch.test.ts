import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn() }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: sendEmailMock }));

const { getOutreachRowMock, markSentMock } = vi.hoisted(() => ({
  getOutreachRowMock: vi.fn(),
  markSentMock: vi.fn(),
}));
vi.mock("./outreach-store", () => ({
  getOutreachRow: getOutreachRowMock,
  markSent: markSentMock,
}));

import { sendOutreachPitch } from "./send-pitch";
import type { OutreachPipelineRow } from "./types";

const DRAFT_ROW: OutreachPipelineRow = {
  tenantId: "tenant-x",
  id: "outreach-1",
  targetDomain: "example.com",
  targetUrl: "https://example.com",
  contactEmail: "editor@example.com",
  pitchSubject: "Subject",
  pitchBody: "Body",
  status: "draft",
  leadSource: "profound_citation",
  sentAt: null,
  lastEventAt: "2026-07-01T00:00:00.000Z",
  createdAt: "2026-06-30T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendOutreachPitch - the ONLY send path, requires an explicit call", () => {
  it("sends the email and marks the row sent on success", async () => {
    getOutreachRowMock.mockResolvedValue(DRAFT_ROW);
    sendEmailMock.mockResolvedValue({ sent: true, id: "email-123" });
    markSentMock.mockResolvedValue(true);

    const r = await sendOutreachPitch("tenant-x", "outreach-1");
    expect(r).toEqual({ ok: true, emailId: "email-123" });
    expect(sendEmailMock).toHaveBeenCalledWith({ to: "editor@example.com", subject: "Subject", text: "Body" });
    expect(markSentMock).toHaveBeenCalledWith("tenant-x", "outreach-1", expect.any(Date));
  });

  it("refuses when the row is not found", async () => {
    getOutreachRowMock.mockResolvedValue(null);
    const r = await sendOutreachPitch("tenant-x", "missing");
    expect(r).toEqual({ ok: false, reason: "not_found" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("refuses to re-send an already-sent row", async () => {
    getOutreachRowMock.mockResolvedValue({ ...DRAFT_ROW, status: "sent" });
    const r = await sendOutreachPitch("tenant-x", "outreach-1");
    expect(r).toEqual({ ok: false, reason: "already_sent" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("refuses when there is no contact email on the row", async () => {
    getOutreachRowMock.mockResolvedValue({ ...DRAFT_ROW, contactEmail: null });
    const r = await sendOutreachPitch("tenant-x", "outreach-1");
    expect(r).toEqual({ ok: false, reason: "no_contact_email" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("reports not_configured honestly when the email transport is unset (never a silent failure)", async () => {
    getOutreachRowMock.mockResolvedValue(DRAFT_ROW);
    sendEmailMock.mockResolvedValue({ sent: false, reason: "not_configured", missing: ["RESEND_API_KEY"] });
    const r = await sendOutreachPitch("tenant-x", "outreach-1");
    expect(r).toEqual({ ok: false, reason: "not_configured", detail: "RESEND_API_KEY" });
    expect(markSentMock).not.toHaveBeenCalled();
  });

  it("reports send_failed and does not mark sent when the provider errors", async () => {
    getOutreachRowMock.mockResolvedValue(DRAFT_ROW);
    sendEmailMock.mockResolvedValue({ sent: false, reason: "send_failed", detail: "http_500: boom" });
    const r = await sendOutreachPitch("tenant-x", "outreach-1");
    expect(r.ok).toBe(false);
    expect(markSentMock).not.toHaveBeenCalled();
  });
});
