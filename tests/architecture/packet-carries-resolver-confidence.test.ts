/**
 * LLM-DryRun-3 (operator audit, 2026-05-05) — pin that the recommendation
 * evidence packet surfaces the resolver's confidence to the LLM.
 *
 * Why this invariant exists:
 *   The SYSTEM_PROMPT structural-abstention rule (Rule 16.A trigger 2)
 *   says: "Return [] when resolution.confidence === 'low' AND
 *   brandAssertions is empty." For that rule to actually fire, the
 *   model has to be able to evaluate `resolution.confidence` from the
 *   JSON-stringified user message. Before LLM-DryRun-3 the candidate's
 *   `resolution.*` lived only on the queue row and was NOT carried
 *   into the packet — so the model had no way to know the confidence
 *   was "low" on a multi-prompt packet. Trigger 2 was structurally
 *   unenforceable.
 *
 *   This invariant pins the fix forward:
 *
 *     1. The packet TYPE has a `resolution: { confidence, tier, action } | null`
 *        block (always present, even when null).
 *     2. The production caller `buildPacketForRec` reads
 *        `rec.resolution` and threads `confidence` + `tier` + `action`
 *        into the packet `resolution` block.
 *     3. The OpenAI provider's user-message construction goes through
 *        `JSON.stringify(packet)`, so the resolver context lands in
 *        the message verbatim.
 *
 * If a future regression drops the packet-level resolution block, or
 * stops sourcing it from `rec.resolution`, this invariant fails the
 * build before the next dry-run can mis-fire on it.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const PACKET_TYPE_PATH = join(
  REPO_ROOT,
  "src/domains/recommendations/specific-edit-evidence.ts",
);
const LOAD_QUEUE_PATH = join(
  REPO_ROOT,
  "src/domains/recommendations/load-queue.ts",
);
const PROVIDER_PATH = join(
  REPO_ROOT,
  "src/domains/recommendations/providers/openai.ts",
);

const PACKET_SRC = readFileSync(PACKET_TYPE_PATH, "utf-8");
const LOAD_QUEUE_SRC = readFileSync(LOAD_QUEUE_PATH, "utf-8");
const PROVIDER_SRC = readFileSync(PROVIDER_PATH, "utf-8");

describe("LLM-DryRun-3 — SpecificEditEvidencePacket carries resolver context", () => {
  it("declares resolution.{confidence,tier,action} on the packet type", () => {
    // Anchor on the packet type definition — guard against accidental
    // removal.
    expect(PACKET_SRC.includes("export type SpecificEditEvidencePacket")).toBe(
      true,
    );
    expect(
      /resolution\?:\s*\{[\s\S]{0,200}confidence:\s*"high"\s*\|\s*"medium"\s*\|\s*"low"/.test(
        PACKET_SRC,
      ),
      "SpecificEditEvidencePacket must declare a resolution block with " +
        "confidence: 'high' | 'medium' | 'low' so the LLM can evaluate " +
        "Rule 16.A trigger 2 (DryRun-3 brief)",
    ).toBe(true);
    expect(
      /resolution\?:\s*\{[\s\S]{0,300}tier:/.test(PACKET_SRC),
      "Packet resolution block must carry the resolver tier so the LLM " +
        "has the full context",
    ).toBe(true);
    expect(
      /resolution\?:\s*\{[\s\S]{0,400}action:/.test(PACKET_SRC),
      "Packet resolution block must carry the resolver action so the LLM " +
        "can correlate confidence with action type (e.g. needs_review)",
    ).toBe(true);
  });

  it("includes the resolution block in the hashed packet body", () => {
    // The packet's `withoutHash` literal — what gets hashed and serialized
    // — must include a `resolution:` field. If this disappears, the
    // packet still typechecks but the model loses sight of the
    // resolver context.
    expect(
      /withoutHash[\s\S]{0,500}resolution:\s*args\.resolution/.test(
        PACKET_SRC,
      ) ||
        /resolution:\s*args\.resolution\s*\?\?\s*null/.test(PACKET_SRC),
      "buildSpecificEditEvidencePacket must include the resolution block in " +
        "the hashed packet body (so caches invalidate when resolver flips, " +
        "and the user-message JSON.stringify carries it)",
    ).toBe(true);
  });
});

describe("LLM-DryRun-3 — buildPacketForRec sources resolution from rec.resolution", () => {
  it("threads rec.resolution.confidence into the packet builder args", () => {
    expect(
      /resolution:\s*rec\.resolution\s*\?\s*\{[\s\S]{0,300}confidence:\s*rec\.resolution\.confidence/.test(
        LOAD_QUEUE_SRC,
      ),
      "buildPacketForRec must source `confidence` from `rec.resolution.confidence`. " +
        "If this regresses, low-confidence packets won't carry the " +
        "confidence label into the JSON-stringified user message and " +
        "Rule 16.A trigger 2 will fail to fire on multi-prompt packets",
    ).toBe(true);
  });

  it("threads tier + action alongside confidence", () => {
    expect(
      /tier:\s*rec\.resolution\.tier/.test(LOAD_QUEUE_SRC),
      "buildPacketForRec must source `tier` from `rec.resolution.tier`",
    ).toBe(true);
    expect(
      /action:\s*rec\.resolution\.action/.test(LOAD_QUEUE_SRC),
      "buildPacketForRec must source `action` from `rec.resolution.action`",
    ).toBe(true);
  });

  it("falls back to null when the candidate has no resolution attached", () => {
    expect(
      /rec\.resolution\s*\?[\s\S]{0,300}:\s*null/.test(LOAD_QUEUE_SRC),
      "buildPacketForRec must fall back to `null` when rec.resolution is " +
        "absent (graceful degradation for legacy callers / test fixtures); " +
        "this preserves the type contract `resolution?: ... | null`",
    ).toBe(true);
  });
});

describe("LLM-DryRun-3 — provider serializes the packet (incl. resolution) to the user message", () => {
  it("sends the full packet JSON in the user message", () => {
    // The OpenAI provider's user message is `JSON.stringify(packet, null, 2)`;
    // because resolution is a top-level packet field, JSON.stringify
    // surfaces it verbatim when non-null/non-undefined. Pin the
    // serialization call so a future refactor doesn't quietly project
    // away the field.
    expect(
      /content:\s*`Evidence packet:\\n\$\{JSON\.stringify\(packet[^)]*\)\}/.test(
        PROVIDER_SRC,
      ) ||
        /JSON\.stringify\(packet,\s*null,\s*2\)/.test(PROVIDER_SRC),
      "openai provider must serialize the FULL packet (including the new " +
        "resolution block) into the user message via JSON.stringify(packet, ...). " +
        "If a future refactor projects away fields, the LLM loses the " +
        "resolver context and Rule 16.A becomes unenforceable again.",
    ).toBe(true);
  });
});
