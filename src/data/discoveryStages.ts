import type { ActiveStage, ArchiveOutcome, Stage } from "../types";

export const activeStages: ActiveStage[] = ["Awaiting Validation", "Validated", "Published"];
export const archiveStages: ArchiveOutcome[] = ["Not supported", "Refuted", "Withdrawn"];
export const stages: Stage[] = [...activeStages, ...archiveStages];
export const isArchived = (status: Stage): status is ArchiveOutcome =>
  archiveStages.includes(status as ArchiveOutcome);

export const archiveDescriptions: Record<ArchiveOutcome, string> = {
  "Not supported": "Review found insufficient evidence for the claim.",
  Refuted: "Evidence demonstrates that the claim is incorrect.",
  Withdrawn: "The investigation was withdrawn with an explanation.",
};
