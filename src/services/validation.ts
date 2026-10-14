import type { Discovery, Field, ProfileInput, Role, TopicId } from "../types";

export const topicIds: TopicId[] = [
  "bandit-theory",
  "machine-learning",
  "scientific-ai",
  "time-domain-astronomy",
  "exoplanets",
  "galaxy-evolution",
];
export const roles: Role[] = ["Reader", "Reviewer", "Approver", "Admin"];
const fields: Field[] = ["Astronomy", "Artificial Intelligence"];
const stages = ["Awaiting Validation", "Validated", "Published"];
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 10000): value is string =>
  typeof value === "string" && value.length <= max;
const nonempty = (value: unknown, max = 10000): value is string =>
  text(value, max) && value.trim().length > 0;
const list = <T extends string>(
  value: unknown,
  choices: readonly T[],
): value is T[] =>
  Array.isArray(value) &&
  value.every((item) => choices.includes(item)) &&
  new Set(value).size === value.length;
export const validTopics = (
  value: unknown,
  required = false,
): value is TopicId[] =>
  list(value, topicIds) && (!required || value.length > 0);

export function validUrl(value: unknown, optional = true): boolean {
  if (!text(value, 2000)) return false;
  if (!value.trim()) return optional;
  try {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function profileError(input: ProfileInput): string | null {
  if (!nonempty(input.fullName, 120))
    return "Enter a full name (up to 120 characters).";
  if (!text(input.affiliation, 200) || !text(input.researchRole, 120))
    return "Affiliation or research role is too long.";
  if (!validUrl(input.scholarUrl))
    return "Use a complete http or https Google Scholar URL.";
  if (
    input.scholarUrl.trim() &&
    new URL(input.scholarUrl).hostname !== "scholar.google.com"
  )
    return "Use a scholar.google.com profile URL.";
  if (!validUrl(input.website))
    return "Use a complete http or https research website URL.";
  if (!list(input.fields, fields) || !validTopics(input.expertiseTopics))
    return "Choose recognized research fields and topics.";
  if (
    input.expertiseTopics.some(
      (topic) =>
        !input.fields.includes(
          topicIds.indexOf(topic) < 3 ? "Artificial Intelligence" : "Astronomy",
        ),
    )
  )
    return "Choose expertise topics within your selected research fields.";
  if (!text(input.expertiseStatement, 2000) || !text(input.evidence, 6000))
    return "Keep the expertise statement under 2,000 characters and evidence under 6,000.";
  return null;
}

export function cleanProfile(input: ProfileInput): ProfileInput {
  return {
    fullName: input.fullName.trim(),
    affiliation: input.affiliation.trim(),
    researchRole: input.researchRole.trim(),
    scholarUrl: input.scholarUrl.trim(),
    website: input.website.trim(),
    fields: [...input.fields],
    expertiseTopics: [...input.expertiseTopics],
    expertiseStatement: input.expertiseStatement.trim(),
    evidence: input.evidence.trim(),
  };
}

export function validDiscovery(value: unknown): value is Discovery {
  if (!object(value)) return false;
  return (
    nonempty(value.id, 80) &&
    nonempty(value.title, 250) &&
    fields.includes(value.field as Field) &&
    topicIds.includes(value.topic as TopicId) &&
    stages.includes(value.status as string) &&
    nonempty(value.summary, 3000) &&
    nonempty(value.updatedAt, 60) &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    nonempty(value.version, 40) &&
    nonempty(value.reviewNote, 3000) &&
    Array.isArray(value.sections) &&
    value.sections.length > 0 &&
    value.sections.length <= 30 &&
    value.sections.every(
      (section) =>
        object(section) &&
        nonempty(section.id, 80) &&
        nonempty(section.title, 250) &&
        nonempty(section.body, 20000) &&
        (section.equation === undefined || text(section.equation, 4000)),
    ) &&
    new Set(value.sections.map((section) => section.id)).size ===
      value.sections.length &&
    object(value.materials) &&
    ["paper", "appendix", "figures", "data", "repository"].every(
      (key) =>
        value.materials &&
        object(value.materials) &&
        (value.materials[key] === null ||
          validUrl(value.materials[key], false)),
    )
  );
}
