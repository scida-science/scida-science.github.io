import { describe, expect, it } from "vitest";
import { discoveries } from "../../test/fixtures/discoveries";
import type { Discovery, StatusDecision } from "../types";
import { discoveryUpdateError, MAX_STATUS_DECISIONS, validDiscovery } from "./validation";

const decision: StatusDecision = {
  from: "Awaiting Validation", to: "Withdrawn", reason: "The evidence requires additional independent checks.",
  decidedAt: "2026-10-15T08:00:00.000Z", decidedBy: "89913681", decidedByName: "Owner", version: "v0.2",
};
const archived = (): Discovery => ({ ...structuredClone(discoveries[0]), status: "Withdrawn", statusHistory: [{ ...decision }] });

describe("discovery status history validation", () => {
  it("accepts existing active records without history and archived records with a matching decision", () => {
    expect(validDiscovery(discoveries[0])).toBe(true);
    expect(validDiscovery(archived())).toBe(true);
    expect(validDiscovery({ ...archived(), statusHistory: undefined })).toBe(false);
    expect(validDiscovery({ ...archived(), statusHistory: [] })).toBe(false);
  });
  it.each([
    { from: "Withdrawn" }, { to: "Refuted" }, { from: "Unknown" }, { reason: "too short" },
    { reason: "x".repeat(2001) }, { decidedAt: "not a date" }, { decidedAt: "2026-02-30T08:00:00.000Z" },
    { decidedAt: "2026-10-15T08:00:00" }, { decidedBy: "client-admin" },
    { decidedByName: " " }, { version: "" }, { privateNote: "Never project undeclared history data." },
  ])("rejects malformed or mismatched decisions: %j", (changes) => {
    expect(validDiscovery({ ...archived(), statusHistory: [{ ...decision, ...changes }] })).toBe(false);
  });
  it("requires continuous chronological history and a nonempty transition", () => {
    const restored: StatusDecision = { ...decision, from: "Withdrawn", to: "Validated", decidedAt: "2026-10-15T09:00:00.000Z" };
    expect(validDiscovery({ ...archived(), status: "Validated", statusHistory: [decision, restored] })).toBe(true);
    expect(validDiscovery({ ...archived(), status: "Validated", statusHistory: [decision, { ...restored, from: "Published" }] })).toBe(false);
    expect(validDiscovery({ ...archived(), status: "Validated", statusHistory: [decision, { ...restored, decidedAt: "2026-10-14T09:00:00.000Z" }] })).toBe(false);
    expect(validDiscovery({ ...archived(), statusHistory: [{ ...decision, from: "Withdrawn" }] })).toBe(false);
    expect(validDiscovery({ ...archived(), statusHistory: Array(MAX_STATUS_DECISIONS + 1).fill(decision) })).toBe(false);
  });
  it("validates pending archive/restore requests using current history without inventing a decision", () => {
    const active = discoveries[0];
    const request = { ...active, status: "Withdrawn" as const, statusChangeReason: decision.reason };
    expect(validDiscovery(request)).toBe(false);
    expect(discoveryUpdateError(request, active)).toBeNull();
    expect(discoveryUpdateError({ ...request, statusChangeReason: "" }, active)).toContain("10–2,000");
    expect(discoveryUpdateError({ ...archived(), status: "Awaiting Validation", statusChangeReason: decision.reason }, archived())).toBeNull();
    expect(discoveryUpdateError({ ...archived(), title: "An edited title", statusHistory: [] }, archived())).toBeNull();
  });
});
