import { describe, it, expect } from "vitest";
import {
  canTransition, derivePlanExecutionStatus, itemStatus, isActiveStatus, LEVER_TO_ACTION_TYPE,
  type DailyExperimentItemStatus, type PlanExecutionState,
} from "./execution-state";

describe("execution-state transitions", () => {
  it("allows the happy path", () => {
    expect(canTransition("ready_to_apply", "verification_pending")).toBe(true);
    expect(canTransition("verification_pending", "verified_live")).toBe(true);
    expect(canTransition("verified_live", "active")).toBe(true);
    expect(canTransition("active", "gsc_submitted")).toBe(true);
  });
  it("allows retry + skip", () => {
    expect(canTransition("verification_pending", "verification_failed")).toBe(true);
    expect(canTransition("verification_failed", "verification_pending")).toBe(true);
    expect(canTransition("ready_to_apply", "skipped")).toBe(true);
    expect(canTransition("verification_failed", "skipped")).toBe(true);
  });
  it("FORBIDS shortcuts to active (no proof without verified-live)", () => {
    expect(canTransition("ready_to_apply", "active")).toBe(false);
    expect(canTransition("verification_failed", "active")).toBe(false);
    expect(canTransition("verification_pending", "active")).toBe(false);
  });
  it("forbids resurrecting terminal states", () => {
    expect(canTransition("skipped", "active")).toBe(false);
    expect(canTransition("gsc_submitted", "ready_to_apply")).toBe(false);
    expect(canTransition("active", "ready_to_apply")).toBe(false);
  });
});

describe("itemStatus", () => {
  const exec: PlanExecutionState = { items: { a: { experimentId: "a", status: "active", receipts: [] } }, updatedAt: "t" };
  it("defaults to ready_to_apply when no execution block", () => {
    expect(itemStatus(undefined, "x")).toBe("ready_to_apply");
    expect(itemStatus(exec, "missing")).toBe("ready_to_apply");
  });
  it("reads a stored status", () => {
    expect(itemStatus(exec, "a")).toBe("active");
  });
});

describe("isActiveStatus", () => {
  it("treats active/gsc states as active", () => {
    expect(isActiveStatus("active")).toBe(true);
    expect(isActiveStatus("gsc_submission_pending")).toBe(true);
    expect(isActiveStatus("gsc_submitted")).toBe(true);
    expect(isActiveStatus("ready_to_apply")).toBe(false);
    expect(isActiveStatus("verification_failed")).toBe(false);
  });
});

describe("derivePlanExecutionStatus", () => {
  const s = (...x: DailyExperimentItemStatus[]) => x;
  it("mirrors the acceptance lifecycle for non-accepted", () => {
    expect(derivePlanExecutionStatus("preview", s("ready_to_apply"))).toBe("preview");
    expect(derivePlanExecutionStatus("abandoned", s("ready_to_apply"))).toBe("abandoned");
    expect(derivePlanExecutionStatus("completed", s("active"))).toBe("completed");
  });
  it("accepted with nothing started", () => {
    expect(derivePlanExecutionStatus("accepted", s("ready_to_apply", "ready_to_apply"))).toBe("accepted");
  });
  it("in_progress when some verifying/failed but none active", () => {
    expect(derivePlanExecutionStatus("accepted", s("verification_failed", "ready_to_apply"))).toBe("in_progress");
  });
  it("partially_active when some active, some not", () => {
    expect(derivePlanExecutionStatus("accepted", s("active", "ready_to_apply"))).toBe("partially_active");
  });
  it("active when every non-skipped item is active", () => {
    expect(derivePlanExecutionStatus("accepted", s("active", "gsc_submitted", "skipped"))).toBe("active");
  });
  it("accepted when all skipped", () => {
    expect(derivePlanExecutionStatus("accepted", s("skipped", "skipped"))).toBe("accepted");
  });
});

describe("LEVER_TO_ACTION_TYPE", () => {
  it("maps every lever to a canonical proof action_type", () => {
    expect(LEVER_TO_ACTION_TYPE.meta).toBe("edit_meta");
    expect(LEVER_TO_ACTION_TYPE.internal_link).toBe("add_internal_link");
    expect(LEVER_TO_ACTION_TYPE.answer_block).toBe("add_answer_block");
    expect(LEVER_TO_ACTION_TYPE.title).toBe("edit_title");
    expect(LEVER_TO_ACTION_TYPE.h1).toBe("change_h1");
  });
});
