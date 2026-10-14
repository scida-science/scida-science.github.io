import type {
  CommentInput,
  Discovery,
  DiscussionComment,
  Invitation,
  PortalState,
  Profile,
  ProfileInput,
  TopicId,
} from "../src/types";
import {
  cleanProfile,
  profileError,
  validDiscovery,
  validTopics,
  topicIds,
} from "../src/services/validation";
import { HttpError, materialKinds, object, validMaterial } from "./model";
import type {
  AdminState,
  AccessRecord,
  DiscoveryDocument,
  GitHubStore,
  MaterialKind,
  MaterialRecord,
  StoredDiscovery,
  StoredInvitation,
} from "./model";
export { HttpError } from "./model";

const iso = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const string = (value: unknown, max: number, min = 0): value is string =>
  typeof value === "string" &&
  value.length <= max &&
  value.trim().length >= min;
const bad = (message: string): never => {
  throw new HttpError(400, message);
};
const denied = (message = "You do not have access to this action."): never => {
  throw new HttpError(403, message);
};
const numericId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value);
const owns = (record: object, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key);
const sameTopics = (a: TopicId[], b: TopicId[]) =>
  a.length === b.length && a.every((topic) => b.includes(topic));
const clone = <T>(value: T): T => structuredClone(value);
function topics(value: unknown, required = false): TopicId[] {
  if (!validTopics(value, required))
    bad("Choose recognized, distinct research topics.");
  return [...(value as TopicId[])];
}
async function hash(value: string): Promise<string> {
  const result = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(result)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function invitationCode(value: unknown): string {
  if (!string(value, 256, 1)) bad("Enter an invitation code.");
  return (value as string).trim();
}
function safeInvitation(value: StoredInvitation): Invitation {
  return {
    id: value.id,
    createdBy: value.createdBy,
    topics: [...value.topics],
    intendedEmail: value.intendedEmail,
    expiresAt: value.expiresAt,
    ...(value.usedBy ? { usedBy: value.usedBy } : {}),
  };
}
function profileInput(value: unknown): ProfileInput {
  if (!object(value)) bad("A valid profile is required.");
  const error = profileError(value as unknown as ProfileInput);
  if (error) bad(error);
  return cleanProfile(value as unknown as ProfileInput);
}
export function validDiscoveryDocument(
  value: unknown,
): value is DiscoveryDocument {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    !["public", "signed-in"].includes(value.visibility as string) ||
    !validDiscovery(value.discovery) ||
    !object(value.materials)
  )
    return false;
  const discovery = value.discovery;
  return (
    /^[A-Z0-9][A-Za-z0-9_-]{1,79}$/.test(discovery.id) &&
    (discovery.illustrative === undefined ||
      typeof discovery.illustrative === "boolean") &&
    (topicIds.indexOf(discovery.topic) < 3
      ? discovery.field === "Artificial Intelligence"
      : discovery.field === "Astronomy") &&
    materialKinds.every(
      (kind) =>
        value.materials &&
        object(value.materials) &&
        (value.materials[kind] === null ||
          validMaterial(value.materials[kind])),
    )
  );
}

/** Server authority. User IDs come only from verified Worker sessions, never JSON bodies. */
export function createDomain(
  store: GitHubStore,
  adminId: string,
  apiOrigin: string,
) {
  if (!numericId(adminId))
    throw new Error("A numeric ADMIN_GITHUB_ID is required.");
  const origin = apiOrigin.replace(/\/$/, "");
  function getUser(state: AdminState, userId: string | null): Profile | null {
    if (!userId) return null;
    if (!numericId(userId) || !owns(state.profiles, userId))
      throw new HttpError(401, "Sign in again to continue.");
    const record = state.profiles[userId];
    const access = owns(state.access, userId)
      ? state.access[userId]
      : undefined;
    const role =
      userId === adminId
        ? "Admin"
        : access && ["Reviewer", "Approver", "Senior Approver"].includes(access.role)
          ? access.role
          : "Reader";
    return {
      ...clone(record.profile),
      id: userId,
      githubLogin: record.githubLogin,
      email: record.email,
      role,
      approvedTopics:
        access && validTopics(access.approvedTopics)
          ? [...access.approvedTopics]
          : [],
      assignedTopics:
        access && validTopics(access.assignedTopics)
          ? [...access.assignedTopics]
          : [],
    };
  }
  function user(state: AdminState, userId: string | null): Profile {
    const current = getUser(state, userId);
    if (!current) throw new HttpError(401, "Sign in to continue.");
    return current;
  }
  const isAdmin = (current: Profile | null) => current?.id === adminId;
  const canApprove = (current: Profile | null, requested: TopicId[]) =>
    !!current &&
    requested.length > 0 &&
    validTopics(requested) &&
    (isAdmin(current) ||
      (current.role === "Senior Approver" &&
        requested.every((topic) => current.assignedTopics.includes(topic))));
  const canDiscuss = (current: Profile | null, discovery: Discovery) =>
    !!current &&
    current.role !== "Reader" &&
    current.approvedTopics.includes(discovery.topic);
  const canView = (current: Profile | null, document: DiscoveryDocument) =>
    document.visibility === "public" || !!current;
  function materialAllowed(
    current: Profile | null,
    record: StoredDiscovery,
    material: MaterialRecord,
  ): boolean {
    if (!canView(current, record.document)) return false;
    switch (material.access) {
      case "public":
        return true;
      case "reader":
        return !!current;
      case "reviewer":
        return canDiscuss(current, record.document.discovery);
      case "admin":
        return isAdmin(current);
      default:
        return false;
    }
  }
  function audit(
    state: AdminState,
    actorId: string,
    action: string,
    targetId?: string,
    details: Record<string, unknown> = {},
  ) {
    state.audit.push({
      id: id(),
      actorId,
      action,
      ...(targetId ? { targetId } : {}),
      createdAt: iso(),
      details,
    });
  }
  async function records(): Promise<StoredDiscovery[]> {
    const result = await store.listDiscoveries();
    if (result.some((record) => !validDiscoveryDocument(record.document)))
      throw new HttpError(
        503,
        "A discovery repository has invalid configuration.",
      );
    const ids = result.map((record) => record.document.discovery.id);
    if (new Set(ids).size !== ids.length)
      throw new HttpError(
        503,
        "Discovery IDs must be unique across repositories.",
      );
    return result;
  }
  async function discovery(discoveryId: unknown): Promise<StoredDiscovery> {
    if (!string(discoveryId, 80, 1)) bad("A discovery ID is required.");
    const found = (await records()).find(
      (record) => record.document.discovery.id === discoveryId,
    );
    if (!found) throw new HttpError(404, "Discovery not found.");
    return found;
  }
  function visible(current: Profile | null, record: StoredDiscovery) {
    if (!canView(current, record.document))
      throw new HttpError(404, "Discovery not found.");
  }
  function findInvitation(
    state: AdminState,
    current: Profile,
    codeHash: string,
  ): StoredInvitation {
    const found = state.invitations.find(
      (invitation) =>
        invitation.codeHash === codeHash &&
        !invitation.usedBy &&
        Date.parse(invitation.expiresAt) > Date.now() &&
        invitation.intendedEmail.toLowerCase() === current.email.toLowerCase(),
    );
    if (
      !found ||
      found.createdBy === current.id ||
      !owns(state.profiles, found.createdBy) ||
      !canApprove(getUser(state, found.createdBy), found.topics)
    )
      denied("Invitation unavailable for this verified account.");
    return found!;
  }

  return {
    async portal(
      userId: string | null,
    ): Promise<{ state: PortalState; user: Profile | null }> {
      const [admin, all] = await Promise.all([store.readAdmin(), records()]);
      const current = getUser(admin, userId);
      const readable = all.filter((record) =>
        canView(current, record.document),
      );
      const state: PortalState = {
        profiles: [],
        discoveries: [],
        comments: [],
        codeRequests: [],
        applications: [],
        invitations: [],
      };
      state.discoveries = readable
        .map((record) => {
          const source = record.document.discovery;
          // Repository JSON may contain owner-only annotations outside the public
          // brief schema. Project explicit fields rather than spreading that data.
          const result: Discovery & {
            restrictedMaterials: MaterialKind[];
            revision: string;
          } = {
            id: source.id,
            title: source.title,
            field: source.field,
            topic: source.topic,
            status: source.status,
            summary: source.summary,
            updatedAt: source.updatedAt,
            version: source.version,
            reviewNote: source.reviewNote,
            sections: source.sections.map((section) => ({
              id: section.id,
              title: section.title,
              body: section.body,
              ...(section.equation === undefined
                ? {}
                : { equation: section.equation }),
            })),
            ...(source.illustrative === undefined
              ? {}
              : { illustrative: source.illustrative }),
            materials: {
              paper: null,
              appendix: null,
              figures: null,
              data: null,
              repository: null,
            },
            restrictedMaterials: [],
            revision: record.sha,
          };
          for (const kind of materialKinds) {
            const material = record.document.materials[kind];
            if (material && materialAllowed(current, record, material))
              result.materials[kind] =
                `${origin}/v1/discoveries/${encodeURIComponent(result.id)}/materials/${kind}`;
            else if (material) result.restrictedMaterials.push(kind);
          }
          return result;
        })
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      state.comments = (
        await Promise.all(
          readable.map(async (record) =>
            (await store.readComments(record))
              .filter(
                (comment) =>
                  comment.discoveryId === record.document.discovery.id,
              )
              .map((comment) => ({
                id: comment.id,
                discoveryId: comment.discoveryId,
                authorId: comment.authorId,
                parentId: comment.parentId,
                version: comment.version,
                reference: comment.reference,
                body: comment.body,
                createdAt: comment.createdAt,
                authorName:
                  admin.profiles[comment.authorId]?.profile.fullName ??
                  "Researcher",
              })),
          ),
        )
      ).flat();
      if (current) {
        state.applications = admin.applications
          .filter(
            (application) =>
              application.userId === current.id ||
              canApprove(current, application.topics),
          )
          .map(clone);
        const allowedProfiles = new Set([
          current.id,
          ...state.applications
            .filter((application) => canApprove(current, application.topics))
            .map((application) => application.userId),
        ]);
        state.profiles = Object.keys(admin.profiles)
          .filter(
            (profileId) => isAdmin(current) || allowedProfiles.has(profileId),
          )
          .map((profileId) => {
            const profile = getUser(admin, profileId)!;
            return {
              ...profile,
              email: profileId === current.id ? profile.email : "",
            };
          });
        state.codeRequests = admin.codeRequests
          .filter(
            (request) => request.userId === current.id || isAdmin(current),
          )
          .map(clone);
        state.invitations = admin.invitations
          .filter(
            (invitation) =>
              invitation.createdBy === current.id || isAdmin(current),
          )
          .map(safeInvitation);
      }
      return { state, user: current };
    },
    async saveProfile(userId: string, input: unknown): Promise<void> {
      const profile = profileInput(input);
      await store.updateAdmin((state) => {
        user(state, userId);
        state.profiles[userId].profile = clone(profile);
      });
    },
    async applyForReview(
      userId: string,
      requested: unknown,
      evidence: unknown,
    ): Promise<void> {
      const scope = topics(requested, true);
      if (!string(evidence, 6000, 10))
        bad("Provide application evidence between 10 and 6,000 characters.");
      const application = {
        id: id(),
        userId,
        topics: scope,
        evidence: (evidence as string).trim(),
        status: "Pending" as const,
        createdAt: iso(),
      };
      await store.updateAdmin((state) => {
        user(state, userId);
        if (
          state.applications.some(
            (item) => item.userId === userId && item.status === "Pending",
          )
        )
          throw new HttpError(409, "You already have a pending application.");
        state.applications.push(clone(application));
      });
    },
    async reviewApplication(
      userId: string,
      applicationId: unknown,
      approved: unknown,
      note: unknown,
    ): Promise<void> {
      if (
        !string(applicationId, 100, 1) ||
        typeof approved !== "boolean" ||
        !string(note, 4000)
      )
        bad("Provide a valid application decision.");
      await store.updateAdmin((state) => {
        const current = user(state, userId);
        const application = state.applications.find(
          (item) => item.id === applicationId,
        );
        if (
          !application ||
          application.userId === current.id ||
          !canApprove(current, application.topics)
        )
          denied("You cannot decide this application.");
        if (application!.status !== "Pending")
          throw new HttpError(
            409,
            "This application has already been decided.",
          );
        user(state, application!.userId);
        application!.status = approved ? "Approved" : "Declined";
        application!.decidedBy = current.id;
        application!.decisionNote = (note as string).trim();
        if (approved) {
          const access = state.access[application!.userId] ?? {
            role: "Reader",
            approvedTopics: [],
            assignedTopics: [],
          };
          access.approvedTopics = [
            ...new Set([...access.approvedTopics, ...application!.topics]),
          ];
          if (access.role === "Reader") access.role = "Reviewer";
          state.access[application!.userId] = access;
        }
        audit(state, current.id, "review_application", application!.userId, {
          applicationId,
          approved,
          topics: application!.topics,
        });
      });
    },
    async createInvitation(
      userId: string,
      requested: unknown,
      intendedEmail: unknown,
    ): Promise<Invitation> {
      const scope = topics(requested, true);
      if (
        !string(intendedEmail, 320, 3) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((intendedEmail as string).trim())
      )
        bad("Enter a valid intended email address.");
      const email = (intendedEmail as string).trim().toLowerCase();
      const code = id().replaceAll("-", "") + id().replaceAll("-", "");
      const invitation: StoredInvitation = {
        id: id(),
        createdBy: userId,
        topics: scope,
        intendedEmail: email,
        codeHash: await hash(code),
        createdAt: iso(),
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      };
      return store.updateAdmin((state) => {
        const current = user(state, userId);
        if (!canApprove(current, scope))
          denied("You cannot invite reviewers in these topics.");
        if (current.email.toLowerCase() === email)
          denied("You cannot invite yourself.");
        state.invitations.push(clone(invitation));
        audit(state, current.id, "create_invitation", undefined, {
          invitationId: invitation.id,
          topics: scope,
        });
        return { ...safeInvitation(invitation), code };
      });
    },
    async previewInvitation(
      userId: string,
      rawCode: unknown,
    ): Promise<Invitation> {
      const codeHash = await hash(invitationCode(rawCode));
      const state = await store.readAdmin();
      return safeInvitation(
        findInvitation(state, user(state, userId), codeHash),
      );
    },
    async acceptInvitation(
      userId: string,
      rawCode: unknown,
      confirmed: unknown,
    ): Promise<void> {
      const codeHash = await hash(invitationCode(rawCode));
      const scope = topics(confirmed, true);
      await store.updateAdmin((state) => {
        const current = user(state, userId);
        const invitation = findInvitation(state, current, codeHash);
        if (!sameTopics(scope, invitation.topics))
          bad("Confirm exactly the topics offered by this invitation.");
        const access = state.access[userId] ?? {
          role: "Reader",
          approvedTopics: [],
          assignedTopics: [],
        };
        access.approvedTopics = [
          ...new Set([...access.approvedTopics, ...scope]),
        ];
        if (access.role === "Reader") access.role = "Reviewer";
        state.access[userId] = access;
        invitation.usedBy = userId;
        invitation.usedAt = iso();
        audit(state, userId, "accept_invitation", userId, {
          invitationId: invitation.id,
          topics: scope,
        });
      });
    },
    async addComment(
      userId: string,
      input: unknown,
    ): Promise<DiscussionComment> {
      if (
        !object(input) ||
        !string(input.discoveryId, 80, 1) ||
        !string(input.version, 40, 1) ||
        !(input.parentId === null || string(input.parentId, 100, 1)) ||
        !string(input.reference, 250) ||
        !string(input.body, 6000, 3)
      )
        bad("Provide a valid discussion message and manuscript version.");
      const commentInput = input as unknown as CommentInput;
      const record = await discovery(commentInput.discoveryId);
      let current = user(await store.readAdmin(), userId);
      visible(current, record);
      if (!canDiscuss(current, record.document.discovery))
        denied("Reviewer approval is required for this discovery topic.");
      if (commentInput.parentId) {
        const parent = (await store.readComments(record)).find(
          (comment) => comment.id === commentInput.parentId,
        );
        if (
          !parent ||
          parent.discoveryId !== commentInput.discoveryId ||
          parent.version !== commentInput.version
        )
          bad("Reply must match its parent discovery and manuscript version.");
      } else if (commentInput.version !== record.document.discovery.version)
        bad("New discussion must use the current manuscript version.");
      // Recheck access after potentially slow repository reads. GitHub's separate
      // Issues and Contents APIs do not provide a cross-repository transaction.
      current = user(await store.readAdmin(), userId);
      if (!canDiscuss(current, record.document.discovery))
        denied("Reviewer access has changed. Refresh and try again.");
      const comment: DiscussionComment = {
        id: id(),
        discoveryId: commentInput.discoveryId,
        authorId: userId,
        parentId: commentInput.parentId,
        version: commentInput.version,
        reference: commentInput.reference.trim(),
        body: commentInput.body.trim(),
        createdAt: iso(),
      };
      await store.addComment(record, comment);
      return { ...comment, authorName: current.fullName };
    },
    async requestCode(
      userId: string,
      discoveryId: unknown,
      explanation: unknown,
    ): Promise<void> {
      if (!string(explanation, 2000, 1))
        bad("Provide a short explanation, up to 2,000 characters.");
      const record = await discovery(discoveryId);
      const request = {
        id: id(),
        discoveryId: record.document.discovery.id,
        userId,
        explanation: (explanation as string).trim(),
        createdAt: iso(),
      };
      await store.updateAdmin((state) => {
        const current = user(state, userId);
        visible(current, record);
        state.codeRequests.push(clone(request));
      });
    },
    async updateDiscovery(userId: string, input: unknown): Promise<void> {
      const current = user(await store.readAdmin(), userId);
      if (!isAdmin(current))
        denied("Only the site administrator can edit discoveries.");
      if (!object(input)) return bad("Provide a valid discovery.");
      const record = await discovery(input.id);
      if (typeof input.revision !== "string" || input.revision !== record.sha)
        throw new HttpError(
          409,
          "The discovery revision changed or is missing. Refresh before editing again.",
        );
      if (input.updatedAt !== record.document.discovery.updatedAt)
        throw new HttpError(
          409,
          "The discovery changed after this form was opened. Refresh before editing again.",
        );
      // Material permissions and repository paths are owner-managed metadata.
      // Browser display URLs are never written back into that configuration.
      const candidate = {
        ...input,
        materials: clone(record.document.discovery.materials),
        updatedAt: iso(),
      } as unknown as Discovery;
      const document: DiscoveryDocument = {
        ...clone(record.document),
        discovery: candidate,
      };
      if (!validDiscoveryDocument(document))
        bad("Provide a valid discovery with matching field and topic.");
      document.discovery = {
        id: candidate.id,
        title: candidate.title,
        field: candidate.field,
        topic: candidate.topic,
        status: candidate.status,
        summary: candidate.summary,
        updatedAt: candidate.updatedAt,
        version: candidate.version,
        reviewNote: candidate.reviewNote,
        sections: candidate.sections.map((section) => ({
          id: section.id,
          title: section.title,
          body: section.body,
          ...(section.equation === undefined
            ? {}
            : { equation: section.equation }),
        })),
        materials: clone(record.document.discovery.materials),
        ...(candidate.illustrative === undefined
          ? {}
          : { illustrative: candidate.illustrative }),
      };
      await store.saveDiscovery(record, document);
    },
    async setAccess(
      userId: string,
      targetId: unknown,
      role: unknown,
      approved: unknown,
      assigned: unknown,
    ): Promise<void> {
      if (
        !numericId(targetId) ||
        !["Reader", "Reviewer", "Approver", "Senior Approver"].includes(role as string)
      )
        bad("Choose an existing account and a non-admin role.");
      const approvedTopics = topics(approved);
      const assignedTopics = topics(assigned);
      if (
        (role === "Reader" &&
          approvedTopics.length + assignedTopics.length > 0) ||
        ((role === "Reviewer" || role === "Approver") &&
          (!approvedTopics.length || assignedTopics.length)) ||
        (role === "Senior Approver" && !assignedTopics.length)
      )
        bad("Choose appropriate topic scopes for this role.");
      await store.updateAdmin((state) => {
        const current = user(state, userId);
        if (!isAdmin(current))
          denied("Only the site administrator can manage account access.");
        if (targetId === adminId)
          denied(
            "The owner identity cannot be changed or self-approved through account management.",
          );
        if (!owns(state.profiles, targetId as string))
          throw new HttpError(404, "Account not found.");
        state.access[targetId as string] = {
          role: role as AccessRecord["role"],
          approvedTopics: [...approvedTopics],
          assignedTopics: [...assignedTopics],
        };
        audit(state, userId, "set_access", targetId as string, {
          role,
          approvedTopics,
          assignedTopics,
        });
      });
    },
    async authorizeMaterial(
      userId: string | null,
      discoveryId: unknown,
      kind: unknown,
    ): Promise<{ record: StoredDiscovery; material: MaterialRecord }> {
      if (!materialKinds.includes(kind as MaterialKind))
        throw new HttpError(404, "Material not found.");
      const record = await discovery(discoveryId);
      const current = getUser(await store.readAdmin(), userId);
      visible(current, record);
      const material = record.document.materials[kind as MaterialKind];
      if (!material || !materialAllowed(current, record, material))
        throw new HttpError(
          404,
          "Material not found or unavailable to this account.",
        );
      return { record: clone(record), material: clone(material) };
    },
  };
}
