import { describe, it, expect } from "vitest";

import {
  isTerminalAgentRunStatus,
  runProfoundAgentToCompletion,
} from "./client";

function jsonRes(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe("isTerminalAgentRunStatus", () => {
  it("recognizes terminal vs in-flight (case-insensitive)", () => {
    expect(isTerminalAgentRunStatus("succeeded")).toBe(true);
    expect(isTerminalAgentRunStatus("FAILED")).toBe(true);
    expect(isTerminalAgentRunStatus("cancelled")).toBe(true);
    expect(isTerminalAgentRunStatus("skipped")).toBe(true);
    expect(isTerminalAgentRunStatus("running")).toBe(false);
    expect(isTerminalAgentRunStatus("pending")).toBe(false);
    expect(isTerminalAgentRunStatus(null)).toBe(false);
    expect(isTerminalAgentRunStatus(undefined)).toBe(false);
  });
});

describe("runProfoundAgentToCompletion", () => {
  it("starts a run, polls past 'running', returns the terminal outputs", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    let getCount = 0;
    const fetchImpl = (async (url: string, init: { method: string }) => {
      const path = url.replace("https://api.tryprofound.com", "");
      calls.push({ method: init.method, path });
      if (init.method === "POST") return jsonRes({ id: "run1" });
      getCount += 1;
      return getCount === 1
        ? jsonRes({ status: "running" })
        : jsonRes({ status: "succeeded", outputs: { volume: 42 } });
    }) as unknown as typeof fetch;

    const run = await runProfoundAgentToCompletion(
      { tenantId: "t", agentId: "ag1", inputs: { kw: "persian food" }, pollMs: 1, maxWaitMs: 100 },
      { getApiKey: async () => "key", fetchImpl, sleep: async () => {} },
    );

    expect(run).not.toBeNull();
    expect(run!.status).toBe("succeeded");
    expect(run!.outputs).toEqual({ volume: 42 });
    expect(calls[0]).toEqual({ method: "POST", path: "/v1/agents/ag1/runs" });
    expect(calls[1]!.path).toBe("/v1/agents/ag1/runs/run1");
  });

  it("returns null fail-soft when the run never starts", async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    const run = await runProfoundAgentToCompletion(
      { tenantId: "t", agentId: "ag1", inputs: {}, pollMs: 1, maxWaitMs: 10 },
      { getApiKey: async () => "key", fetchImpl, sleep: async () => {} },
    );
    expect(run).toBeNull();
  });

  it("times out to null if the run never reaches terminal", async () => {
    const fetchImpl = (async (url: string, init: { method: string }) => {
      if (init.method === "POST") return jsonRes({ id: "run1" });
      return jsonRes({ status: "running" }); // never terminal
    }) as unknown as typeof fetch;
    const run = await runProfoundAgentToCompletion(
      { tenantId: "t", agentId: "ag1", inputs: {}, pollMs: 5, maxWaitMs: 12 },
      { getApiKey: async () => "key", fetchImpl, sleep: async () => {} },
    );
    expect(run).toBeNull();
  });
});
