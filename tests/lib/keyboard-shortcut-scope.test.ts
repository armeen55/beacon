import { describe, expect, it } from "vitest";
import { isKeyboardTypingTarget } from "@/lib/keyboard-shortcut-scope";

describe("isKeyboardTypingTarget", () => {
  it("returns false for null", () => {
    expect(isKeyboardTypingTarget(null)).toBe(false);
  });

  it("returns false for non-Element targets", () => {
    expect(isKeyboardTypingTarget({} as EventTarget)).toBe(false);
  });

  it("returns true for input when DOM is available", () => {
    if (typeof document === "undefined") return;
    const input = document.createElement("input");
    expect(isKeyboardTypingTarget(input)).toBe(true);
  });

  it("returns true for contenteditable when DOM is available", () => {
    if (typeof document === "undefined") return;
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "true");
    expect(isKeyboardTypingTarget(el)).toBe(true);
  });
});
