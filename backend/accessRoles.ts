import { validTopics } from "../src/services/validation";
import { object, type AccessRecord, type AdminState } from "./model";

/** Interpret old records safely without changing stored data during a read. */
export function normalizeAccessRecord(value: unknown): AccessRecord {
  const role = object(value) ? value.role : undefined;
  const normalized = role === "Senior Approver" || role === "Senior Reviewer"
    ? "Senior Reviewer"
    : role === "Approver" || role === "Reviewer" ? "Reviewer" : "Reader";
  return {
    role: normalized,
    approvedTopics: normalized !== "Reader" && object(value) && validTopics(value.approvedTopics)
      ? [...value.approvedTopics] : [],
    assignedTopics: normalized === "Senior Reviewer" && object(value) && validTopics(value.assignedTopics)
      ? [...value.assignedTopics] : [],
  };
}

export interface AccessRoleMigrationCounts {
  renamedSeniorApprovers: number;
  convertedApprovers: number;
  removedAssignedTopics: number;
}

/** Idempotent, synchronous migration suitable for a SHA-conflict retry. */
export function migrateAccessRoles(state: AdminState): AccessRoleMigrationCounts {
  const counts: AccessRoleMigrationCounts = {
    renamedSeniorApprovers: 0, convertedApprovers: 0, removedAssignedTopics: 0,
  };
  for (const record of Object.values(state.access)) {
    if (!object(record)) continue;
    if (record.role === "Senior Approver") {
      Object.assign(record, { role: "Senior Reviewer" });
      counts.renamedSeniorApprovers++;
    } else if (record.role === "Approver") {
      Object.assign(record, { role: "Reviewer" });
      counts.convertedApprovers++;
      counts.removedAssignedTopics += Array.isArray(record.assignedTopics) ? record.assignedTopics.length : 0;
      record.assignedTopics = [];
    }
  }
  return counts;
}
