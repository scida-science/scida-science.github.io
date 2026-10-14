import type { ApiClient } from "../lib/api";
import type {
  CommentInput,
  Discovery,
  Invitation,
  PortalState,
  Profile,
  ProfileInput,
  Role,
  TopicId,
} from "../types";
export function emptyPortalState(): PortalState {
  return {
    profiles: [],
    discoveries: [],
    comments: [],
    codeRequests: [],
    applications: [],
    invitations: [],
  };
}
export interface PortalResponse {
  state: PortalState;
  user: Profile | null;
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
            ["Reader", "Reviewer", "Approver", "Admin"].includes(
              result.user.role,
            ))
        )
      )
        throw new Error("The SciDA API returned incomplete portal data.");
      if (result.user && !client.getSession())
        throw new Error(
          "The API returned private account data without an active session.",
        );
      return result;
    },
    saveProfile: (input: ProfileInput) =>
      client.request<void>("/v1/profile", { input }),
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
    updateDiscovery: (discovery: Discovery) =>
      client.request<void>(
        `/v1/discoveries/${encodeURIComponent(discovery.id)}`,
        { discovery },
      ),
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
