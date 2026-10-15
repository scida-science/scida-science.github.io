import type { ApiClient } from "../lib/api";
import { existingPackageFile, verifyPackageFile, type PackageDirectory } from "../lib/reviewerPackage";
import type {
  ActionResult,
  CommentInput,
  Discovery,
  DiscoveryUpdate,
  Invitation,
  PortalState,
  Profile,
  ProfileInput,
  Role,
  TopicId,
  ReviewerPackageFile,
} from "../types";
import { createGitHubAuth, type GitHubAuth } from "./auth";
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
  discoveryUpdateError,
  roles,
  validTopics,
} from "./validation";

export interface PortalSnapshot {
  state: PortalState;
  user: Profile | null;
  configured: boolean;
  loading: boolean;
  error: string | null;
}
export interface PortalDependencies {
  repository?: PortalRepository;
  auth?: GitHubAuth;
  navigate?: (url: string) => void;
  saveDownload?: (blob: Blob, filename: string) => void;
}
const reason = (error: unknown) =>
  error &&
  typeof error === "object" &&
  "message" in error &&
  typeof error.message === "string"
    ? error.message
    : "The SciDA service could not complete this request. Please try again.";
const bounded = (value: string, max: number) =>
  value.trim().length > 0 && value.length <= max;
function saveDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function createPortalService(
  client: ApiClient | null,
  configurationError: string | null = null,
  dependencies: PortalDependencies = {},
) {
  const repo =
    dependencies.repository ?? (client ? createPortalRepository(client) : null);
  const auth = dependencies.auth ?? (client ? createGitHubAuth(client) : null);
  const listeners = new Set<() => void>();
  let snapshot: PortalSnapshot = {
    state: emptyPortalState(),
    user: null,
    configured: !!client,
    loading: !!client,
    error: configurationError,
  };
  let revision = 0;
  let active = false;
  let initialized = false;
  let initializing: Promise<void> | null = null;
  let sessionGeneration = 0;
  let sessionRefreshPending = false;
  let sessionRefreshQueued = false;
  let clearingSession = false;
  let unsubscribe: (() => void) | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
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
        "Accounts and shared storage are not connected yet. The administrator must configure the SciDA API before this action is available.",
    );
  const changedAccount = (): ActionResult => ({
    ok: false,
    message:
      "The account changed while this request was running. Refresh to check its result.",
  });
  const captureSession = () => ({
    token: client?.getSession()?.token,
    generation: sessionGeneration,
  });
  const sessionChanged = (captured: ReturnType<typeof captureSession>) => {
    const token = client?.getSession()?.token;
    return captured.token !== token || captured.generation !== sessionGeneration;
  };
  function scheduleSessionRefresh() {
    if (!active || initializing || clearingSession || !sessionRefreshPending || sessionRefreshQueued) return;
    sessionRefreshQueued = true;
    queueMicrotask(() => {
      sessionRefreshQueued = false;
      if (!active || initializing || clearingSession || !sessionRefreshPending) return;
      void refresh();
    });
  }

  function scheduleExpiry() {
    clearTimeout(expiryTimer);
    const session = client?.getSession();
    if (session && active)
      expiryTimer = setTimeout(
        () => {
          client?.getSession();
          scheduleExpiry();
        },
        Math.min(
          Math.max(Date.parse(session.expiresAt) - Date.now(), 1),
          2_147_483_647,
        ),
      );
  }
  async function refresh(): Promise<ActionResult> {
    if (!client || !repo) return missingBackend();
    const captured = captureSession();
    // A storage read can notify subscribers synchronously. This request already
    // uses that latest session, so it consumes any refresh queued by the read.
    sessionRefreshPending = false;
    const request = ++revision;
    publish({ loading: true });
    try {
      const result = await repo.read();
      if (sessionChanged(captured) || request !== revision)
        return changedAccount();
      publish({ ...result, loading: false, error: null });
      scheduleExpiry();
      return { ok: true, message: "Research portal refreshed." };
    } catch (error) {
      if (sessionChanged(captured) || request !== revision) {
        return changedAccount();
      }
      publish({ state: emptyPortalState(), user: null, loading: false });
      return fail(reason(error));
    } finally {
      scheduleSessionRefresh();
    }
  }
  async function mutate(
    operation: (repository: PortalRepository) => Promise<unknown>,
    message: string,
  ): Promise<ActionResult> {
    if (!client || !repo) return missingBackend();
    const captured = captureSession();
    if (!snapshot.user || !captured.token)
      return fail("Sign in with GitHub to continue.");
    try {
      await operation(repo);
      if (sessionChanged(captured)) return changedAccount();
      const refreshed = await refresh();
      if (sessionChanged(captured)) return changedAccount();
      return {
        ok: true,
        message: refreshed.ok
          ? message
          : `${message} The latest data could not be loaded; refresh to check the result.`,
      };
    } catch (error) {
      if (sessionChanged(captured)) return changedAccount();
      return fail(reason(error));
    }
  }
  const refreshWhenVisible = () => {
    if (active && !snapshot.loading && document.visibilityState === "visible")
      void refresh();
  };

  const actions = {
    async loadFigure(discoveryId: string, figureId: string): Promise<Blob> {
      if (!repo) throw new Error("Evidence figures require connected account services.");
      return repo.loadFigure(discoveryId, figureId);
    },
    refresh,
    setFollowing(discoveryId: string, following: boolean): Promise<ActionResult> {
      if (!/^[A-Za-z0-9_-]+$/.test(discoveryId) || typeof following !== "boolean")
        return Promise.resolve(fail("Choose a discovery to follow."));
      return mutate(
        (repository) => repository.setFollowing(discoveryId, following),
        following ? "Discovery added to Following." : "Discovery removed from Following.",
      );
    },
    async signInWithGitHub(): Promise<ActionResult> {
      if (!client || !auth) return missingBackend();
      try {
        await auth.signIn();
        publish({ error: null });
        return { ok: true, message: "Redirecting to GitHub to sign in." };
      } catch (error) {
        return fail(reason(error));
      }
    },
    async signOut(): Promise<ActionResult> {
      if (!client) return missingBackend();
      let token: string | undefined;
      let removalError: string | null = null;
      // This action owns the one public refresh after local removal. External
      // account changes after this synchronous block still refresh immediately.
      clearingSession = true;
      try {
        token = client.getSession()?.token;
        ++revision;
        try {
          if (token) client.clearSession(token);
        } catch (error) {
          removalError = reason(error);
        }
        if (!client.getSession()) sessionRefreshPending = false;
        publish({ user: null, state: emptyPortalState(), loading: true, error: null });
      } finally {
        clearingSession = false;
        scheduleSessionRefresh();
      }
      const signedOut = captureSession();
      let revocationError: string | null = null;
      try {
        if (token) await client.request("/auth/logout", {}, { token });
      } catch (error) {
        revocationError = reason(error);
      }
      if (signedOut.token || sessionChanged(signedOut)) return changedAccount();
      const refreshed = await refresh();
      if (sessionChanged(signedOut)) return changedAccount();
      if (removalError || revocationError) {
        const details = [
          removalError ? `The saved browser session could not be removed: ${removalError}` : null,
          revocationError ? `Server revocation could not be confirmed: ${revocationError}` : null,
        ].filter(Boolean).join(" ");
        return fail(`Signed out of this ${removalError ? "tab" : "browser"}. ${details}`);
      }
      return {
        ok: true,
        message: refreshed.ok
          ? "Signed out. Your SciDA session has been revoked."
          : "Signed out. Your SciDA session has been revoked; public discoveries could not be refreshed.",
      };
    },
    saveProfile(input: ProfileInput): Promise<ActionResult> {
      const error = profileError(input);
      if (error) return Promise.resolve(fail(error));
      return mutate(
        (repository) => repository.saveProfile(cleanProfile(input)),
        "Research profile saved.",
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
        (repository) => repository.applyForReview(topics, evidence.trim()),
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
        (repository) => repository.reviewApplication(id, decision, note.trim()),
        "Reviewer application decision saved.",
      );
    },
    async createInvitation(
      topics: TopicId[],
      email: string,
    ): Promise<ActionResult & { code?: string }> {
      if (!repo || !client) return missingBackend();
      const captured = captureSession();
      const user = snapshot.user;
      if (!user || !captured.token) return fail("Sign in with GitHub to continue.");
      if (
        !validTopics(topics, true) ||
        !topics.every((topic) => canManageTopic(user, topic))
      )
        return fail("Choose topics within your assigned approval scope.");
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        email.length > 254
      )
        return fail("Enter the intended researcher's verified email address.");
      try {
        const invitation = await repo.createInvitation(topics, email.trim());
        if (sessionChanged(captured)) return changedAccount();
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
            "Invitation created. Share its code privately with the intended recipient.",
          code,
        };
      } catch (error) {
        if (sessionChanged(captured)) return changedAccount();
        return fail(reason(error));
      }
    },
    async previewInvitation(
      code: string,
    ): Promise<ActionResult & { invitation?: Invitation }> {
      if (!repo || !client) return missingBackend();
      const captured = captureSession();
      if (!snapshot.user || !captured.token)
        return fail("Sign in with GitHub before entering an invitation.");
      if (!bounded(code, 200)) return fail("Enter a valid invitation code.");
      try {
        const invitation = await repo.previewInvitation(code.trim());
        if (sessionChanged(captured)) return changedAccount();
        publish({ error: null });
        return {
          ok: true,
          message:
            "Review the intended scope, then explicitly confirm every topic to accept.",
          invitation,
        };
      } catch (error) {
        if (sessionChanged(captured)) return changedAccount();
        return fail(reason(error));
      }
    },
    confirmInvitation(code: string, topics: TopicId[]): Promise<ActionResult> {
      if (!bounded(code, 200) || !validTopics(topics, true))
        return Promise.resolve(
          fail("Enter an invitation and confirm its exact topic scope."),
        );
      return mutate(
        (repository) => repository.confirmInvitation(code.trim(), topics),
        "Invitation accepted. The approved review topics are now attached to your account.",
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
        (repository) =>
          repository.addComment({
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
        (repository) => repository.requestCode(discoveryId, explanation.trim()),
        "Code request recorded for the site administrator.",
      );
    },
    updateDiscovery(discovery: DiscoveryUpdate): Promise<ActionResult> {
      if (snapshot.user?.role !== "Admin")
        return Promise.resolve(
          fail(
            "Only the administrator can edit discoveries or change their status.",
          ),
        );
      const current = snapshot.state.discoveries.find((item) => item.id === discovery.id);
      if (!current) return Promise.resolve(fail("Refresh the discovery before editing."));
      const error = discoveryUpdateError(discovery, current);
      if (error) return Promise.resolve(fail(error));
      return mutate(
        (repository) => repository.updateDiscovery(discovery),
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
            "Only the administrator can manage access or appoint Senior Reviewers.",
          ),
        );
      if (role === "Admin")
        return Promise.resolve(
          fail(
            "Administrator access is controlled by the server configuration.",
          ),
        );
      if (!roles.includes(role))
        return Promise.resolve(fail("Choose Reader, Reviewer, or Senior Reviewer."));
      if (!validTopics(approved) || !validTopics(assigned))
        return Promise.resolve(fail("Choose recognized research topics."));
      return mutate(
        (repository) => repository.setAccess(userId, role, approved, assigned),
        "Account access updated.",
      );
    },
    async downloadMaterial(
      discoveryId: string,
      kind: keyof Discovery["materials"],
    ): Promise<ActionResult> {
      if (!client || !repo) return missingBackend();
      const captured = captureSession();
      if (
        !["paper", "appendix", "figures", "data", "repository"].includes(kind)
      )
        return fail("This supporting material is unavailable.");
      try {
        const material = await repo.downloadMaterial(discoveryId, kind);
        if (sessionChanged(captured)) return changedAccount();
        if (material.package) {
          publish({ error: null });
          return { ok: true, message: "The complete analysis package is ready to download.", package: material.package };
        }
        if (material.url)
          (
            dependencies.navigate ??
            ((url: string) => window.location.assign(url))
          )(material.url);
        else if (material.blob)
          (dependencies.saveDownload ?? saveDownload)(
            material.blob,
            material.filename ?? `${discoveryId}-${kind}`,
          );
        else
          throw new Error(
            "The material response did not contain a file or link.",
          );
        publish({ error: null });
        return {
          ok: true,
          message: material.url
            ? "Opening the supporting material."
            : "Supporting material downloaded.",
        };
      } catch (error) {
        if (sessionChanged(captured)) return changedAccount();
        return fail(reason(error));
      }
    },
    async downloadPackageFile(discoveryId: string, kind: keyof Discovery["materials"], file: ReviewerPackageFile,
      directory?: PackageDirectory): Promise<ActionResult> {
      if (!client || !repo) return missingBackend();
      const captured = captureSession();
      if (!/^[a-z0-9-]{1,64}$/.test(file.id) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(file.filename) ||
          file.filename.includes("..") || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 100 * 1024 * 1024)
        return fail("Invalid package file.");
      try {
        // Obtain current authorization even when a matching file already exists locally.
        const result = await client.download(`/v1/discoveries/${encodeURIComponent(discoveryId)}/materials/${encodeURIComponent(kind)}/files/${encodeURIComponent(file.id)}`,
          { maxBytes: file.size });
        if (sessionChanged(captured)) return changedAccount();
        if (!result.blob) throw new Error("The package file response is invalid.");
        await verifyPackageFile(result.blob, file);
        if (sessionChanged(captured)) return changedAccount();
        if (directory) {
          if (!(await existingPackageFile(directory, file))) {
            const handle = await directory.getFileHandle(file.filename, { create: true });
            const writer = await handle.createWritable();
            try { await writer.write(result.blob); await writer.close(); }
            catch (error) { await writer.abort(); throw error; }
          }
        } else (dependencies.saveDownload ?? saveDownload)(result.blob, file.filename);
        publish({ error: null });
        return { ok: true, message: `Verified and saved ${file.filename}.` };
      } catch (error) {
        if (sessionChanged(captured)) return changedAccount();
        return fail(reason(error));
      }
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
      if (!client || !auth) return Promise.resolve();
      active = true;
      unsubscribe ??= client.subscribeSession(() => {
        ++revision;
        ++sessionGeneration;
        sessionRefreshPending = true;
        publish({
          user: null,
          state: emptyPortalState(),
          loading: false,
          error: client.getSession()
            ? null
            : "Your SciDA session ended. Sign in with GitHub to continue.",
        });
        scheduleExpiry();
        scheduleSessionRefresh();
      });
      if (!refreshTimer) {
        refreshTimer = setInterval(refreshWhenVisible, 120_000);
        window.addEventListener("focus", refreshWhenVisible);
        document.addEventListener("visibilitychange", refreshWhenVisible);
      }
      if (initializing) return initializing;
      if (initialized) return refresh().then(() => undefined);
      initializing = (async () => {
        try {
          await auth.completeCallback();
          if (active) await refresh();
        } catch (error) {
          if (active) {
            publish({ user: null, state: emptyPortalState(), loading: false });
            fail(reason(error));
          }
        } finally {
          initialized = true;
          initializing = null;
          scheduleSessionRefresh();
        }
      })();
      return initializing;
    },
    stop() {
      active = false;
      ++revision;
      sessionRefreshPending = false;
      unsubscribe?.();
      unsubscribe = undefined;
      clearTimeout(expiryTimer);
      clearInterval(refreshTimer);
      refreshTimer = undefined;
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    },
    actions,
  };
}
export type PortalService = ReturnType<typeof createPortalService>;
