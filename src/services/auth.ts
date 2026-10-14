import type { ApiClient } from "../lib/api";
export const OAUTH_KEY = "scida.oauth.v1";
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
export interface AuthDependencies {
  crypto?: Crypto;
  navigate?: (url: string) => void;
  currentUrl?: () => URL;
  replace?: (url: URL) => void;
  now?: () => number;
}

/** PKCE binds a single-use exchange code to this tab; OAuth cookies stay first-party. */
export function createGitHubAuth(
  client: ApiClient,
  dependencies: AuthDependencies = {},
) {
  const crypto = dependencies.crypto ?? globalThis.crypto;
  const now = dependencies.now ?? Date.now;
  const navigate =
    dependencies.navigate ?? ((url: string) => window.location.assign(url));
  const currentUrl =
    dependencies.currentUrl ?? (() => new URL(window.location.href));
  const replace =
    dependencies.replace ??
    ((url: URL) => {
      window.history.replaceState(null, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
  return {
    async signIn() {
      if (!client.storage)
        throw new Error(
          "Session storage is unavailable. Enable browser storage before signing in.",
        );
      const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
      const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = base64url(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(verifier),
          ),
        ),
      );
      client.storage.setItem(
        OAUTH_KEY,
        JSON.stringify({ verifier, state, createdAt: now() }),
      );
      const url = new URL(`${client.baseUrl}/auth/start`);
      url.searchParams.set("challenge", challenge);
      url.searchParams.set("state", state);
      navigate(url.href);
    },
    async completeCallback(): Promise<boolean> {
      const url = currentUrl();
      const [path, query = ""] = url.hash.slice(1).split("?");
      if (path !== "/auth/callback") return false;
      const params = new URLSearchParams(query);
      const code = params.get("code");
      const state = params.get("state");
      const callbackError =
        params.get("error_description") ?? params.get("error");
      url.hash = "/auth/callback";
      replace(url);
      let pending: {
        verifier?: string;
        state?: string;
        createdAt?: number;
      } | null = null;
      try {
        const raw = client.storage?.getItem(OAUTH_KEY);
        if (raw) pending = JSON.parse(raw);
      } catch {
        pending = null;
      }
      client.storage?.removeItem(OAUTH_KEY);
      try {
        if (callbackError) throw new Error(callbackError);
        if (
          !code ||
          !state ||
          !pending?.verifier ||
          state !== pending.state ||
          typeof pending.createdAt !== "number" ||
          now() - pending.createdAt > 10 * 60_000 ||
          pending.createdAt > now()
        )
          throw new Error(
            "The GitHub sign-in could not be verified in this browser tab. Start sign-in again.",
          );
        const session = await client.request<unknown>(
          "/auth/exchange",
          { code, verifier: pending.verifier },
          { anonymous: true },
        );
        client.setSession(session);
        url.hash = "/profile";
        replace(url);
        return true;
      } catch (error) {
        url.hash = "/login";
        replace(url);
        throw error;
      }
    },
  };
}
export type GitHubAuth = ReturnType<typeof createGitHubAuth>;
