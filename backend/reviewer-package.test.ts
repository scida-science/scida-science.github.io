import { beforeEach, describe, expect, it, vi } from "vitest";
import { discoveries } from "../src/data/discoveries";
import { handleRequest } from "./index";
import { digest } from "./crypto";
import { GitHubApi, GitHubRepositoryStore } from "./github";
import { emptyAdminState, validMaterial, validReviewerPackage, type ReviewerPackage, type StoredDiscovery } from "./model";
import type { Env } from "./env";

const env: Env = {
  FRONTEND_ORIGIN: "https://site.example.test", API_ORIGIN: "https://api.example.test",
  GITHUB_ORG: "fixture", ADMIN_REPOSITORY: "admin", ADMIN_GITHUB_ID: "101",
  GITHUB_APP_ID: "123", GITHUB_CLIENT_ID: "fixture", GITHUB_INSTALLATION_ID: "456",
  GITHUB_CLIENT_SECRET: "test-only-client-secret", GITHUB_PRIVATE_KEY: "test-only-key",
  SESSION_SECRET: "test-only-session-secret-32-characters", DISCUSSION_SECRET: "test-only-discussion-secret-32-characters",
};
const manifest = (): ReviewerPackage => ({
  schemaVersion: 1, filename: "Analysis.zip", size: 3, sha256: "a".repeat(64),
  files: [
    { id: "readme", path: "reviewer/README.md", size: 5, sha256: "b".repeat(64) },
    { id: "part001", path: "reviewer/parts/Analysis.zip.001", size: 3, sha256: "a".repeat(64) },
  ],
});
describe("reviewer package metadata", () => {
  it("accepts only the declared path transport and safe bounded package metadata", () => {
    expect(validMaterial({ path: "reviewer/package.json", access: "reviewer", format: "multipart-zip" })).toBe(true);
    expect(validReviewerPackage(manifest(), "reviewer/package.json")).toBe(true);
    expect(validMaterial({ url: "https://example.test/package.json", access: "reviewer", format: "multipart-zip" })).toBe(false);
    expect(validMaterial({ path: "reviewer/package.json", access: "reviewer", format: "unknown" })).toBe(false);
  });
  it.each([
    ["parent traversal", (m: ReviewerPackage) => { m.files[0].path = "reviewer/../internal/private.json"; }],
    ["encoded traversal", (m: ReviewerPackage) => { m.files[0].path = "reviewer/%2e%2e/private.json"; }],
    ["different directory", (m: ReviewerPackage) => { m.files[0].path = "internal/private.json"; }],
    ["absolute path", (m: ReviewerPackage) => { m.files[0].path = "/reviewer/README.md"; }],
    ["duplicate ID", (m: ReviewerPackage) => { m.files[1].id = m.files[0].id; }],
    ["duplicate path", (m: ReviewerPackage) => { m.files[1].path = m.files[0].path; }],
    ["duplicate download name", (m: ReviewerPackage) => { m.files[1].path = "reviewer/parts/README.md"; }],
    ["oversized part", (m: ReviewerPackage) => { m.files[0].size = 100 * 1024 * 1024 + 1; }],
    ["invalid hash", (m: ReviewerPackage) => { m.files[0].sha256 = "invalid"; }],
    ["invalid ID", (m: ReviewerPackage) => { m.files[0].id = "../private"; }],
    ["unsafe archive name", (m: ReviewerPackage) => { m.filename = "../Analysis.zip"; }],
    ["extra URL", (m: ReviewerPackage) => { Object.assign(m.files[0], { url: "https://example.test/private" }); }],
  ])("rejects %s", (_label, mutate) => {
    const value = manifest(); mutate(value);
    expect(validReviewerPackage(value, "reviewer/package.json")).toBe(false);
  });
});

describe("authenticated reviewer package routes", () => {
  let state = emptyAdminState(), store: GitHubRepositoryStore, record: StoredDiscovery;
  let fetcher: ReturnType<typeof vi.fn>;
  const tokens: Record<string, string> = { reader: "r".repeat(43), reviewer: "v".repeat(43), wrong: "w".repeat(43) };
  const identities: Record<string, string> = { reader: "201", reviewer: "202", wrong: "203" };
  beforeEach(async () => {
    state = emptyAdminState();
    const discovery = structuredClone(discoveries.find((row) => row.id === "AST-001")!);
    record = { repository: "discovery-ast-001", sha: "fixture-sha", document: {
      schemaVersion: 1, visibility: "public", discovery,
      materials: { paper: null, appendix: null, figures: null, data: null,
        repository: { path: "reviewer/package.json", access: "reviewer", format: "multipart-zip" } },
    } };
    for (const [label, token] of Object.entries(tokens)) {
      const userId = identities[label];
      state.profiles[userId] = { githubLogin: label, email: `${label}@example.test`, profile: {
        fullName: label, affiliation: "", researchRole: "", scholarUrl: "", website: "", fields: [], expertiseTopics: [], expertiseStatement: "", evidence: "",
      } };
      state.access[userId] = { role: label === "reader" ? "Reader" : "Reviewer", approvedTopics: label === "reviewer" ? [discovery.topic] : label === "wrong" ? ["bandit-theory"] : [], assignedTopics: [] };
      state.sessions[await digest(token)] = { userId, expiresAt: new Date(Date.now() + 3600000).toISOString() };
    }
    fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/reviewer/package.json")) return Response.json(manifest());
      if (path.endsWith("/reviewer/parts/Analysis.zip.001")) return new Response("zip");
      if (path.endsWith("/reviewer/README.md")) return new Response("guide");
      throw new Error("Unexpected remote file request");
    });
    const api = new GitHubApi(env, fetcher);
    vi.spyOn(api, "token").mockResolvedValue("private-installation-token");
    store = new GitHubRepositoryStore(api);
    vi.spyOn(store, "readAdmin").mockImplementation(async () => structuredClone(state));
    vi.spyOn(store, "listDiscoveries").mockImplementation(async () => [structuredClone(record)]);
  });
  const request = (user: string | null, suffix = "") => new Request(`${env.API_ORIGIN}/v1/discoveries/AST-001/materials/repository${suffix}`, { headers: user ? { Authorization: `Bearer ${tokens[user]}`, Origin: env.FRONTEND_ORIGIN } : {} });
  it.each([null, "reader", "wrong"])("denies %s before reading the manifest or a part", async (user) => {
    for (const suffix of ["", "/files/part001"]) {
      const response = await handleRequest(request(user, suffix), env, store);
      expect(response.status, await response.clone().text()).toBe(404);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("returns only authenticated API download URLs and manifest identities", async () => {
    const response = await handleRequest(request("reviewer"), env, store);
    expect(response.status, await response.clone().text()).toBe(200);
    const value = await response.json();
    expect(value.package).toMatchObject({ filename: "Analysis.zip", size: 3, sha256: "a".repeat(64) });
    expect(value.package.files[1]).toEqual({ id: "part001", filename: "Analysis.zip.001", size: 3, sha256: "a".repeat(64), url: `${env.API_ORIGIN}/v1/discoveries/AST-001/materials/repository/files/part001` });
    expect(JSON.stringify(value)).not.toContain("github");
    expect(JSON.stringify(value)).not.toContain("private-installation-token");
    expect(JSON.stringify(value)).not.toContain("reviewer/parts");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("streams a declared attachment and repeats topic authorization for every file", async () => {
    let response = await handleRequest(request("reviewer", "/files/part001"), env, store);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="Analysis.zip.001"');
    expect(await response.text()).toBe("zip");
    state.access[identities.reviewer].approvedTopics = [];
    const previousCalls = fetcher.mock.calls.length;
    response = await handleRequest(request("reviewer", "/files/part001"), env, store);
    expect(response.status).toBe(404);
    expect(fetcher).toHaveBeenCalledTimes(previousCalls);
  });
  it.each(["missing", "%2e%2e%2finternal%2fprivate.json"])("rejects undeclared file ID %s", async (id) => {
    const response = await handleRequest(request("reviewer", `/files/${id}`), env, store);
    expect(response.status).toBe(404);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed manifest data before attempting a child download", async () => {
    fetcher.mockResolvedValue(Response.json({ ...manifest(), files: [{ ...manifest().files[0], path: "internal/private.json" }] }));
    const response = await handleRequest(request("reviewer", "/files/readme"), env, store);
    expect(response.status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounds manifest transport to 2 MiB", async () => {
    fetcher.mockResolvedValue(new Response(" ".repeat(2 * 1024 * 1024 + 1)));
    const response = await handleRequest(request("reviewer"), env, store);
    expect(response.status).toBe(503);
  });
  it("keeps single-file materials on their existing transport", async () => {
    record.document.materials.repository = { path: "reviewer/README.md", access: "reviewer" };
    const response = await handleRequest(request("reviewer"), env, store);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("guide");
    const nested = await handleRequest(request("reviewer", "/files/readme"), env, store);
    expect(nested.status).toBe(404);
  });
});
