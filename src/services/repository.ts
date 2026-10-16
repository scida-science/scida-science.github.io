import type { ApiClient } from "../lib/api";
import type {
  CommentInput,
  Discovery,
  DiscoveryUpdate,
  Invitation,
  PortalState,
  Profile,
  ProfileInput,
  Role,
  TopicId,
} from "../types";
import { roles } from "./validation";
export function emptyPortalState(): PortalState {
  return {
    profiles: [],
    discoveries: [],
    comments: [],
    codeRequests: [],
    applications: [],
    invitations: [],
    notifications: [],
  };
}
export interface PortalResponse {
  state: PortalState;
  user: Profile | null;
}

// Read-only compatibility while the new frontend and Worker roll out separately.
// Legacy names are never offered as roles or sent in access-management writes.
function canonicalServerProfile(profile: Profile): Profile {
  const role: string = profile.role;
  if (role === "Senior Approver") return { ...profile, role: "Senior Reviewer" };
  if (role === "Approver") return { ...profile, role: "Reviewer", assignedTopics: [] };
  return profile;
}

/** The Worker enforces permissions and writes shared records to private GitHub files. */
export function createPortalRepository(client: ApiClient) {
  return {
    async read(): Promise<PortalResponse> {
      const result = await client.request<PortalResponse>("/v1/portal");
      if (
        !result ||
        !result.state ||
        ![
          "profiles",
          "discoveries",
          "comments",
          "codeRequests",
          "applications",
          "invitations",
        ].every((key) =>
          Array.isArray(result.state[key as keyof PortalState]),
        ) ||
        !(
          result.user === null ||
          (typeof result.user?.id === "string" &&
            roles.includes(canonicalServerProfile(result.user).role))
        )
      )
        throw new Error("The SciDA API returned incomplete portal data.");
      if (result.user && !client.getSession())
        throw new Error(
          "The API returned private account data without an active session.",
        );
      if (result.state.notifications !== undefined && !Array.isArray(result.state.notifications))
        throw new Error("The SciDA API returned incomplete notification data.");
      return {
        ...result,
        user: result.user && canonicalServerProfile(result.user),
        state: {
          ...result.state,
          profiles: result.state.profiles.map(canonicalServerProfile),
          notifications: result.user ? (result.state.notifications ?? []) : [],
          // Old illustrative repositories must not reappear in a real research feed.
          discoveries: result.state.discoveries.filter((discovery) => discovery.illustrative === false),
        },
      };
    },
    saveProfile: (input: ProfileInput) =>
      client.request<void>("/v1/profile", { input }),
    setFollowing: (discoveryId: string, following: boolean) =>
      client.request<void>(`/v1/discoveries/${encodeURIComponent(discoveryId)}/follow`, { following }),
    markNotificationsRead: (ids: string[]) =>
      client.request<void>("/v1/notifications/read", { ids }),
    applyForReview: (topics: TopicId[], evidence: string) =>
      client.request<void>("/v1/applications", { topics, evidence }),
    reviewApplication: (
      id: string,
      decision: "Approved" | "Declined",
      note: string,
    ) =>
      client.request<void>(
        `/v1/applications/${encodeURIComponent(id)}/decision`,
        { decision, note },
      ),
    async createInvitation(
      topics: TopicId[],
      intendedEmail: string,
    ): Promise<Invitation> {
      const result = await client.request<{
        invitation: Invitation;
        code?: string;
      }>("/v1/invitations", { topics, intendedEmail });
      return {
        ...result.invitation,
        code: result.code ?? result.invitation?.code,
      };
    },
    async previewInvitation(code: string): Promise<Invitation> {
      return (
        await client.request<{ invitation: Invitation }>(
          "/v1/invitations/preview",
          { code },
        )
      ).invitation;
    },
    confirmInvitation: (code: string, confirmedTopics: TopicId[]) =>
      client.request<void>("/v1/invitations/accept", { code, confirmedTopics }),
    addComment: (input: CommentInput) =>
      client.request<void>("/v1/comments", { input }),
    requestCode: (discoveryId: string, explanation: string) =>
      client.request<void>("/v1/code-requests", { discoveryId, explanation }),
    updateDiscovery: (discovery: DiscoveryUpdate) => {
      const input = { ...discovery };
      delete input.statusHistory;
      return client.request<void>(
        `/v1/discoveries/${encodeURIComponent(discovery.id)}`,
        { discovery: input },
      );
    },
    setAccess: (
      userId: string,
      role: Role,
      approvedTopics: TopicId[],
      assignedTopics: TopicId[],
    ) =>
      client.request<void>(`/v1/access/${encodeURIComponent(userId)}`, {
        role,
        approvedTopics,
        assignedTopics,
      }),
    loadFigure: async (discoveryId: string, figureId: string): Promise<Blob> => {
      const result = await client.download(
        `/v1/discoveries/${encodeURIComponent(discoveryId)}/evidence/${encodeURIComponent(figureId)}`,
      );
      if (!result.blob || result.blob.type !== "image/png")
        throw new Error("Evidence figure is unavailable.");
      return result.blob;
    },
    downloadMaterial: (
      discoveryId: string,
      kind: keyof Discovery["materials"],
    ) =>
      client.download(
        `/v1/discoveries/${encodeURIComponent(discoveryId)}/materials/${encodeURIComponent(kind)}`,
      ),
  };
}
export type PortalRepository = ReturnType<typeof createPortalRepository>;
