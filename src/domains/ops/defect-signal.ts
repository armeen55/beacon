/**
 * defect-signal (P2-a, 2026-07-10 visual audit) - THE one red-defect signal shared by
 * OpsPipelineSection's banner (Today slot 1) and the Today command's fix_defect gate (slot 2).
 * Before this, page.tsx only fed pipeline-invariant violations into buildTodayCommand, so a
 * stalled overnight job (the deadman) or a run of failures (the error spike) could paint the
 * banner red while the command right below it still said "Do this next" or "Nothing needs a
 * decision today" - the exact contradiction the visual audit flagged. Both callers now derive
 * from this ONE pure function, so they can never drift apart again.
 * PURE, no I/O.
 */
import type { PipelineViolation } from "./pipeline-invariants";
import type { DeadmanVerdict } from "./deadman";

export type DefectSignalInput = {
  violations: ReadonlyArray<PipelineViolation>;
  deadman: DeadmanVerdict | null;
  errorSpikeLine: string | null;
};

export type DefectSignal = {
  /** RED-tier pipeline violations only (info/warn staleness never counts as a defect). */
  alarmViolations: PipelineViolation[];
  /** STALENESS (warn-tier) violations - amber, never part of redFires. */
  warnViolations: PipelineViolation[];
  /** True when ANY red-tier signal fires: a broken pipe stage, a stalled overnight job, or a
   *  run of failures. THE SAME condition OpsPipelineSection's banner uses to go red. */
  redFires: boolean;
  /** Every first-person sentence a red signal contributed, in priority order (pipeline stage
   *  violations, then the deadman's own sentences, then the error-spike line). Feed this
   *  straight into buildTodayCommand's pipelineAlarms so the command can never miss a red
   *  signal the banner is already showing. */
  sentences: string[];
};

export function deriveDefectSignal(input: DefectSignalInput): DefectSignal {
  const alarmViolations = input.violations.filter((v) => v.severity !== "info" && v.severity !== "warn");
  const warnViolations = input.violations.filter((v) => v.severity === "warn");
  const pipelineFires = alarmViolations.length > 0;
  const deadmanFires = input.deadman != null && input.deadman.alarm && input.deadman.sentences.length > 0;
  const spikeFires = input.errorSpikeLine != null;
  const redFires = pipelineFires || deadmanFires || spikeFires;
  const sentences = [
    ...alarmViolations.map((v) => v.sentence),
    ...(deadmanFires ? input.deadman!.sentences : []),
    ...(spikeFires ? [input.errorSpikeLine as string] : []),
  ];
  return { alarmViolations, warnViolations, redFires, sentences };
}
