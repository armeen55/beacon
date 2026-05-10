/**
 * DataFreshnessHeartbeat — render + verdict-compute contract tests.
 *
 * Pins the 6 invariants from the operator brief:
 *   1. Fresh poll renders fresh-band copy + green tone.
 *   2. Stale poll renders stale-band copy + amber tone.
 *   3. Empty/no-data renders calm copy, never overclaims.
 *   4. Per-platform pills render correct labels (Perplexity / ChatGPT)
 *      with correct status copy (fresh/partial/needs attention/pending).
 *   5. No UUIDs or raw exception text leak into the customer surface.
 *   6. Tone bands map deterministically from a single hours-ago number.
 *
 * Plus the verdict-compute helper covers the band boundaries.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DataFreshnessHeartbeat,
  computeFreshnessVerdict,
  computeScanFreshnessVerdict,
  formatRelativeHours,
} from "./data-freshness-heartbeat";
import type { PollHealthSnapshot } from "@/domains/observations/poll-health";

const NOW = new Date("2026-05-10T12:00:00.000Z");

function snapshot(over: Partial<PollHealthSnapshot> = {}): PollHealthSnapshot {
  return {
    date: "2026-05-10",
    platforms: [
      {
        platform: "perplexity",
        expectedChunks: 1,
        completedChunks: 1,
        failedChunks: 0,
        observationsWritten: 100,
        status: "ok",
        samplingStatus: "full",
        latestRun: {
          runId: "pollrun-PPL",
          startedAt: "2026-05-10T07:00:00.000Z",
          completedAt: "2026-05-10T07:05:00.000Z",
          scopeLabel: "Native perplexity poll · 100/100 prompts · cost=$0.09",
          runStatus: "completed",
        },
      },
      {
        platform: "chatgpt",
        expectedChunks: 1,
        completedChunks: 1,
        failedChunks: 0,
        observationsWritten: 100,
        status: "ok",
        samplingStatus: "full",
        latestRun: {
          runId: "pollrun-OAI",
          startedAt: "2026-05-10T07:10:00.000Z",
          completedAt: "2026-05-10T07:15:00.000Z",
          scopeLabel: "Native chatgpt poll · 100/100 prompts · cost=$2.88",
          runStatus: "completed",
        },
      },
    ],
    ...over,
  };
}

// ── computeFreshnessVerdict — band boundaries ──────────────────────────

describe("computeFreshnessVerdict — band boundaries", () => {
  it("null snapshot → no_data", () => {
    expect(computeFreshnessVerdict(null, NOW).band).toBe("no_data");
  });

  it("empty platforms → no_data", () => {
    expect(
      computeFreshnessVerdict({ date: "2026-05-10", platforms: [] }, NOW).band,
    ).toBe("no_data");
  });

  it("all platforms successful within last 24h → fresh", () => {
    expect(computeFreshnessVerdict(snapshot(), NOW).band).toBe("fresh");
  });

  it("last success between 24h and 48h → stale", () => {
    const snap = snapshot({
      platforms: snapshot().platforms.map((p) => ({
        ...p,
        latestRun: {
          ...p.latestRun!,
          completedAt: "2026-05-09T07:00:00.000Z", // 29h ago
        },
      })),
    });
    expect(computeFreshnessVerdict(snap, NOW).band).toBe("stale");
  });

  it("last success > 48h → needs_attention", () => {
    const snap = snapshot({
      platforms: snapshot().platforms.map((p) => ({
        ...p,
        latestRun: {
          ...p.latestRun!,
          completedAt: "2026-05-07T07:00:00.000Z", // 77h ago
        },
      })),
    });
    expect(computeFreshnessVerdict(snap, NOW).band).toBe("needs_attention");
  });

  it("any failed platform → needs_attention regardless of clock", () => {
    const snap = snapshot();
    snap.platforms[0].status = "failed";
    expect(computeFreshnessVerdict(snap, NOW).band).toBe("needs_attention");
  });

  it("any pending and last success ≥ 12h ago → pending framing", () => {
    const snap = snapshot();
    snap.platforms[0].status = "pending";
    snap.platforms[1].latestRun!.completedAt = "2026-05-09T22:00:00.000Z"; // 14h ago
    expect(computeFreshnessVerdict(snap, NOW).band).toBe("pending");
  });

  it("all pending with no prior success → no_data (not stale-from-1970)", () => {
    const snap = snapshot();
    for (const p of snap.platforms) {
      p.status = "pending";
      p.latestRun = undefined;
    }
    expect(computeFreshnessVerdict(snap, NOW).band).toBe("no_data");
    expect(computeFreshnessVerdict(snap, NOW).hoursSinceLastSuccess).toBeNull();
  });

  it("hoursSinceLastSuccess never negative even if completedAt > now", () => {
    const snap = snapshot({
      platforms: snapshot().platforms.map((p) => ({
        ...p,
        latestRun: {
          ...p.latestRun!,
          completedAt: "2026-05-11T00:00:00.000Z", // future
        },
      })),
    });
    const v = computeFreshnessVerdict(snap, NOW);
    expect(v.hoursSinceLastSuccess).not.toBeNull();
    expect(v.hoursSinceLastSuccess!).toBeGreaterThanOrEqual(0);
  });
});

// ── formatRelativeHours ────────────────────────────────────────────────

describe("formatRelativeHours", () => {
  it("null / NaN / Infinity → em-dash", () => {
    expect(formatRelativeHours(null)).toBe("—");
    expect(formatRelativeHours(NaN)).toBe("—");
    expect(formatRelativeHours(Infinity)).toBe("—");
  });

  it("0 → just now", () => {
    expect(formatRelativeHours(0)).toBe("just now");
  });

  it("1 → 1h ago", () => {
    expect(formatRelativeHours(1)).toBe("1h ago");
  });

  it("9.4 → 9h ago (no decimals)", () => {
    expect(formatRelativeHours(9.4)).toBe("9h ago");
  });

  it("23.9 → 23h ago", () => {
    expect(formatRelativeHours(23.9)).toBe("23h ago");
  });

  it("24 → 1 day ago", () => {
    expect(formatRelativeHours(24)).toBe("1 day ago");
  });

  it("50 → 2 days ago", () => {
    expect(formatRelativeHours(50)).toBe("2 days ago");
  });
});

// ── DataFreshnessHeartbeat — render contract ───────────────────────────

describe("DataFreshnessHeartbeat — render", () => {
  it("renders fresh-band attribute + green-success tone for fresh poll", () => {
    const html = renderToStaticMarkup(
      <DataFreshnessHeartbeat pollHealth={snapshot()} now={NOW} />,
    );
    expect(html).toContain('data-today-section="data-freshness-heartbeat"');
    expect(html).toContain('data-freshness-band="fresh"');
    expect(html).toContain("Beacon refreshed AI visibility");
    expect(html).toContain("Latest readings are current.");
    // Green-success tone class is applied somewhere in the markup.
    expect(html).toMatch(/text-status-success|bg-status-success/);
  });

  it("renders stale-band copy + amber tone when last poll 24–48h ago", () => {
    const snap = snapshot({
      platforms: snapshot().platforms.map((p) => ({
        ...p,
        latestRun: {
          ...p.latestRun!,
          completedAt: "2026-05-09T07:00:00.000Z",
        },
      })),
    });
    const html = renderToStaticMarkup(
      <DataFreshnessHeartbeat pollHealth={snap} now={NOW} />,
    );
    expect(html).toContain('data-freshness-band="stale"');
    expect(html).toContain("AI visibility data is stale");
    expect(html).toMatch(/text-status-warning|bg-status-warning/);
  });

  it("renders needs_attention copy + danger tone when > 48h", () => {
    const snap = snapshot({
      platforms: snapshot().platforms.map((p) => ({
        ...p,
        latestRun: {
          ...p.latestRun!,
          completedAt: "2026-05-07T07:00:00.000Z",
        },
      })),
    });
    const html = renderToStaticMarkup(
      <DataFreshnessHeartbeat pollHealth={snap} now={NOW} />,
    );
    expect(html).toContain('data-freshness-band="needs_attention"');
    expect(html).toContain("AI visibility needs attention");
    expect(html).toMatch(/text-status-danger|bg-status-danger/);
  });

  it("renders no_data calm copy when pollHealth is null", () => {
    const html = renderToStaticMarkup(
      <DataFreshnessHeartbeat pollHealth={null} now={NOW} />,
    );
    expect(html).toContain('data-freshness-band="no_data"');
    expect(html).toContain("Beacon has not refreshed AI visibility yet.");
    expect(html).toContain(
      "Beacon will surface a reading after the first scheduled poll.",
    );
  });

  it("pending-band subline lists all three scheduled poll attempts (07:00 / 08:30 / 10:00 UTC)", () => {
    // 2026-05-10 — heartbeat copy must reflect the redundant-schedule
    // reliability fix in .github/workflows/daily-native-poll.yml. The
    // single-schedule "fires at 07:00 UTC" copy is now misleading.
    const snap = snapshot();
    snap.platforms[0].status = "pending";
    snap.platforms[1].latestRun!.completedAt = "2026-05-09T22:00:00.000Z"; // 14h ago
    const html = renderToStaticMarkup(
      <DataFreshnessHeartbeat pollHealth={snap} now={NOW} />,
    );
    expect(html).toContain('data-freshness-band="pending"');
    // New copy mentions all three attempts + the auto-backup posture
    // so the operator knows they don't need to take action.
    expect(html).toContain(
      "Scheduled poll attempts run at 07:00, 08:30, and 10:00 UTC.",
    );
    expect(html).toContain("Backup attempts run automatically.");
    // Old single-schedule-only copy must NOT remain in the heartbeat
    // pending-band render.
    expect(html).not.toContain("The next scheduled poll fires at 07:00 UTC.");
  });

  it("stale-band subline mentions auto-backups + the 10:45 UTC threshold", () => {
    // 2026-05-10 — stale-band hint upgrade. Operator gets a clean
    // threshold for when the day's poll has actually missed.
    const snap = snapshot({
      platforms: snapshot().platforms.map((p) => ({
        ...p,
        latestRun: {
          ...p.latestRun!,
          completedAt: "2026-05-09T07:00:00.000Z", // 29h ago → stale band
        },
      })),
    });
    const html = renderToStaticMarkup(
      <DataFreshnessHeartbeat pollHealth={snap} now={NOW} />,
    );
    expect(html).toContain('data-freshness-band="stale"');
    expect(html).toContain("Backup poll attempts run automatically.");
    expect(html).toContain("10:45 UTC");
    expect(html).toContain("review poll health");
    // Old generic "retry on the next cycle" copy must not remain.
    expect(html).not.toContain("retry on the next cycle");
  });

  it("fresh-band subline does NOT include any stale/needs-action language", () => {
    // 2026-05-10 — guard against the new stale-band hint creeping
    // into the calm fresh-band render.
    const html = renderToStaticMarkup(
      <DataFreshnessHeartbeat pollHealth={snapshot()} now={NOW} />,
    );
    expect(html).toContain('data-freshness-band="fresh"');
    expect(html).toContain("Latest readings are current.");
    expect(html).not.toContain("review poll health");
    expect(html).not.toContain("10:45 UTC");
    expect(html).not.toContain("Backup attempts run automatically");
    expect(html).not.toContain("Backup poll attempts run automatically");
  });

  it("operator-safe vocabulary across all hints — never says 'GitHub skipped' or 'system failed'", () => {
    for (const fixture of [
      // pending
      (() => {
        const s = snapshot();
        s.platforms[0].status = "pending";
        s.platforms[1].latestRun!.completedAt = "2026-05-09T22:00:00.000Z";
        return s;
      })(),
      // stale
      snapshot({
        platforms: snapshot().platforms.map((p) => ({
          ...p,
          latestRun: { ...p.latestRun!, completedAt: "2026-05-09T07:00:00.000Z" },
        })),
      }),
      // needs_attention (any-failed)
      (() => {
        const s = snapshot();
        s.platforms[0].status = "failed";
        return s;
      })(),
    ]) {
      const html = renderToStaticMarkup(
        <DataFreshnessHeartbeat pollHealth={fixture} now={NOW} />,
      );
      const lc = html.toLowerCase();
      expect(lc).not.toContain("github");
      expect(lc).not.toContain("system failed");
      expect(lc).not.toContain("skipped"); // operator vocab
      expect(lc).not.toContain("scheduler"); // operator vocab
      expect(lc).not.toContain("exception");
      expect(lc).not.toContain("stacktrace");
    }
  });

  it("renders no_data calm copy when all platforms pending with no prior run", () => {
    const snap = snapshot();
    for (const p of snap.platforms) {
      p.status = "pending";
      p.latestRun = undefined;
    }
    const html = renderToStaticMarkup(
      <DataFreshnessHeartbeat pollHealth={snap} now={NOW} />,
    );
    expect(html).toContain('data-freshness-band="no_data"');
  });

  it("renders both platform names in the per-platform pills", () => {
    const html = renderToStaticMarkup(
      <DataFreshnessHeartbeat pollHealth={snapshot()} now={NOW} />,
    );
    expect(html).toContain('data-freshness-platform="perplexity"');
    expect(html).toContain('data-freshness-platform="chatgpt"');
    expect(html).toContain("Perplexity");
    expect(html).toContain("ChatGPT");
  });

  it("per-platform status copy maps ok→fresh, partial→partial, failed→needs attention, pending→pending", () => {
    const snap = snapshot();
    snap.platforms[0].status = "partial";
    snap.platforms[1].status = "failed";
    const html = renderToStaticMarkup(
      <DataFreshnessHeartbeat pollHealth={snap} now={NOW} />,
    );
    // partial column
    expect(html).toContain('data-freshness-platform-status="partial"');
    expect(html).toContain(">partial<");
    // failed column
    expect(html).toContain('data-freshness-platform-status="failed"');
    expect(html).toContain(">needs attention<");
  });

  it("never leaks UUIDs (no raw run_id in the customer-visible markup)", () => {
    const html = renderToStaticMarkup(
      <DataFreshnessHeartbeat pollHealth={snapshot()} now={NOW} />,
    );
    expect(html).not.toContain("pollrun-PPL");
    expect(html).not.toContain("pollrun-OAI");
  });

  // ── Site-scan freshness (2026-05-10) ──

  describe("site scan freshness", () => {
    it("does NOT render the scan row when siteScan is undefined (back-compat)", () => {
      const html = renderToStaticMarkup(
        <DataFreshnessHeartbeat pollHealth={snapshot()} now={NOW} />,
      );
      expect(html).not.toContain('data-today-section="data-freshness-heartbeat-scan"');
    });

    it("renders calm 'waiting for first scan' line when siteScan is null", () => {
      const html = renderToStaticMarkup(
        <DataFreshnessHeartbeat pollHealth={snapshot()} siteScan={null} now={NOW} />,
      );
      expect(html).toContain('data-scan-freshness-band="no_data"');
      expect(html).toContain("Site scan: waiting for the first scheduled scan.");
    });

    it("renders fresh-band scan row for completed scan < 24h ago", () => {
      const html = renderToStaticMarkup(
        <DataFreshnessHeartbeat
          pollHealth={snapshot()}
          siteScan={{
            completedAt: "2026-05-10T09:00:00.000Z", // 3h ago
            status: "completed",
          }}
          now={NOW}
        />,
      );
      expect(html).toContain('data-scan-freshness-band="fresh"');
      expect(html).toContain("Site scan: fresh 3h ago.");
    });

    it("renders stale-band copy for scan 24–48h ago", () => {
      const html = renderToStaticMarkup(
        <DataFreshnessHeartbeat
          pollHealth={snapshot()}
          siteScan={{
            completedAt: "2026-05-09T07:00:00.000Z", // 29h ago
            status: "completed",
          }}
          now={NOW}
        />,
      );
      expect(html).toContain('data-scan-freshness-band="stale"');
      expect(html).toContain("Site scan: stale — last scan 1 day ago.");
    });

    it("renders needs_attention for scan > 48h ago", () => {
      const html = renderToStaticMarkup(
        <DataFreshnessHeartbeat
          pollHealth={snapshot()}
          siteScan={{
            completedAt: "2026-05-07T07:00:00.000Z", // 77h ago
            status: "completed",
          }}
          now={NOW}
        />,
      );
      expect(html).toContain('data-scan-freshness-band="needs_attention"');
      expect(html).toContain("Site scan: needs attention — last scan 3 days ago.");
    });

    it("renders needs_attention when scan status is failed regardless of clock", () => {
      const html = renderToStaticMarkup(
        <DataFreshnessHeartbeat
          pollHealth={snapshot()}
          siteScan={{
            completedAt: "2026-05-10T09:00:00.000Z", // would be fresh
            status: "failed",
          }}
          now={NOW}
        />,
      );
      expect(html).toContain('data-scan-freshness-band="needs_attention"');
    });

    it("renders pending for partial-status scan within 24h", () => {
      const html = renderToStaticMarkup(
        <DataFreshnessHeartbeat
          pollHealth={snapshot()}
          siteScan={{
            completedAt: "2026-05-10T09:00:00.000Z", // 3h ago
            status: "partial",
          }}
          now={NOW}
        />,
      );
      expect(html).toContain('data-scan-freshness-band="pending"');
      expect(html).toContain("Site scan: partial");
    });

    it("scan row never leaks raw error text or UUIDs", () => {
      const html = renderToStaticMarkup(
        <DataFreshnessHeartbeat
          pollHealth={snapshot()}
          siteScan={{
            completedAt: "2026-05-09T07:00:00.000Z",
            status: "failed",
          }}
          now={NOW}
        />,
      );
      const lc = html.toLowerCase();
      // Customer-safe vocabulary on the scan row too.
      expect(lc).not.toContain("broken");
      expect(lc).not.toContain("failed system");
      expect(lc).not.toContain("exception");
      expect(lc).not.toContain("stacktrace");
      // No UUID-shaped strings in the scan markup. (We don't ever pass
      // a run_id into the component — this is a defense-in-depth ratchet.)
      expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    });
  });

  // ── computeScanFreshnessVerdict — band boundaries ──

  describe("computeScanFreshnessVerdict — band boundaries", () => {
    it("null/undefined input → no_data", () => {
      expect(computeScanFreshnessVerdict(null, NOW).band).toBe("no_data");
      expect(computeScanFreshnessVerdict(undefined, NOW).band).toBe("no_data");
    });

    it("null completedAt + failed status → needs_attention", () => {
      expect(
        computeScanFreshnessVerdict({ completedAt: null, status: "failed" }, NOW).band,
      ).toBe("needs_attention");
    });

    it("completed within 24h → fresh", () => {
      expect(
        computeScanFreshnessVerdict(
          { completedAt: "2026-05-10T09:00:00.000Z", status: "completed" },
          NOW,
        ).band,
      ).toBe("fresh");
    });

    it("partial within 24h → pending", () => {
      expect(
        computeScanFreshnessVerdict(
          { completedAt: "2026-05-10T09:00:00.000Z", status: "partial" },
          NOW,
        ).band,
      ).toBe("pending");
    });

    it("future timestamp clamps hours to 0 (no negative)", () => {
      const v = computeScanFreshnessVerdict(
        { completedAt: "2026-05-11T00:00:00.000Z", status: "completed" },
        NOW,
      );
      expect(v.hoursSinceLastSuccess).not.toBeNull();
      expect(v.hoursSinceLastSuccess!).toBeGreaterThanOrEqual(0);
    });
  });

  it("never overclaims with proven/validated/confirmed/winning/won copy", () => {
    for (const verdict of ["fresh", "stale", "needs_attention", "pending", "no_data"]) {
      let snap: PollHealthSnapshot | null = snapshot();
      switch (verdict) {
        case "stale":
          snap = snapshot({
            platforms: snapshot().platforms.map((p) => ({
              ...p,
              latestRun: { ...p.latestRun!, completedAt: "2026-05-09T07:00:00.000Z" },
            })),
          });
          break;
        case "needs_attention":
          snap = snapshot({
            platforms: snapshot().platforms.map((p) => ({
              ...p,
              latestRun: { ...p.latestRun!, completedAt: "2026-05-07T07:00:00.000Z" },
            })),
          });
          break;
        case "pending": {
          const s = snapshot();
          s.platforms[0].status = "pending";
          s.platforms[1].latestRun!.completedAt = "2026-05-09T22:00:00.000Z";
          snap = s;
          break;
        }
        case "no_data":
          snap = null;
          break;
      }
      const html = renderToStaticMarkup(
        <DataFreshnessHeartbeat pollHealth={snap} now={NOW} />,
      );
      const lc = html.toLowerCase();
      expect(lc).not.toContain("validated");
      expect(lc).not.toContain("proven");
      expect(lc).not.toContain("confirmed");
      expect(lc).not.toMatch(/\bwinning\b/);
      expect(lc).not.toMatch(/\bwon\b/);
      // Customer-safe vocabulary: no "broken", no "failed system".
      expect(lc).not.toContain("broken");
      expect(lc).not.toContain("failed system");
    }
  });
});
