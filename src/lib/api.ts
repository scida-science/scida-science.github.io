import type { ReviewerPackage } from "../types";
import { parseReviewerPackage } from "./reviewerPackage";

export interface SciDASession {
  token: string;
  expiresAt: string;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export const SESSION_KEY = "scida.session.v1";
export function browserSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
export function parseApiConfiguration(value?: string): {
  url: string | null;
  error: string | null;
} {
  if (!value?.trim()) return { url: null, error: null };
  try {
    const url = new URL(value.trim());
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "Use an HTTPS SciDA API URL, or a loopback HTTP URL for development. Do not include credentials, query parameters, or fragments.",
      );
    return { url: url.href.replace(/\/+$/, ""), error: null };
  } catch (error) {
    return {
      url: null,
      error:
        error instanceof Error
          ? error.message
          : "The SciDA API URL is invalid.",
    };
  }
}
function parseSession(value: unknown, now: number): SciDASession | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.token !== "string" ||
    candidate.token.length < 20 ||
    candidate.token.length > 4096 ||
    /\s/.test(candidate.token) ||
    /^(gh[pousr]_|github_pat_)/.test(candidate.token)
  )
    return null;
  const rawExpiry = candidate.expiresAt;
  const expires =
    typeof rawExpiry === "number"
      ? rawExpiry < 1e12
        ? rawExpiry * 1000
        : rawExpiry
      : typeof rawExpiry === "string"
        ? Date.parse(rawExpiry)
        : NaN;
  if (!Number.isFinite(expires) || expires <= now) return null;
  return { token: candidate.token, expiresAt: new Date(expires).toISOString() };
}
function responseError(value: unknown, status: number): string {
  if (value && typeof value === "object") {
    const body = value as Record<string, unknown>;
    if (typeof body.error === "string") return body.error;
    if (typeof body.message === "string") return body.message;
    if (
      body.error &&
      typeof body.error === "object" &&
      "message" in body.error &&
      typeof body.error.message === "string"
    )
      return body.error.message;
  }
  return status === 401
    ? "Your SciDA session has expired or was revoked. Sign in with GitHub again."
    : `The SciDA service could not complete this request (HTTP ${status}).`;
}
export interface ApiDependencies {
  fetch?: typeof fetch;
  storage?: Storage | null;
  now?: () => number;
}

/** Only revocable SciDA sessions reach this tab. GitHub credentials stay on the Worker. */
export function createApiClient(
  baseUrl: string,
  dependencies: ApiDependencies = {},
) {
  const storage =
    dependencies.storage === undefined
      ? browserSessionStorage()
      : dependencies.storage;
  const fetcher = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  const now = dependencies.now ?? Date.now;
  const listeners = new Set<() => void>();
  let session: SciDASession | null = null;
  try {
    const raw = storage?.getItem(SESSION_KEY);
    session = raw ? parseSession(JSON.parse(raw), now()) : null;
    if (raw && !session) storage?.removeItem(SESSION_KEY);
  } catch {
    try {
      storage?.removeItem(SESSION_KEY);
    } catch {
      /* Storage can be disabled. */
    }
  }
  const notify = () => listeners.forEach((listener) => listener());
  function clearSession() {
    const changed = session !== null;
    session = null;
    try {
      storage?.removeItem(SESSION_KEY);
    } catch {
      /* In-memory access is still revoked. */
    }
    if (changed) notify();
  }
  function getSession(): SciDASession | null {
    if (session && Date.parse(session.expiresAt) <= now()) clearSession();
    return session;
  }
  function setSession(value: unknown) {
    const validated = parseSession(value, now());
    if (!validated)
      throw new Error(
        "The sign-in service returned an invalid or expired SciDA session.",
      );
    if (!storage)
      throw new Error(
        "Session storage is unavailable. Enable browser storage before signing in.",
      );
    storage.setItem(SESSION_KEY, JSON.stringify(validated));
    session = validated;
    notify();
  }
  async function response(
    path: string,
    body?: unknown,
    options: { method?: string; anonymous?: boolean; token?: string } = {},
  ): Promise<Response> {
    if (!path.startsWith("/") || path.startsWith("//"))
      throw new Error("Invalid API endpoint.");
    const token =
      options.token ?? (options.anonymous ? null : getSession()?.token);
    const headers = new Headers({ Accept: "application/json" });
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (body !== undefined) headers.set("Content-Type", "application/json");
    const result = await fetcher(`${baseUrl}${path}`, {
      method: options.method ?? (body === undefined ? "GET" : "POST"),
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
    if (!result.ok) {
      let payload: unknown;
      try {
        payload = await result.json();
      } catch {
        payload = null;
      }
      if (result.status === 401 && token === session?.token) clearSession();
      throw new ApiError(responseError(payload, result.status), result.status);
    }
    return result;
  }
  return {
    baseUrl,
    storage,
    getSession,
    setSession,
    clearSession,
    subscribeSession(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async request<T>(
      path: string,
      body?: unknown,
      options?: { method?: string; anonymous?: boolean; token?: string },
    ): Promise<T> {
      const result = await response(path, body, options);
      if (result.status === 204) return undefined as T;
      let payload: unknown;
      try {
        payload = await result.json();
      } catch {
        throw new Error("The SciDA API returned an invalid response.");
      }
      if (
        payload &&
        typeof payload === "object" &&
        "ok" in payload &&
        payload.ok === false
      )
        throw new Error(responseError(payload, result.status));
      return payload as T;
    },
    async download(
      path: string,
      options: { maxBytes?: number } = {},
    ): Promise<{ blob?: Blob; filename?: string; url?: string; package?: ReviewerPackage }> {
      const result = await response(path);
      if (result.headers.get("Content-Type")?.includes("application/json")) {
        const payload: unknown = await result.json();
        if (payload && typeof payload === "object" && "package" in payload)
          return { package: parseReviewerPackage(payload.package, baseUrl, path) };
        const value =
          payload && typeof payload === "object" && "url" in payload
            ? payload.url
            : null;
        if (typeof value !== "string")
          throw new Error("The material response is invalid.");
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password)
          throw new Error("The material link is not a valid public HTTPS URL.");
        return { url: url.href };
      }
      const disposition = result.headers.get("Content-Disposition") ?? "";
      const match = /filename\*?=(?:UTF-8''|"?)([^";]+)/i.exec(disposition);
      let filename: string | undefined;
      if (match) {
        try {
          filename = decodeURIComponent(match[1])
            .replace(/[\\/\x00-\x1f]/g, "_")
            .slice(0, 200);
        } catch {
          filename = undefined;
        }
      }
      if (options.maxBytes !== undefined) {
        const reader = result.body?.getReader();
        if (!reader) throw new Error("The package file is empty.");
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > options.maxBytes) {
            await reader.cancel();
            throw new Error("The package file exceeds its recorded size.");
          }
          chunks.push(new Uint8Array(value));
        }
        return { blob: new Blob(chunks), filename };
      }
      return { blob: await result.blob(), filename };
    },
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;
let cached: { client: ApiClient | null; error: string | null } | undefined;
export function getBackend(): {
  client: ApiClient | null;
  error: string | null;
} {
  if (!cached) {
    const parsed = parseApiConfiguration(import.meta.env.VITE_SCIDA_API_URL);
    cached = {
      client: parsed.url ? createApiClient(parsed.url) : null,
      error: parsed.error,
    };
  }
  return cached;
}
