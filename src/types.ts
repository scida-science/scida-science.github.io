export type Field = "Astronomy" | "Artificial Intelligence";
export type ActiveStage = "Awaiting Validation" | "Validated" | "Published";
export type ArchiveOutcome = "Not supported" | "Refuted" | "Withdrawn";
export type Stage = ActiveStage | ArchiveOutcome;
export interface StatusDecision {
  from: Stage;
  to: Stage;
  reason: string;
  decidedAt: string;
  decidedBy: string;
  decidedByName: string;
  version: string;
}
export type Role = "Reader" | "Reviewer" | "Approver" | "Senior Approver" | "Admin";
export type TopicId =
  | "bandit-theory"
  | "machine-learning"
  | "scientific-ai"
  | "time-domain-astronomy"
  | "exoplanets"
  | "galaxy-evolution";
export interface Topic {
  id: TopicId;
  label: string;
  field: Field;
}
export interface Section {
  id: string;
  title: string;
  body: string;
  equation?: string;
}
export interface Discovery {
  question?: string;
  headlineResult?: { equation: string; caption: string };
  headlineFigureId?: string;
  figures?: EvidenceFigure[];
  /** API-only source revision, used to prevent overwriting newer GitHub edits. */
  revision?: string;
  restrictedMaterials?: Array<keyof Discovery["materials"]>;
  illustrative?: boolean;
  id: string;
  title: string;
  field: Field;
  topic: TopicId;
  status: Stage;
  /** Append-only decisions recorded by the backend; never edited by the browser. */
  statusHistory?: StatusDecision[];
  summary: string;
  updatedAt: string;
  version: string;
  reviewNote: string;
  sections: Section[];
  materials: {
    paper: string | null;
    appendix: string | null;
    figures: string | null;
    data: string | null;
    repository: string | null;
  };
}
export type DiscoveryUpdate = Discovery & { statusChangeReason?: string };
export interface EvidenceFigure {
  id: string;
  /** Repository-relative PNG, served through the authorized evidence endpoint. */
  path: string;
  caption: string;
  alt: string;
  sectionId: string;
}
export interface Profile {
  id: string;
  githubLogin?: string;
  fullName: string;
  email: string;
  affiliation: string;
  researchRole: string;
  scholarUrl: string;
  website: string;
  fields: Field[];
  expertiseTopics: TopicId[];
  expertiseStatement: string;
  evidence: string;
  role: Role;
  approvedTopics: TopicId[];
  assignedTopics: TopicId[];
  /** Private preference, returned only for the signed-in account. */
  followedDiscoveryIds?: string[];
}
export interface DiscussionComment {
  id: string;
  discoveryId: string;
  authorId: string;
  authorName?: string;
  parentId: string | null;
  version: string;
  reference: string;
  body: string;
  createdAt: string;
}
export interface CodeRequest {
  id: string;
  discoveryId: string;
  userId: string;
  explanation: string;
  createdAt: string;
}
export interface ReviewerApplication {
  id: string;
  userId: string;
  topics: TopicId[];
  evidence: string;
  status: "Pending" | "Approved" | "Declined";
  createdAt: string;
  decidedBy?: string;
  decisionNote?: string;
}
export interface Invitation {
  id: string;
  code?: string;
  createdBy?: string;
  topics: TopicId[];
  intendedEmail: string;
  usedBy?: string;
  expiresAt?: string;
}
export interface PortalState {
  profiles: Profile[];
  discoveries: Discovery[];
  comments: DiscussionComment[];
  codeRequests: CodeRequest[];
  applications: ReviewerApplication[];
  invitations: Invitation[];
}
export interface ActionResult {
  ok: boolean;
  message: string;
  package?: ReviewerPackage;
}
export interface ReviewerPackageFile {
  id: string;
  filename: string;
  size: number;
  sha256: string;
  url: string;
}
export interface ReviewerPackage {
  filename: string;
  size: number;
  sha256: string;
  files: ReviewerPackageFile[];
}
export type ProfileInput = Omit<
  Profile,
  "id" | "githubLogin" | "email" | "role" | "approvedTopics" | "assignedTopics" | "followedDiscoveryIds"
>;
export interface CommentInput {
  discoveryId: string;
  parentId: string | null;
  version: string;
  reference: string;
  body: string;
}
