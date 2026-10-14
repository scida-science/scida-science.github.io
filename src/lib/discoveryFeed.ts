import type { Discovery, Profile } from "../types";

export type ResearchInterests = Pick<Profile, "fields" | "expertiseTopics">;

export function hasResearchInterests(profile?: ResearchInterests | null) {
  return Boolean(profile?.fields.length || profile?.expertiseTopics.length);
}

/** Personalization changes order only; discoveries outside a profile remain visible. */
export function orderDiscoveries(
  discoveries: readonly Discovery[],
  interests?: ResearchInterests | null,
) {
  const priority = (discovery: Discovery) => {
    if (interests?.expertiseTopics.includes(discovery.topic)) return 0;
    if (interests?.fields.includes(discovery.field)) return 1;
    return 2;
  };
  return [...discoveries].sort(
    (a, b) =>
      priority(a) - priority(b) ||
      b.updatedAt.localeCompare(a.updatedAt) ||
      a.id.localeCompare(b.id),
  );
}
