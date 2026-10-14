import type { Env } from "./env";
import { appJwt } from "./crypto";
import {
  HttpError,
  object,
  type AdminState,
  type DiscoveryDocument,
  type GitHubStore,
  type StoredDiscovery,
} from "./model";
import type { DiscussionComment } from "../src/types";
import { validDiscovery } from "../src/services/validation";
import { createHmac, timingSafeEqual } from "node:crypto";

export type Fetcher = typeof fetch;
class GitHubError extends Error {
  constructor(readonly status: number) {
    super("GitHub API request failed");
  }
}
const tokenCache = new Map<string, { token: string; expires: number }>();
const apiVersion = "2022-11-28";
const statePath = "scida/state.json";
const marker = "<!-- scida-discussion-v1:";
const segment = (value: string) => encodeURIComponent(value);
const pathParts = (value: string) => value.split("/").map(segment).join("/");

export class GitHubApi {
  private pendingToken: Promise<string> | undefined;
  constructor(
    readonly env: Env,
    // Workers' native fetch requires its global receiver. Calling a captured
    // native function as this.fetcher() otherwise throws "Illegal invocation".
    readonly fetcher: Fetcher = (input, init) => fetch(input, init),
  ) {}
  async token(): Promise<string> {
    const cacheKey = `${this.env.GITHUB_APP_ID}:${this.env.GITHUB_INSTALLATION_ID}:${this.env.GITHUB_PRIVATE_KEY}`;
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expires > Date.now() + 60000) return cached.token;
    // Parallel reads in one request share initialization. Keep pending I/O on
    // this request's adapter; only completed tokens enter the global cache.
    if (this.pendingToken) return this.pendingToken;
    const pending = this.issueToken(cacheKey);
    this.pendingToken = pending;
    try {
      return await pending;
    } finally {
      if (this.pendingToken === pending) this.pendingToken = undefined;
    }
  }
  private async issueToken(cacheKey: string): Promise<string> {
    const jwt = appJwt(this.env.GITHUB_APP_ID, this.env.GITHUB_PRIVATE_KEY);
    const installation = await this.request<{
      account: { login: string };
      suspended_at: string | null;
    }>(
      `/app/installations/${segment(this.env.GITHUB_INSTALLATION_ID)}`,
      {},
      jwt,
    );
    if (
      installation.account.login.toLowerCase() !==
        this.env.GITHUB_ORG.toLowerCase() ||
      installation.suspended_at
    )
      throw new HttpError(
        503,
        "The GitHub App installation is not active for the configured organization.",
      );
    const result = await this.request<{ token: string; expires_at: string }>(
      `/app/installations/${segment(this.env.GITHUB_INSTALLATION_ID)}/access_tokens`,
      {
        method: "POST",
        body: JSON.stringify({
          permissions: { contents: "write", issues: "write", metadata: "read" },
        }),
      },
      jwt,
    );
    tokenCache.set(cacheKey, {
      token: result.token,
      expires: Date.parse(result.expires_at),
    });
    return result.token;
  }
  async raw(
    path: string,
    init: RequestInit = {},
    token?: string,
  ): Promise<Response> {
    if (!path.startsWith("/") || path.startsWith("//"))
      throw new HttpError(500, "Invalid GitHub API path.");
    return this.fetcher("https://api.github.com" + path, {
      ...init,
      // Workers supports manual/follow only. Callers reject non-2xx responses,
      // so a redirect is never followed with the installation token attached.
      redirect: "manual",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": apiVersion,
        "User-Agent": "SciDA-Research-Portal",
        Authorization: `Bearer ${token ?? (await this.token())}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  }
  async request<T>(
    path: string,
    init: RequestInit = {},
    token?: string,
  ): Promise<T> {
    const response = await this.raw(path, init, token);
    if (!response.ok) {
      if (
        response.status === 429 ||
        (response.status === 403 &&
          response.headers.get("x-ratelimit-remaining") === "0")
      )
        throw new HttpError(
          503,
          "GitHub storage is temporarily rate limited. Please try again later.",
        );
      throw new GitHubError(response.status);
    }
    return response.status === 204
      ? (undefined as T)
      : (response.json() as Promise<T>);
  }
  async pages<T>(path: string): Promise<T[]> {
    const result: T[] = [];
    for (let page = 1; page <= 20; page++) {
      const rows = await this.request<T[]>(
        `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      );
      result.push(...rows);
      if (rows.length < 100) return result;
    }
    throw new HttpError(
      503,
      "This repository exceeds the current portal pagination limit.",
    );
  }
}

interface ContentFile {
  sha: string;
  content: string;
  encoding: string;
  size: number;
  type: string;
}
interface Repo {
  name: string;
  private: boolean;
  archived: boolean;
  owner: { login: string };
}
interface IssueRow {
  number: number;
  body: string | null;
  pull_request?: unknown;
  performed_via_github_app?: { id: number };
  user?: { type: string };
}

export class GitHubRepositoryStore implements GitHubStore {
  private adminPrivate: Promise<void> | undefined;
  constructor(readonly api: GitHubApi) {}
  private repoPath(repo: string): string {
    if (!/^[A-Za-z0-9_.-]+$/.test(repo))
      throw new HttpError(500, "Invalid repository configuration.");
    return `/repos/${segment(this.api.env.GITHUB_ORG)}/${segment(repo)}`;
  }
  private async protectAdmin() {
    this.adminPrivate ??= this.api
      .request<Repo>(this.repoPath(this.api.env.ADMIN_REPOSITORY))
      .then((repo) => {
        if (!repo.private || repo.archived)
          throw new HttpError(
            503,
            "Administrative storage must be an active private repository.",
          );
      });
    return this.adminPrivate;
  }
  private async jsonFile<T>(
    repo: string,
    path: string,
  ): Promise<{ value: T; sha: string }> {
    const file = await this.api.request<ContentFile>(
      `${this.repoPath(repo)}/contents/${pathParts(path)}`,
    );
    if (
      file.type !== "file" ||
      file.encoding !== "base64" ||
      file.size > 2_000_000
    )
      throw new HttpError(503, "A SciDA record is not a supported JSON file.");
    try {
      return {
        value: JSON.parse(
          Buffer.from(file.content, "base64").toString("utf8"),
        ) as T,
        sha: file.sha,
      };
    } catch {
      throw new HttpError(503, "A SciDA repository contains invalid JSON.");
    }
  }
  private async putJson(
    repo: string,
    path: string,
    value: unknown,
    sha: string,
    message: string,
  ) {
    const content = Buffer.from(JSON.stringify(value, null, 2) + "\n").toString(
      "base64",
    );
    if (content.length > 2_600_000)
      throw new HttpError(
        503,
        "Administrative storage needs archival before accepting more records.",
      );
    await this.api.request(
      `${this.repoPath(repo)}/contents/${pathParts(path)}`,
      { method: "PUT", body: JSON.stringify({ message, sha, content }) },
    );
  }
  private async adminFile() {
    await this.protectAdmin();
    const file = await this.jsonFile<AdminState>(
      this.api.env.ADMIN_REPOSITORY,
      statePath,
    );
    const state = file.value;
    if (
      !object(state) ||
      state.schemaVersion !== 1 ||
      !object(state.profiles) ||
      !object(state.access) ||
      !object(state.sessions) ||
      !object(state.exchanges) ||
      !Array.isArray(state.applications) ||
      !Array.isArray(state.invitations) ||
      !Array.isArray(state.codeRequests) ||
      !Array.isArray(state.audit)
    )
      throw new HttpError(
        503,
        "Administrative storage has an unsupported format.",
      );
    return file;
  }
  async readAdmin(): Promise<AdminState> {
    return (await this.adminFile()).value;
  }
  async updateAdmin<T>(mutate: (state: AdminState) => T): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { value, sha } = await this.adminFile();
      const result = mutate(value);
      try {
        await this.putJson(
          this.api.env.ADMIN_REPOSITORY,
          statePath,
          value,
          sha,
          "Update SciDA private records",
        );
        return result;
      } catch (error) {
        if (!(error instanceof GitHubError) || error.status !== 409)
          throw error;
      }
    }
    throw new HttpError(
      409,
      "Another researcher updated the records. Refresh and try again.",
    );
  }
  async listDiscoveries(): Promise<StoredDiscovery[]> {
    const repos: Repo[] = [];
    for (let page = 1; page <= 20; page++) {
      const data = await this.api.request<{ repositories: Repo[] }>(
        `/installation/repositories?per_page=100&page=${page}`,
      );
      repos.push(...data.repositories);
      if (data.repositories.length < 100) break;
      if (page === 20)
        throw new HttpError(
          503,
          "The installation exceeds the discovery listing limit.",
        );
    }
    const discoveries: StoredDiscovery[] = [];
    // Bounded serial reads respect GitHub secondary rate limits.
    for (const repo of repos.filter(
      (repo) =>
        repo.private &&
        !repo.archived &&
        repo.owner.login.toLowerCase() ===
          this.api.env.GITHUB_ORG.toLowerCase() &&
        repo.name.startsWith("discovery-"),
    )) {
      try {
        const { value, sha } = await this.jsonFile<DiscoveryDocument>(
          repo.name,
          "discovery.json",
        );
        if (
          !object(value) ||
          value.schemaVersion !== 1 ||
          !["public", "signed-in"].includes(value.visibility) ||
          !validDiscovery(value.discovery) ||
          !object(value.materials)
        )
          throw new HttpError(
            503,
            "A discovery repository has an invalid discovery.json.",
          );
        discoveries.push({ repository: repo.name, sha, document: value });
      } catch (error) {
        if (error instanceof GitHubError && error.status === 404) continue;
        throw error;
      }
    }
    if (
      new Set(discoveries.map((row) => row.document.discovery.id)).size !==
      discoveries.length
    )
      throw new HttpError(
        503,
        "Discovery IDs must be unique across repositories.",
      );
    return discoveries;
  }
  async saveDiscovery(record: StoredDiscovery, document: DiscoveryDocument) {
    try {
      await this.putJson(
        record.repository,
        "discovery.json",
        document,
        record.sha,
        "Update SciDA research brief",
      );
    } catch (error) {
      if (error instanceof GitHubError && error.status === 409)
        throw new HttpError(
          409,
          "The discovery changed on GitHub. Refresh before editing again.",
        );
      throw error;
    }
  }
  private decodeDiscussion(row: IssueRow): DiscussionComment | null {
    if (
      String(row.performed_via_github_app?.id) !== this.api.env.GITHUB_APP_ID ||
      row.user?.type !== "Bot" ||
      !row.body?.startsWith(marker)
    )
      return null;
    const encoded = row.body.slice(marker.length).split(" -->", 1)[0];
    try {
      const [payload, signature] = encoded.split(".");
      const expected = createHmac("sha256", this.api.env.DISCUSSION_SECRET)
        .update(payload)
        .digest();
      const actual = Buffer.from(signature || "", "base64url");
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        return null;
      const record = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      );
      if (
        !object(record) ||
        typeof record.id !== "string" ||
        typeof record.authorId !== "string" ||
        typeof record.body !== "string" ||
        typeof record.discoveryId !== "string" ||
        typeof record.version !== "string" ||
        typeof record.createdAt !== "string" ||
        typeof record.reference !== "string" ||
        !(record.parentId === null || typeof record.parentId === "string")
      )
        return null;
      if (!Number.isFinite(Date.parse(record.createdAt))) return null;
      return record as unknown as DiscussionComment;
    } catch {
      return null;
    }
  }
  private encodeDiscussion(comment: DiscussionComment): string {
    const payload = Buffer.from(JSON.stringify(comment)).toString("base64url");
    const signature = createHmac("sha256", this.api.env.DISCUSSION_SECRET)
      .update(payload)
      .digest("base64url");
    return `${marker}${payload}.${signature} -->\n\n**SciDA author:** ${comment.authorName || "Researcher"} (GitHub ID ${comment.authorId})\n\n**Manuscript:** ${comment.version}\n\n**Reference:** ${comment.reference || "General discussion"}\n\n${comment.body}`;
  }
  private async issues(record: StoredDiscovery): Promise<IssueRow[]> {
    return (
      await this.api.pages<IssueRow>(
        `${this.repoPath(record.repository)}/issues?state=all`,
      )
    ).filter((row) => !row.pull_request);
  }
  async readComments(record: StoredDiscovery): Promise<DiscussionComment[]> {
    const comments: DiscussionComment[] = [];
    for (const issue of await this.issues(record)) {
      const root = this.decodeDiscussion(issue);
      if (
        !root ||
        root.parentId !== null ||
        root.discoveryId !== record.document.discovery.id
      )
        continue;
      comments.push(root);
      for (const row of await this.api.pages<IssueRow>(
        `${this.repoPath(record.repository)}/issues/${issue.number}/comments`,
      )) {
        const reply = this.decodeDiscussion(row);
        if (
          reply &&
          reply.discoveryId === root.discoveryId &&
          reply.version === root.version &&
          comments.some((parent) => parent.id === reply.parentId)
        )
          comments.push(reply);
      }
    }
    return comments;
  }
  async addComment(
    record: StoredDiscovery,
    comment: DiscussionComment,
  ): Promise<void> {
    const issues = await this.issues(record);
    if (comment.parentId === null) {
      await this.api.request(`${this.repoPath(record.repository)}/issues`, {
        method: "POST",
        body: JSON.stringify({
          title:
            `[SciDA ${comment.version}] ${comment.reference || "Research discussion"}`.slice(
              0,
              200,
            ),
          body: this.encodeDiscussion(comment),
        }),
      });
      return;
    }
    for (const issue of issues) {
      const root = this.decodeDiscussion(issue);
      if (
        !root ||
        root.discoveryId !== comment.discoveryId ||
        root.version !== comment.version
      )
        continue;
      const replies = await this.api.pages<IssueRow>(
        `${this.repoPath(record.repository)}/issues/${issue.number}/comments`,
      );
      if (
        root.id === comment.parentId ||
        replies.some(
          (row) => this.decodeDiscussion(row)?.id === comment.parentId,
        )
      ) {
        await this.api.request(
          `${this.repoPath(record.repository)}/issues/${issue.number}/comments`,
          {
            method: "POST",
            body: JSON.stringify({ body: this.encodeDiscussion(comment) }),
          },
        );
        return;
      }
    }
    throw new HttpError(
      409,
      "The parent discussion changed. Refresh and try again.",
    );
  }
  async materialFile(record: StoredDiscovery, path: string): Promise<Response> {
    const response = await this.api.raw(
      `${this.repoPath(record.repository)}/contents/${pathParts(path)}`,
      { headers: { Accept: "application/vnd.github.raw+json" } },
    );
    if (!response.ok)
      throw new HttpError(
        response.status === 404 ? 404 : 503,
        "The supporting file could not be retrieved from GitHub.",
      );
    const name = path
      .split("/")
      .at(-1)!
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    // Attachments never execute on the API origin; no signed GitHub URL is exposed.
    return new Response(response.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
}
