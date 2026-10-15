import type { Discovery, DiscoveryUpdate, Field, ProfileInput, Role, Stage, StatusDecision, TopicId } from "../types";
import { isArchived, stages } from "../data/discoveryStages";

export const topicIds: TopicId[] = [
  "bandit-theory",
  "machine-learning",
  "scientific-ai",
  "time-domain-astronomy",
  "exoplanets",
  "galaxy-evolution",
];
export const roles: Role[] = ["Reader", "Reviewer", "Approver", "Senior Approver", "Admin"];
const fields: Field[] = ["Astronomy", "Artificial Intelligence"];
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

export const MAX_STATUS_DECISIONS = 100;
const statusDecisionKeys = ["from", "to", "reason", "decidedAt", "decidedBy", "decidedByName", "version"];
const decisionTime = (value: unknown): value is string =>
  text(value, 60) &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === value.slice(0, 10);
export function validStatusHistory(value: unknown, status: Stage): value is StatusDecision[] | undefined {
  if (value === undefined) return !isArchived(status);
  if (!Array.isArray(value) || value.length > MAX_STATUS_DECISIONS) return false;
  if (!value.length) return !isArchived(status);
  return value.every((decision, index) =>
    object(decision) && Object.keys(decision).every((key) => statusDecisionKeys.includes(key)) &&
    stages.includes(decision.from as Stage) && stages.includes(decision.to as Stage) &&
    decision.from !== decision.to &&
    text(decision.reason, 2000) && decision.reason.trim().length >= 10 &&
    decisionTime(decision.decidedAt) &&
    typeof decision.decidedBy === "string" && /^[1-9][0-9]{0,19}$/.test(decision.decidedBy) &&
    nonempty(decision.decidedByName, 120) && nonempty(decision.version, 40) &&
    (index === 0 ? !isArchived(decision.from as Stage) :
      decision.from === value[index - 1].to && Date.parse(decision.decidedAt) >= Date.parse(value[index - 1].decidedAt)),
  ) && value[value.length - 1].to === status;
}

/** A pending status change carries a reason, not a browser-authored audit entry. */
export function discoveryUpdateError(input: DiscoveryUpdate, current: Discovery): string | null {
  if (!stages.includes(input.status) || !validDiscovery({ ...input, status: current.status, statusHistory: current.statusHistory }))
    return "Complete all discovery fields before saving.";
  if (input.status !== current.status) {
    if (!text(input.statusChangeReason, 2000) || input.statusChangeReason.trim().length < 10)
      return "Explain the status change in 10–2,000 characters.";
    if ((current.statusHistory?.length ?? 0) >= MAX_STATUS_DECISIONS)
      return "This discovery has reached its status history limit. Contact the administrator before changing its status.";
  }
  return null;
}

export function validDiscovery(value: unknown): value is Discovery {
  if (!object(value)) return false;
  return (
    nonempty(value.id, 80) &&
    nonempty(value.title, 250) &&
    fields.includes(value.field as Field) &&
    topicIds.includes(value.topic as TopicId) &&
    stages.includes(value.status as Stage) &&
    validStatusHistory(value.statusHistory, value.status as Stage) &&
    nonempty(value.summary, 3000) &&
    (value.question === undefined || nonempty(value.question, 500)) &&
    (value.headlineResult === undefined ||
      (object(value.headlineResult) && nonempty(value.headlineResult.equation, 4000) &&
        nonempty(value.headlineResult.caption, 3000))) &&
    validEvidence(value) &&
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

function validEvidence(value: Record<string, unknown>): boolean {
  if (value.figures === undefined) return value.headlineFigureId === undefined;
  if (!Array.isArray(value.figures) || value.figures.length > 12) return false;
  const sections = Array.isArray(value.sections) ? value.sections : [];
  if (!value.figures.every((figure) => object(figure) &&
    typeof figure.id === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(figure.id) &&
    nonempty(figure.path, 1000) && figure.path.endsWith(".png") &&
    !/[\\%?#:\x00-\x1f\x7f]/u.test(figure.path) &&
    figure.path.split("/").every((s) => !!s && s !== "." && s !== "..") &&
    nonempty(figure.caption, 3000) && nonempty(figure.alt, 1500) &&
    sections.some((s) => object(s) && s.id === figure.sectionId))) return false;
  return new Set(value.figures.map((f) => f.id)).size === value.figures.length &&
    (value.headlineFigureId === undefined ||
      value.figures.some((f) => f.id === value.headlineFigureId));
}
