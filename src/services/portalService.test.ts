// @vitest-environment jsdom
import { webcrypto, createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoveries } from "../data/discoveries";
import {
  ApiError,
  createApiClient,
  parseApiConfiguration,
  SESSION_KEY,
} from "../lib/api";
import type { Invitation, Profile, ProfileInput } from "../types";
import { createGitHubAuth, OAUTH_KEY } from "./auth";
import { canDiscuss, canManageTopic, canReviewApplication } from "./permissions";
import { createPortalService, type PortalService } from "./portalService";
import { emptyPortalState } from "./repository";

const token = "scida-session-only-0123456789abcdef0123456789";
const session = () => ({
  token,
  expiresAt: new Date(Date.now() + 8 * 3600_000).toISOString(),
});
function profile(role: Profile["role"] = "Reader"): Profile {
  return {
    id: "github:12345",
    fullName: "Researcher",
    email: "researcher@example.org",
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
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const services: PortalService[] = [];
function setup(options: { role?: Profile["role"]; signedIn?: boolean } = {}) {
  if (options.signedIn !== false)
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session()));
  let currentProfile = profile(options.role);
  const routes = new Map<
    string,
    (init: RequestInit) => Promise<Response> | Response
  >();
  const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
    const path = new URL(String(input)).pathname;
    const custom = routes.get(path);
    if (custom) return custom(init);
    if (path === "/v1/portal") {
      const authenticated = new Headers(init.headers).has("Authorization");
      return json({
        state: {
          ...emptyPortalState(),
          discoveries,
          profiles: authenticated ? [currentProfile] : [],
        },
        user: authenticated ? currentProfile : null,
      });
    }
    if (path === "/auth/exchange") return json(session());
    return json({ ok: true });
  });
  const client = createApiClient("https://api.scida.example", {
    fetch: fetcher,
    storage: sessionStorage,
  });
  const navigate = vi.fn();
  const auth = createGitHubAuth(client, {
    crypto: webcrypto as Crypto,
    navigate,
  });
  const download = vi.fn();
  const service = createPortalService(client, null, {
    auth,
    navigate,
    saveDownload: download,
  });
  services.push(service);
  return {
    client,
    service,
    auth,
    fetcher,
    routes,
    navigate,
    download,
    setProfile: (value: Profile) => {
      currentProfile = value;
    },
  };
}
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  services.splice(0).forEach((service) => service.stop());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("API configuration and sessions", () => {
  it("permits HTTPS and loopback API URLs without credential configuration", () => {
    expect(parseApiConfiguration("https://api.scida.example/").url).toBe(
      "https://api.scida.example",
    );
    expect(parseApiConfiguration("http://127.0.0.1:8787").url).toBeTruthy();
    expect(parseApiConfiguration("http://localhost:8787").url).toBeTruthy();
    for (const url of [
      "http://api.scida.example",
      "https://user:secret@api.scida.example",
      "https://api.scida.example?token=secret",
      "https://api.scida.example/#secret",
      "javascript:alert(1)",
    ])
      expect(parseApiConfiguration(url).url).toBeNull();
    expect(parseApiConfiguration()).toEqual({ url: null, error: null });
  });
  it("ignores all old demo state and offers read-only examples when unconfigured", async () => {
    localStorage.setItem(
      "scida.demo.v1",
      JSON.stringify({ role: "Admin", activeUserId: "admin" }),
    );
    const service = createPortalService(null);
    expect(service.getSnapshot().state.discoveries).toHaveLength(6);
    expect(service.getSnapshot().state.comments).toEqual([]);
    expect(service.getSnapshot().user).toBeNull();
    expect((await service.actions.signInWithGitHub()).ok).toBe(false);
    expect(
      (await service.actions.requestCode(discoveries[0].id, "Research request"))
        .ok,
    ).toBe(false);
  });
  it("persists only a SciDA session in sessionStorage and reloads real portal data", async () => {
    const { client, service, fetcher } = setup();
    await service.start();
    expect(service.getSnapshot().user?.role).toBe("Reader");
    expect(
      new Headers(fetcher.mock.calls[0][1]?.headers).get("Authorization"),
    ).toBe(`Bearer ${token}`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
    const reloaded = createApiClient(client.baseUrl, {
      fetch: fetcher,
      storage: sessionStorage,
    });
    expect(reloaded.getSession()?.token).toBe(token);
    expect(localStorage.length).toBe(0);
    expect(JSON.parse(sessionStorage.getItem(SESSION_KEY)!)).toEqual(
      client.getSession(),
    );
  });
  it("rejects GitHub credentials, malformed sessions, and expired sessions", () => {
    for (const value of [
      { ...session(), token: "ghp_privateGitHubToken123456789" },
      { ...session(), token: "github_pat_privateToken123456789" },
      { ...session(), expiresAt: "2000-01-01" },
      { token: "short", expiresAt: session().expiresAt },
    ]) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
      const client = createApiClient("https://api.scida.example", {
        storage: sessionStorage,
      });
      expect(client.getSession()).toBeNull();
      expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    }
  });
  it("takes roles from the server even if session storage contains forged privileges", async () => {
    const { client, service } = setup();
    client.setSession({
      ...session(),
      role: "Admin",
      approvedTopics: ["bandit-theory"],
    });
    await service.start();
    expect(service.getSnapshot().user?.role).toBe("Reader");
    expect(JSON.parse(sessionStorage.getItem(SESSION_KEY)!)).not.toHaveProperty(
      "role",
    );
    expect(
      (
        await service.actions.setAccess(
          profile().id,
          "Approver",
          [],
          ["bandit-theory"],
        )
      ).ok,
    ).toBe(false);
  });
});

describe("Senior Approver permissions", () => {
  it("parses a server-issued Senior Approver and grants only their assigned approval scope", async () => {
    const { service, setProfile } = setup({ role: "Senior Approver" });
    setProfile({ ...profile("Senior Approver"), assignedTopics: ["bandit-theory"] });
    await service.start();
    const user = service.getSnapshot().user;
    expect(user?.role).toBe("Senior Approver");
    expect(canManageTopic(user, "bandit-theory")).toBe(true);
    expect(canManageTopic(user, "exoplanets")).toBe(false);
    expect(canDiscuss(user, discoveries[0])).toBe(false);
    expect(canReviewApplication(user, {
      id: "application", userId: "other", topics: ["bandit-theory"],
      evidence: "Research evidence", status: "Pending", createdAt: "2026-10-14T10:00:00Z",
    })).toBe(true);
  });

  it("denies ordinary Approver invitations while preserving approved discussions", async () => {
    const { service, setProfile, fetcher } = setup({ role: "Approver" });
    setProfile({ ...profile("Approver"), approvedTopics: ["bandit-theory"], assignedTopics: ["bandit-theory"] });
    await service.start();
    const user = service.getSnapshot().user;
    expect(canManageTopic(user, "bandit-theory")).toBe(false);
    expect(canReviewApplication(user, {
      id: "application", userId: "other", topics: ["bandit-theory"],
      evidence: "Research evidence", status: "Pending", createdAt: "2026-10-14T10:00:00Z",
    })).toBe(false);
    expect(canDiscuss(user, discoveries[0])).toBe(true);
    expect((await service.actions.createInvitation(["bandit-theory"], "other@example.test")).ok).toBe(false);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("/v1/invitations"))).toBe(false);
  });
});

describe("GitHub OAuth with PKCE", () => {
  it("redirects top-level with a challenge and state, never a verifier or GitHub token", async () => {
    const { auth, navigate } = setup({ signedIn: false });
    await auth.signIn();
    const pending = JSON.parse(sessionStorage.getItem(OAUTH_KEY)!) as {
      state: string;
      verifier: string;
    };
    const url = new URL(navigate.mock.calls[0][0]);
    expect(url.pathname).toBe("/auth/start");
    expect(url.searchParams.get("state")).toBe(pending.state);
    expect(url.searchParams.get("challenge")).toBe(
      createHash("sha256").update(pending.verifier).digest("base64url"),
    );
    expect(url.href).not.toContain(pending.verifier);
    expect(pending.verifier).toHaveLength(43);
  });
  it("checks state, exchanges once across StrictMode restarts, and removes callback values", async () => {
    const { service, auth, fetcher } = setup({ signedIn: false });
    await auth.signIn();
    const pending = JSON.parse(sessionStorage.getItem(OAUTH_KEY)!) as {
      state: string;
      verifier: string;
    };
    window.history.replaceState(
      null,
      "",
      `/#/auth/callback?code=one-time-code&state=${pending.state}`,
    );
    const first = service.start();
    service.stop();
    const second = service.start();
    await Promise.all([first, second]);
    const exchanges = fetcher.mock.calls.filter(([input]) =>
      String(input).endsWith("/auth/exchange"),
    );
    expect(exchanges).toHaveLength(1);
    expect(JSON.parse(exchanges[0][1]?.body as string)).toEqual({
      code: "one-time-code",
      verifier: pending.verifier,
    });
    expect(new Headers(exchanges[0][1]?.headers).has("Authorization")).toBe(
      false,
    );
    expect(sessionStorage.getItem(OAUTH_KEY)).toBeNull();
    expect(window.location.hash).toBe("#/profile");
    expect(service.getSnapshot().user?.role).toBe("Reader");
  });
  it("rejects mismatched OAuth state without making an exchange request", async () => {
    const { service, auth, fetcher } = setup({ signedIn: false });
    await auth.signIn();
    window.history.replaceState(
      null,
      "",
      "/#/auth/callback?code=attacker-code&state=wrong",
    );
    await service.start();
    expect(fetcher).not.toHaveBeenCalled();
    expect(service.getSnapshot().error).toMatch(/could not be verified/);
    expect(service.getSnapshot().user).toBeNull();
    expect(window.location.hash).toBe("#/login");
    expect(sessionStorage.getItem(OAUTH_KEY)).toBeNull();
  });
  it("does not manufacture a session when exchange fails", async () => {
    const { service, auth, routes } = setup({ signedIn: false });
    await auth.signIn();
    const pending = JSON.parse(sessionStorage.getItem(OAUTH_KEY)!) as {
      state: string;
    };
    routes.set("/auth/exchange", () =>
      json({ error: "Exchange code expired" }, 401),
    );
    window.history.replaceState(
      null,
      "",
      `/#/auth/callback?code=expired&state=${pending.state}`,
    );
    await service.start();
    expect(service.getSnapshot().error).toBe("Exchange code expired");
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(service.getSnapshot().user).toBeNull();
  });
});

describe("permission and session boundaries", () => {
  it("clears identity and private state when the API revokes a session", async () => {
    const { service, client, routes } = setup({ role: "Admin" });
    await service.start();
    routes.set("/v1/portal", () => json({ error: "Session revoked" }, 401));
    expect((await service.actions.refresh()).ok).toBe(false);
    expect(client.getSession()).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(service.getSnapshot().user).toBeNull();
    expect(service.getSnapshot().state.profiles).toEqual([]);
    expect(service.getSnapshot().error).toBe("Session revoked");
  });
  it("clears account privileges automatically when the SciDA session expires", async () => {
    vi.useFakeTimers();
    const { service, client } = setup({ role: "Admin" });
    client.setSession({
      token,
      expiresAt: new Date(Date.now() + 50).toISOString(),
    });
    await service.start();
    expect(service.getSnapshot().user?.role).toBe("Admin");
    await vi.advanceTimersByTimeAsync(51);
    expect(service.getSnapshot().user).toBeNull();
    expect(service.getSnapshot().state.profiles).toEqual([]);
    expect(client.getSession()).toBeNull();
  });
  it("does not let an old unauthorized response erase a newer session", async () => {
    let resolve: ((response: Response) => void) | undefined;
    const fetcher = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const client = createApiClient("https://api.scida.example", {
      fetch: fetcher,
      storage: sessionStorage,
    });
    client.setSession(session());
    const request = client.request("/v1/portal");
    const newToken = "different-scida-session-token-0123456789";
    client.setSession({ ...session(), token: newToken });
    resolve!(json({ error: "Old session revoked" }, 401));
    await expect(request).rejects.toBeInstanceOf(ApiError);
    expect(client.getSession()?.token).toBe(newToken);
  });
  it("revokes logout server-side and clears the tab before waiting for the network", async () => {
    const { service, client, fetcher } = setup({ role: "Admin" });
    await service.start();
    const result = service.actions.signOut();
    expect(client.getSession()).toBeNull();
    expect(service.getSnapshot().user).toBeNull();
    expect((await result).ok).toBe(true);
    const logout = fetcher.mock.calls.find(([url]) =>
      String(url).endsWith("/auth/logout"),
    )!;
    expect(logout[1]?.method).toBe("POST");
    expect(new Headers(logout[1]?.headers).get("Authorization")).toBe(
      `Bearer ${token}`,
    );
  });
  it("reports revocation failures honestly while leaving the tab signed out", async () => {
    const { service, client, routes } = setup();
    await service.start();
    routes.set("/auth/logout", () =>
      json({ error: "GitHub write unavailable" }, 503),
    );
    const result = await service.actions.signOut();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/revocation could not be confirmed/);
    expect(client.getSession()).toBeNull();
    expect(service.getSnapshot().user).toBeNull();
  });
  it("discards a delayed privileged response after account logout", async () => {
    const { service, client, routes } = setup({ role: "Admin" });
    await service.start();
    let resolve: ((response: Response) => void) | undefined;
    routes.set(
      "/v1/portal",
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const refresh = service.actions.refresh();
    await vi.waitFor(() => expect(resolve).toBeDefined());
    client.clearSession();
    resolve!(
      json({
        state: { ...emptyPortalState(), profiles: [profile("Admin")] },
        user: profile("Admin"),
      }),
    );
    await refresh;
    expect(service.getSnapshot().user).toBeNull();
    expect(service.getSnapshot().state.profiles).toEqual([]);
  });
  it("refreshes revoked topic grants from shared server data", async () => {
    const { service, setProfile } = setup({ role: "Reviewer" });
    setProfile({ ...profile("Reviewer"), approvedTopics: ["bandit-theory"] });
    await service.start();
    const discovery = discoveries.find(
      (item) => item.topic === "bandit-theory",
    )!;
    expect(canDiscuss(service.getSnapshot().user, discovery)).toBe(true);
    setProfile(profile("Reader"));
    await service.actions.refresh();
    expect(canDiscuss(service.getSnapshot().user, discovery)).toBe(false);
  });
  it("refreshes visible tabs every two minutes and on focus, while hidden tabs stay quiet", async () => {
    vi.useFakeTimers();
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    const { service, fetcher, setProfile } = setup();
    await service.start();
    setProfile({ ...profile(), fullName: "Updated in shared storage" });
    await vi.advanceTimersByTimeAsync(119_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(service.getSnapshot().user?.fullName).toBe(
      "Updated in shared storage",
    );
    visibility.mockReturnValue("hidden");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue("visible");
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("surfaces server denial of a forged privilege write", async () => {
    const { client, routes, service } = setup();
    await service.start();
    routes.set("/v1/access/github%3A12345", () =>
      json({ error: "Only the administrator can manage access" }, 403),
    );
    await expect(
      client.request("/v1/access/github%3A12345", {
        role: "Admin",
        approvedTopics: ["bandit-theory"],
        assignedTopics: [],
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(service.getSnapshot().user?.role).toBe("Reader");
  });
});

describe("shared writes and authorized materials", () => {
  it("sends editable profile fields without caller-supplied roles or identity", async () => {
    const { service, fetcher } = setup();
    await service.start();
    const injected = {
      ...profile("Admin"),
      fullName: "  Edited name  ",
      approvedTopics: ["bandit-theory"],
    };
    expect(
      (await service.actions.saveProfile(injected as ProfileInput)).ok,
    ).toBe(true);
    const call = fetcher.mock.calls.find(([url]) =>
      String(url).endsWith("/v1/profile"),
    )!;
    const body = JSON.parse(call[1]?.body as string) as {
      input: Record<string, unknown>;
    };
    expect(body.input.fullName).toBe("Edited name");
    for (const key of [
      "role",
      "id",
      "email",
      "approvedTopics",
      "assignedTopics",
    ])
      expect(body.input).not.toHaveProperty(key);
  });
  it("keeps configured failures visible without falling back to local examples", async () => {
    const { service, routes } = setup({ signedIn: false });
    routes.set("/v1/portal", () =>
      json({ error: "Private content store unavailable" }, 503),
    );
    await service.start();
    expect(service.getSnapshot().state.discoveries).toEqual([]);
    expect(service.getSnapshot().error).toBe(
      "Private content store unavailable",
    );
  });
  it("never treats rejected writes as success or adds local records", async () => {
    const { service, routes } = setup();
    await service.start();
    routes.set("/v1/code-requests", () =>
      json({ error: "Write conflict; please retry" }, 409),
    );
    const result = await service.actions.requestCode(
      discoveries[0].id,
      "Reproduce this result",
    );
    expect(result).toEqual({
      ok: false,
      message: "Write conflict; please retry",
    });
    expect(service.getSnapshot().state.codeRequests).toEqual([]);
  });
  it("returns invitation codes once and grants nothing during preview", async () => {
    const { service, routes, client } = setup({ role: "Admin" });
    const invitation: Invitation = {
      id: "invite",
      intendedEmail: profile().email,
      topics: ["bandit-theory"],
    };
    routes.set("/v1/invitations", () =>
      json({ invitation, code: "one-time-invitation" }),
    );
    routes.set("/v1/invitations/preview", () => json({ invitation }));
    await service.start();
    expect(
      (
        await service.actions.createInvitation(
          ["bandit-theory"],
          profile().email,
        )
      ).code,
    ).toBe("one-time-invitation");
    expect(service.getSnapshot().state.invitations[0].code).toBeUndefined();
    expect(
      (await service.actions.previewInvitation("one-time-invitation"))
        .invitation,
    ).toEqual(invitation);
    expect(service.getSnapshot().user?.approvedTopics).toEqual([]);
    expect(client.getSession()).not.toBeNull();
  });
  it("downloads authorized attachments without exposing the bearer token in a URL", async () => {
    const { service, routes, download, fetcher } = setup();
    const path = `/v1/discoveries/${discoveries[0].id}/materials/paper`;
    routes.set(
      path,
      () =>
        new Response("paper-content", {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": 'attachment; filename="paper.pdf"',
          },
        }),
    );
    await service.start();
    expect(
      (await service.actions.downloadMaterial(discoveries[0].id, "paper")).ok,
    ).toBe(true);
    expect(download).toHaveBeenCalledWith(expect.any(Blob), "paper.pdf");
    const call = fetcher.mock.calls.find(([url]) =>
      String(url).endsWith(path),
    )!;
    expect(String(call[0])).not.toContain(token);
    expect(new Headers(call[1]?.headers).get("Authorization")).toBe(
      `Bearer ${token}`,
    );
  });
  it("opens only server-authorized HTTPS material links and never fetches them with credentials", async () => {
    const { service, routes, navigate, fetcher } = setup();
    const path = `/v1/discoveries/${discoveries[0].id}/materials/repository`;
    routes.set(path, () =>
      json({ url: "https://github.com/scida-science/research" }),
    );
    await service.start();
    expect(
      (await service.actions.downloadMaterial(discoveries[0].id, "repository"))
        .ok,
    ).toBe(true);
    expect(navigate).toHaveBeenCalledWith(
      "https://github.com/scida-science/research",
    );
    expect(
      fetcher.mock.calls.every(([url]) =>
        String(url).startsWith("https://api.scida.example/"),
      ),
    ).toBe(true);
    routes.set(path, () => json({ url: "javascript:alert(1)" }));
    expect(
      (await service.actions.downloadMaterial(discoveries[0].id, "repository"))
        .ok,
    ).toBe(false);
  });
});
