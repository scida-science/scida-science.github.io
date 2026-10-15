import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { digest } from "./crypto";
import { validDiscoveryDocument } from "./domain";
import type { Env } from "./env";
import { GitHubApi, GitHubRepositoryStore } from "./github";
import { handleRequest } from "./index";
import { emptyAdminState, type DiscoveryDocument, type StoredDiscovery } from "./model";

// Opt in with SCIDA_BANDIT_REPOSITORY pointing to a prepared research checkout.
// Only local, size-bounded artifacts are read. GitHub and account writes remain
// in memory; this test never connects to the live site or a remote repository.
const repositoryDirectory = process.env.SCIDA_BANDIT_REPOSITORY;
const env: Env = {
  FRONTEND_ORIGIN: "https://site.example.test", API_ORIGIN: "https://api.example.test",
  GITHUB_ORG: "fixture", ADMIN_REPOSITORY: "admin", ADMIN_GITHUB_ID: "101",
  GITHUB_APP_ID: "123", GITHUB_CLIENT_ID: "fixture", GITHUB_INSTALLATION_ID: "456",
  GITHUB_CLIENT_SECRET: "test-only-client-secret", GITHUB_PRIVATE_KEY: "test-only-key",
  SESSION_SECRET: "test-only-session-secret-32-characters", DISCUSSION_SECRET: "test-only-discussion-secret-32-characters",
};
const tokens = { reader: "r".repeat(43), reviewer: "v".repeat(43), wrong: "w".repeat(43) };
const identities = { reader: "201", reviewer: "202", wrong: "203" };
type Identity = keyof typeof tokens;

describe.skipIf(!repositoryDirectory)("prepared bandit content and material permissions", () => {
  let document: DiscoveryDocument, record: StoredDiscovery, store: GitHubRepositoryStore;
  let state = emptyAdminState();
  let paperPath: string, packagePath: string;
  let fetcher: ReturnType<typeof vi.fn>;
  const files = new Map<string, Buffer>();

  beforeAll(async () => {
    const root = await realpath(repositoryDirectory!);
    async function boundedFile(path: string, maximum: number) {
      const target = await realpath(resolve(root, path));
      const child = relative(root, target);
      if (isAbsolute(child) || child === ".." || child.startsWith("../") || child.startsWith("..\\"))
        throw new Error("Research artifact escapes the supplied repository");
      const info = await stat(target);
      if (!info.isFile() || info.size > maximum) throw new Error(`Invalid or oversized artifact: ${path}`);
      return readFile(target);
    }
    const value: unknown = JSON.parse((await boundedFile("discovery.json", 512 * 1024)).toString("utf8"));
    if (!validDiscoveryDocument(value)) throw new Error("Invalid prepared discovery.json");
    document = value;
    expect(document.discovery.topic).toBe("bandit-theory");
    expect(document.discovery.illustrative).toBe(false);
    expect(document.visibility).toBe("public");
    expect(document.discovery.headlineResult).toBeDefined();
    expect(document.materials.paper?.access).toBe("public");
    expect(document.materials.repository?.access).toBe("reviewer");
    if (!document.materials.paper?.path || !document.materials.repository?.path || document.materials.repository.format)
      throw new Error("Prepared bandit materials must contain a paper and a single reviewer ZIP");
    paperPath = document.materials.paper.path;
    packagePath = document.materials.repository.path;
    const figures = document.discovery.figures ?? [];
    expect(figures.length).toBeGreaterThan(0);
    expect(figures.length).toBeLessThanOrEqual(12);
    for (const path of [paperPath, packagePath, ...figures.map((figure) => figure.path)])
      files.set(path, await boundedFile(path, 32 * 1024 * 1024));
    expect(files.get(paperPath)!.subarray(0, 5).toString()).toBe("%PDF-");
    expect(files.get(packagePath)!.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))).toBe(true);
  });

  beforeEach(async () => {
    state = emptyAdminState();
    record = { repository: "information-optimal-bandits", sha: "local-content-test", document: structuredClone(document) };
    for (const label of Object.keys(tokens) as Identity[]) {
      const userId = identities[label];
      state.profiles[userId] = { githubLogin: label, email: `${label}@example.test`, profile: {
        fullName: label, affiliation: "", researchRole: "", scholarUrl: "", website: "", fields: [], expertiseTopics: [], expertiseStatement: "", evidence: "",
      } };
      state.access[userId] = { role: label === "reader" ? "Reader" : "Reviewer",
        approvedTopics: label === "reviewer" ? ["bandit-theory"] : label === "wrong" ? ["exoplanets"] : [], assignedTopics: [] };
      state.sessions[await digest(tokens[label])] = { userId, expiresAt: new Date(Date.now() + 3600000).toISOString() };
    }
    fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const prefix = `/repos/${env.GITHUB_ORG}/${record.repository}/contents/`;
      if (url.origin !== "https://api.github.com" || !url.pathname.startsWith(prefix))
        throw new Error("Unexpected remote destination in local content test");
      const path = decodeURIComponent(url.pathname.slice(prefix.length));
      const bytes = files.get(path);
      if (!bytes) throw new Error(`Undeclared research artifact requested: ${path}`);
      return new Response(new Uint8Array(bytes), { headers: { "Content-Length": String(bytes.length) } });
    });
    const api = new GitHubApi(env, fetcher);
    vi.spyOn(api, "token").mockResolvedValue("test-only-installation-token");
    store = new GitHubRepositoryStore(api);
    vi.spyOn(store, "readAdmin").mockImplementation(async () => structuredClone(state));
    vi.spyOn(store, "listDiscoveries").mockImplementation(async () => [structuredClone(record)]);
    vi.spyOn(store, "readComments").mockResolvedValue([]);
    vi.spyOn(store, "updateAdmin").mockImplementation(async (mutate) => {
      const next = structuredClone(state);
      const result = mutate(next);
      state = next;
      return result;
    });
  });

  const request = (path: string, identity: Identity | null = null, body?: unknown) => new Request(`${env.API_ORIGIN}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: env.FRONTEND_ORIGIN, ...(identity ? { Authorization: `Bearer ${tokens[identity]}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const materialRoute = (kind: "paper" | "repository") => `/v1/discoveries/${encodeURIComponent(document.discovery.id)}/materials/${kind}`;

  it("projects the actual headline and hides the protected package from anonymous readers", async () => {
    const response = await handleRequest(request("/v1/portal"), env, store);
    expect(response.status).toBe(200);
    const value = await response.json();
    expect(value.state.discoveries).toHaveLength(1);
    const brief = value.state.discoveries[0];
    expect(brief.id).toBe(document.discovery.id);
    expect(brief.headlineResult).toEqual(document.discovery.headlineResult);
    expect(brief.materials.paper).toBe(`${env.API_ORIGIN}${materialRoute("paper")}`);
    expect(brief.materials.repository).toBeNull();
    expect(brief.restrictedMaterials).toContain("repository");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("serves the complete configured paper bytes publicly", async () => {
    const response = await handleRequest(request(materialRoute("paper")), env, store);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(files.get(paperPath)!)).toBe(true);
    expect(response.headers.get("Content-Disposition")).toContain("attachment;");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("serves each declared public figure with its exact PNG bytes", async () => {
    for (const figure of document.discovery.figures ?? []) {
      const path = `/v1/discoveries/${encodeURIComponent(document.discovery.id)}/evidence/${encodeURIComponent(figure.id)}`;
      const response = await handleRequest(request(path), env, store);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/png");
      expect(Buffer.from(await response.arrayBuffer()).equals(files.get(figure.path)!)).toBe(true);
    }
  });

  it.each([null, "reader", "wrong"] as const)("denies the analysis/Lean ZIP to %s without fetching bytes", async (identity) => {
    const response = await handleRequest(request(materialRoute("repository"), identity), env, store);
    expect(response.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("records a signed-in request without granting package access", async () => {
    const response = await handleRequest(request("/v1/code-requests", "reader", {
      discoveryId: document.discovery.id, explanation: "Review the analysis and exact Lean theorem assumptions.",
    }), env, store);
    expect(response.status).toBe(200);
    expect(state.codeRequests).toHaveLength(1);
    expect(state.codeRequests[0]).toMatchObject({ discoveryId: document.discovery.id, userId: identities.reader });
    expect(state.access[identities.reader]).toMatchObject({ role: "Reader", approvedTopics: [] });
    const denied = await handleRequest(request(materialRoute("repository"), "reader"), env, store);
    expect(denied.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("serves exact ZIP bytes to a bandit reviewer and denies them immediately after revocation", async () => {
    const response = await handleRequest(request(materialRoute("repository"), "reviewer"), env, store);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(files.get(packagePath)!)).toBe(true);
    expect(response.headers.get("Content-Disposition")).toContain(".zip");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    state.access[identities.reviewer].approvedTopics = [];
    const previousCalls = fetcher.mock.calls.length;
    const revoked = await handleRequest(request(materialRoute("repository"), "reviewer"), env, store);
    expect(revoked.status).toBe(404);
    expect(fetcher).toHaveBeenCalledTimes(previousCalls);
  });
});
