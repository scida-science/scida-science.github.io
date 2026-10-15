import { describe, expect, it } from "vitest";
import { migrateAccessRoles, normalizeAccessRecord } from "./accessRoles";
import { emptyAdminState } from "./model";

describe("role compatibility and explicit migration", () => {
  it("retains both senior scopes and only explicit review scope for a retired ordinary role", () => {
    const scopes = { approvedTopics: ["exoplanets"], assignedTopics: ["bandit-theory"] };
    expect(normalizeAccessRecord({ role: "Senior Approver", ...scopes })).toEqual({ role: "Senior Reviewer", ...scopes });
    expect(normalizeAccessRecord({ role: "Approver", ...scopes })).toEqual({ role: "Reviewer", approvedTopics: ["exoplanets"], assignedTopics: [] });
    expect(normalizeAccessRecord({ role: "Reviewer", ...scopes })).toEqual({ role: "Reviewer", approvedTopics: ["exoplanets"], assignedTopics: [] });
  });
  it("fails closed for unknown, client-supplied Admin, and malformed access records", () => {
    for (const value of [null, [], "Senior Reviewer", { role: "Admin", approvedTopics: ["exoplanets"], assignedTopics: ["bandit-theory"] }, { role: "Unknown" }])
      expect(normalizeAccessRecord(value)).toEqual({ role: "Reader", approvedTopics: [], assignedTopics: [] });
    expect(normalizeAccessRecord({ role: "Senior Reviewer", approvedTopics: ["exoplanets", "bogus"], assignedTopics: "bandit-theory" })).toEqual({ role: "Senior Reviewer", approvedTopics: [], assignedTopics: [] });
  });
  it("migrates only retired role fields, preserves unrelated state and metadata, and returns counts without identities", () => {
    const state = emptyAdminState();
    state.access["100"] = { role: "Senior Approver", approvedTopics: ["exoplanets"], assignedTopics: ["bandit-theory"] };
    state.access["200"] = { role: "Approver", approvedTopics: ["exoplanets"], assignedTopics: ["bandit-theory", "scientific-ai"] };
    state.access["300"] = { role: "Reviewer", approvedTopics: ["machine-learning"], assignedTopics: [] };
    Object.assign(state.access["100"], { privateAnnotation: "Preserve owner metadata." });
    state.sessions.existing = { userId: "100", expiresAt: "2099-01-01T00:00:00Z" };
    state.audit.push({ id: "old", actorId: "100", action: "set_access", createdAt: "2026-01-01T00:00:00Z", details: { role: "Senior Approver" } });
    const expected = structuredClone(state);
    Object.assign(expected.access["100"], { role: "Senior Reviewer" });
    Object.assign(expected.access["200"], { role: "Reviewer", assignedTopics: [] });
    expect(migrateAccessRoles(state)).toEqual({ renamedSeniorApprovers: 1, convertedApprovers: 1, removedAssignedTopics: 2 });
    expect(state).toEqual(expected);
    expect(migrateAccessRoles(state)).toEqual({ renamedSeniorApprovers: 0, convertedApprovers: 0, removedAssignedTopics: 0 });
    expect(state).toEqual(expected);
  });
});
