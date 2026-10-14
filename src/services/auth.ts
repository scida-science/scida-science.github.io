import type { SupabaseClient, User } from "@supabase/supabase-js";

/** Exchanges PKCE email links before loading account data; hash routes remain untouched. */
export async function completeAuthCallback(
  client: SupabaseClient,
): Promise<boolean> {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const code = url.searchParams.get("code");
  const callbackError =
    url.searchParams.get("error_description") ??
    url.searchParams.get("error") ??
    fragment.get("error_description") ??
    fragment.get("error");
  const unsupportedTokens =
    fragment.has("access_token") || fragment.has("refresh_token");
  const recovery = url.searchParams.get("recovery") === "1";
  if (callbackError || code || unsupportedTokens) {
    for (const key of ["code", "error", "error_code", "error_description"])
      url.searchParams.delete(key);
    const replaceHash =
      fragment.has("error") ||
      fragment.has("error_description") ||
      unsupportedTokens;
    if (replaceHash) url.hash = "/login";
    window.history.replaceState(null, "", url);
    if (replaceHash) window.dispatchEvent(new PopStateEvent("popstate"));
  }
  if (callbackError) throw new Error(callbackError);
  if (unsupportedTokens)
    throw new Error(
      "This account link uses an unsupported sign-in flow. Request a new confirmation or recovery email from this website and open it in the same browser.",
    );
  if (code) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error)
      throw new Error(
        `${error.message} Request a new email link and open it in the same browser used to register or request recovery.`,
      );
  }
  return recovery;
}

export async function verifiedAuthUser(
  client: SupabaseClient,
): Promise<User | null> {
  const session = await client.auth.getSession();
  if (session.error) throw new Error(session.error.message);
  if (!session.data.session) return null;
  const result = await client.auth.getUser();
  if (result.error) throw new Error(result.error.message);
  if (!result.data.user?.email_confirmed_at)
    throw new Error("Confirm your email address before signing in.");
  return result.data.user;
}

export function clearRecoveryMarker(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("recovery");
  window.history.replaceState(null, "", url);
}
