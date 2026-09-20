let attempt = 0;
/** One hermetic atomic reservation lifecycle for tests whose subject is not money. */
export const atomicSpend = {
  reserve: async (input: { estimatedUsd: number }) => ({ outcome: "reserved" as const, attemptId: `fixture-spend-${attempt += 1}`, attemptOrdinal: 1, state: "reserved" as const, reportingDay: "2026-09-19", estimatedUsd: input.estimatedUsd, actualUsd: null, providerTaskId: null }),
  claimTransmission: async () => "claimed" as const,
  markAmbiguous: async () => true,
  release: async () => true,
  reconcile: async () => true,
};

/** Preserve the production async-context seams in hermetic tests while leaving persistence out of scope. */
export const runWithProposalWorkKey = <T>(_workKey: string | null | undefined, work: () => Promise<T>): Promise<T> => work();
export const runWithResearchRun = <T>(_runId: string | null | undefined, _owner: string | null | undefined, work: () => Promise<T>): Promise<T> => work();
export const researchRunSpendUsd = async (): Promise<number> => 0;
