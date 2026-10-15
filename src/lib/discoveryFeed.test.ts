import { describe, expect, it } from "vitest";
import { discoveries } from "../../test/fixtures/discoveries";
import { hasResearchInterests, orderDiscoveries } from "./discoveryFeed";

describe("discovery feed ordering", () => {
  const records = discoveries.map((discovery) => ({ ...discovery }));
  const interests = {
    fields: ["Artificial Intelligence" as const],
    expertiseTopics: ["bandit-theory" as const],
  };

  it("prioritizes expertise, then fields, without removing other research", () => {
    const input = records.map((discovery) => ({
      ...discovery,
      updatedAt: discovery.topic === "bandit-theory"
        ? "2026-01-01T00:00:00Z"
        : discovery.field === "Astronomy"
          ? "2026-12-01T00:00:00Z"
          : discovery.updatedAt,
    }));
    const originalOrder = input.map((discovery) => discovery.id);
    const result = orderDiscoveries(input, interests);

    expect(result[0].topic).toBe("bandit-theory");
    expect(result.slice(0, 3).every((discovery) => discovery.field === "Artificial Intelligence")).toBe(true);
    expect(result.slice(3).every((discovery) => discovery.field === "Astronomy")).toBe(true);
    expect(result.map((discovery) => discovery.id).sort()).toEqual([...originalOrder].sort());
    expect(input.map((discovery) => discovery.id)).toEqual(originalOrder);
    expect(result[1].updatedAt >= result[2].updatedAt).toBe(true);
  });

  it("orders Recent discoveries chronologically, independently of interests", () => {
    const result = orderDiscoveries(records);
    expect(result.map((discovery) => discovery.updatedAt)).toEqual(
      records.map((discovery) => discovery.updatedAt).sort().reverse(),
    );
    expect(orderDiscoveries(records, { fields: [], expertiseTopics: [] })).toEqual(result);
  });

  it("offers personalization only when a profile has a field or topic", () => {
    expect(hasResearchInterests(null)).toBe(false);
    expect(hasResearchInterests({ fields: [], expertiseTopics: [] })).toBe(false);
    expect(hasResearchInterests({ fields: ["Astronomy"], expertiseTopics: [] })).toBe(true);
    expect(hasResearchInterests({ fields: [], expertiseTopics: ["exoplanets"] })).toBe(true);
  });
});
