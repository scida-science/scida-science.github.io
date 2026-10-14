import { beforeEach, describe, expect, it } from "vitest";
import { discoveries } from "../src/data/discoveries";
import type { Discovery, DiscussionComment, ProfileInput } from "../src/types";
import { createDomain, validDiscoveryDocument } from "./domain";
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
    role: "Senior Approver",
    approvedTopics: [],
    assignedTopics: ["bandit-theory"],
  };
  domain = createDomain(store, OWNER, "https://api.example.test");
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
  it("keeps ordinary Approvers discussion-only, even with legacy assigned topics", async () => {
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
    await denied(domain.setAccess(OTHER, READER, "Senior Approver", [], ["bandit-theory"]));
    expect(store.state).toEqual(before);
    const portal = await domain.portal(OTHER);
    expect(portal.user?.role).toBe("Approver");
    expect(portal.state.applications).toEqual([]);
    expect(portal.state.profiles.map((item) => item.id)).toEqual([OTHER]);
    expect((await domain.addComment(OTHER, comment())).authorId).toBe(OTHER);
    await denied(domain.addComment(OTHER, comment({ discoveryId: "AST-001", version: "v0.1" })));
  });

  it("allows only the owner to appoint an ordinary Approver with discussion topics", async () => {
    await denied(domain.setAccess(APPROVER, OTHER, "Approver", ["bandit-theory"], []));
    await domain.setAccess(OWNER, OTHER, "Approver", ["bandit-theory"], []);
    expect(store.state.access[OTHER]).toEqual({
      role: "Approver",
      approvedTopics: ["bandit-theory"],
      assignedTopics: [],
    });
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
      domain.setAccess(READER, OTHER, "Senior Approver", [], ["bandit-theory"]),
    );
    await denied(
      domain.setAccess(APPROVER, OTHER, "Senior Approver", [], ["bandit-theory"]),
    );
    await denied(domain.setAccess(OWNER, OTHER, "Admin", [], []), 400);
    await denied(
      domain.setAccess(OWNER, OWNER, "Reviewer", ["bandit-theory"], []),
    );
    await domain.setAccess(
      OWNER,
      OTHER,
      "Senior Approver",
      ["exoplanets"],
      ["exoplanets"],
    );
    expect(store.state.access[OTHER]).toMatchObject({
      role: "Senior Approver",
      assignedTopics: ["exoplanets"],
    });
  });
  it.each([
    ["Reader", ["bandit-theory"], []],
    ["Reviewer", [], []],
    ["Reviewer", ["bandit-theory"], ["exoplanets"]],
    ["Approver", [], []],
    ["Approver", ["bandit-theory"], ["exoplanets"]],
    ["Senior Approver", [], []],
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
  it("posts only with topic approval, including for the owner", async () => {
    await denied(domain.addComment(READER, comment()));
    await denied(domain.addComment(OWNER, comment()));
    await denied(domain.addComment(APPROVER, comment()));
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
    await denied(domain.authorizeMaterial(OWNER, "AI-001", "figures"), 404);
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
