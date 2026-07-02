import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Chainable supabase mock over one in-memory table ────────────────────────

type Row = {
  tenant_id: string;
  id: string;
  target_domain: string;
  target_url: string;
  contact_email: string | null;
  pitch_subject: string;
  pitch_body: string;
  status: string;
  lead_source: string;
  sent_at: string | null;
  last_event_at: string;
  created_at: string;
};

let rows: Row[] = [];
let forceError: { code?: string; message: string } | null = null;

function baseRow(over: Partial<Row>): Row {
  return {
    tenant_id: "tenant-x",
    id: "outreach-1",
    target_domain: "example.com",
    target_url: "https://example.com/page",
    contact_email: null,
    pitch_subject: "Subject",
    pitch_body: "Body",
    status: "draft",
    lead_source: "profound_citation",
    sent_at: null,
    last_event_at: "2026-06-01T00:00:00.000Z",
    created_at: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

function chain() {
  let filtered = [...rows];
  let pendingPatch: Partial<Row> | null = null;
  const applyFilters = () => filtered;

  const c: Record<string, unknown> = {
    eq: vi.fn((col: string, val: unknown) => {
      filtered = filtered.filter((r) => (r as Record<string, unknown>)[col] === val);
      return c;
    }),
    in: vi.fn((col: string, vals: unknown[]) => {
      filtered = filtered.filter((r) => vals.includes((r as Record<string, unknown>)[col]));
      return c;
    }),
    not: vi.fn(() => c),
    ilike: vi.fn(() => c),
    order: vi.fn(() => c),
    limit: vi.fn(async () => {
      if (forceError) return { data: null, error: forceError };
      return { data: applyFilters(), error: null };
    }),
    maybeSingle: vi.fn(async () => {
      if (forceError) return { data: null, error: forceError };
      return { data: applyFilters()[0] ?? null, error: null };
    }),
    upsert: vi.fn(async (row: Row) => {
      if (forceError) return { error: forceError };
      const idx = rows.findIndex((r) => r.tenant_id === row.tenant_id && r.id === row.id);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
      else rows.push({ ...baseRow({}), ...row });
      return { error: null };
    }),
    update: vi.fn((patch: Partial<Row>) => {
      pendingPatch = patch;
      return c;
    }),
    // select() is used two ways: as a read-chain starter (select("*").eq...maybeSingle/limit)
    // and as the terminal call after update(...).eq(...).eq(...).in(...) (Supabase's
    // .update().select() pattern to get back the affected rows).
    select: vi.fn((..._args: unknown[]) => {
      if (pendingPatch) {
        return (async () => {
          if (forceError) return { data: null, error: forceError };
          const matched = applyFilters();
          for (const m of matched) Object.assign(m, pendingPatch);
          return { data: matched.map((m) => ({ id: m.id })), error: null };
        })();
      }
      return c;
    }),
    // Real Supabase query builders are thenable - `await ....eq(...).eq(...)` with
    // no explicit .select() resolves the query directly. Applying a pending patch
    // here covers setOutreachStatus's shorter chain (update -> eq -> eq, no select).
    then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
      if (forceError) return resolve({ data: null, error: forceError });
      const matched = applyFilters();
      if (pendingPatch) for (const m of matched) Object.assign(m, pendingPatch);
      resolve({ data: matched, error: null });
    },
  };
  return c;
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({ from: () => chain() }),
}));

import {
  listOutreachRows,
  getOutreachRow,
  upsertOutreachDraft,
  markSent,
  setOutreachStatus,
  updateOutreachDraftText,
} from "./outreach-store";

beforeEach(() => {
  rows = [baseRow({})];
  forceError = null;
});

describe("outreach-store - reads", () => {
  it("lists rows for a tenant", async () => {
    const out = await listOutreachRows("tenant-x");
    expect(out).toHaveLength(1);
    expect(out[0]!.targetDomain).toBe("example.com");
  });

  it("returns empty for a missing table (PGRST205), never throws", async () => {
    forceError = { code: "PGRST205", message: "schema cache" };
    const out = await listOutreachRows("tenant-x");
    expect(out).toEqual([]);
  });

  it("gets one row by id", async () => {
    const row = await getOutreachRow("tenant-x", "outreach-1");
    expect(row?.id).toBe("outreach-1");
  });

  it("returns null for an unknown id", async () => {
    const row = await getOutreachRow("tenant-x", "nope");
    expect(row).toBeNull();
  });
});

describe("outreach-store - upsertOutreachDraft", () => {
  it("inserts a new draft row defaulting to status=draft", async () => {
    const ok = await upsertOutreachDraft("tenant-x", {
      id: "outreach-2",
      targetDomain: "new.example",
      targetUrl: "https://new.example",
      pitchSubject: "Hi",
      pitchBody: "Body",
      leadSource: "wiki_gap",
    });
    expect(ok).toBe(true);
    const row = await getOutreachRow("tenant-x", "outreach-2");
    expect(row?.status).toBe("draft");
  });
});

describe("outreach-store - markSent (the ONLY sent-setter)", () => {
  it("marks a draft row sent and stamps sent_at", async () => {
    const ok = await markSent("tenant-x", "outreach-1", new Date("2026-07-02T00:00:00.000Z"));
    expect(ok).toBe(true);
    const row = await getOutreachRow("tenant-x", "outreach-1");
    expect(row?.status).toBe("sent");
    expect(row?.sentAt).toBe("2026-07-02T00:00:00.000Z");
  });

  it("refuses to re-send an already-sent row", async () => {
    rows = [baseRow({ status: "sent", sent_at: "2026-06-15T00:00:00.000Z" })];
    const ok = await markSent("tenant-x", "outreach-1");
    expect(ok).toBe(false);
  });
});

describe("outreach-store - setOutreachStatus", () => {
  it("transitions to replied/won/dead", async () => {
    const ok = await setOutreachStatus("tenant-x", "outreach-1", "replied");
    expect(ok).toBe(true);
    const row = await getOutreachRow("tenant-x", "outreach-1");
    expect(row?.status).toBe("replied");
  });
});

describe("outreach-store - updateOutreachDraftText", () => {
  it("edits subject/body/contact email on a draft row", async () => {
    const ok = await updateOutreachDraftText("tenant-x", "outreach-1", {
      pitchSubject: "New subject",
      contactEmail: "editor@example.com",
    });
    expect(ok).toBe(true);
    const row = await getOutreachRow("tenant-x", "outreach-1");
    expect(row?.pitchSubject).toBe("New subject");
    expect(row?.contactEmail).toBe("editor@example.com");
  });

  it("refuses to edit an already-sent row", async () => {
    rows = [baseRow({ status: "sent" })];
    const ok = await updateOutreachDraftText("tenant-x", "outreach-1", { pitchSubject: "Nope" });
    expect(ok).toBe(false);
  });
});
