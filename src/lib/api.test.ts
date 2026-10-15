// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  browserSessionStorage,
  createApiClient,
  SESSION_KEY,
  SESSION_MIGRATION_KEY,
} from "./api";

const origin = "https://api.scida.example";
const firstToken = "first-scida-session-0123456789abcdef0123456789";
const secondToken = "second-scida-session-0123456789abcdef0123456789";
const session = (token = firstToken, expiry = Date.now() + 8 * 3600_000) => ({
  token,
  expiresAt: new Date(expiry).toISOString(),
});
const stops: Array<() => void> = [];
const fetcher = () => vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => { items.delete(key); },
    setItem: (key, value) => { items.set(key, value); },
  };
}
function storageEvent(key: string | null = SESSION_KEY, area = localStorage, newValue: string | null = null) {
  window.dispatchEvent(new StorageEvent("storage", { key, storageArea: area, newValue }));
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.restoreAllMocks();
});

describe("persistent SciDA sessions", () => {
  it("reopens a signed-in client after tab storage is cleared without extending its expiry", () => {
    const original = session();
    const client = createApiClient(origin, { fetch: fetcher() });
    client.setSession(original);
    expect(client.storage).toBe(localStorage);
    expect(browserSessionStorage()).toBe(sessionStorage);
    sessionStorage.clear();
    const reopened = createApiClient(origin, { fetch: fetcher() });
    expect(reopened.getSession()).toEqual(original);
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!)).toEqual(original);
  });

  it("migrates a valid tab session once, preserving expiry and removing untrusted fields", () => {
    const original = session();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...original, role: "Admin", profile: { id: "forged" } }));
    const client = createApiClient(origin, { fetch: fetcher() });
    expect(client.getSession()).toEqual(original);
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!)).toEqual(original);
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(localStorage.getItem(SESSION_MIGRATION_KEY)).toBe("1");
    client.clearSession();
    // An older tab can still contain its own copy, but logout must win.
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(original));
    expect(createApiClient(origin, { fetch: fetcher() }).getSession()).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("never replaces a persistent entry with a legacy tab session, even if that entry expired", () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session(secondToken)));
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session()));
    expect(createApiClient(origin, { fetch: fetcher() }).getSession()?.token).toBe(secondToken);
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    localStorage.setItem(SESSION_KEY, JSON.stringify(session(secondToken, Date.now() - 1)));
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session()));
    expect(createApiClient(origin, { fetch: fetcher() }).getSession()).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("keeps injected storage isolated from browser storage and legacy migration", () => {
    const storage = memoryStorage();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session()));
    localStorage.setItem(SESSION_KEY, JSON.stringify(session(secondToken)));
    const client = createApiClient(origin, { storage, fetch: fetcher() });
    expect(client.getSession()).toBeNull();
    client.setSession(session());
    expect(storage.length).toBe(1);
    client.clearSession();
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!).token).toBe(secondToken);
    expect(sessionStorage.getItem(SESSION_KEY)).not.toBeNull();
  });

  it("notifies subscribed tabs of login and logout while ignoring unrelated storage events", () => {
    const first = createApiClient(origin, { fetch: fetcher() });
    const second = createApiClient(origin, { fetch: fetcher() });
    const listener = vi.fn();
    stops.push(second.subscribeSession(listener));
    first.setSession(session());
    storageEvent("unrelated");
    storageEvent(SESSION_KEY, sessionStorage);
    expect(listener).not.toHaveBeenCalled();
    storageEvent();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(second.getSession()?.token).toBe(firstToken);
    first.clearSession();
    storageEvent();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(second.getSession()).toBeNull();
    first.setSession(session(secondToken));
    storageEvent();
    expect(second.getSession()?.token).toBe(secondToken);
    localStorage.clear();
    storageEvent(null);
    expect(second.getSession()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("reads current storage before a request even without a delivered storage event", async () => {
    const transport = fetcher();
    const client = createApiClient(origin, { fetch: transport });
    client.setSession(session());
    localStorage.setItem(SESSION_KEY, JSON.stringify(session(secondToken)));
    await client.request("/v1/portal");
    expect(new Headers(transport.mock.calls[0][1]?.headers).get("Authorization")).toBe(`Bearer ${secondToken}`);
    localStorage.removeItem(SESSION_KEY);
    await client.request("/v1/portal");
    expect(new Headers(transport.mock.calls[1][1]?.headers).has("Authorization")).toBe(false);
  });

  it("ignores delayed event values and reports the latest stored session once", () => {
    const client = createApiClient(origin, { fetch: fetcher() });
    client.setSession(session());
    const listener = vi.fn(() => { client.getSession(); });
    stops.push(client.subscribeSession(listener));
    localStorage.setItem(SESSION_KEY, JSON.stringify(session(secondToken)));
    storageEvent(SESSION_KEY, localStorage, JSON.stringify(session()));
    storageEvent(SESSION_KEY, localStorage, null);
    expect(client.getSession()?.token).toBe(secondToken);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("attaches one storage listener while subscribed and detaches when the last subscriber leaves", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const client = createApiClient(origin, { fetch: fetcher() });
    const one = client.subscribeSession(vi.fn());
    const two = client.subscribeSession(vi.fn());
    expect(add.mock.calls.filter(([type]) => type === "storage")).toHaveLength(1);
    one();
    expect(remove.mock.calls.filter(([type]) => type === "storage")).toHaveLength(0);
    two();
    expect(remove.mock.calls.filter(([type]) => type === "storage")).toHaveLength(1);
    const again = client.subscribeSession(vi.fn());
    expect(add.mock.calls.filter(([type]) => type === "storage")).toHaveLength(2);
    again();
  });

  it("does not let an old 401 erase a newer session written by another tab", async () => {
    let resolve!: (response: Response) => void;
    const transport = vi.fn<typeof fetch>(() => new Promise<Response>((done) => { resolve = done; }));
    const client = createApiClient(origin, { fetch: transport });
    client.setSession(session());
    const pending = client.request("/v1/portal");
    localStorage.setItem(SESSION_KEY, JSON.stringify(session(secondToken)));
    resolve(Response.json({ message: "Old session revoked" }, { status: 401 }));
    await expect(pending).rejects.toBeInstanceOf(ApiError);
    expect(client.getSession()?.token).toBe(secondToken);
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!).token).toBe(secondToken);
  });

  it("compares the latest stored identity when clearing a captured token", () => {
    const client = createApiClient(origin, { fetch: fetcher() });
    client.setSession(session());
    localStorage.setItem(SESSION_KEY, JSON.stringify(session(secondToken)));
    client.clearSession(firstToken);
    expect(client.getSession()?.token).toBe(secondToken);
    client.clearSession(secondToken);
    expect(client.getSession()).toBeNull();
  });

  it("expires sessions at their original server-provided expiry and notifies subscribers", () => {
    let time = Date.now();
    const client = createApiClient(origin, { fetch: fetcher(), now: () => time });
    client.setSession(session(firstToken, time + 100));
    const listener = vi.fn();
    stops.push(client.subscribeSession(listener));
    time += 100;
    expect(client.getSession()).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("does not delete a newer stored login while discarding an expired value", () => {
    const storage = memoryStorage();
    const client = createApiClient(origin, { storage, fetch: fetcher() });
    const expired = JSON.stringify(session(firstToken, Date.now() - 1));
    const newer = JSON.stringify(session(secondToken));
    let reads = 0;
    vi.spyOn(storage, "getItem").mockImplementation(() => ++reads === 1 ? expired : newer);
    const remove = vi.spyOn(storage, "removeItem");
    expect(client.getSession()?.token).toBe(secondToken);
    expect(remove).not.toHaveBeenCalled();
  });

  it.each(["ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_"])("rejects GitHub credentials with prefix %s", (prefix) => {
    const credential = session(prefix + "never-store-a-github-credential-0123456789");
    localStorage.setItem(SESSION_KEY, JSON.stringify(credential));
    const client = createApiClient(origin, { fetch: fetcher() });
    expect(client.getSession()).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(() => client.setSession(credential)).toThrow(/invalid or expired/);
  });

  it("never trusts stored roles or profile fields as part of the session", () => {
    const client = createApiClient(origin, { fetch: fetcher() });
    client.setSession({ ...session(), role: "Admin", profile: { approvedTopics: ["exoplanets"] } });
    expect(Object.keys(JSON.parse(localStorage.getItem(SESSION_KEY)!)).sort()).toEqual(["expiresAt", "token"]);
    expect(client.getSession()).not.toHaveProperty("role");
    const copy = client.getSession()!;
    copy.token = "attempt-to-change-the-cached-session";
    expect(client.getSession()?.token).toBe(firstToken);
  });

  it("reports unavailable persistent storage without silently keeping an in-memory login", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    const client = createApiClient(origin, { fetch: fetcher() });
    expect(client.getSession()).toBeNull();
    expect(() => client.setSession(session())).toThrow(/Browser storage is unavailable/);
    expect(client.getSession()).toBeNull();
  });

  it("reports failed writes and fails closed if storage becomes unreadable", () => {
    const storage = memoryStorage();
    const client = createApiClient(origin, { storage, fetch: fetcher() });
    const write = vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
    expect(() => client.setSession(session())).toThrow(/Browser storage is unavailable/);
    expect(client.getSession()).toBeNull();
    write.mockRestore();
    client.setSession(session());
    const listener = vi.fn();
    stops.push(client.subscribeSession(listener));
    vi.spyOn(storage, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
    expect(client.getSession()).toBeNull();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("reports failed removal but does not resurrect that token in the current tab", () => {
    const storage = memoryStorage();
    const client = createApiClient(origin, { storage, fetch: fetcher() });
    client.setSession(session());
    const remove = vi.spyOn(storage, "removeItem").mockImplementation(() => { throw new Error("Read only"); });
    expect(() => client.clearSession()).toThrow(/browser storage could not be cleared/);
    expect(client.getSession()).toBeNull();
    expect(() => client.clearSession()).toThrow(/browser storage could not be cleared/);
    expect(client.getSession()).toBeNull();
    remove.mockRestore();
    client.clearSession();
    expect(storage.getItem(SESSION_KEY)).toBeNull();
  });
});
