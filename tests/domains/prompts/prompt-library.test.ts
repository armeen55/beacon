/**
 * Phase 7.8e-4c (2026-04-26) — prompt-library request-scope getter.
 *
 * Pins the lazy-load + mutator contract:
 *   - First call hydrates from disk via readStore.
 *   - Subsequent calls reuse the cached array reference.
 *   - addPrompt mutates the cached array (push semantics preserved).
 *   - initFromTrackedPrompts dedupes by lowercased prompt_text.
 *   - getActivePrompts / getPromptsByJourneyStage / getPromptsByTopic /
 *     getLibrarySummary are async and read through the same cached array.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LibraryPrompt } from "@/domains/prompts/types";

const readMock = vi.hoisted(() => vi.fn(async () => [] as LibraryPrompt[]));
const writeMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/persistence/json-store", () => ({
  readStore: readMock,
  writeStore: writeMock,
}));

describe("prompt-library — Phase 7.8e-4c request-scope getter", () => {
  beforeEach(async () => {
    vi.resetModules();
    readMock.mockReset();
    writeMock.mockReset();
    readMock.mockResolvedValue([]);
  });

  it("first call hydrates from disk", async () => {
    readMock.mockResolvedValueOnce([
      { id: "p1", prompt_text: "best builder", topic: null, city: null, service_type: null, journey_stage: "consideration", source: "manual", is_active: true, created_at: "2026-04-26" },
    ] as LibraryPrompt[]);
    const mod = await import("@/domains/prompts/prompt-library");
    mod._resetPromptLibraryForTests();
    const lib = await mod.getPromptLibrary();
    expect(readMock).toHaveBeenCalledTimes(1);
    expect(lib).toHaveLength(1);
    expect(lib[0].id).toBe("p1");
  });

  it("subsequent calls reuse the cached array (no re-read)", async () => {
    readMock.mockResolvedValueOnce([] as LibraryPrompt[]);
    const mod = await import("@/domains/prompts/prompt-library");
    mod._resetPromptLibraryForTests();
    await mod.getPromptLibrary();
    await mod.getPromptLibrary();
    await mod.getPromptLibrary();
    expect(readMock).toHaveBeenCalledTimes(1);
  });

  it("addPrompt mutates the cached array (push semantics)", async () => {
    readMock.mockResolvedValueOnce([] as LibraryPrompt[]);
    const mod = await import("@/domains/prompts/prompt-library");
    mod._resetPromptLibraryForTests();
    const before = await mod.getPromptLibrary();
    expect(before).toHaveLength(0);
    await mod.addPrompt({
      prompt_text: "best home builder atherton",
      source: "manual",
    });
    const after = await mod.getPromptLibrary();
    expect(after).toHaveLength(1);
    // Same array reference — push semantics preserved.
    expect(after).toBe(before);
  });

  it("addPrompt dedupes by lowercased prompt_text", async () => {
    readMock.mockResolvedValueOnce([] as LibraryPrompt[]);
    const mod = await import("@/domains/prompts/prompt-library");
    mod._resetPromptLibraryForTests();
    await mod.addPrompt({ prompt_text: "Best Builder", source: "manual" });
    await mod.addPrompt({ prompt_text: "best builder", source: "manual" });
    const lib = await mod.getPromptLibrary();
    expect(lib).toHaveLength(1);
  });

  it("initFromTrackedPrompts adds new + skips duplicates", async () => {
    readMock.mockResolvedValueOnce([
      { id: "p1", prompt_text: "existing", topic: null, city: null, service_type: null, journey_stage: "consideration", source: "manual", is_active: true, created_at: "2026-04-26" },
    ] as LibraryPrompt[]);
    const mod = await import("@/domains/prompts/prompt-library");
    mod._resetPromptLibraryForTests();
    const result = await mod.initFromTrackedPrompts([
      { id: "tp1", text: "EXISTING", topic_id: null, location_scope: null, service_scope: null, intent_type: null, is_active: true },
      { id: "tp2", text: "fresh prompt", topic_id: null, location_scope: null, service_scope: null, intent_type: null, is_active: true },
    ]);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
    const lib = await mod.getPromptLibrary();
    expect(lib).toHaveLength(2);
  });

  it("getActivePrompts filters is_active=true", async () => {
    readMock.mockResolvedValueOnce([
      { id: "p1", prompt_text: "a", topic: null, city: null, service_type: null, journey_stage: "consideration", source: "manual", is_active: true, created_at: "2026-04-26" },
      { id: "p2", prompt_text: "b", topic: null, city: null, service_type: null, journey_stage: "consideration", source: "manual", is_active: false, created_at: "2026-04-26" },
    ] as LibraryPrompt[]);
    const mod = await import("@/domains/prompts/prompt-library");
    mod._resetPromptLibraryForTests();
    const active = await mod.getActivePrompts();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("p1");
  });

  it("getLibrarySummary aggregates by stage / source / topic", async () => {
    readMock.mockResolvedValueOnce([
      { id: "p1", prompt_text: "a", topic: "kitchen", city: null, service_type: null, journey_stage: "awareness", source: "profound", is_active: true, created_at: "2026-04-26" },
      { id: "p2", prompt_text: "b", topic: "kitchen", city: null, service_type: null, journey_stage: "consideration", source: "manual", is_active: true, created_at: "2026-04-26" },
      { id: "p3", prompt_text: "c", topic: null, city: null, service_type: null, journey_stage: "awareness", source: "manual", is_active: false, created_at: "2026-04-26" },
    ] as LibraryPrompt[]);
    const mod = await import("@/domains/prompts/prompt-library");
    mod._resetPromptLibraryForTests();
    const s = await mod.getLibrarySummary();
    expect(s.total).toBe(3);
    expect(s.active).toBe(2);
    expect(s.byJourneyStage.awareness).toBe(2);
    expect(s.bySource.profound).toBe(1);
    expect(s.byTopic.kitchen).toBe(2);
    expect(s.byTopic.untagged).toBe(1);
  });

  it("persistPromptLibrary writes the cached array", async () => {
    readMock.mockResolvedValueOnce([
      { id: "p1", prompt_text: "x", topic: null, city: null, service_type: null, journey_stage: "consideration", source: "manual", is_active: true, created_at: "2026-04-26" },
    ] as LibraryPrompt[]);
    const mod = await import("@/domains/prompts/prompt-library");
    mod._resetPromptLibraryForTests();
    await mod.persistPromptLibrary();
    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock.mock.calls[0][0]).toBe("prompt-library");
    expect((writeMock.mock.calls[0][1] as LibraryPrompt[]).length).toBe(1);
  });
});
