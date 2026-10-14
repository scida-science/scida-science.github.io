import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoveries } from "../src/data/discoveries";
import type { DiscussionComment } from "../src/types";
import type { Env } from "./env";
import { GitHubApi, GitHubRepositoryStore, type Fetcher } from "./github";
import {
  emptyAdminState,
  validMaterial,
  type AdminState,
  type DiscoveryDocument,
  type StoredDiscovery,
} from "./model";

// No network or real credentials: exercise the production adapter against GitHub-shaped HTTP responses.
const env: Env = {
  FRONTEND_ORIGIN: "https://scida-science.github.io",
  API_ORIGIN: "https://api.example.test",
  GITHUB_ORG: "scida-science",
  ADMIN_REPOSITORY: "scida-admin",
  ADMIN_GITHUB_ID: "101",
  GITHUB_APP_ID: "222",
  GITHUB_CLIENT_ID: "test-client",
  GITHUB_INSTALLATION_ID: "333",
  GITHUB_CLIENT_SECRET: "test-only-client-secret",
  GITHUB_PRIVATE_KEY: "test-only-private-key",
  SESSION_SECRET: "test-session-secret-at-least-thirty-two-characters",
  DISCUSSION_SECRET: "test-discussion-secret-at-least-thirty-two-characters",
};
const token = "test-installation-token";
const adminPath = "/repos/scida-science/scida-admin";
const discoveryPath = "/repos/scida-science/discovery-ai-one";
const json = (value: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
function file(value: unknown, sha = "sha-one") {
  const text = JSON.stringify(value);
  return {
    sha,
    type: "file",
    encoding: "base64",
    size: Buffer.byteLength(text),
    content: Buffer.from(text).toString("base64"),
  };
}
function repository(
  name = "discovery-ai-one",
  changes: Record<string, unknown> = {},
) {
  return {
    name,
    private: true,
    archived: false,
    owner: { login: env.GITHUB_ORG },
    ...changes,
  };
}
function document(): DiscoveryDocument {
  return {
    schemaVersion: 1,
    visibility: "public",
    discovery: structuredClone(discoveries[0]),
    materials: {
      paper: null,
      appendix: null,
      figures: null,
      data: null,
      repository: null,
    },
  };
}
function record(): StoredDiscovery {
  return {
    repository: "discovery-ai-one",
    sha: "sha-one",
    document: document(),
  };
}
function harness(
  handler: (url: URL, init: RequestInit) => Response | Promise<Response>,
  overrides: Partial<Env> = {},
) {
  const fetcher = vi.fn<Fetcher>(async (input, init) =>
    handler(new URL(String(input)), init ?? {}),
  );
  const api = new GitHubApi({ ...env, ...overrides }, fetcher);
  vi.spyOn(api, "token").mockResolvedValue(token);
  return { api, store: new GitHubRepositoryStore(api), fetcher };
}
function comment(
  id: string,
  changes: Partial<DiscussionComment> = {},
): DiscussionComment {
  return {
    id,
    authorId: "1001",
    discoveryId: "AI-001",
    parentId: null,
    version: "v0.2",
    reference: "Assumption A1",
    body: "Please clarify the confidence event.",
    createdAt: "2026-10-14T10:00:00Z",
    ...changes,
  };
}
function signedBody(value: unknown, secret = env.DISCUSSION_SECRET) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `<!-- scida-discussion-v1:${payload}.${signature} -->\n\nReadable discussion text.`;
}
function issue(
  number: number,
  value: unknown,
  changes: Record<string, unknown> = {},
) {
  return {
    number,
    body: signedBody(value),
    user: { type: "Bot" },
    performed_via_github_app: { id: Number(env.GITHUB_APP_ID) },
    ...changes,
  };
}
afterEach(() => vi.restoreAllMocks());

describe("GitHub repository discovery and file schema", () => {
  it("enumerates private, active discovery repositories in the configured organization across pages", async () => {
    const ignored = Array.from({ length: 95 }, (_, index) =>
      repository(`unrelated-${index}`),
    );
    const firstPage = [
      repository(),
      repository("discovery-public", { private: false }),
      repository("discovery-archived", { archived: true }),
      repository("discovery-foreign", { owner: { login: "someone-else" } }),
      repository("scida-admin"),
      ...ignored,
    ];
    const next = document();
    next.discovery.id = "AI-NEW";
    const { store, fetcher } = harness((url) => {
      if (url.pathname === "/installation/repositories")
        return json({
          repositories:
            url.searchParams.get("page") === "1"
              ? firstPage
              : [
                  repository("discovery-new", {
                    owner: { login: "SCIDA-SCIENCE" },
                  }),
                ],
        });
      if (url.pathname === `${discoveryPath}/contents/discovery.json`)
        return json(file(document()));
      if (
        url.pathname ===
        "/repos/scida-science/discovery-new/contents/discovery.json"
      )
        return json(file(next, "sha-new"));
      throw new Error(`Unexpected API path: ${url.pathname}`);
    });
    expect(
      (await store.listDiscoveries()).map((item) => item.document.discovery.id),
    ).toEqual(["AI-001", "AI-NEW"]);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.github.com/installation/repositories?per_page=100&page=1",
      "https://api.github.com/installation/repositories?per_page=100&page=2",
      `https://api.github.com${discoveryPath}/contents/discovery.json`,
      "https://api.github.com/repos/scida-science/discovery-new/contents/discovery.json",
    ]);
  });

  it("picks up a newly added discovery repository on the next read without a deployment", async () => {
    let includeNew = false;
    const second = document();
    second.discovery.id = "AI-NEW";
    const { store } = harness((url) => {
      if (url.pathname === "/installation/repositories")
        return json({
          repositories: includeNew
            ? [repository(), repository("discovery-new")]
            : [repository()],
        });
      return json(
        file(url.pathname.includes("discovery-new") ? second : document()),
      );
    });
    expect(await store.listDiscoveries()).toHaveLength(1);
    includeNew = true;
    expect(await store.listDiscoveries()).toHaveLength(2);
  });

  it("skips a prefix-matching repository without discovery.json but fails closed on malformed JSON", async () => {
    let corrupt = false;
    const { store } = harness((url) =>
      url.pathname === "/installation/repositories"
        ? json({ repositories: [repository()] })
        : corrupt
          ? json({
              ...file({}),
              content: Buffer.from("invalid-json").toString("base64"),
            })
          : json({ message: "Not Found" }, 404),
    );
    expect(await store.listDiscoveries()).toEqual([]);
    corrupt = true;
    await expect(store.listDiscoveries()).rejects.toMatchObject({
      status: 503,
      message: "A SciDA repository contains invalid JSON.",
    });
  });

  it.each([
    { ...document(), schemaVersion: 99 },
    { ...document(), visibility: "unrecognized" },
    { ...document(), discovery: { id: "AI-001" } },
    { ...document(), materials: null },
  ])(
    "rejects unsupported discovery metadata rather than returning partial records: %j",
    async (value) => {
      const { store } = harness((url) =>
        url.pathname === "/installation/repositories"
          ? json({ repositories: [repository()] })
          : json(file(value)),
      );
      await expect(store.listDiscoveries()).rejects.toMatchObject({
        status: 503,
      });
    },
  );

  it("rejects duplicate stable discovery IDs across repositories", async () => {
    const { store } = harness((url) =>
      url.pathname === "/installation/repositories"
        ? json({ repositories: [repository(), repository("discovery-other")] })
        : json(file(document())),
    );
    await expect(store.listDiscoveries()).rejects.toMatchObject({
      status: 503,
      message: "Discovery IDs must be unique across repositories.",
    });
  });

  it.each([{ type: "dir" }, { encoding: "none" }, { size: 2_000_001 }])(
    "rejects unsupported GitHub content envelopes: %j",
    async (change) => {
      const { store } = harness((url) =>
        url.pathname === "/installation/repositories"
          ? json({ repositories: [repository()] })
          : json({ ...file(document()), ...change }),
      );
      await expect(store.listDiscoveries()).rejects.toMatchObject({
        status: 503,
      });
    },
  );

  it.each([
    "../private.json",
    "/private.json",
    "notes/../private.json",
    "notes//paper.pdf",
    "notes/%2e%2e/private.json",
    "notes\\paper.pdf",
    "https://example.test/paper",
    "paper.pdf?token=x",
    "paper.pdf#fragment",
    "paper\u0000.pdf",
  ])("rejects material path traversal or URL syntax: %j", (path) => {
    expect(validMaterial({ path, access: "reviewer" })).toBe(false);
  });

  it("accepts repository-relative paths and HTTPS external materials without embedded credentials", () => {
    expect(
      validMaterial({ path: "manuscript/paper draft.pdf", access: "reviewer" }),
    ).toBe(true);
    expect(
      validMaterial({
        url: "https://example.test/paper.pdf",
        access: "reader",
      }),
    ).toBe(true);
    expect(
      validMaterial({
        url: "https://user:password@example.test/paper.pdf",
        access: "reader",
      }),
    ).toBe(false);
    expect(
      validMaterial({ url: "javascript:alert(1)", access: "reader" }),
    ).toBe(false);
    expect(
      validMaterial({
        path: "paper.pdf",
        url: "https://example.test/paper.pdf",
        access: "reader",
      }),
    ).toBe(false);
  });
});

describe("Private administrative records and SHA concurrency", () => {
  it.each([{ private: false }, { archived: true }])(
    "refuses administrative storage that is not active and private: %j",
    async (change) => {
      const { store, fetcher } = harness(() =>
        json(repository("scida-admin", change)),
      );
      await expect(store.readAdmin()).rejects.toMatchObject({ status: 503 });
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it("rejects an unsafe administrative repository name before any GitHub request", async () => {
    const { store, fetcher } = harness(() => json({}), {
      ADMIN_REPOSITORY: "../public-repository",
    });
    await expect(store.readAdmin()).rejects.toMatchObject({ status: 500 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { ...emptyAdminState(), schemaVersion: 2 },
    { ...emptyAdminState(), access: [] },
    { ...emptyAdminState(), invitations: {} },
  ])("fails closed on malformed administrative state: %j", async (value) => {
    const { store } = harness((url) =>
      json(
        url.pathname === adminPath ? repository("scida-admin") : file(value),
      ),
    );
    await expect(store.readAdmin()).rejects.toMatchObject({ status: 503 });
  });

  it("reloads after a SHA conflict and preserves a concurrent request instead of overwriting it", async () => {
    let state = emptyAdminState();
    let sha = "original-sha";
    const submitted = {
      id: "ours",
      discoveryId: "AI-001",
      userId: "1001",
      explanation: "Reproduce the experiment.",
      createdAt: "2026-10-14T10:00:00Z",
    };
    const concurrent = { ...submitted, id: "concurrent", userId: "1002" };
    const writes: Array<{ sha: string; content: string }> = [];
    const { store } = harness((url, init) => {
      if (url.pathname === adminPath) return json(repository("scida-admin"));
      if (init.method !== "PUT") return json(file(state, sha));
      const write = JSON.parse(String(init.body));
      writes.push(write);
      if (writes.length === 1) {
        state.codeRequests.push(concurrent);
        sha = "concurrent-sha";
        return json({ message: "SHA conflict" }, 409);
      }
      expect(write.sha).toBe(sha);
      state = JSON.parse(
        Buffer.from(write.content, "base64").toString("utf8"),
      ) as AdminState;
      return json({ content: { sha: "saved-sha" } });
    });
    const mutate = vi.fn((draft: AdminState) => {
      draft.codeRequests.push(submitted);
      return draft.codeRequests.length;
    });
    expect(await store.updateAdmin(mutate)).toBe(2);
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(writes.map((write) => write.sha)).toEqual([
      "original-sha",
      "concurrent-sha",
    ]);
    expect(state.codeRequests.map((request) => request.id)).toEqual([
      "concurrent",
      "ours",
    ]);
  });

  it("bounds repeated SHA conflicts and returns an explicit conflict without claiming success", async () => {
    const { store, fetcher } = harness((url, init) =>
      url.pathname === adminPath
        ? json(repository("scida-admin"))
        : init.method === "PUT"
          ? json({}, 409)
          : json(file(emptyAdminState())),
    );
    await expect(
      store.updateAdmin((state) => {
        state.audit = [];
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "PUT"),
    ).toHaveLength(4);
  });

  it("rejects a stale manuscript SHA rather than overwriting newer discovery content", async () => {
    const { store, fetcher } = harness(() => json({}, 409));
    await expect(
      store.saveDiscovery(record(), document()),
    ).rejects.toMatchObject({
      status: 409,
      message: "The discovery changed on GitHub. Refresh before editing again.",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).sha).toBe(
      "sha-one",
    );
  });
});

describe("Authenticated, versioned GitHub discussions", () => {
  it("paginates issues and replies, preserving nested parent relationships and manuscript versions", async () => {
    const root = comment("root");
    const reply = comment("reply", { parentId: root.id });
    const nested = comment("nested", { parentId: reply.id });
    const another = comment("second-root", { version: "v0.1" });
    const ignored = Array.from({ length: 99 }, (_, index) => ({
      number: index + 100,
      body: "Manual discussion",
      user: { type: "User" },
    }));
    const { store, fetcher } = harness((url) => {
      const page = url.searchParams.get("page");
      if (url.pathname === `${discoveryPath}/issues`)
        return json(
          page === "1" ? [issue(1, root), ...ignored] : [issue(2, another)],
        );
      if (url.pathname === `${discoveryPath}/issues/1/comments`)
        return json(
          page === "1"
            ? [issue(1000, reply), ...ignored]
            : [issue(1001, nested)],
        );
      if (url.pathname === `${discoveryPath}/issues/2/comments`)
        return json([]);
      throw new Error(`Unexpected path ${url.pathname}`);
    });
    expect(await store.readComments(record())).toEqual([
      root,
      reply,
      nested,
      another,
    ]);
    expect(
      fetcher.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.includes("page=2")),
    ).toHaveLength(2);
  });

  it("ignores human-created, foreign-app, unsigned, pull-request, wrong-discovery, and malformed records", async () => {
    const valid = comment("valid-root");
    const unsigned = `<!-- scida-discussion-v1:${Buffer.from(JSON.stringify(comment("unsigned"))).toString("base64url")} -->`;
    const rows = [
      issue(1, valid),
      issue(2, comment("manual"), { user: { type: "User" } }),
      issue(3, comment("foreign"), { performed_via_github_app: { id: 999 } }),
      issue(4, comment("unsigned"), { body: unsigned }),
      issue(5, comment("pull-request"), { pull_request: {} }),
      issue(6, comment("wrong-discovery", { discoveryId: "AST-001" })),
      issue(7, { id: "malformed" }),
    ];
    const { store, fetcher } = harness((url) =>
      json(url.pathname.endsWith("/issues") ? rows : []),
    );
    expect(await store.readComments(record())).toEqual([valid]);
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes("/comments")),
    ).toHaveLength(1);
  });

  it("rejects a manually changed author or text even when the original App provenance remains", async () => {
    const original = comment("root");
    const body = signedBody(original);
    const originalPayload = Buffer.from(JSON.stringify(original)).toString(
      "base64url",
    );
    const forgedPayload = Buffer.from(
      JSON.stringify({
        ...original,
        authorId: "101",
        body: "Forged administrator claim.",
      }),
    ).toString("base64url");
    const { store } = harness((url) =>
      json(
        url.pathname.endsWith("/issues")
          ? [
              issue(1, original, {
                body: body.replace(originalPayload, forgedPayload),
              }),
              issue(2, original, {
                body: signedBody(original, "attacker-key"),
              }),
            ]
          : [],
      ),
    );
    expect(await store.readComments(record())).toEqual([]);
  });

  it("rejects signed records with invalid timestamps before they can break date rendering", async () => {
    const { store } = harness((url) =>
      json(
        url.pathname.endsWith("/issues")
          ? [issue(1, comment("root", { createdAt: "not-a-date" }))]
          : [],
      ),
    );
    expect(await store.readComments(record())).toEqual([]);
  });

  it("ignores orphan replies and replies for a different manuscript version or discovery", async () => {
    const root = comment("root");
    const accepted = comment("valid-reply", { parentId: root.id });
    const { store } = harness((url) =>
      json(
        url.pathname.endsWith("/issues")
          ? [issue(1, root)]
          : [
              issue(2, comment("orphan", { parentId: "missing-parent" })),
              issue(
                3,
                comment("wrong-version", { parentId: root.id, version: "v99" }),
              ),
              issue(
                4,
                comment("wrong-discovery", {
                  parentId: root.id,
                  discoveryId: "AST-001",
                }),
              ),
              issue(5, accepted),
            ],
      ),
    );
    expect(await store.readComments(record())).toEqual([root, accepted]);
  });

  it("creates a signed root issue and stores a nested reply under its existing root issue", async () => {
    const root = comment("root");
    const existing = comment("existing", { parentId: root.id });
    const nested = comment("nested", { parentId: existing.id });
    const writes: Array<{
      path: string;
      value: { body: string; title?: string };
    }> = [];
    const { store } = harness((url, init) => {
      if (init.method === "POST") {
        writes.push({
          path: url.pathname,
          value: JSON.parse(String(init.body)),
        });
        return json({}, 201);
      }
      return json(
        url.pathname.endsWith("/issues")
          ? [issue(17, root)]
          : [issue(18, existing)],
      );
    });
    await store.addComment(record(), comment("new-root"));
    await store.addComment(record(), nested);
    expect(writes.map((write) => write.path)).toEqual([
      `${discoveryPath}/issues`,
      `${discoveryPath}/issues/17/comments`,
    ]);
    const envelope = writes[0].value.body.match(
      /^<!-- scida-discussion-v1:([^ ]+) -->/,
    )![1];
    const [payload, signature] = envelope.split(".");
    expect(
      createHmac("sha256", env.DISCUSSION_SECRET)
        .update(payload)
        .digest("base64url"),
    ).toBe(signature);
    expect(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    ).toEqual(comment("new-root"));
    expect(writes[0].value.title).toContain("v0.2");
  });
});

describe("GitHub material boundary and upstream failures", () => {
  it("streams private material as a safe attachment without forwarding credentials, cookies, or redirect locations", async () => {
    const { store, fetcher } = harness(
      () =>
        new Response("private-file-bytes", {
          headers: {
            "Content-Type": "text/html",
            Location: "https://private.example.test/?token=secret",
            "Set-Cookie": "upstream-secret",
            "X-OAuth-Scopes": "repository",
          },
        }),
    );
    const response = await store.materialFile(
      record(),
      "manuscript/paper draft.html",
    );
    expect(await response.text()).toBe("private-file-bytes");
    expect(response.headers.get("Content-Type")).toBe(
      "application/octet-stream",
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="paper_draft.html"',
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(JSON.stringify([...response.headers])).not.toContain(token);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      `https://api.github.com${discoveryPath}/contents/manuscript/paper%20draft.html`,
    );
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      `Bearer ${token}`,
    );
  });

  it("refuses upstream redirects and does not expose the target or installation token in errors", async () => {
    const { store } = harness(
      () =>
        new Response(null, {
          status: 302,
          headers: { Location: `https://private.example.test/?token=${token}` },
        }),
    );
    await expect(
      store.materialFile(record(), "paper.pdf"),
    ).rejects.toMatchObject({
      status: 503,
      message: "The supporting file could not be retrieved from GitHub.",
    });
  });

  it.each(["https://evil.example.test", "//evil.example.test/path"])(
    "rejects nonlocal GitHub API paths before sending credentials: %s",
    async (path) => {
      const { api, fetcher } = harness(() => json({}));
      await expect(api.raw(path)).rejects.toMatchObject({ status: 500 });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([429, 403])(
    "reports GitHub rate limiting without leaking upstream content (%s)",
    async (status) => {
      const { api } = harness(() =>
        json({ message: token }, status, { "x-ratelimit-remaining": "0" }),
      );
      await expect(
        api.request("/installation/repositories"),
      ).rejects.toMatchObject({
        status: 503,
        message:
          "GitHub storage is temporarily rate limited. Please try again later.",
      });
    },
  );
});
