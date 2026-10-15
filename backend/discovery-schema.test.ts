import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import schema from "../docs/discovery.schema.json";
import { discoveries } from "../test/fixtures/discoveries";
import { validDiscoveryDocument } from "./domain";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const document = () => ({ schemaVersion: 1, visibility: "public", discovery: structuredClone(discoveries[0]), materials: { paper: null, appendix: null, figures: null, data: null, repository: null } });
describe("discovery archive schema", () => {
  it("keeps legacy active documents valid", () => {
    expect(validate(document())).toBe(true);
    expect(validDiscoveryDocument(document())).toBe(true);
  });
  it.each(["Not supported", "Refuted", "Withdrawn"] as const)("requires a complete decision for %s documents", (status) => {
    const value = document();
    value.discovery.status = status;
    expect(validate(value)).toBe(false);
    value.discovery.statusHistory = [{
      from: "Awaiting Validation", to: status, reason: "The independent evidence does not support the claim.",
      decidedAt: "2026-10-15T08:00:00.000Z", decidedBy: "89913681", decidedByName: "Owner", version: "v0.2",
    }];
    expect(validate(value)).toBe(true);
    expect(validDiscoveryDocument(value)).toBe(true);
    value.discovery.statusHistory[0].reason = "          ";
    expect(validate(value)).toBe(false);
  });
});
