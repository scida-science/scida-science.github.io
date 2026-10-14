import { beforeEach, expect, it } from "vitest";
import { createApiClient } from "../src/lib/api";
import { createPortalRepository } from "../src/services/repository";
import { discoveries } from "../src/data/discoveries";
import type { DiscussionComment, ProfileInput } from "../src/types";
import { handleRequest } from "./index";
import { digest } from "./crypto";
import {
  emptyAdminState,
  HttpError,
  type GitHubStore,
  type StoredDiscovery,
} from "./model";
import type { Env } from "./env";

// Actual frontend HTTP adapter + Worker routes + authorization + persistence
// contracts, with only GitHub's remote storage replaced by an isolated fixture.
const env: Env = {
  FRONTEND_ORIGIN: "https://scida-science.github.io",
  API_ORIGIN: "https://api.example.test",
  GITHUB_ORG: "scida-science",
  ADMIN_REPOSITORY: "scida-admin",
  ADMIN_GITHUB_ID: "89913681",
  GITHUB_APP_ID: "123",
  GITHUB_CLIENT_ID: "fixture",
  GITHUB_INSTALLATION_ID: "456",
  GITHUB_CLIENT_SECRET: "test-only-client-secret",
  GITHUB_PRIVATE_KEY: "test-only-key",
  SESSION_SECRET: "test-only-session-secret-32-characters",
  DISCUSSION_SECRET: "test-only-discussion-secret-32-characters",
};
let state = emptyAdminState(),
  store: GitHubStore,
  records: StoredDiscovery[],
  comments: DiscussionComment[];
const profile: ProfileInput = {
  fullName: "Researcher",
  affiliation: "",
  researchRole: "",
  scholarUrl: "",
  website: "",
  fields: [],
  expertiseTopics: [],
  expertiseStatement: "",
  evidence: "",
};
const ids = [env.ADMIN_GITHUB_ID, "200", "300", "400"];
async function repository(userId: string | null) {
  const storage: Storage = {
    length: 0,
    clear() {},
    getItem() {
      return null;
    },
    key() {
      return null;
    },
    removeItem() {},
    setItem() {},
  };
  const client = createApiClient(env.API_ORIGIN, {
    storage,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("Origin", env.FRONTEND_ORIGIN);
      return handleRequest(
        new Request(String(input), { ...init, headers }),
        env,
        store,
      );
    },
  });
  if (userId) {
    const token = String(ids.indexOf(userId) + 1).repeat(43);
    client.setSession({
      token,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
  }
  return createPortalRepository(client);
}
beforeEach(async () => {
  state = emptyAdminState();
  comments = [];
  for (const [index, userId] of ids.entries()) {
    state.profiles[userId] = {
      profile: structuredClone(profile),
      githubLogin: "fixture-" + userId,
      email: userId + "@example.test",
    };
    state.access[userId] = {
      role: "Reader",
      approvedTopics: [],
      assignedTopics: [],
    };
    state.sessions[await digest(String(index + 1).repeat(43))] = {
      userId,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
  }
  records = discoveries
    .slice(0, 2)
    .map((discovery) => ({
      repository: "discovery-" + discovery.id.toLowerCase(),
      sha: "1",
      document: {
        schemaVersion: 1,
        visibility: "public",
        discovery: structuredClone(discovery),
        materials: {
          paper: null,
          appendix: null,
          figures: null,
          data: null,
          repository: null,
        },
      },
    }));
  store = {
    readAdmin: async () => structuredClone(state),
    updateAdmin: async (fn) => {
      const next = structuredClone(state),
        result = fn(next);
      state = next;
      return result;
    },
    listDiscoveries: async () => structuredClone(records),
    readComments: async (record) =>
      structuredClone(
        comments.filter((c) => c.discoveryId === record.document.discovery.id),
      ),
    addComment: async (_record, comment) => {
      comments.push(structuredClone(comment));
    },
    saveDiscovery: async (record, document) => {
      const current = records.find((r) => r.repository === record.repository)!;
      if (current.sha !== record.sha) throw new HttpError(409, "Conflict");
      current.document = structuredClone(document);
      current.sha = String(Number(current.sha) + 1);
    },
  };
});
it("persists profile edits across independent clients and never exposes private profiles to visitors", async () => {
  const reader = await repository("200");
  await reader.saveProfile({
    ...profile,
    fullName: "Edited researcher",
    fields: ["Astronomy"],
    expertiseTopics: ["exoplanets"],
    scholarUrl: "https://scholar.google.com/citations?user=example",
  });
  expect((await (await repository("200")).read()).user).toMatchObject({
    fullName: "Edited researcher",
    role: "Reader",
    email: "200@example.test",
  });
  expect((await (await repository(null)).read()).state.profiles).toEqual([]);
});
it("applies, approves within scope, and persists versioned threads through the real HTTP contract", async () => {
  const owner = await repository(env.ADMIN_GITHUB_ID),
    reader = await repository("200"),
    approver = await repository("300");
  await owner.setAccess("300", "Approver", [], ["bandit-theory"]);
  await reader.applyForReview(["bandit-theory"], "Relevant research evidence");
  const application = (await approver.read()).state.applications[0];
  await approver.reviewApplication(
    application.id,
    "Approved",
    "Topic evidence checked",
  );
  const comment = {
    discoveryId: "AI-001",
    version: "v0.2",
    parentId: null,
    reference: "Assumption A1",
    body: "Please explain the dependence on this assumption.",
  };
  await reader.addComment(comment);
  const parent = (await reader.read()).state.comments[0];
  await reader.addComment({
    ...comment,
    parentId: parent.id,
    body: "A proposed follow-up check.",
  });
  expect((await (await repository("200")).read()).state.comments).toHaveLength(
    2,
  );
  await expect(
    reader.addComment({ ...comment, discoveryId: "AST-001" }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    approver.setAccess("200", "Approver", [], ["exoplanets"]),
  ).rejects.toMatchObject({ status: 403 });
});
it("round-trips invitation preview/acceptance and code requests without local fabricated success", async () => {
  const owner = await repository(env.ADMIN_GITHUB_ID),
    invitee = await repository("400");
  const invitation = await owner.createInvitation(
    ["exoplanets"],
    "400@example.test",
  );
  expect(invitation.code).toBeTruthy();
  expect((await invitee.previewInvitation(invitation.code!)).topics).toEqual([
    "exoplanets",
  ]);
  expect((await invitee.read()).user?.role).toBe("Reader");
  await invitee.confirmInvitation(invitation.code!, ["exoplanets"]);
  expect((await invitee.read()).user?.approvedTopics).toEqual(["exoplanets"]);
  await invitee.requestCode("AST-001", "Reproduce the timing analysis");
  expect((await owner.read()).state.codeRequests).toHaveLength(1);
  expect(
    (await (await repository("200")).read()).state.codeRequests,
  ).toHaveLength(0);
});
it("allows owner edits with the original revision and denies a Reader or stale form", async () => {
  const owner = await repository(env.ADMIN_GITHUB_ID),
    reader = await repository("200");
  const original = (await owner.read()).state.discoveries.find(
    (d) => d.id === "AI-001",
  )!;
  expect(original.revision).toBe("1");
  await expect(
    reader.updateDiscovery({ ...original, status: "Validated" }),
  ).rejects.toMatchObject({ status: 403 });
  await owner.updateDiscovery({
    ...original,
    title: "Updated illustrative title",
    status: "Validated",
  });
  const saved = (await owner.read()).state.discoveries.find(
    (d) => d.id === "AI-001",
  )!;
  expect(saved).toMatchObject({
    title: "Updated illustrative title",
    status: "Validated",
    revision: "2",
  });
  await expect(
    owner.updateDiscovery({ ...original, title: "Stale title" }),
  ).rejects.toMatchObject({ status: 409 });
  expect(records[0].document.discovery).not.toHaveProperty("revision");
});
