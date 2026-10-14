import type { SupabaseClient, User } from "@supabase/supabase-js";
import type {
  CommentInput,
  Discovery,
  Field,
  Invitation,
  PortalState,
  Profile,
  ProfileInput,
  Role,
  Section,
  Stage,
  TopicId,
} from "../types";

type Row = Record<string, unknown>;
const string = (row: Row, key: string): string =>
  typeof row[key] === "string" ? (row[key] as string) : "";
const strings = <T extends string>(row: Row, key: string): T[] =>
  Array.isArray(row[key]) ? (row[key] as T[]) : [];
const optional = (row: Row, key: string) => string(row, key) || undefined;
function requireResult<T>(result: {
  data: T;
  error: { message: string } | null;
}): NonNullable<T> {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null || result.data === undefined)
    throw new Error("The server returned no data.");
  return result.data as NonNullable<T>;
}
async function write(
  request: PromiseLike<{ error: { message: string } | null }>,
): Promise<void> {
  const result = await request;
  if (result.error) throw new Error(result.error.message);
}

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

export function mapInvitation(row: Row): Invitation {
  return {
    id: string(row, "id"),
    topics: strings<TopicId>(row, "topics"),
    intendedEmail: string(row, "intended_email"),
    createdBy: optional(row, "created_by"),
    usedBy: optional(row, "used_by"),
    expiresAt: optional(row, "expires_at"),
    code: optional(row, "code"),
  };
}

/** All domain persistence is remote. RLS/RPC checks are the authority for access. */
export function createPortalRepository(client: SupabaseClient) {
  return {
    async read(
      authUser: User | null,
    ): Promise<{ state: PortalState; user: Profile | null }> {
      const [discoveryResult, commentResult, authorsResult] = await Promise.all(
        [
          client
            .from("discoveries")
            .select(
              "id,title,field,topic,status,summary,updated_at,version,review_note,sections,materials,illustrative",
            )
            .order("updated_at", { ascending: false }),
          client
            .from("comments")
            .select(
              "id,discovery_id,author_id,parent_id,version,reference,body,created_at",
            )
            .order("created_at"),
          client.rpc("get_public_authors"),
        ],
      );
      const state = emptyPortalState();
      state.discoveries = (requireResult(discoveryResult) as Row[]).map(
        (row): Discovery => ({
          id: string(row, "id"),
          title: string(row, "title"),
          field: string(row, "field") as Field,
          topic: string(row, "topic") as TopicId,
          status: string(row, "status") as Stage,
          summary: string(row, "summary"),
          updatedAt: string(row, "updated_at"),
          version: string(row, "version"),
          reviewNote: string(row, "review_note"),
          sections: row.sections as Section[],
          materials: row.materials as Discovery["materials"],
          illustrative: row.illustrative === true,
        }),
      );
      const authors = new Map(
        (requireResult(authorsResult) as Row[]).map((row) => [
          string(row, "id"),
          string(row, "full_name"),
        ]),
      );
      state.comments = (requireResult(commentResult) as Row[]).map((row) => ({
        id: string(row, "id"),
        discoveryId: string(row, "discovery_id"),
        authorId: string(row, "author_id"),
        authorName: authors.get(string(row, "author_id")) ?? "Researcher",
        parentId: optional(row, "parent_id") ?? null,
        version: string(row, "version"),
        reference: string(row, "reference"),
        body: string(row, "body"),
        createdAt: string(row, "created_at"),
      }));
      if (!authUser) return { state, user: null };
      const [
        profiles,
        roles,
        approved,
        assigned,
        applications,
        requests,
        invitations,
      ] = await Promise.all([
        client
          .from("profiles")
          .select(
            "id,full_name,affiliation,research_role,scholar_url,website,fields,expertise_topics,expertise_statement,evidence",
          ),
        client.from("user_roles").select("user_id,role"),
        client.from("reviewer_topics").select("user_id,topic_id"),
        client.from("approver_topics").select("user_id,topic_id"),
        client
          .from("reviewer_applications")
          .select(
            "id,user_id,topics,evidence,status,created_at,decided_by,decision_note",
          )
          .order("created_at", { ascending: false }),
        client
          .from("code_requests")
          .select("id,discovery_id,user_id,explanation,created_at")
          .order("created_at", { ascending: false }),
        client
          .from("invitations")
          .select(
            "id,created_by,topics,intended_email,expires_at,used_by,created_at",
          )
          .order("created_at", { ascending: false }),
      ]);
      const roleRows = requireResult(roles) as Row[];
      const approvedRows = requireResult(approved) as Row[];
      const assignedRows = requireResult(assigned) as Row[];
      state.profiles = (requireResult(profiles) as Row[]).map(
        (row): Profile => {
          const id = string(row, "id");
          const role =
            string(roleRows.find((r) => r.user_id === id) ?? {}, "role") ||
            "Reader";
          if (!["Reader", "Reviewer", "Approver", "Admin"].includes(role))
            throw new Error("The server returned an invalid account role.");
          return {
            id,
            fullName: string(row, "full_name"),
            email: id === authUser.id ? (authUser.email ?? "") : "",
            affiliation: string(row, "affiliation"),
            researchRole: string(row, "research_role"),
            scholarUrl: string(row, "scholar_url"),
            website: string(row, "website"),
            fields: strings<Field>(row, "fields"),
            expertiseTopics: strings<TopicId>(row, "expertise_topics"),
            expertiseStatement: string(row, "expertise_statement"),
            evidence: string(row, "evidence"),
            role: role as Role,
            approvedTopics: approvedRows
              .filter((r) => r.user_id === id)
              .map((r) => string(r, "topic_id") as TopicId),
            assignedTopics: assignedRows
              .filter((r) => r.user_id === id)
              .map((r) => string(r, "topic_id") as TopicId),
          };
        },
      );
      const user =
        state.profiles.find((profile) => profile.id === authUser.id) ?? null;
      if (!user)
        throw new Error(
          "Your account profile is unavailable. Check that the database migrations have been applied.",
        );
      if (!roleRows.some((row) => row.user_id === authUser.id))
        throw new Error(
          "Your account access record is unavailable. Contact the site administrator.",
        );
      state.applications = (requireResult(applications) as Row[]).map(
        (row) => ({
          id: string(row, "id"),
          userId: string(row, "user_id"),
          topics: strings<TopicId>(row, "topics"),
          evidence: string(row, "evidence"),
          status: string(row, "status") as "Pending" | "Approved" | "Declined",
          createdAt: string(row, "created_at"),
          decidedBy: optional(row, "decided_by"),
          decisionNote: optional(row, "decision_note"),
        }),
      );
      state.codeRequests = (requireResult(requests) as Row[]).map((row) => ({
        id: string(row, "id"),
        discoveryId: string(row, "discovery_id"),
        userId: string(row, "user_id"),
        explanation: string(row, "explanation"),
        createdAt: string(row, "created_at"),
      }));
      state.invitations = (requireResult(invitations) as Row[]).map(
        mapInvitation,
      );
      return { state, user };
    },
    async saveProfile(userId: string, input: ProfileInput): Promise<void> {
      const result = await client
        .from("profiles")
        .update({
          full_name: input.fullName,
          affiliation: input.affiliation,
          research_role: input.researchRole,
          scholar_url: input.scholarUrl,
          website: input.website,
          fields: input.fields,
          expertise_topics: input.expertiseTopics,
          expertise_statement: input.expertiseStatement,
          evidence: input.evidence,
        })
        .eq("id", userId)
        .select("id")
        .single();
      requireResult(result);
    },
    applyForReview: (userId: string, topics: TopicId[], evidence: string) =>
      write(
        client
          .from("reviewer_applications")
          .insert({ user_id: userId, topics, evidence }),
      ),
    reviewApplication: (id: string, approved: boolean, note: string) =>
      write(
        client.rpc("review_application", {
          p_application_id: id,
          p_approve: approved,
          p_note: note,
        }),
      ),
    async createInvitation(
      topics: TopicId[],
      email: string,
    ): Promise<Invitation> {
      return mapInvitation(
        requireResult(
          await client.rpc("create_invitation", {
            p_topics: topics,
            p_intended_email: email,
          }),
        ) as Row,
      );
    },
    async previewInvitation(code: string): Promise<Invitation> {
      return mapInvitation(
        requireResult(
          await client.rpc("preview_invitation", { p_code: code }),
        ) as Row,
      );
    },
    confirmInvitation: (code: string, topics: TopicId[]) =>
      write(
        client.rpc("accept_invitation", {
          p_code: code,
          p_confirmed_topics: topics,
        }),
      ),
    addComment: (userId: string, input: CommentInput) =>
      write(
        client
          .from("comments")
          .insert({
            discovery_id: input.discoveryId,
            author_id: userId,
            parent_id: input.parentId,
            version: input.version,
            reference: input.reference,
            body: input.body,
          }),
      ),
    requestCode: (userId: string, discoveryId: string, explanation: string) =>
      write(
        client
          .from("code_requests")
          .insert({ user_id: userId, discovery_id: discoveryId, explanation }),
      ),
    async updateDiscovery(discovery: Discovery): Promise<void> {
      const result = await client
        .from("discoveries")
        .update({
          title: discovery.title,
          field: discovery.field,
          topic: discovery.topic,
          status: discovery.status,
          summary: discovery.summary,
          version: discovery.version,
          review_note: discovery.reviewNote,
          sections: discovery.sections,
          materials: discovery.materials,
        })
        .eq("id", discovery.id)
        .select("id")
        .single();
      requireResult(result);
    },
    setAccess: (
      userId: string,
      role: Role,
      approved: TopicId[],
      assigned: TopicId[],
    ) =>
      write(
        client.rpc("set_account_access", {
          p_user_id: userId,
          p_role: role,
          p_approved_topics: approved,
          p_assigned_topics: assigned,
        }),
      ),
  };
}

export type PortalRepository = ReturnType<typeof createPortalRepository>;
