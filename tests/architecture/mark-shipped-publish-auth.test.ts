import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");

describe("manual verified-live overrides enforce tenant publish authority", () => {
  for (const [label, relative, action] of [
    ["Changes", "src/app/(shell)/changes/actions.ts", "markChangelogEditShipped"],
    ["Recommendations", "src/app/(shell)/recommendations/actions.ts", "markRecommendationShipped"],
  ] as const) {
    it(`${label} checks canPublishForCurrentTenant inside ${action}`, () => {
      const source = readFileSync(resolve(ROOT, relative), "utf8");
      const start = source.indexOf(`export async function ${action}`);
      expect(start).toBeGreaterThan(-1);
      const body = source.slice(start, start + 1_600);
      expect(body).toContain("await canPublishForCurrentTenant()");
      expect(body.indexOf("await canPublishForCurrentTenant()")).toBeLessThan(body.indexOf("await currentTenantId()"));
    });
  }
});
