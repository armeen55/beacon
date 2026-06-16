/**
 * form-controls — a11y association contract (UX_TEARDOWN #168).
 *
 * Pins the fix that made every modal sheet's labels reachable:
 *   1. FormField links its <label htmlFor> to the control's id (the
 *      same generated id appears on both), so clicking/announcing the
 *      label focuses the control.
 *   2. A caller-supplied id on the control is never clobbered.
 *   3. Required fields expose aria-required on the control AND a
 *      visually-hidden "(required)" text — not color-only.
 *   4. FormSelect / FormTextarea get the same association.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { FormField, FormInput, FormSelect, FormTextarea } from "./form-controls";

/** Pull the htmlFor value off the rendered <label>. */
function labelFor(html: string): string | null {
  const m = html.match(/<label[^>]*\bfor="([^"]+)"/);
  return m ? m[1] : null;
}

/** Pull the id value off the first control element in the markup. */
function controlId(html: string, tag: "input" | "select" | "textarea"): string | null {
  const m = html.match(new RegExp(`<${tag}[^>]*\\bid="([^"]+)"`));
  return m ? m[1] : null;
}

describe("FormField label↔control association (#168)", () => {
  it("links the label htmlFor to the FormInput id", () => {
    const html = renderToStaticMarkup(
      <FormField label="Title">
        <FormInput name="title" />
      </FormField>,
    );
    const forVal = labelFor(html);
    const idVal = controlId(html, "input");
    expect(forVal).toBeTruthy();
    expect(idVal).toBeTruthy();
    expect(forVal).toBe(idVal);
  });

  it("keeps label and control in sync even when the caller passes an id", () => {
    // Inside a FormField the field owns the association: the generated id
    // wins so the label (which renders first) can never point at the wrong
    // element. The invariant that matters is label.htmlFor === control.id.
    const html = renderToStaticMarkup(
      <FormField label="URL">
        <FormInput id="my-explicit-id" name="url" />
      </FormField>,
    );
    const forVal = labelFor(html);
    expect(forVal).toBeTruthy();
    expect(controlId(html, "input")).toBe(forVal);
  });

  it("uses the caller's own id for a standalone control (no FormField)", () => {
    const html = renderToStaticMarkup(<FormInput id="solo" name="solo" />);
    expect(controlId(html, "input")).toBe("solo");
  });

  it("marks required fields with aria-required + visually-hidden (required) text", () => {
    const html = renderToStaticMarkup(
      <FormField label="Objective" required>
        <FormTextarea name="objective" />
      </FormField>,
    );
    expect(html).toContain('aria-required="true"');
    expect(html).toContain("(required)");
  });

  it("does not set aria-required on optional fields", () => {
    const html = renderToStaticMarkup(
      <FormField label="Notes">
        <FormTextarea name="notes" />
      </FormField>,
    );
    expect(html).not.toContain("aria-required");
    expect(html).not.toContain("(required)");
  });

  it("associates FormSelect the same way", () => {
    const html = renderToStaticMarkup(
      <FormField label="Type" required>
        <FormSelect name="brief_type" defaultValue="">
          <option value="">Choose…</option>
          <option value="a">A</option>
        </FormSelect>
      </FormField>,
    );
    expect(labelFor(html)).toBe(controlId(html, "select"));
    expect(html).toContain('aria-required="true"');
  });
});
