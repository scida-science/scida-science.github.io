import type {
  CodeRequest,
  Discovery,
  DiscussionComment,
  Invitation,
  ProfileInput,
  ReviewerApplication,
  Role,
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
  /** Server-managed preference, separate from client-editable profile fields. */
  followedDiscoveryIds?: string[];
}
export interface AccessRecord {
  role: Exclude<Role, "Admin">;
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
  | { path: string; access: MaterialAccess; format?: "multipart-zip"; url?: never }
  | { url: string; access: MaterialAccess; path?: never; format?: never };
export interface ReviewerPackageFile {
  id: string;
  path: string;
  size: number;
  sha256: string;
  /** Private release asset in this investigation repository; never a client URL. */
  releaseAssetId?: number;
}
export interface ReviewerPackage {
  schemaVersion: 1;
  filename: string;
  size: number;
  sha256: string;
  files: ReviewerPackageFile[];
}
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
  if (typeof value.url === "string" && value.path === undefined && value.format === undefined) {
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
    (value.format !== undefined && value.format !== "multipart-zip") ||
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

/** Repository-owned manifest; never accept arbitrary URLs or paths from a download request. */
export function validReviewerPackage(value: unknown, manifestPath: string): value is ReviewerPackage {
  const keys = (row: Record<string, unknown>, names: string[]) => Object.keys(row).every((key) => names.includes(key));
  const size = (input: unknown) => typeof input === "number" && Number.isSafeInteger(input) && input > 0;
  const digest = (input: unknown) => typeof input === "string" && /^[a-f0-9]{64}$/.test(input);
  if (!validMaterial({ path: manifestPath, access: "reviewer" }) || !manifestPath.startsWith("reviewer/")) return false;
  const directory = manifestPath.slice(0, manifestPath.lastIndexOf("/") + 1);
  if (!object(value) || !keys(value, ["schemaVersion", "filename", "size", "sha256", "files"]) ||
      value.schemaVersion !== 1 || typeof value.filename !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}\.zip$/.test(value.filename) ||
      !size(value.size) || !digest(value.sha256) || !Array.isArray(value.files) ||
      value.files.length < 1 || value.files.length > 512) return false;
  const ids = new Set<string>(), paths = new Set<string>(), names = new Set<string>();
  for (const file of value.files) {
    if (!object(file) || !keys(file, ["id", "path", "size", "sha256", "releaseAssetId"]) ||
        typeof file.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(file.id) ||
        typeof file.path !== "string" || !validMaterial({ path: file.path, access: "reviewer" }) ||
        !file.path.startsWith(directory) || file.path === manifestPath ||
        !size(file.size) || (file.size as number) > 100 * 1024 * 1024 || !digest(file.sha256) ||
        (file.releaseAssetId !== undefined && !size(file.releaseAssetId))) return false;
    const name = file.path.split("/").at(-1)!;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name) || ids.has(file.id) || paths.has(file.path) || names.has(name)) return false;
    ids.add(file.id); paths.add(file.path); names.add(name);
  }
  return true;
}
