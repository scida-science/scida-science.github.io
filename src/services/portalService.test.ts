// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AuthChangeEvent,
  SupabaseClient,
  User,
} from "@supabase/supabase-js";
import { discoveries } from "../data/discoveries";
import { parseBackendConfiguration } from "../lib/supabase";
import type { Profile } from "../types";
import { canDiscuss } from "./permissions";
import { createPortalService } from "./portalService";
import {
  createPortalRepository,
  emptyPortalState,
  type PortalRepository,
} from "./repository";

const account = {
  id: "verified-user",
  email: "researcher@example.org",
  email_confirmed_at: "2026-01-01",
  user_metadata: { role: "Admin" },
} as unknown as User;
function profile(role: Profile["role"] = "Reader"): Profile {
  return {
    id: account.id,
    fullName: "Verified researcher",
    email: account.email!,
    affiliation: "",
    researchRole: "",
    scholarUrl: "",
    website: "",
    fields: ["Artificial Intelligence"],
    expertiseTopics: ["bandit-theory"],
    expertiseStatement: "",
    evidence: "",
    role,
    approvedTopics: [],
    assignedTopics: [],
  };
}
function setup(role: Profile["role"] = "Reader") {
  let signedIn = true;
  let event: ((event: AuthChangeEvent) => void) | undefined;
  const auth = {
    getSession: vi.fn(async () => ({
      data: { session: signedIn ? { user: account } : null },
      error: null,
    })),
    getUser: vi.fn(async () => ({ data: { user: account }, error: null })),
    signInWithPassword: vi.fn(async () => ({
      data: { user: account },
      error: null as { message: string } | null,
    })),
    signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
    signOut: vi.fn(async () => {
      signedIn = false;
      event?.("SIGNED_OUT");
      return { error: null };
    }),
    resetPasswordForEmail: vi.fn(async () => ({ error: null })),
    updateUser: vi.fn(async () => ({ error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ error: null })),
    onAuthStateChange: vi.fn((callback: (event: AuthChangeEvent) => void) => {
      event = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
  };
  const repository = {
    read: vi.fn(async (user: User | null) => ({
      state: {
        ...emptyPortalState(),
        discoveries: structuredClone(discoveries),
        profiles: user ? [profile(role)] : [],
      },
      user: user ? profile(role) : null,
    })),
    saveProfile: vi.fn(async () => undefined),
    applyForReview: vi.fn(async () => undefined),
    reviewApplication: vi.fn(async () => undefined),
    createInvitation: vi.fn(async () => ({
      id: "invitation",
      topics: ["bandit-theory" as const],
      intendedEmail: account.email!,
      code: "single-use-code",
    })),
    previewInvitation: vi.fn(async () => ({
      id: "invitation",
      topics: ["bandit-theory" as const],
      intendedEmail: account.email!,
    })),
    confirmInvitation: vi.fn(async () => undefined),
    addComment: vi.fn(async () => undefined),
    requestCode: vi.fn(async () => undefined),
    updateDiscovery: vi.fn(async () => undefined),
    setAccess: vi.fn(async () => undefined),
  } satisfies PortalRepository;
  const client = { auth } as unknown as SupabaseClient;
  const service = createPortalService(client, null, repository);
  return {
    auth,
    repository,
    service,
    emit: (value: AuthChangeEvent) => event?.(value),
    signOutExternally: () => {
      signedIn = false;
      event?.("SIGNED_OUT");
    },
  };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  localStorage.clear();
});

describe("frontend configuration", () => {
  it("accepts publishable and legacy anon keys, rejects privileged keys", () => {
    const jwt = (role: string) =>
      `e30.${btoa(JSON.stringify({ role }))}.signature`;
    expect(
      parseBackendConfiguration(
        "https://project.supabase.co",
        "sb_publishable_example",
      ).configuration,
    ).not.toBeNull();
    expect(
      parseBackendConfiguration("http://127.0.0.1:54321", jwt("anon"))
        .configuration,
    ).not.toBeNull();
    for (const key of [
      "sb_secret_example",
      jwt("service_role"),
      jwt("authenticated"),
      "invalid-key",
    ])
      expect(
        parseBackendConfiguration("https://project.supabase.co", key)
          .configuration,
      ).toBeNull();
    expect(
      parseBackendConfiguration(
        "http://project.supabase.co",
        "sb_publishable_example",
      ).configuration,
    ).toBeNull();
    expect(
      parseBackendConfiguration("https://project.supabase.co", undefined).error,
    ).toBeTruthy();
  });
  it("provides only read-only examples when configuration is missing", async () => {
    localStorage.setItem(
      "scida.demo.v1",
      JSON.stringify({ activeUserId: "admin", role: "Admin" }),
    );
    const service = createPortalService(null);
    await service.start();
    expect(service.getSnapshot().state.discoveries).toHaveLength(6);
    expect(service.getSnapshot().user).toBeNull();
    expect(service.getSnapshot().state.profiles).toEqual([]);
    expect(service.getSnapshot().state.comments).toEqual([]);
    expect(
      (await service.actions.signIn("email@example.org", "password")).ok,
    ).toBe(false);
    expect(
      (await service.actions.requestCode(discoveries[0].id, "Research request"))
        .ok,
    ).toBe(false);
  });
});

describe("real authentication and loading boundaries", () => {
  it("uses verified server identity and never user metadata for role", async () => {
    const { service, auth } = setup();
    await service.start();
    expect(auth.getUser).toHaveBeenCalled();
    expect(service.getSnapshot().user?.role).toBe("Reader");
    expect(
      (
        await service.actions.setAccess(
          account.id,
          "Approver",
          [],
          ["bandit-theory"],
        )
      ).ok,
    ).toBe(false);
  });
  it("reports authentication failure without a fake successful session", async () => {
    const { service, auth } = setup();
    await service.start();
    auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: account },
      error: { message: "Invalid login credentials" },
    });
    const result = await service.actions.signIn("bad@example.org", "incorrect");
    expect(result).toEqual({ ok: false, message: "Invalid login credentials" });
    expect(service.getSnapshot().user).toBeNull();
    expect(service.getSnapshot().state.profiles).toEqual([]);
    expect(service.getSnapshot().loading).toBe(false);
  });
  it("never falls back to placeholder data after a configured backend fails", async () => {
    const { service, repository } = setup();
    repository.read.mockRejectedValueOnce(
      new Error("Database migration missing"),
    );
    await service.start();
    expect(service.getSnapshot().state.discoveries).toEqual([]);
    expect(service.getSnapshot().error).toBe("Database migration missing");
  });
  it("completes sign-in when the SDK emits an auth event during the request", async () => {
    const { service, auth, emit } = setup();
    await service.start();
    auth.signInWithPassword.mockImplementationOnce(async () => {
      emit("SIGNED_IN");
      return { data: { user: account }, error: null };
    });
    const result = await service.actions.signIn(account.email!, "a-password");
    expect(result.ok).toBe(true);
    expect(service.getSnapshot().user?.id).toBe(account.id);
    expect(service.getSnapshot().loading).toBe(false);
  });
  it("erases roles and private data immediately at logout", async () => {
    const { service, signOutExternally } = setup("Admin");
    await service.start();
    expect(service.getSnapshot().user?.role).toBe("Admin");
    signOutExternally();
    expect(service.getSnapshot().user).toBeNull();
    expect(service.getSnapshot().state.profiles).toEqual([]);
    expect(service.getSnapshot().state.applications).toEqual([]);
    expect((await service.actions.updateDiscovery(discoveries[0])).ok).toBe(
      false,
    );
    service.stop();
  });
  it("reloads revoked review topics from the server on refresh", async () => {
    const { service, repository } = setup("Reviewer");
    const approved = {
      ...profile("Reviewer"),
      approvedTopics: ["bandit-theory" as const],
    };
    repository.read.mockResolvedValueOnce({
      state: { ...emptyPortalState(), discoveries, profiles: [approved] },
      user: approved,
    });
    await service.start();
    const discovery = discoveries.find(
      (item) => item.topic === "bandit-theory",
    )!;
    expect(canDiscuss(service.getSnapshot().user, discovery)).toBe(true);
    await service.actions.refresh();
    expect(canDiscuss(service.getSnapshot().user, discovery)).toBe(false);
  });
  it("discards a slow previous account response after sign-out", async () => {
    const { service, repository, signOutExternally } = setup("Admin");
    await service.start();
    let finish:
      | ((value: Awaited<ReturnType<PortalRepository["read"]>>) => void)
      | undefined;
    repository.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const refresh = service.actions.refresh();
    await vi.waitFor(() => expect(finish).toBeDefined());
    signOutExternally();
    finish!({
      state: { ...emptyPortalState(), profiles: [profile("Admin")] },
      user: profile("Admin"),
    });
    await refresh;
    await vi.waitFor(() => expect(service.getSnapshot().loading).toBe(false));
    expect(service.getSnapshot().user).toBeNull();
    expect(service.getSnapshot().state.profiles).toEqual([]);
    service.stop();
  });
  it("exchanges a recovery code once across StrictMode effect restarts", async () => {
    window.history.replaceState(
      null,
      "",
      "/?code=email-code&recovery=1#/profile",
    );
    const { service, auth } = setup();
    const first = service.start();
    service.stop();
    const second = service.start();
    await Promise.all([first, second]);
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("?recovery=1");
    expect(window.location.hash).toBe("#/profile");
    expect(service.getSnapshot().recoveryMode).toBe(true);
    expect((await service.actions.updatePassword("new-long-password")).ok).toBe(
      true,
    );
    expect(window.location.search).toBe("");
    expect(service.getSnapshot().recoveryMode).toBe(false);
  });
  it("requires an authenticated recovery session before password updates", async () => {
    const { service, auth } = setup();
    await service.start();
    expect((await service.actions.updatePassword("new-password")).ok).toBe(
      false,
    );
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it("surfaces an expired email-link error returned in the URL fragment", async () => {
    window.history.replaceState(
      null,
      "",
      "/#error=access_denied&error_description=Email+link+expired",
    );
    const { service, auth } = setup();
    await service.start();
    expect(service.getSnapshot().error).toBe("Email link expired");
    expect(service.getSnapshot().user).toBeNull();
    expect(window.location.hash).toBe("#/login");
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});

describe("server-backed writes", () => {
  it("surfaces RLS rejections and does not update local domain data", async () => {
    const { service, repository } = setup();
    await service.start();
    repository.requestCode.mockRejectedValueOnce(
      new Error("new row violates row-level security policy"),
    );
    const result = await service.actions.requestCode(
      discoveries[0].id,
      "Please provide the analysis code.",
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/row-level security/);
    expect(service.getSnapshot().state.codeRequests).toEqual([]);
  });
  it("strips injected role, account, email and grants from profile payloads", async () => {
    const { service, repository } = setup();
    await service.start();
    const result = await service.actions.saveProfile({
      ...profile("Admin"),
      fullName: "  Researcher  ",
      approvedTopics: ["bandit-theory"],
    } as Profile);
    expect(result.ok).toBe(true);
    const payload = repository.saveProfile.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(payload[0]).toBe(account.id);
    expect(payload[1].fullName).toBe("Researcher");
    expect(payload[1]).not.toHaveProperty("role");
    expect(payload[1]).not.toHaveProperty("email");
    expect(payload[1]).not.toHaveProperty("approvedTopics");
  });
  it("previews invitations without granting reviewer access", async () => {
    const { service, repository } = setup();
    await service.start();
    expect(
      (await service.actions.previewInvitation("code")).invitation?.topics,
    ).toEqual(["bandit-theory"]);
    expect(service.getSnapshot().user?.role).toBe("Reader");
    expect(repository.confirmInvitation).not.toHaveBeenCalled();
    expect((await service.actions.confirmInvitation("code", [])).ok).toBe(
      false,
    );
    expect(
      (await service.actions.confirmInvitation("code", ["bandit-theory"])).ok,
    ).toBe(true);
    expect(repository.confirmInvitation).toHaveBeenCalledWith("code", [
      "bandit-theory",
    ]);
  });
  it("returns a created invitation code once without depending on a second network read", async () => {
    const { service, repository } = setup("Admin");
    await service.start();
    repository.read.mockRejectedValueOnce(
      new Error("Connection lost after write"),
    );
    const result = await service.actions.createInvitation(
      ["bandit-theory"],
      account.email!,
    );
    expect(result.ok).toBe(true);
    expect(result.code).toBe("single-use-code");
    expect(repository.read).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().state.invitations[0].code).toBeUndefined();
    expect(service.getSnapshot().user?.role).toBe("Admin");
  });
  it("keeps discussion approval topic-specific, including administrators", () => {
    const bandit = discoveries.find((item) => item.topic === "bandit-theory")!;
    const astronomy = discoveries.find((item) => item.field === "Astronomy")!;
    const reviewer = {
      ...profile("Reviewer"),
      approvedTopics: ["bandit-theory" as const],
    };
    expect(canDiscuss(reviewer, bandit)).toBe(true);
    expect(canDiscuss(reviewer, astronomy)).toBe(false);
    expect(canDiscuss(profile("Admin"), bandit)).toBe(false);
  });
});

describe("database adapter", () => {
  it("maps public author names without exposing profile email or trusting metadata", async () => {
    const rows: Record<string, unknown[]> = {
      discoveries: [],
      comments: [{ id: "comment", author_id: account.id }],
      profiles: [
        { id: account.id, full_name: "Researcher" },
        { id: "another", full_name: "Another researcher" },
      ],
      user_roles: [
        { user_id: account.id, role: "Reader" },
        { user_id: "another", role: "Reviewer" },
      ],
      reviewer_topics: [],
      approver_topics: [],
      reviewer_applications: [],
      code_requests: [],
      invitations: [],
    };
    const client = {
      from(table: string) {
        const query = {
          select: () => query,
          order: () => Promise.resolve({ data: rows[table], error: null }),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: rows[table], error: null }).then(resolve),
        };
        return query;
      },
      rpc: vi.fn(async () => ({
        data: [{ id: account.id, full_name: "Researcher" }],
        error: null,
      })),
    } as unknown as SupabaseClient;
    const result = await createPortalRepository(client).read(account);
    expect(result.user?.role).toBe("Reader");
    expect(result.user?.email).toBe(account.email);
    expect(result.state.profiles.find((p) => p.id === "another")?.email).toBe(
      "",
    );
    expect(result.state.comments[0].authorName).toBe("Researcher");
    expect(client.rpc).toHaveBeenCalledWith("get_public_authors");
    const publicResult = await createPortalRepository(client).read(null);
    expect(publicResult.state.profiles).toEqual([]);
    expect(publicResult.state.comments[0].authorName).toBe("Researcher");
  });
});
