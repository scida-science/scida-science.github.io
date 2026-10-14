export type Field = "Astronomy" | "Artificial Intelligence";
export type Stage = "Awaiting Validation" | "Validated" | "Published";
export type Role = "Reader" | "Reviewer" | "Approver" | "Admin";
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
  illustrative?: boolean;
  id: string;
  title: string;
  field: Field;
  topic: TopicId;
  status: Stage;
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
export interface Profile {
  id: string;
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
}
export type ProfileInput = Omit<
  Profile,
  "id" | "email" | "role" | "approvedTopics" | "assignedTopics"
>;
export interface CommentInput {
  discoveryId: string;
  parentId: string | null;
  version: string;
  reference: string;
  body: string;
}
