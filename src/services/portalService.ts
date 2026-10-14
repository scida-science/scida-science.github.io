import type { SupabaseClient } from "@supabase/supabase-js";
import { discoveries } from "../data/discoveries";
import { authRedirectUrl } from "../lib/supabase";
import type {
  ActionResult,
  CommentInput,
  Discovery,
  Invitation,
  PortalState,
  Profile,
  ProfileInput,
  Role,
  TopicId,
} from "../types";
import {
  clearRecoveryMarker,
  completeAuthCallback,
  verifiedAuthUser,
} from "./auth";
import {
  canDiscuss,
  canManageTopic,
  canReviewApplication,
} from "./permissions";
import {
  createPortalRepository,
  emptyPortalState,
  type PortalRepository,
} from "./repository";
import {
  cleanProfile,
  profileError,
  validDiscovery,
  validTopics,
} from "./validation";

export interface PortalSnapshot {
  state: PortalState;
  user: Profile | null;
  configured: boolean;
  loading: boolean;
  error: string | null;
  recoveryMode: boolean;
}

const reason = (error: unknown) =>
  error &&
  typeof error === "object" &&
  "message" in error &&
  typeof error.message === "string"
    ? error.message
    : "The server could not complete this request. Please try again.";
const bounded = (value: string, max: number) =>
  value.trim().length > 0 && value.length <= max;

export function createPortalService(
  client: SupabaseClient | null,
  configurationError: string | null = null,
  repository?: PortalRepository,
) {
  const repo = repository ?? (client ? createPortalRepository(client) : null);
  const listeners = new Set<() => void>();
  let snapshot: PortalSnapshot = {
    state: client
      ? emptyPortalState()
      : { ...emptyPortalState(), discoveries: structuredClone(discoveries) },
    user: null,
    configured: !!client,
    loading: !!client,
    error: configurationError,
    recoveryMode: false,
  };
  let revision = 0;
  let active = false;
  let initialized = false;
  let initialization: Promise<void> | null = null;
  let subscription: { unsubscribe: () => void } | undefined;
  let initializing = false;
  const publish = (patch: Partial<PortalSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };
  const fail = (message: string): ActionResult => {
    publish({ error: message });
    return { ok: false, message };
  };
  const missingBackend = () =>
    fail(
      configurationError ??
        "Accounts and shared storage are not configured. The administrator must connect Supabase before this action is available.",
    );
  const clearPrivate = () => ({
    ...emptyPortalState(),
    discoveries: snapshot.state.discoveries,
    comments: snapshot.state.comments,
  });

  async function refresh(): Promise<ActionResult> {
    if (!client || !repo) return missingBackend();
    const request = ++revision;
    publish({ loading: true });
    try {
      const authUser = await verifiedAuthUser(client);
      if (request !== revision)
        return {
          ok: false,
          message: "The account changed while data was loading.",
        };
      if (snapshot.user?.id !== authUser?.id)
        publish({ user: null, state: clearPrivate() });
      const result = await repo.read(authUser);
      if (request !== revision)
        return {
          ok: false,
          message:
            "The account changed while data was loading. Please try again.",
        };
      publish({
        ...result,
        loading: false,
        error: null,
        recoveryMode: !!authUser && snapshot.recoveryMode,
      });
      return { ok: true, message: "Data refreshed from Supabase." };
    } catch (error) {
      if (request !== revision)
        return {
          ok: false,
          message: "The account changed while data was loading.",
        };
      publish({ state: emptyPortalState(), user: null, loading: false });
      return fail(reason(error));
    }
  }

  async function mutate(
    operation: (user: Profile, repository: PortalRepository) => Promise<void>,
    message: string,
  ): Promise<ActionResult> {
    if (!client || !repo) return missingBackend();
    const user = snapshot.user;
    if (!user) return fail("Sign in with a verified account to continue.");
    const request = revision;
    try {
      await operation(user, repo);
      if (request !== revision && snapshot.user?.id !== user.id)
        return {
          ok: false,
          message:
            "Your account changed during this request. Refresh to check its result.",
        };
      const refreshed = await refresh();
      return {
        ok: true,
        message: refreshed.ok
          ? message
          : `${message} The latest data could not be loaded; refresh to check the result.`,
      };
    } catch (error) {
      return fail(reason(error));
    }
  }

  const actions = {
    refresh,
    async signIn(email: string, password: string): Promise<ActionResult> {
      if (!client) return missingBackend();
      ++revision;
      publish({
        user: null,
        state: clearPrivate(),
        error: null,
        loading: true,
      });
      try {
        const result = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (result.error) throw result.error;
        const loaded = await refresh();
        return loaded.ok ? { ok: true, message: "Signed in." } : loaded;
      } catch (error) {
        publish({ loading: false });
        return fail(reason(error));
      }
    },
    async signUp(
      email: string,
      password: string,
      fullName: string,
    ): Promise<ActionResult> {
      if (!client) return missingBackend();
      if (!bounded(fullName, 120))
        return fail("Enter your full name (up to 120 characters).");
      try {
        const result = await client.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: authRedirectUrl(),
            data: { full_name: fullName.trim() },
          },
        });
        if (result.error) throw result.error;
        if (result.data.session) await refresh();
        else publish({ error: null });
        return {
          ok: true,
          message:
            "Check your email to confirm your account. Open the confirmation link in this same browser, then sign in.",
        };
      } catch (error) {
        return fail(reason(error));
      }
    },
    async signOut(): Promise<ActionResult> {
      if (!client) return missingBackend();
      ++revision;
      publish({
        user: null,
        state: emptyPortalState(),
        recoveryMode: false,
        loading: true,
        error: null,
      });
      clearRecoveryMarker();
      try {
        const result = await client.auth.signOut({ scope: "local" });
        if (result.error) throw result.error;
        await refresh();
        return { ok: true, message: "Signed out of this browser." };
      } catch (error) {
        publish({ loading: false });
        return fail(reason(error));
      }
    },
    async requestPasswordReset(email: string): Promise<ActionResult> {
      if (!client) return missingBackend();
      try {
        const result = await client.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: authRedirectUrl(true),
        });
        if (result.error) throw result.error;
        publish({ error: null });
        return {
          ok: true,
          message:
            "If this address has an account, a recovery email will arrive. Open its link in this same browser.",
        };
      } catch (error) {
        return fail(reason(error));
      }
    },
    async updatePassword(password: string): Promise<ActionResult> {
      if (!client) return missingBackend();
      if (!snapshot.user || !snapshot.recoveryMode)
        return fail(
          "Open a valid recovery email link before choosing a new password.",
        );
      try {
        const result = await client.auth.updateUser({ password });
        if (result.error) throw result.error;
        clearRecoveryMarker();
        publish({ recoveryMode: false, error: null });
        return { ok: true, message: "Password updated." };
      } catch (error) {
        return fail(reason(error));
      }
    },
    saveProfile(input: ProfileInput): Promise<ActionResult> {
      const error = profileError(input);
      if (error) return Promise.resolve(fail(error));
      return mutate(
        (user, repository) =>
          repository.saveProfile(user.id, cleanProfile(input)),
        "Profile saved to Supabase.",
      );
    },
    applyForReview(topics: TopicId[], evidence: string): Promise<ActionResult> {
      if (
        !validTopics(topics, true) ||
        evidence.trim().length < 10 ||
        !bounded(evidence, 6000)
      )
        return Promise.resolve(
          fail(
            "Choose at least one topic and provide relevant evidence (10–6,000 characters).",
          ),
        );
      return mutate(
        (user, repository) =>
          repository.applyForReview(user.id, topics, evidence.trim()),
        "Reviewer application submitted.",
      );
    },
    reviewApplication(
      id: string,
      decision: "Approved" | "Declined",
      note: string,
    ): Promise<ActionResult> {
      const application = snapshot.state.applications.find(
        (item) => item.id === id,
      );
      if (!application || !canReviewApplication(snapshot.user, application))
        return Promise.resolve(
          fail(
            "You cannot decide this application within your assigned scope.",
          ),
        );
      if (note.length > 2000)
        return Promise.resolve(
          fail("Keep the decision note under 2,000 characters."),
        );
      return mutate(
        (_user, repository) =>
          repository.reviewApplication(
            id,
            decision === "Approved",
            note.trim(),
          ),
        "Reviewer application decision saved.",
      );
    },
    async createInvitation(
      topics: TopicId[],
      email: string,
    ): Promise<ActionResult & { code?: string }> {
      if (!repo || !client) return missingBackend();
      const user = snapshot.user;
      if (!user) return fail("Sign in with a verified account to continue.");
      if (
        !validTopics(topics, true) ||
        !topics.every((topic) => canManageTopic(snapshot.user, topic))
      )
        return fail("Choose topics within your assigned approval scope.");
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        email.length > 254
      )
        return fail("Enter the intended researcher's email address.");
      const request = revision;
      try {
        const invitation = await repo.createInvitation(topics, email.trim());
        if (request !== revision && snapshot.user?.id !== user.id)
          return fail(
            "The account changed after creating the invitation. Sign in and create a new invitation if needed.",
          );
        // Return the one-time code before any secondary reload can fail or unmount
        // its form. The cache includes only confirmed server fields, never the code.
        const { code, ...record } = invitation;
        if (!code)
          throw new Error(
            "The server did not return the invitation code. Create a new invitation.",
          );
        publish({
          state: {
            ...snapshot.state,
            invitations: [
              ...snapshot.state.invitations,
              { ...record, createdBy: user.id },
            ],
          },
          error: null,
        });
        return {
          ok: true,
          message:
            "Invitation created. Share the code privately with its intended recipient.",
          code,
        };
      } catch (error) {
        return fail(reason(error));
      }
    },
    async previewInvitation(
      code: string,
    ): Promise<ActionResult & { invitation?: Invitation }> {
      if (!repo || !client) return missingBackend();
      if (!snapshot.user)
        return fail(
          "Sign in with your verified email address before entering an invitation.",
        );
      if (!bounded(code, 200)) return fail("Enter a valid invitation code.");
      const request = revision;
      try {
        const invitation = await repo.previewInvitation(code.trim());
        if (request !== revision)
          return fail("Your account changed. Enter the invitation again.");
        publish({ error: null });
        return {
          ok: true,
          message:
            "Review the intended scope, then explicitly confirm every topic to accept.",
          invitation,
        };
      } catch (error) {
        return fail(reason(error));
      }
    },
    confirmInvitation(code: string, topics: TopicId[]): Promise<ActionResult> {
      if (!bounded(code, 200) || !validTopics(topics, true))
        return Promise.resolve(
          fail("Enter an invitation and confirm its exact topic scope."),
        );
      return mutate(
        (_user, repository) =>
          repository.confirmInvitation(code.trim(), topics),
        "Invitation accepted. Approved review topics are now attached to your account.",
      );
    },
    addComment(input: CommentInput): Promise<ActionResult> {
      const discovery = snapshot.state.discoveries.find(
        (item) => item.id === input.discoveryId,
      );
      if (!discovery || !canDiscuss(snapshot.user, discovery))
        return Promise.resolve(
          fail(
            "Discussion requires reviewer approval for this discovery's topic.",
          ),
        );
      if (
        input.body.trim().length < 3 ||
        !bounded(input.body, 6000) ||
        input.reference.length > 250
      )
        return Promise.resolve(
          fail(
            "Write a comment (3–6,000 characters) and a reference of at most 250 characters.",
          ),
        );
      return mutate(
        (user, repository) =>
          repository.addComment(user.id, {
            ...input,
            body: input.body.trim(),
            reference: input.reference.trim(),
          }),
        "Discussion contribution saved.",
      );
    },
    requestCode(
      discoveryId: string,
      explanation: string,
    ): Promise<ActionResult> {
      if (!bounded(explanation, 2000))
        return Promise.resolve(
          fail("Explain your request in 1–2,000 characters."),
        );
      return mutate(
        (user, repository) =>
          repository.requestCode(user.id, discoveryId, explanation.trim()),
        "Code request recorded for the site administrator.",
      );
    },
    updateDiscovery(discovery: Discovery): Promise<ActionResult> {
      if (snapshot.user?.role !== "Admin")
        return Promise.resolve(
          fail(
            "Only the administrator can edit discoveries or change their status.",
          ),
        );
      if (!validDiscovery(discovery))
        return Promise.resolve(
          fail(
            "Complete the discovery fields and use valid HTTP or HTTPS material URLs.",
          ),
        );
      return mutate(
        (_user, repository) => repository.updateDiscovery(discovery),
        "Discovery updated.",
      );
    },
    setAccess(
      userId: string,
      role: Role,
      approved: TopicId[],
      assigned: TopicId[],
    ): Promise<ActionResult> {
      if (snapshot.user?.role !== "Admin")
        return Promise.resolve(
          fail(
            "Only the administrator can manage access or appoint approvers.",
          ),
        );
      if (role === "Admin")
        return Promise.resolve(
          fail(
            "Administrator access can only be established through the controlled database procedure.",
          ),
        );
      if (!validTopics(approved) || !validTopics(assigned))
        return Promise.resolve(fail("Choose recognized research topics."));
      return mutate(
        (_user, repository) =>
          repository.setAccess(userId, role, approved, assigned),
        "Account access updated.",
      );
    },
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start(): Promise<void> {
      if (!client) return Promise.resolve();
      active = true;
      subscription ??= client.auth.onAuthStateChange((event) => {
        // Never await Supabase calls inside this callback: the auth lock may be held.
        if (initializing || event === "INITIAL_SESSION") return;
        ++revision;
        publish({
          user: null,
          state: clearPrivate(),
          loading: true,
          recoveryMode:
            event === "PASSWORD_RECOVERY" ||
            (event !== "SIGNED_OUT" && snapshot.recoveryMode),
        });
        queueMicrotask(() => {
          if (active) void refresh();
        });
      }).data.subscription;
      if (initialization) return initialization;
      if (initialized) return refresh().then(() => undefined);
      initializing = true;
      initialization = (async () => {
        try {
          const recoveryMode = await completeAuthCallback(client);
          if (active) {
            publish({ recoveryMode });
            await refresh();
          }
        } catch (error) {
          if (active) {
            publish({ state: emptyPortalState(), user: null, loading: false });
            fail(reason(error));
          }
        } finally {
          initializing = false;
          initialized = true;
          initialization = null;
        }
      })();
      return initialization;
    },
    stop() {
      active = false;
      subscription?.unsubscribe();
      subscription = undefined;
      ++revision;
    },
    actions,
  };
}

export type PortalService = ReturnType<typeof createPortalService>;
