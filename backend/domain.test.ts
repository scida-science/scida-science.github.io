import { beforeEach, describe, expect, it } from "vitest";
import { discoveries } from "../test/fixtures/discoveries";
import type { Discovery, DiscussionComment, ProfileInput, StatusDecision } from "../src/types";
import { MAX_STATUS_DECISIONS } from "../src/services/validation";
import { createDomain, validDiscoveryDocument } from "./domain";
import { migrateAccessRoles } from "./accessRoles";
import { emptyAdminState, HttpError, validMaterial } from "./model";
import type {
  AdminState,
  DiscoveryDocument,
  GitHubStore,
  StoredDiscovery,
} from "./model";

const OWNER = "89913681",
  READER = "1001",
  REVIEWER = "1002",
  APPROVER = "1003",
  OTHER = "1004",
  INVITEE = "1005";
const copy = <T>(value: T): T => structuredClone(value);
const profile = (name: string): ProfileInput => ({
  fullName: name,
  affiliation: "",
  researchRole: "",
  scholarUrl: "",
  website: "",
  fields: [],
  expertiseTopics: [],
  expertiseStatement: "",
  evidence: "",
});
const document = (discovery: Discovery): DiscoveryDocument => ({
  schemaVersion: 1,
  visibility: "public",
  discovery: copy(discovery),
  materials: {
    paper: null,
    appendix: null,
    figures: null,
    data: null,
    repository: null,
  },
});
class MemoryStore implements GitHubStore {
  state = emptyAdminState();
  records: StoredDiscovery[] = discoveries.map((discovery) => ({
    repository: `discovery-${discovery.id.toLowerCase()}`,
    sha: "1",
    document: document(discovery),
  }));
  discussions: Record<string, DiscussionComment[]> = {};
  conflict?: (state: AdminState) => void;
  saveConflict = false;
  mutations = 0;
  async readAdmin() {
    return copy(this.state);
  }
  async updateAdmin<T>(mutate: (state: AdminState) => T): Promise<T> {
    const candidate = copy(this.state);
    const result = mutate(candidate);
    if (this.conflict) {
      const conflict = this.conflict;
      this.conflict = undefined;
      conflict(this.state);
      return this.updateAdmin(mutate);
    }
    this.state = candidate;
    this.mutations++;
    return copy(result);
  }
  async listDiscoveries() {
    return copy(this.records);
  }
  async saveDiscovery(record: StoredDiscovery, next: DiscoveryDocument) {
    const current = this.records.find(
      (item) => item.repository === record.repository,
    )!;
    if (this.saveConflict) {
      current.sha = "concurrent";
      this.saveConflict = false;
    }
    if (current.sha !== record.sha)
      throw new HttpError(409, "Discovery changed. Refresh before editing.");
    current.document = copy(next);
    current.sha = String(Number(current.sha) + 1);
  }
  async readComments(record: StoredDiscovery) {
    return copy(this.discussions[record.document.discovery.id] ?? []);
  }
  async addComment(record: StoredDiscovery, comment: DiscussionComment) {
    (this.discussions[record.document.discovery.id] ??= []).push(copy(comment));
  }
}
let store: MemoryStore;
let domain: ReturnType<typeof createDomain>;
const denied = async (promise: Promise<unknown>, status = 403) =>
  expect(promise).rejects.toMatchObject({ name: "HttpError", status });
const comment = (changes: Record<string, unknown> = {}) => ({
  discoveryId: "AI-001",
  parentId: null,
  version: "v0.2",
  reference: "Assumption A1",
  body: "Could the confidence event hold under adaptive sampling?",
  ...changes,
});
const editable = (index = 0) => ({
  ...copy(store.records[index].document.discovery),
  revision: store.records[index].sha,
});
beforeEach(() => {
  store = new MemoryStore();
  for (const [userId, name] of [
    [OWNER, "owner"],
    [READER, "reader"],
    [REVIEWER, "reviewer"],
    [APPROVER, "approver"],
    [OTHER, "other"],
    [INVITEE, "invitee"],
  ]) {
    store.state.profiles[userId] = {
      profile: profile(name),
      githubLogin: name,
      email: `${name}@example.test`,
    };
    store.state.access[userId] = {
      role: "Reader",
      approvedTopics: [],
      assignedTopics: [],
    };
  }
  store.state.access[REVIEWER] = {
    role: "Reviewer",
    approvedTopics: ["bandit-theory"],
    assignedTopics: [],
  };
  store.state.access[APPROVER] = {
    role: "Senior Reviewer",
    approvedTopics: [],
    assignedTopics: ["bandit-theory"],
  };
  domain = createDomain(store, OWNER, "https://api.example.test");
});

describe("administrator status decisions and archive", () => {
  const reason = "Independent review does not support the proposed interpretation.";
  it.each(["Not supported", "Refuted", "Withdrawn"] as const)("records an owner-authored %s outcome without changing protected material access", async (status) => {
    store.records[0].document.materials.paper = { path: "papers/original.pdf", access: "reviewer" };
    const originalMaterials = copy(store.records[0].document.materials);
    const request = { ...editable(), status, statusChangeReason: `  ${reason}  `, statusHistory: [{ decidedBy: READER, decidedAt: "2000-01-01T00:00:00.000Z", reason: "forged" }] };
    for (const account of [READER, REVIEWER, APPROVER]) await denied(domain.updateDiscovery(account, request));
    const started = Date.now();
    await domain.updateDiscovery(OWNER, request);
    const saved = store.records[0].document.discovery;
    expect(saved.statusHistory).toHaveLength(1);
    expect(saved.statusHistory![0]).toMatchObject({ from: discoveries[0].status, to: status, reason, decidedBy: OWNER, decidedByName: "owner", version: saved.version });
    expect(Date.parse(saved.statusHistory![0].decidedAt)).toBeGreaterThanOrEqual(started);
    expect(saved.statusHistory![0].decidedAt).toBe(saved.updatedAt);
    expect(saved).not.toHaveProperty("statusChangeReason");
    expect(store.records[0].document.materials).toEqual(originalMaterials);
    await denied(domain.authorizeMaterial(READER, saved.id, "paper"), 404);
    const publicSaved = (await createDomain(store, OWNER, "https://api.example.test").portal(null)).state.discoveries.find((item) => item.id === saved.id)!;
    expect(publicSaved.statusHistory).toEqual(saved.statusHistory);
    expect(publicSaved.materials.paper).toBeNull();
    expect(publicSaved).not.toHaveProperty("statusChangeReason");
    publicSaved.statusHistory![0].reason = "Local mutation cannot change the audit record.";
    expect(saved.statusHistory![0].reason).toBe(reason);
  });

  it("preserves all original decisions through content edits, caller tampering, and restoration", async () => {
    await domain.addComment(REVIEWER, comment());
    await domain.updateDiscovery(OWNER, { ...editable(), status: "Withdrawn", statusChangeReason: reason });
    const originalHistory = copy(store.records[0].document.discovery.statusHistory);
    for (const forged of [undefined, [], [{ from: "Withdrawn", to: "Published", decidedBy: READER }]]) {
      await domain.updateDiscovery(OWNER, { ...editable(), title: "A clarified title", statusHistory: forged, statusChangeReason: "Ignored because the status has not changed." });
      expect(store.records[0].document.discovery.statusHistory).toEqual(originalHistory);
    }
    store.state.profiles[OWNER].profile.fullName = "Updated owner name";
    await domain.updateDiscovery(OWNER, { ...editable(), version: "v0.3", status: "Awaiting Validation", statusChangeReason: "New evidence warrants reopening the investigation.", statusHistory: [] });
    const saved = store.records[0].document.discovery;
    expect(saved.status).toBe("Awaiting Validation");
    expect(saved.statusHistory).toHaveLength(2);
    expect(saved.statusHistory![0]).toEqual(originalHistory![0]);
    expect(saved.statusHistory![1]).toMatchObject({ from: "Withdrawn", to: "Awaiting Validation", decidedBy: OWNER, decidedByName: "Updated owner name", version: "v0.3" });
    expect(store.discussions["AI-001"]).toHaveLength(1);
    expect(validDiscoveryDocument(store.records[0].document)).toBe(true);
  });

  it.each([undefined, null, "short", "          ", "x".repeat(2001)])("requires a bounded substantive reason for every status transition (%s)", async (statusChangeReason) => {
    await denied(domain.updateDiscovery(OWNER, { ...editable(), status: "Validated", statusChangeReason }), 400);
    expect(store.records[0].document.discovery.statusHistory).toBeUndefined();
    expect(store.records[0].sha).toBe("1");
  });

  it("cannot append an archive or restore decision from stale revisions or a conflicting GitHub write", async () => {
    const old = editable();
    store.saveConflict = true;
    await denied(domain.updateDiscovery(OWNER, { ...old, status: "Refuted", statusChangeReason: reason }), 409);
    expect(store.records[0].document.discovery.statusHistory).toBeUndefined();
    // Reset only the isolated fixture's conflict SHA to continue this test.
    store.records[0].sha = "2";
    await domain.updateDiscovery(OWNER, { ...editable(), status: "Refuted", statusChangeReason: reason });
    await denied(domain.updateDiscovery(OWNER, { ...old, status: "Awaiting Validation", statusChangeReason: "New observations would justify a fresh review." }), 409);
    expect(store.records[0].document.discovery.statusHistory).toHaveLength(1);
    expect(store.records[0].document.discovery.status).toBe("Refuted");
  });

  it("rejects new transitions at the history bound without truncating past decisions", async () => {
    const history: StatusDecision[] = Array.from({ length: MAX_STATUS_DECISIONS }, (_, index) => ({
      from: index % 2 ? "Withdrawn" : "Awaiting Validation",
      to: index % 2 ? "Awaiting Validation" : "Withdrawn",
      reason, decidedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      decidedBy: OWNER, decidedByName: "owner", version: "v0.2",
    }));
    store.records[0].document.discovery.statusHistory = history;
    await denied(domain.updateDiscovery(OWNER, { ...editable(), status: "Withdrawn", statusChangeReason: reason }), 400);
    await domain.updateDiscovery(OWNER, { ...editable(), title: "A permitted content correction" });
    expect(store.records[0].document.discovery.statusHistory).toEqual(history);
  });
});

describe("private discovery following", () => {
  it("persists idempotent follow and unfollow preferences across a fresh domain instance", async () => {
    await domain.setFollowing(READER, "AI-001", true);
    await domain.setFollowing(READER, "AI-001", true);
    expect(store.state.profiles[READER].followedDiscoveryIds).toEqual(["AI-001"]);
    const reloaded = createDomain(store, OWNER, "https://api.example.test");
    const result = await reloaded.portal(READER);
    expect(result.user?.followedDiscoveryIds).toEqual(["AI-001"]);
    expect(result.state.profiles.find((item) => item.id === READER)?.followedDiscoveryIds).toEqual(["AI-001"]);
    await reloaded.setFollowing(READER, "AI-001", false);
    await reloaded.setFollowing(READER, "AI-001", false);
    expect((await domain.portal(READER)).user?.followedDiscoveryIds).toEqual([]);
  });
  it("keeps follows private to each account, including when an administrator lists profiles", async () => {
    await domain.setFollowing(READER, "AI-001", true);
    await domain.setFollowing(OTHER, "AST-001", true);
    expect((await domain.portal(OTHER)).user?.followedDiscoveryIds).toEqual(["AST-001"]);
    const ownerPortal = await domain.portal(OWNER);
    expect(ownerPortal.user?.followedDiscoveryIds).toEqual([]);
    expect(ownerPortal.state.profiles.find((item) => item.id === READER)).not.toHaveProperty("followedDiscoveryIds");
    expect(ownerPortal.state.profiles.find((item) => item.id === OTHER)).not.toHaveProperty("followedDiscoveryIds");
    expect((await domain.portal(null)).state.profiles).toEqual([]);
  });
  it("handles legacy accounts and hides stale, malformed, or duplicate stored follows", async () => {
    expect((await domain.portal(READER)).user?.followedDiscoveryIds).toEqual([]);
    store.state.profiles[READER].followedDiscoveryIds = ["AI-001", "AI-001", "REMOVED-001", "../private"];
    expect((await domain.portal(READER)).user?.followedDiscoveryIds).toEqual(["AI-001"]);
    store.records = store.records.filter((record) => record.document.discovery.id !== "AI-001");
    expect((await domain.portal(READER)).user?.followedDiscoveryIds).toEqual([]);
    await domain.setFollowing(READER, "REMOVED-001", false);
    await domain.setFollowing(READER, "AI-001", false);
    expect(store.state.profiles[READER].followedDiscoveryIds).toEqual([]);
  });
  it("requires an existing discovery to follow and validates the boolean and discovery ID", async () => {
    await denied(domain.setFollowing(READER, "MISSING-001", true), 404);
    await denied(domain.setFollowing(READER, "AI-001", "true"), 400);
    await denied(domain.setFollowing(READER, "../private", false), 400);
    await denied(domain.setFollowing("99999", "AI-001", true), 401);
    expect(store.mutations).toBe(0);
  });
  it("preserves saved follows when editing a profile and ignores injected profile preferences", async () => {
    await domain.setFollowing(READER, "AI-001", true);
    await domain.saveProfile(READER, { ...profile("Edited"), followedDiscoveryIds: ["AST-001"] });
    expect(store.state.profiles[READER].profile).not.toHaveProperty("followedDiscoveryIds");
    expect((await domain.portal(READER)).user?.followedDiscoveryIds).toEqual(["AI-001"]);
    Object.assign(store.state.profiles[READER].profile, { followedDiscoveryIds: ["AST-001"] });
    expect((await domain.portal(READER)).user?.followedDiscoveryIds).toEqual(["AI-001"]);
    expect((await domain.portal(OWNER)).state.profiles.find((item) => item.id === READER)).not.toHaveProperty("followedDiscoveryIds");
  });
  it("merges simultaneous preference updates using the latest persisted state", async () => {
    store.conflict = (state) => {
      state.profiles[READER].followedDiscoveryIds = ["AST-001"];
    };
    await domain.setFollowing(READER, "AI-001", true);
    expect(store.state.profiles[READER].followedDiscoveryIds).toEqual(["AST-001", "AI-001"]);
  });
  it("does not grant discussion or analysis-package access to a Reader", async () => {
    const access = copy(store.state.access);
    store.records[0].document.materials.repository = { path: "reviewer/package.json", access: "reviewer", format: "multipart-zip" };
    await domain.setFollowing(READER, "AI-001", true);
    expect(store.state.access).toEqual(access);
    expect((await domain.portal(READER)).user?.role).toBe("Reader");
    await denied(domain.addComment(READER, comment()));
    await denied(domain.authorizeMaterial(READER, "AI-001", "repository"), 404);
  });
});

describe("private notification receipts and follow start times", () => {
  it("persists the follow start, keeps repeat follows stable, and resets after unfollowing", async () => {
    await domain.setFollowing(READER, "AI-001", true);
    const started = store.state.profiles[READER].followedSince?.["AI-001"];
    expect(Number.isFinite(Date.parse(started!))).toBe(true);
    store.state.profiles[READER].followedSince!["AI-001"] = "2026-01-01T00:00:00.000Z";
    await domain.setFollowing(READER, "AI-001", true);
    expect(store.state.profiles[READER].followedSince?.["AI-001"]).toBe("2026-01-01T00:00:00.000Z");
    await domain.setFollowing(READER, "AI-001", false);
    expect(store.state.profiles[READER].followedSince).not.toHaveProperty("AI-001");
    await domain.setFollowing(READER, "AI-001", true);
    expect(store.state.profiles[READER].followedSince?.["AI-001"]).not.toBe("2026-01-01T00:00:00.000Z");
    store.state.profiles[OTHER].followedDiscoveryIds = ["AI-001"];
    await domain.setFollowing(OTHER, "AI-001", true);
    expect(store.state.profiles[OTHER].followedSince).toEqual({});
  });
  it("projects only the viewer's notifications without additional reads or mutations", async () => {
    store.state.profiles[READER].followedDiscoveryIds = ["AI-001"];
    store.discussions["AI-001"] = [{ ...comment(), id: "notice", authorId: REVIEWER, createdAt: "2026-10-10T00:00:00.000Z" }];
    const before = copy(store.state);
    let commentReads = 0;
    const original = store.readComments.bind(store);
    store.readComments = async (record) => { commentReads++; return original(record); };
    const result = await domain.portal(READER);
    expect(result.state.notifications).toEqual(expect.arrayContaining([expect.objectContaining({ id: "comment:AI-001:notice", kind: "discussion", read: false })]));
    expect(commentReads).toBe(store.records.length);
    expect(store.state).toEqual(before);
    expect(store.mutations).toBe(0);
    expect((await domain.portal(null)).state.notifications).toEqual([]);
    expect((await domain.portal(OTHER)).state.notifications).toEqual([]);
    expect((await domain.portal(OWNER)).state.notifications).toEqual([]);
  });
  it("saves read receipts across fresh portal instances and merges concurrent receipts on retry", async () => {
    store.state.profiles[READER].followedDiscoveryIds = ["AI-001"];
    store.discussions["AI-001"] = [{ ...comment(), id: "notice", authorId: REVIEWER, createdAt: "2026-10-10T00:00:00.000Z" }];
    store.conflict = (state) => { state.profiles[READER].readNotificationIds = ["comment:AI-001:concurrent"]; };
    await domain.markNotificationsRead(READER, ["comment:AI-001:notice"]);
    expect(store.state.profiles[READER].readNotificationIds).toEqual(["comment:AI-001:concurrent", "comment:AI-001:notice"]);
    expect((await createDomain(store, OWNER, "https://api.example.test").portal(READER)).state.notifications)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: "comment:AI-001:notice", read: true })]));
    expect(store.state.profiles[OTHER].readNotificationIds).toBeUndefined();
  });
  it("validates receipts, caps storage, and never mutates access", async () => {
    const access = copy(store.state.access);
    for (const invalid of [undefined, [], ["bad"], ["comment:AI-001:same", "comment:AI-001:same"], Array.from({ length: 101 }, (_, n) => `comment:AI-001:c${n}`)])
      await denied(domain.markNotificationsRead(READER, invalid), 400);
    await denied(domain.markNotificationsRead("99999", ["comment:AI-001:notice"]), 401);
    expect(store.mutations).toBe(0);
    store.state.profiles[READER].readNotificationIds = Array.from({ length: 1000 }, (_, n) => `comment:AI-001:c${n}`);
    await domain.markNotificationsRead(READER, ["comment:AI-001:new"]);
    expect(store.state.profiles[READER].readNotificationIds).toHaveLength(1000);
    expect(store.state.profiles[READER].readNotificationIds?.at(-1)).toBe("comment:AI-001:new");
    expect(store.state.access).toEqual(access);
  });
  it("keeps receipt metadata out of editable profiles and administrator profile projections", async () => {
    const hidden = { followedSince: { "AI-001": "2026-01-01T00:00:00Z" }, readNotificationIds: ["comment:AI-001:notice"], notifications: [{ private: true }] };
    Object.assign(store.state.profiles[READER], hidden);
    await domain.saveProfile(READER, { ...profile("Edited"), ...hidden });
    expect(store.state.profiles[READER].profile).toEqual(profile("Edited"));
    Object.assign(store.state.profiles[READER].profile, hidden);
    const owner = await domain.portal(OWNER);
    const own = await domain.portal(READER);
    for (const projected of [owner.state.profiles.find((item) => item.id === READER), own.user]) {
      expect(projected).not.toHaveProperty("followedSince");
      expect(projected).not.toHaveProperty("readNotificationIds");
      expect(projected).not.toHaveProperty("notifications");
    }
    expect(store.state.profiles[READER].readNotificationIds).toEqual(hidden.readNotificationIds);
  });
});

describe("server identity, profiles, and privacy", () => {
  it("starts with no seeded identities, sessions, comments, or approval decisions", () => {
    expect(emptyAdminState()).toEqual({
      schemaVersion: 1,
      profiles: {},
      access: {},
      applications: [],
      invitations: [],
      codeRequests: [],
      sessions: {},
      exchanges: {},
      audit: [],
    });
  });
  it("derives owner privileges only from fixed verified GitHub ID", async () => {
    (store.state.access[READER] as { role: string }).role = "Admin";
    Object.assign(store.state.profiles[READER].profile, {
      role: "Admin",
      id: OWNER,
      email: "owner@example.test",
    });
    expect((await domain.portal(READER)).user).toMatchObject({
      id: READER,
      role: "Reader",
      email: "reader@example.test",
    });
    expect((await domain.portal(OWNER)).user?.role).toBe("Admin");
    await denied(domain.updateDiscovery(READER, discoveries[0]));
  });
  it("requires a real stored identity and rejects prototype keys", async () => {
    await denied(domain.portal("99999"), 401);
    await denied(domain.portal("__proto__"), 401);
    await denied(domain.saveProfile("99999", profile("Unknown")), 401);
  });
  it("returns public briefs with no private profiles or operational state", async () => {
    store.state.sessions.secret = {
      userId: OWNER,
      expiresAt: "2099-01-01T00:00:00Z",
    };
    const result = await domain.portal(null);
    expect(result.state.discoveries).toHaveLength(6);
    expect(result.user).toBeNull();
    expect(result.state.profiles).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("@example.test");
  });
  it("edits only own scientific profile, dropping client privilege fields", async () => {
    await domain.saveProfile(READER, {
      ...profile("Updated Researcher"),
      fields: ["Artificial Intelligence"],
      expertiseTopics: ["bandit-theory"],
      role: "Admin",
      id: OWNER,
      email: "changed@example.test",
      approvedTopics: ["exoplanets"],
    });
    const result = await domain.portal(READER);
    expect(result.user).toMatchObject({
      fullName: "Updated Researcher",
      role: "Reader",
      email: "reader@example.test",
      approvedTopics: [],
    });
    expect(store.state.profiles[OWNER].profile.fullName).toBe("owner");
    expect(store.state.profiles[READER].profile).not.toHaveProperty("role");
  });
  it.each([
    null,
    [],
    {},
    { fullName: "Valid but incomplete" },
    {
      ...profile("Wrong topics"),
      fields: ["Artificial Intelligence"],
      expertiseTopics: ["exoplanets"],
    },
  ])("rejects malformed profile without a TypeError: %j", async (value) => {
    await denied(domain.saveProfile(READER, value), 400);
  });
  it("keeps email private even when owner can inspect profiles", async () => {
    const result = await domain.portal(OWNER);
    expect(result.state.profiles).toHaveLength(6);
    expect(
      result.state.profiles.find((item) => item.id === READER)?.email,
    ).toBe("");
    expect(result.state.profiles.find((item) => item.id === OWNER)?.email).toBe(
      "owner@example.test",
    );
    expect(result.state.profiles.find((item) => item.id === READER)?.githubLogin)
      .toBe(store.state.profiles[READER].githubLogin);
  });
});

describe("scope-specific applications and account permissions", () => {
  it("retains legacy senior authority within assigned topics and projects only the new role", async () => {
    store.state.access[APPROVER] = { role: "Senior Approver", approvedTopics: ["exoplanets"], assignedTopics: ["bandit-theory"] };
    const portal = await domain.portal(APPROVER);
    expect(portal.user).toMatchObject({ role: "Senior Reviewer", approvedTopics: ["exoplanets"], assignedTopics: ["bandit-theory"] });
    expect(store.state.access[APPROVER].role).toBe("Senior Approver");
    await domain.applyForReview(READER, ["bandit-theory"], "Relevant research evidence.");
    await domain.reviewApplication(APPROVER, store.state.applications[0].id, true, "");
    expect(store.state.access[READER].approvedTopics).toEqual(["bandit-theory"]);
    await denied(domain.createInvitation(APPROVER, ["exoplanets"], "invitee@example.test"));
  });

  it("canonicalizes legacy ordinary access when approving an application", async () => {
    store.state.access[OTHER] = { role: "Approver", approvedTopics: ["exoplanets"], assignedTopics: ["scientific-ai"] };
    await domain.applyForReview(OTHER, ["bandit-theory"], "Relevant research evidence.");
    await domain.reviewApplication(APPROVER, store.state.applications[0].id, true, "");
    expect(store.state.access[OTHER]).toEqual({ role: "Reviewer", approvedTopics: ["exoplanets", "bandit-theory"], assignedTopics: [] });
  });

  it("reads legacy ordinary Approvers as Reviewers without inherited approval topics", async () => {
    store.state.access[OTHER] = {
      role: "Approver",
      approvedTopics: ["bandit-theory"],
      assignedTopics: ["bandit-theory"],
    };
    await domain.applyForReview(READER, ["bandit-theory"], "Relevant research evidence.");
    const application = store.state.applications[0];
    const before = copy(store.state);
    await denied(domain.reviewApplication(OTHER, application.id, true, ""));
    await denied(domain.createInvitation(OTHER, ["bandit-theory"], "invitee@example.test"));
    await denied(domain.setAccess(OTHER, READER, "Senior Reviewer", [], ["bandit-theory"]));
    expect(store.state).toEqual(before);
    const portal = await domain.portal(OTHER);
    expect(portal.user?.role).toBe("Reviewer");
    expect(portal.user?.assignedTopics).toEqual([]);
    expect(store.state.access[OTHER].role).toBe("Approver");
    expect(portal.state.applications).toEqual([]);
    expect(portal.state.profiles.map((item) => item.id)).toEqual([OTHER]);
    expect((await domain.addComment(OTHER, comment())).authorId).toBe(OTHER);
    await denied(domain.addComment(OTHER, comment({ discoveryId: "AST-001", version: "v0.1" })));
  });

  it("allows only the owner to appoint a Reviewer with discussion topics", async () => {
    await denied(domain.setAccess(APPROVER, OTHER, "Reviewer", ["bandit-theory"], []));
    await domain.setAccess(OWNER, OTHER, "Reviewer", ["bandit-theory"], []);
    expect(store.state.access[OTHER]).toEqual({
      role: "Reviewer",
      approvedTopics: ["bandit-theory"],
      assignedTopics: [],
    });
  });
  it.each(["Approver", "Senior Approver"])("rejects the retired %s role even when the owner submits it", async (role) => {
    await denied(domain.setAccess(OWNER, OTHER, role, ["bandit-theory"], ["exoplanets"]), 400);
    expect(store.state.access[OTHER].role).toBe("Reader");
  });

  it("does not allow the owner to decide their own review application", async () => {
    await domain.applyForReview(OWNER, ["bandit-theory"], "Owner review evidence.");
    await denied(domain.reviewApplication(OWNER, store.state.applications[0].id, true, ""));
    expect(store.state.access[OWNER].approvedTopics).toEqual([]);
  });

  it("allows a Reader application and a scoped approver decision", async () => {
    await domain.applyForReview(
      READER,
      ["bandit-theory"],
      "A relevant thesis and reproducible code.",
    );
    const application = store.state.applications[0];
    expect(
      (await domain.portal(APPROVER)).state.profiles
        .map((item) => item.id)
        .sort(),
    ).toEqual([READER, APPROVER].sort());
    expect((await domain.portal(OTHER)).state.applications).toEqual([]);
    await domain.reviewApplication(
      APPROVER,
      application.id,
      true,
      "Reviewed the supplied work.",
    );
    expect(store.state.access[READER]).toEqual({
      role: "Reviewer",
      approvedTopics: ["bandit-theory"],
      assignedTopics: [],
    });
    expect(store.state.applications[0]).toMatchObject({
      status: "Approved",
      decidedBy: APPROVER,
    });
    expect(store.state.audit.at(-1)?.action).toBe("review_application");
  });
  it("requires the full requested topic scope, including across fields", async () => {
    await domain.applyForReview(
      READER,
      ["bandit-theory", "exoplanets"],
      "Evidence in two research fields.",
    );
    const application = store.state.applications[0];
    expect((await domain.portal(APPROVER)).state.applications).toEqual([]);
    expect(
      (await domain.portal(APPROVER)).state.profiles.map((item) => item.id),
    ).toEqual([APPROVER]);
    await denied(domain.reviewApplication(APPROVER, application.id, true, ""));
    await domain.reviewApplication(
      OWNER,
      application.id,
      false,
      "Please supply more evidence.",
    );
    expect(store.state.access[READER].role).toBe("Reader");
  });
  it("forbids self-approval, duplicate pending applications, and repeated decisions", async () => {
    await domain.applyForReview(
      APPROVER,
      ["bandit-theory"],
      "Approver evidence for peer review.",
    );
    const application = store.state.applications[0];
    await denied(domain.reviewApplication(APPROVER, application.id, true, ""));
    await denied(
      domain.applyForReview(
        APPROVER,
        ["exoplanets"],
        "A second pending application.",
      ),
      409,
    );
    await domain.reviewApplication(
      OWNER,
      application.id,
      false,
      "More evidence needed.",
    );
    await denied(
      domain.reviewApplication(OWNER, application.id, true, ""),
      409,
    );
  });
  it("only owner appoints approvers; API never appoints or changes owner", async () => {
    await denied(
      domain.setAccess(READER, OTHER, "Senior Reviewer", [], ["bandit-theory"]),
    );
    await denied(
      domain.setAccess(APPROVER, OTHER, "Senior Reviewer", [], ["bandit-theory"]),
    );
    await denied(domain.setAccess(OWNER, OTHER, "Admin", [], []), 400);
    await denied(
      domain.setAccess(OWNER, OWNER, "Reviewer", ["bandit-theory"], []),
    );
    await domain.setAccess(
      OWNER,
      OTHER,
      "Senior Reviewer",
      ["exoplanets"],
      ["exoplanets"],
    );
    expect(store.state.access[OTHER]).toMatchObject({
      role: "Senior Reviewer",
      assignedTopics: ["exoplanets"],
    });
  });
  it.each([
    ["Reader", ["bandit-theory"], []],
    ["Reviewer", [], []],
    ["Reviewer", ["bandit-theory"], ["exoplanets"]],
    ["Approver", [], []],
    ["Approver", ["bandit-theory"], ["exoplanets"]],
    ["Senior Reviewer", [], []],
  ])(
    "rejects inconsistent role/topic assignments %s",
    async (role, approved, assigned) => {
      await denied(
        domain.setAccess(OWNER, OTHER, role, approved, assigned),
        400,
      );
    },
  );
  it("rechecks scope after a GitHub state SHA conflict instead of committing stale approval", async () => {
    await domain.applyForReview(
      READER,
      ["bandit-theory"],
      "A thesis to be reviewed by experts.",
    );
    store.conflict = (state) => {
      state.access[APPROVER] = {
        role: "Reader",
        approvedTopics: [],
        assignedTopics: [],
      };
    };
    await denied(
      domain.reviewApplication(
        APPROVER,
        store.state.applications[0].id,
        true,
        "Approved before conflict",
      ),
    );
    expect(store.state.applications[0].status).toBe("Pending");
    expect(store.state.access[READER].approvedTopics).toEqual([]);
  });
  it("retains unrelated concurrent state changes when retrying profile writes", async () => {
    store.conflict = (state) => {
      state.profiles[OTHER].profile.fullName = "Concurrent update";
    };
    await domain.saveProfile(READER, profile("My saved change"));
    expect(store.state.profiles[READER].profile.fullName).toBe(
      "My saved change",
    );
    expect(store.state.profiles[OTHER].profile.fullName).toBe(
      "Concurrent update",
    );
  });
});

describe("email-bound invitations", () => {
  it("preserves invitations from renamed seniors and canonicalizes legacy recipients", async () => {
    store.state.access[APPROVER].role = "Senior Approver";
    const invitation = await domain.createInvitation(APPROVER, ["bandit-theory"], "invitee@example.test");
    migrateAccessRoles(store.state);
    store.state.access[INVITEE] = { role: "Approver", approvedTopics: ["exoplanets"], assignedTopics: ["scientific-ai"] };
    expect((await domain.previewInvitation(INVITEE, invitation.code)).topics).toEqual(["bandit-theory"]);
    await domain.acceptInvitation(INVITEE, invitation.code, ["bandit-theory"]);
    expect(store.state.access[APPROVER].role).toBe("Senior Reviewer");
    expect(store.state.access[INVITEE]).toEqual({ role: "Reviewer", approvedTopics: ["exoplanets", "bandit-theory"], assignedTopics: [] });
  });

  it("rejects a prior invitation after its issuer becomes an ordinary Approver", async () => {
    const invitation = await domain.createInvitation(
      APPROVER,
      ["bandit-theory"],
      "invitee@example.test",
    );
    // Old installations may retain assignedTopics in an ordinary Approver record.
    store.state.access[APPROVER].role = "Approver";
    const before = copy(store.state);
    await denied(domain.previewInvitation(INVITEE, invitation.code));
    await denied(domain.acceptInvitation(INVITEE, invitation.code, ["bandit-theory"]));
    expect(store.state).toEqual(before);
    expect(store.state.access[INVITEE].role).toBe("Reader");
  });

  it("requires preview then exact scope and stores only a token hash", async () => {
    const invitation = await domain.createInvitation(
      APPROVER,
      ["bandit-theory"],
      "invitee@example.test",
    );
    expect(invitation.code).toHaveLength(64);
    expect(store.state.invitations[0].codeHash).toHaveLength(64);
    expect(store.state.invitations[0]).not.toHaveProperty("code");
    expect(store.state.invitations[0].codeHash).not.toBe(invitation.code);
    const preview = await domain.previewInvitation(INVITEE, invitation.code);
    expect(preview).not.toHaveProperty("code");
    expect(preview.topics).toEqual(["bandit-theory"]);
    expect(store.state.access[INVITEE].role).toBe("Reader");
    await denied(
      domain.acceptInvitation(INVITEE, invitation.code, ["exoplanets"]),
      400,
    );
    await domain.acceptInvitation(INVITEE, invitation.code, ["bandit-theory"]);
    expect(store.state.access[INVITEE]).toEqual({
      role: "Reviewer",
      approvedTopics: ["bandit-theory"],
      assignedTopics: [],
    });
    await denied(
      domain.acceptInvitation(INVITEE, invitation.code, ["bandit-theory"]),
    );
  });
  it("blocks wrong recipient, self-invitation, unauthorized topics, and Reader invitations", async () => {
    const invitation = await domain.createInvitation(
      APPROVER,
      ["bandit-theory"],
      "invitee@example.test",
    );
    await denied(domain.previewInvitation(OTHER, invitation.code));
    await denied(
      domain.createInvitation(
        APPROVER,
        ["bandit-theory"],
        "approver@example.test",
      ),
    );
    await denied(
      domain.createInvitation(APPROVER, ["exoplanets"], "invitee@example.test"),
    );
    await denied(
      domain.createInvitation(
        READER,
        ["bandit-theory"],
        "invitee@example.test",
      ),
    );
    expect((await domain.portal(OTHER)).state.invitations).toEqual([]);
    expect(
      (await domain.portal(APPROVER)).state.invitations[0],
    ).not.toHaveProperty("codeHash");
  });
  it("rejects expired invitations and tokens issued by a revoked approver", async () => {
    const invitation = await domain.createInvitation(
      APPROVER,
      ["bandit-theory"],
      "invitee@example.test",
    );
    store.state.invitations[0].expiresAt = "2000-01-01T00:00:00Z";
    await denied(domain.previewInvitation(INVITEE, invitation.code));
    store.state.invitations[0].expiresAt = "2099-01-01T00:00:00Z";
    await domain.setAccess(OWNER, APPROVER, "Reader", [], []);
    await denied(
      domain.acceptInvitation(INVITEE, invitation.code, ["bandit-theory"]),
    );
  });
  it("rechecks single-use invitation status on a SHA conflict", async () => {
    const invitation = await domain.createInvitation(
      APPROVER,
      ["bandit-theory"],
      "invitee@example.test",
    );
    store.conflict = (state) => {
      state.invitations[0].usedBy = INVITEE;
    };
    await denied(
      domain.acceptInvitation(INVITEE, invitation.code, ["bandit-theory"]),
    );
    expect(store.state.access[INVITEE].role).toBe("Reader");
  });
});

describe("discussions and code requests", () => {
  it("restricts Readers and Reviewers to their effective review authority", async () => {
    await denied(domain.addComment(READER, comment()));
    const saved = await domain.addComment(
      REVIEWER,
      comment({ authorId: OWNER, createdAt: "2000-01-01" }),
    );
    expect(saved.authorId).toBe(REVIEWER);
    expect(saved.createdAt).not.toBe("2000-01-01");
    await denied(
      domain.addComment(
        REVIEWER,
        comment({ discoveryId: "AST-001", version: "v0.1" }),
      ),
    );
    await domain.setAccess(OWNER, REVIEWER, "Reader", [], []);
    await denied(domain.addComment(REVIEWER, comment()));
  });
  it("inherits Senior Reviewer discussion and reply access only within assigned topics", async () => {
    store.state.access[APPROVER].approvedTopics = ["exoplanets"];
    const accessBefore = copy(store.state.access[APPROVER]);
    const parent = await domain.addComment(APPROVER, comment());
    expect(parent.authorId).toBe(APPROVER);
    const reply = await domain.addComment(
      APPROVER,
      comment({ parentId: parent.id, reference: "" }),
    );
    expect(reply.parentId).toBe(parent.id);
    await domain.addComment(
      APPROVER,
      comment({ discoveryId: "AST-002", version: "v1.1" }),
    );
    await denied(
      domain.addComment(APPROVER, comment({ discoveryId: "AST-001", version: "v0.1" })),
    );
    expect(store.state.access[APPROVER]).toEqual(accessBefore);
  });
  it("allows the configured owner to review every topic without stored topic grants", async () => {
    for (const discovery of discoveries) {
      const saved = await domain.addComment(
        OWNER,
        comment({ discoveryId: discovery.id, version: discovery.version }),
      );
      expect(saved.authorId).toBe(OWNER);
    }
    expect(store.state.access[OWNER].approvedTopics).toEqual([]);
    expect(store.state.access[OWNER].assignedTopics).toEqual([]);
  });
  it("removes inherited review access when an approval scope is removed or the role is demoted", async () => {
    await domain.setAccess(OWNER, APPROVER, "Senior Reviewer", ["exoplanets"], ["bandit-theory"]);
    const parent = await domain.addComment(APPROVER, comment());
    await domain.setAccess(OWNER, APPROVER, "Senior Reviewer", ["exoplanets"], ["scientific-ai"]);
    await denied(domain.addComment(APPROVER, comment({ parentId: parent.id })));
    await domain.addComment(APPROVER, comment({ discoveryId: "AI-003", version: "v1.0" }));
    await domain.setAccess(OWNER, APPROVER, "Reviewer", ["exoplanets"], []);
    await denied(domain.addComment(APPROVER, comment({ discoveryId: "AI-003", version: "v1.0" })));
    await domain.addComment(APPROVER, comment({ discoveryId: "AST-002", version: "v1.1" }));
    expect(store.state.access[APPROVER].approvedTopics).toEqual(["exoplanets"]);
  });
  it.each(["Reader", "Reviewer", "Approver"] as const)(
    "does not inherit review access from stale assigned topics for %s",
    async (role) => {
      store.state.access[OTHER] = {
        role,
        approvedTopics: role === "Reader" ? ["bandit-theory"] : ["exoplanets"],
        assignedTopics: ["bandit-theory"],
      };
      await denied(domain.addComment(OTHER, comment()));
    },
  );
  it("rechecks inherited review scope immediately before writing a reply", async () => {
    const parent = await domain.addComment(REVIEWER, comment());
    const readComments = store.readComments.bind(store);
    store.readComments = async (record) => {
      store.state.access[APPROVER].assignedTopics = ["exoplanets"];
      return readComments(record);
    };
    await denied(domain.addComment(APPROVER, comment({ parentId: parent.id })));
    expect(store.discussions["AI-001"]).toHaveLength(1);
  });
  it("preserves parent manuscript versions after the brief changes", async () => {
    const parent = await domain.addComment(REVIEWER, comment());
    const current = editable();
    current.version = "v0.3";
    await domain.updateDiscovery(OWNER, current);
    const reply = await domain.addComment(
      REVIEWER,
      comment({ parentId: parent.id, reference: "" }),
    );
    expect(reply.version).toBe("v0.2");
    await denied(
      domain.addComment(
        REVIEWER,
        comment({ parentId: parent.id, version: "v0.3" }),
      ),
      400,
    );
    await denied(domain.addComment(REVIEWER, comment()), 400);
    await domain.addComment(REVIEWER, comment({ version: "v0.3" }));
  });
  it("rejects cross-discovery and nonexistent parents", async () => {
    const parent = await domain.addComment(REVIEWER, comment());
    await domain.setAccess(
      OWNER,
      REVIEWER,
      "Reviewer",
      ["bandit-theory", "exoplanets"],
      [],
    );
    await denied(
      domain.addComment(
        REVIEWER,
        comment({
          discoveryId: "AST-002",
          version: "v1.1",
          parentId: parent.id,
        }),
      ),
      400,
    );
    await denied(
      domain.addComment(REVIEWER, comment({ parentId: "not-a-real-comment" })),
      400,
    );
  });
  it("returns only public attribution fields, never private profile evidence", async () => {
    store.state.profiles[REVIEWER].profile.evidence = "PRIVATE EVIDENCE";
    const saved = await domain.addComment(REVIEWER, comment());
    Object.assign(store.discussions["AI-001"][0], {
      privateEmail: "SHOULD NOT LEAK",
    });
    const result = await domain.portal(null);
    expect(result.state.comments[0]).toMatchObject({
      id: saved.id,
      authorName: "reviewer",
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE EVIDENCE");
    expect(JSON.stringify(result)).not.toContain("SHOULD NOT LEAK");
  });
  it("stores shared code requests with immutable server identity and private readership", async () => {
    await domain.requestCode(READER, "AI-001", "Reproduce the analysis.");
    expect((await domain.portal(READER)).state.codeRequests[0]).toMatchObject({
      userId: READER,
      discoveryId: "AI-001",
    });
    expect((await domain.portal(OTHER)).state.codeRequests).toEqual([]);
    expect((await domain.portal(OWNER)).state.codeRequests).toHaveLength(1);
    await denied(domain.requestCode(READER, "AI-001", "   "), 400);
  });
  it.each([
    null,
    [],
    {},
    comment({ body: 3 }),
    comment({ version: null }),
    comment({ reference: null }),
    comment({ parentId: 55 }),
  ])("rejects malformed discussion input %j", async (input) => {
    await denied(domain.addComment(REVIEWER, input), 400);
  });
});

describe("discovery content, visibility, and materials", () => {
  it("exposes only listed figures, follows brief visibility, and preserves paths during browser edits", async () => {
    const d = store.records[0].document.discovery;
    d.question = "What survives the controls?";
    d.figures = [{ id: "measurement", path: "assets/measurement.png", caption: "Measured values with uncertainties.", alt: "Error bars on measured values.", sectionId: d.sections[0].id }];
    d.headlineFigureId = "measurement";
    Object.assign(d.figures[0], { internalNote: "not for readers" });
    const brief = (await domain.portal(null)).state.discoveries.find((r) => r.id === d.id)!;
    expect(brief.question).toBe(d.question);
    expect(brief.figures![0]).not.toHaveProperty("internalNote");
    expect((await domain.authorizeFigure(null, d.id, "measurement")).figure.path).toBe("assets/measurement.png");
    await denied(domain.authorizeFigure(null, d.id, "../internal/claims.json"), 404);
    const draft = editable();
    draft.figures![0].path = "internal/private.png";
    await domain.updateDiscovery(OWNER, draft);
    expect(store.records[0].document.discovery.figures![0].path).toBe("assets/measurement.png");
    store.records[0].document.visibility = "signed-in";
    await denied(domain.authorizeFigure(null, d.id, "measurement"), 404);
    expect((await domain.authorizeFigure(READER, d.id, "measurement")).figure.id).toBe("measurement");
  });

  it.each(["../secret.png", "/secret.png", "a//b.png", "a%2fb.png", "a.svg", "a\\b.png"])("rejects unsafe evidence asset %s", (path) => {
    const d = store.records[0].document.discovery;
    d.figures = [{ id: "one", path, caption: "Caption", alt: "Alternative text", sectionId: d.sections[0].id }];
    expect(validDiscoveryDocument(store.records[0].document)).toBe(false);
  });

  it("rejects missing headline and section targets and duplicate figure IDs", () => {
    const d = store.records[0].document.discovery;
    d.figures = [{ id: "one", path: "assets/one.png", caption: "Caption", alt: "Alternative text", sectionId: d.sections[0].id }];
    d.headlineFigureId = "missing";
    expect(validDiscoveryDocument(store.records[0].document)).toBe(false);
    d.headlineFigureId = "one";
    d.figures[0].sectionId = "missing";
    expect(validDiscoveryDocument(store.records[0].document)).toBe(false);
    d.figures[0].sectionId = d.sections[0].id;
    d.figures.push(copy(d.figures[0]));
    expect(validDiscoveryDocument(store.records[0].document)).toBe(false);
  });
  it("projects only public brief fields and strips unknown nested repository annotations", async () => {
    Object.assign(store.records[0].document, {
      privateConfiguration: "PRIVATE TOP-LEVEL CONFIG",
    });
    Object.assign(store.records[0].document.discovery, {
      privateNotes: "PRIVATE DISCOVERY NOTE",
      accessToken: "PRIVATE TOKEN",
    });
    Object.assign(store.records[0].document.discovery.sections[0], {
      reviewerEmail: "PRIVATE SECTION EMAIL",
      privateNotes: { secret: "PRIVATE NESTED NOTE" },
    });
    const result = await domain.portal(null);
    const brief = result.state.discoveries.find(
      (item) => item.id === "AI-001",
    )!;
    expect(brief.title).toBe(discoveries[0].title);
    expect(brief.sections[0].equation).toBe(
      discoveries[0].sections[0].equation,
    );
    expect(brief).not.toHaveProperty("privateNotes");
    expect(brief).not.toHaveProperty("accessToken");
    expect(brief.sections[0]).not.toHaveProperty("reviewerEmail");
    expect(brief.sections[0]).not.toHaveProperty("privateNotes");
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it("only owner edits content and preserves repository material policies", async () => {
    store.records[0].document.materials.paper = {
      path: "papers/manuscript.pdf",
      access: "reviewer",
    };
    const input = {
      ...editable(),
      title: "Owner revised title",
      materials: {
        paper: "https://evil.example.test",
        appendix: null,
        figures: null,
        data: null,
        repository: null,
      },
    };
    await denied(domain.updateDiscovery(READER, input));
    await denied(domain.updateDiscovery(APPROVER, input));
    await domain.updateDiscovery(OWNER, input);
    expect(store.records[0].document.discovery.title).toBe(
      "Owner revised title",
    );
    expect(store.records[0].document.materials.paper).toEqual({
      path: "papers/manuscript.pdf",
      access: "reviewer",
    });
    expect(store.records[0].document.discovery.materials.paper).toBeNull();
    expect(store.records[0].document.discovery).not.toHaveProperty("revision");
  });
  it("does not overwrite a simultaneous discovery edit", async () => {
    store.saveConflict = true;
    await denied(
      domain.updateDiscovery(OWNER, {
        ...editable(),
        title: "Conflicting update",
      }),
      409,
    );
    expect(store.records[0].document.discovery.title).toBe(
      discoveries[0].title,
    );
  });
  it("rejects a stale open edit form even before the final GitHub SHA check", async () => {
    const draft = editable();
    await domain.updateDiscovery(OWNER, {
      ...draft,
      title: "Newer saved title",
    });
    await denied(
      domain.updateDiscovery(OWNER, { ...draft, title: "Stale open form" }),
      409,
    );
    expect(store.records[0].document.discovery.title).toBe("Newer saved title");
  });
  it("rejects a stale SHA after a manual GitHub edit that kept updatedAt unchanged", async () => {
    const draft = (await domain.portal(OWNER)).state.discoveries.find(
      (item) => item.id === "AI-001",
    )!;
    expect(draft.revision).toBe("1");
    store.records[0].sha = "manually-updated-blob";
    store.records[0].document.discovery.title = "Manual GitHub edit";
    expect(store.records[0].document.discovery.updatedAt).toBe(draft.updatedAt);
    await denied(
      domain.updateDiscovery(OWNER, {
        ...draft,
        title: "Stale form would overwrite manual edit",
      }),
      409,
    );
    expect(store.records[0].document.discovery.title).toBe(
      "Manual GitHub edit",
    );
  });
  it("requires the revision supplied by the current portal read", async () => {
    await denied(domain.updateDiscovery(OWNER, copy(discoveries[0])), 409);
    await denied(
      domain.updateDiscovery(OWNER, { ...editable(), revision: 1 }),
      409,
    );
  });
  it("rejects invalid field/topic combinations, malformed content, and unknown IDs", async () => {
    await denied(
      domain.updateDiscovery(OWNER, { ...editable(), field: "Astronomy" }),
      400,
    );
    await denied(domain.updateDiscovery(OWNER, null), 400);
    await denied(
      domain.updateDiscovery(OWNER, { ...editable(), id: "UNKNOWN-ID" }),
      404,
    );
  });
  it("hides signed-in briefs, their comments, and materials from visitors", async () => {
    store.records[0].document.visibility = "signed-in";
    store.records[0].document.materials.paper = {
      path: "paper.pdf",
      access: "public",
    };
    await domain.addComment(REVIEWER, comment());
    expect(
      (await domain.portal(null)).state.discoveries.map((item) => item.id),
    ).not.toContain("AI-001");
    expect((await domain.portal(null)).state.comments).toEqual([]);
    expect((await domain.portal(READER)).state.discoveries).toHaveLength(6);
    await denied(domain.authorizeMaterial(null, "AI-001", "paper"), 404);
  });
  it("enforces per-material public, Reader, reviewer-topic, and owner policies", async () => {
    Object.assign(store.records[0].document.materials, {
      paper: { path: "paper.pdf", access: "public" },
      appendix: { path: "appendix.pdf", access: "reader" },
      figures: { path: "figures/plot.png", access: "reviewer" },
      data: { path: "data/results.csv", access: "admin" },
      repository: {
        url: "https://github.com/scida-science/research",
        access: "admin",
      },
    });
    const publicBrief = (await domain.portal(null)).state.discoveries.find(
      (item) => item.id === "AI-001",
    )!;
    expect(publicBrief.materials.paper).toBe(
      "https://api.example.test/v1/discoveries/AI-001/materials/paper",
    );
    expect(publicBrief.materials.figures).toBeNull();
    expect(publicBrief.restrictedMaterials).toEqual([
      "appendix",
      "figures",
      "data",
      "repository",
    ]);
    expect(JSON.stringify(publicBrief)).not.toContain("results.csv");
    expect(
      (await domain.authorizeMaterial(null, "AI-001", "paper")).material,
    ).toEqual({ path: "paper.pdf", access: "public" });
    await denied(domain.authorizeMaterial(null, "AI-001", "appendix"), 404);
    await domain.authorizeMaterial(READER, "AI-001", "appendix");
    await denied(domain.authorizeMaterial(READER, "AI-001", "figures"), 404);
    await domain.authorizeMaterial(REVIEWER, "AI-001", "figures");
    await denied(domain.authorizeMaterial(REVIEWER, "AI-001", "data"), 404);
    await domain.authorizeMaterial(OWNER, "AI-001", "data");
    await domain.authorizeMaterial(OWNER, "AI-001", "figures");
    await domain.authorizeMaterial(APPROVER, "AI-001", "figures");
  });
  it("uses current inherited review scopes for material links and direct material requests", async () => {
    store.records[0].document.materials.paper = { path: "paper.pdf", access: "reviewer" };
    store.records[1].document.materials.paper = { path: "paper.pdf", access: "reviewer" };
    const allowedBrief = (await domain.portal(APPROVER)).state.discoveries.find(
      (item) => item.id === "AI-001",
    )!;
    expect(allowedBrief.materials.paper).toBe(
      "https://api.example.test/v1/discoveries/AI-001/materials/paper",
    );
    await domain.authorizeMaterial(APPROVER, "AI-001", "paper");
    await denied(domain.authorizeMaterial(APPROVER, "AST-001", "paper"), 404);
    await domain.setAccess(OWNER, APPROVER, "Senior Reviewer", [], ["exoplanets"]);
    await denied(domain.authorizeMaterial(APPROVER, "AI-001", "paper"), 404);
    const restrictedBrief = (await domain.portal(APPROVER)).state.discoveries.find(
      (item) => item.id === "AI-001",
    )!;
    expect(restrictedBrief.materials.paper).toBeNull();
    expect(restrictedBrief.restrictedMaterials).toContain("paper");
  });
  it.each([
    "../secret",
    ".",
    "/absolute.pdf",
    "folder/../secret",
    "folder\\file",
    "folder//file",
    "file%2fsecret",
    "https://example.test/a",
    "file?query",
    "file#fragment",
    "file\nname",
  ])("rejects unsafe repository path %s", (path) => {
    expect(validMaterial({ path, access: "public" })).toBe(false);
  });
  it.each([
    "http://example.test/file",
    "javascript:alert(1)",
    "https://user:password@example.test/file",
  ])("rejects unsafe material URL %s", (url) => {
    expect(validMaterial({ url, access: "reader" })).toBe(false);
  });
  it("validates material defaults and fails closed on invalid or duplicate discovery config", async () => {
    expect(
      validMaterial({ path: "papers/review copy.pdf", access: "reviewer" }),
    ).toBe(true);
    expect(
      validDiscoveryDocument({
        ...document(discoveries[0]),
        visibility: undefined,
      }),
    ).toBe(false);
    store.records[0].document.materials.paper = {
      path: "../private.txt",
      access: "public",
    };
    await denied(domain.portal(null), 503);
    store.records[0].document.materials.paper = null;
    store.records.push(copy(store.records[0]));
    await denied(domain.portal(null), 503);
  });
});
