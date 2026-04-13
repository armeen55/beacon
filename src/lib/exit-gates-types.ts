/** Shared types for Track 1.2 / 1.3 / 1.4 exit gates — safe to import from client components. */

export const EXIT_GATE_KEYS = ["daily_ritual", "replication", "local_layer"] as const;
export type ExitGateKey = (typeof EXIT_GATE_KEYS)[number];

export type ExitGateStatus = "not_started" | "in_review" | "passed" | "failed";

export type ExitGateRecord = {
  key: ExitGateKey;
  status: ExitGateStatus;
  note: string;
  updated_at: string;
};

/** Stable sentinel when a gate has never been written. */
export const EXIT_GATE_DEFAULT_UPDATED_AT = "1970-01-01T00:00:00.000Z";
