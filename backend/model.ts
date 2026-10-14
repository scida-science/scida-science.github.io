import type {
  CodeRequest,
  Discovery,
  DiscussionComment,
  Invitation,
  ProfileInput,
  ReviewerApplication,
  TopicId,
} from "../src/types";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
export interface ProfileRecord {
  profile: ProfileInput;
  githubLogin: string;
  email: string;
}
export interface AccessRecord {
  role: "Reader" | "Reviewer" | "Approver";
  approvedTopics: TopicId[];
  assignedTopics: TopicId[];
}
export interface SessionRecord {
  userId: string;
  expiresAt: string;
  createdAt?: string;
}
export interface ExchangeRecord {
  userId: string;
  challenge: string;
  expiresAt: string;
}
export interface StoredInvitation extends Omit<Invitation, "code"> {
  createdBy: string;
  expiresAt: string;
  codeHash: string;
  createdAt: string;
  usedAt?: string;
}
export interface AuditRecord {
  id: string;
  actorId: string;
  targetId?: string;
  action: string;
  createdAt: string;
  details: Record<string, unknown>;
}
export interface AdminState {
  schemaVersion: 1;
  profiles: Record<string, ProfileRecord>;
  access: Record<string, AccessRecord>;
  applications: ReviewerApplication[];
  invitations: StoredInvitation[];
  codeRequests: CodeRequest[];
  sessions: Record<string, SessionRecord>;
  exchanges: Record<string, ExchangeRecord>;
  audit: AuditRecord[];
}
export const materialKinds = [
  "paper",
  "appendix",
  "figures",
  "data",
  "repository",
] as const;
export type MaterialKind = (typeof materialKinds)[number];
export type MaterialAccess = "public" | "reader" | "reviewer" | "admin";
export type MaterialRecord =
  | { path: string; access: MaterialAccess; url?: never }
  | { url: string; access: MaterialAccess; path?: never };
export interface DiscoveryDocument {
  schemaVersion: 1;
  visibility: "public" | "signed-in";
  discovery: Discovery;
  materials: Record<MaterialKind, MaterialRecord | null>;
}
export interface StoredDiscovery {
  repository: string;
  sha: string;
  document: DiscoveryDocument;
}
export interface GitHubStore {
  readAdmin(): Promise<AdminState>;
  /** Callback may be retried after a SHA conflict. It must be synchronous and side-effect free. */
  updateAdmin<T>(mutate: (state: AdminState) => T): Promise<T>;
  listDiscoveries(): Promise<StoredDiscovery[]>;
  saveDiscovery(
    record: StoredDiscovery,
    document: DiscoveryDocument,
  ): Promise<void>;
  readComments(record: StoredDiscovery): Promise<DiscussionComment[]>;
  addComment(
    record: StoredDiscovery,
    comment: DiscussionComment,
  ): Promise<void>;
}
export function emptyAdminState(): AdminState {
  return {
    schemaVersion: 1,
    profiles: {},
    access: {},
    applications: [],
    invitations: [],
    codeRequests: [],
    sessions: {},
    exchanges: {},
    audit: [],
  };
}
export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function validMaterial(value: unknown): value is MaterialRecord {
  if (
    !object(value) ||
    !["public", "reader", "reviewer", "admin"].includes(value.access as string)
  )
    return false;
  if (typeof value.url === "string" && value.path === undefined) {
    try {
      const url = new URL(value.url);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        value.url.length <= 2000
      );
    } catch {
      return false;
    }
  }
  if (
    typeof value.path !== "string" ||
    value.url !== undefined ||
    value.path.length < 1 ||
    value.path.length > 1000
  )
    return false;
  // GitHub repository-relative paths only. No encoded traversal, controls, URL
  // delimiters, backslashes, empty segments, or leading/trailing separators.
  return (
    !/[\\%?#:\x00-\x1f\x7f]/u.test(value.path) &&
    value.path
      .split("/")
      .every((segment) => !!segment && segment !== "." && segment !== "..")
  );
}
