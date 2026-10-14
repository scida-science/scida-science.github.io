import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, verify } from "node:crypto";
import { createAuth } from "./auth";
import { appJwt, digest, randomToken, seal, unseal } from "./crypto";
import { handleRequest } from "./index";
import { emptyAdminState, type GitHubStore } from "./model";
import type { Env } from "./env";

const env: Env = {
  FRONTEND_ORIGIN: "https://scida-science.github.io",
  API_ORIGIN: "https://api.example.test",
  GITHUB_ORG: "scida-science",
  ADMIN_REPOSITORY: "scida-admin",
  ADMIN_GITHUB_ID: "89913681",
  GITHUB_APP_ID: "123",
  GITHUB_CLIENT_ID: "test-client",
  GITHUB_INSTALLATION_ID: "456",
  GITHUB_CLIENT_SECRET: "test-only-client-secret",
  GITHUB_PRIVATE_KEY: "test-only-key",
  SESSION_SECRET: "test-session-secret-not-a-deployed-secret",
  DISCUSSION_SECRET: "test-discussion-secret-not-a-deployed-secret",
};
function memoryStore() {
  let state = emptyAdminState();
  const store: GitHubStore = {
    readAdmin: async () => structuredClone(state),
    updateAdmin: async (fn) => {
      const candidate = structuredClone(state);
      const result = fn(candidate);
      state = candidate;
      return result;
    },
    listDiscoveries: async () => [],
    saveDiscovery: async () => {},
    readComments: async () => [],
    addComment: async () => {},
  };
  return store;
}
const clientVerifier = "a".repeat(43),
  clientState = "b".repeat(43);
function github(verified = true) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/access_token")) {
      expect(JSON.parse(String(init?.body)).code_verifier).toHaveLength(43);
      return Response.json({ access_token: "ghu_test_server_only" });
    }
    if (url.endsWith("/user/emails"))
      return Response.json([
        { email: "private@example.test", verified, primary: true },
      ]);
    if (url.endsWith("/user"))
      return Response.json({
        id: 100,
        login: "researcher",
        name: "Researcher",
        email: "untrusted@example.test",
      });
    throw new Error("Unexpected URL");
  });
}
async function start(auth: ReturnType<typeof createAuth>) {
  const response = await auth.start(
    new Request(
      `${env.API_ORIGIN}/auth/start?challenge=${await digest(clientVerifier)}&state=${clientState}`,
    ),
  );
  return {
    response,
    state: new URL(response.headers.get("location")!).searchParams.get(
      "state",
    )!,
    cookie: response.headers.get("set-cookie")!.split(";")[0],
  };
}
async function complete(auth: ReturnType<typeof createAuth>) {
  const first = await start(auth);
  const response = await auth.callback(
    new Request(
      `${env.API_ORIGIN}/auth/callback?code=github-code&state=${first.state}`,
      { headers: { Cookie: first.cookie } },
    ),
  );
  const params = new URLSearchParams(
    new URL(response.headers.get("location")!).hash.split("?")[1],
  );
  return { response, params };
}

describe("GitHub OAuth and server sessions", () => {
  let store: GitHubStore;
  beforeEach(() => {
    store = memoryStore();
  });
  it("uses an encrypted first-party HttpOnly cookie and GitHub PKCE without repository scopes", async () => {
    const { response } = await start(createAuth(store, env, github()));
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://github.com");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.has("scope")).toBe(false);
    expect(response.headers.get("set-cookie")).toMatch(
      /HttpOnly; SameSite=Lax; Max-Age=600; Secure/,
    );
    expect(response.headers.get("set-cookie")).not.toContain(clientVerifier);
  });
  it("handles malformed auth start as a 400 response rather than an unhandled rejection", async () => {
    const response = await handleRequest(
      new Request(env.API_ORIGIN + "/auth/start"),
      env,
      store,
    );
    expect(response.status).toBe(400);
  });
  it("refuses mismatched state before contacting GitHub", async () => {
    const fetcher = github(),
      auth = createAuth(store, env, fetcher),
      first = await start(auth);
    const response = await auth.callback(
      new Request(env.API_ORIGIN + "/auth/callback?code=x&state=wrong", {
        headers: { Cookie: first.cookie },
      }),
    );
    expect(response.headers.get("location")).toContain("error=");
    expect(fetcher).not.toHaveBeenCalled();
    expect(Object.keys((await store.readAdmin()).profiles)).toHaveLength(0);
  });
  it("refuses a tampered or missing OAuth cookie", async () => {
    const fetcher = github(),
      auth = createAuth(store, env, fetcher);
    for (const headers of [{}, { Cookie: "scida_oauth=tampered" }]) {
      const response = await auth.callback(
        new Request(env.API_ORIGIN + "/auth/callback?code=x&state=x", {
          headers,
        }),
      );
      expect(response.headers.get("location")).toContain("error=");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses an expired encrypted OAuth request", async () => {
    const value = await seal(
      {
        state: "x",
        clientState,
        challenge: await digest(clientVerifier),
        verifier: clientVerifier,
        expires: Date.now() - 1,
      },
      env.SESSION_SECRET,
    );
    const response = await createAuth(store, env, github()).callback(
      new Request(env.API_ORIGIN + "/auth/callback?code=x&state=x", {
        headers: { Cookie: "scida_oauth=" + value },
      }),
    );
    expect(response.headers.get("location")).toContain("error=");
  });
  it("creates a Reader from the verified GitHub identity and returns only a PKCE-bound exchange code", async () => {
    const auth = createAuth(store, env, github()),
      { response, params } = await complete(auth);
    expect(params.get("state")).toBe(clientState);
    expect(params.get("code")).toHaveLength(43);
    expect(response.headers.get("location")).not.toContain("ghu_");
    const state = await store.readAdmin();
    expect(state.profiles["100"].email).toBe("private@example.test");
    expect(state.access["100"].role).toBe("Reader");
    expect(JSON.stringify(state)).not.toContain("ghu_");
    expect(JSON.stringify(state)).not.toContain(params.get("code"));
  });
  it("requires a verified primary email and seeds nothing on refusal", async () => {
    const { params } = await complete(createAuth(store, env, github(false)));
    expect(params.has("error")).toBe(true);
    expect((await store.readAdmin()).profiles).toEqual({});
  });
  it("exchanges once, refuses an incorrect verifier without consuming, and stores only session hashes", async () => {
    const auth = createAuth(store, env, github()),
      { params } = await complete(auth),
      code = params.get("code");
    await expect(
      auth.exchange({ code, verifier: "c".repeat(43) }),
    ).rejects.toMatchObject({ status: 401 });
    const session = await auth.exchange({ code, verifier: clientVerifier });
    expect(session.token).toHaveLength(43);
    expect(Date.parse(session.expiresAt)).toBeGreaterThan(Date.now());
    expect(JSON.stringify(await store.readAdmin())).not.toContain(
      session.token,
    );
    await expect(
      auth.exchange({ code, verifier: clientVerifier }),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("recognizes a session then rejects the same bearer after logout", async () => {
    const auth = createAuth(store, env, github()),
      { params } = await complete(auth);
    const { token } = await auth.exchange({
      code: params.get("code"),
      verifier: clientVerifier,
    });
    const request = new Request(env.API_ORIGIN + "/v1/portal", {
      headers: { Authorization: "Bearer " + token },
    });
    expect(await auth.authenticate(request)).toBe("100");
    await auth.logout(request);
    await expect(auth.authenticate(request)).rejects.toMatchObject({
      status: 401,
    });
  });
  it("rejects expired, forged and GitHub tokens as SciDA sessions", async () => {
    const auth = createAuth(store, env, github());
    for (const token of [randomToken(), "ghu_not_a_scida_session"])
      await expect(
        auth.authenticate(
          new Request(env.API_ORIGIN, {
            headers: { Authorization: "Bearer " + token },
          }),
        ),
      ).rejects.toMatchObject({ status: 401 });
    const token = randomToken(),
      hash = await digest(token);
    await store.updateAdmin((state) => {
      state.sessions[hash] = {
        userId: "100",
        expiresAt: new Date(Date.now() - 1).toISOString(),
      };
    });
    await expect(
      auth.authenticate(
        new Request(env.API_ORIGIN, {
          headers: { Authorization: "Bearer " + token },
        }),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("does not accept user-supplied admin metadata during exchange", async () => {
    const auth = createAuth(store, env, github()),
      { params } = await complete(auth);
    await auth.exchange({
      code: params.get("code"),
      verifier: clientVerifier,
      userId: env.ADMIN_GITHUB_ID,
      role: "Admin",
    });
    const state = await store.readAdmin();
    expect(Object.values(state.sessions)[0].userId).toBe("100");
    expect(state.access["100"].role).toBe("Reader");
  });
  it("fails closed on malformed stored exchange and session expiration dates", async () => {
    const auth = createAuth(store, env, github()),
      { params } = await complete(auth),
      code = params.get("code")!,
      codeHash = await digest(code);
    await store.updateAdmin((state) => {
      state.exchanges[codeHash].expiresAt = "invalid";
    });
    await expect(
      auth.exchange({ code, verifier: clientVerifier }),
    ).rejects.toMatchObject({ status: 401 });
    const token = randomToken(),
      hash = await digest(token);
    await store.updateAdmin((state) => {
      state.sessions[hash] = { userId: "100", expiresAt: "invalid" };
    });
    await expect(
      auth.authenticate(
        new Request(env.API_ORIGIN, {
          headers: { Authorization: "Bearer " + token },
        }),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("HTTP security boundaries", () => {
  it("fails closed when backend secrets are missing", async () => {
    const response = await handleRequest(
      new Request(env.API_ORIGIN + "/v1/portal"),
      { ...env, GITHUB_PRIVATE_KEY: "" },
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(env.GITHUB_CLIENT_SECRET);
  });
  it("rejects foreign-origin GET and POST and missing-origin writes", async () => {
    for (const method of ["GET", "POST"]) {
      const response = await handleRequest(
        new Request(env.API_ORIGIN + "/v1/portal", {
          method,
          headers: { Origin: "https://attacker.test" },
        }),
        env,
        memoryStore(),
      );
      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
    expect(
      (
        await handleRequest(
          new Request(env.API_ORIGIN + "/auth/exchange", { method: "POST" }),
          env,
          memoryStore(),
        )
      ).status,
    ).toBe(403);
  });
  it("allows only the exact configured frontend in preflight", async () => {
    const response = await handleRequest(
      new Request(env.API_ORIGIN + "/v1/profile", {
        method: "OPTIONS",
        headers: { Origin: env.FRONTEND_ORIGIN },
      }),
      env,
      memoryStore(),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      env.FRONTEND_ORIGIN,
    );
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });
  it("does not accept unauthenticated writes or client asserted roles", async () => {
    const response = await handleRequest(
      new Request(env.API_ORIGIN + "/v1/access/100", {
        method: "POST",
        headers: {
          Origin: env.FRONTEND_ORIGIN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId: env.ADMIN_GITHUB_ID, role: "Admin" }),
      }),
      env,
      memoryStore(),
    );
    expect(response.status).toBe(401);
  });
  it("rejects oversized and malformed exchange payloads", async () => {
    const options = {
      method: "POST",
      headers: {
        Origin: env.FRONTEND_ORIGIN,
        "Content-Type": "application/json",
      },
    };
    expect(
      (
        await handleRequest(
          new Request(env.API_ORIGIN + "/auth/exchange", {
            ...options,
            body: "x".repeat(100001),
          }),
          env,
          memoryStore(),
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await handleRequest(
          new Request(env.API_ORIGIN + "/auth/exchange", {
            ...options,
            body: "[]",
          }),
          env,
          memoryStore(),
        )
      ).status,
    ).toBe(400);
  });
  it("returns a client error for malformed paths and decision values", async () => {
    const store = memoryStore(),
      auth = createAuth(store, env, github()),
      { params } = await complete(auth);
    const { token } = await auth.exchange({
      code: params.get("code"),
      verifier: clientVerifier,
    });
    const headers = {
      Origin: env.FRONTEND_ORIGIN,
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    };
    expect(
      (
        await handleRequest(
          new Request(env.API_ORIGIN + "/v1/applications/one/decision", {
            method: "POST",
            headers,
            body: JSON.stringify({
              decision: { toString: null, valueOf: null },
            }),
          }),
          env,
          store,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleRequest(
          new Request(env.API_ORIGIN + "/v1/%ZZ", { headers }),
          env,
          store,
        )
      ).status,
    ).toBe(400);
  });
});

describe("cryptographic transport", () => {
  it("authenticates encrypted cookie content and rejects changed ciphertext", async () => {
    const value = await seal({ private: "cookie" }, env.SESSION_SECRET);
    expect(await unseal(value, env.SESSION_SECRET)).toEqual({
      private: "cookie",
    });
    await expect(
      unseal(value.slice(0, -3) + "xxx", env.SESSION_SECRET),
    ).rejects.toThrow();
  });
  it("signs a short-lived GitHub App JWT from a downloaded PKCS#1 PEM", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const token = appJwt(
        "123",
        privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
      ),
      parts = token.split(".");
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(parts.slice(0, 2).join(".")),
        publicKey,
        Buffer.from(parts[2], "base64url"),
      ),
    ).toBe(true);
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    expect(claims.iss).toBe("123");
    expect(claims.exp - claims.iat).toBe(600);
  });
});
