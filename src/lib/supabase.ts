import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface BackendConfiguration {
  url: string;
  publishableKey: string;
}

/** Frontend configuration only. Secret/service-role keys must never be bundled. */
export function parseBackendConfiguration(
  url?: string,
  key?: string,
): {
  configuration: BackendConfiguration | null;
  error: string | null;
} {
  if (!url && !key) return { configuration: null, error: null };
  if (!url?.trim() || !key?.trim())
    return {
      configuration: null,
      error: "Both the Supabase URL and publishable key must be configured.",
    };
  try {
    const parsed = new URL(url.trim());
    if (
      (!["https:"].includes(parsed.protocol) &&
        !(
          parsed.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(parsed.hostname)
        )) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !["", "/"].includes(parsed.pathname)
    )
      throw new Error(
        "Use a Supabase project URL (HTTPS, or localhost for development).",
      );
    const publishableKey = key.trim();
    if (publishableKey.startsWith("sb_secret_"))
      throw new Error(
        "A privileged Supabase key was rejected. Use only a frontend publishable or legacy anon key.",
      );
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
      const parts = publishableKey.split(".");
      if (parts.length !== 3)
        throw new Error("Use a Supabase publishable key or legacy anon key.");
      const claims = JSON.parse(
        atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
      ) as { role?: string };
      if (claims.role !== "anon")
        throw new Error(
          "A privileged or unsupported key was rejected. Use the publishable or anon key.",
        );
    }
    return {
      configuration: { url: parsed.origin, publishableKey },
      error: null,
    };
  } catch (error) {
    return {
      configuration: null,
      error:
        error instanceof Error
          ? error.message
          : "Invalid Supabase configuration.",
    };
  }
}

let cachedClient: SupabaseClient | null | undefined;
let cachedError: string | null = null;
export function getBackend(): {
  client: SupabaseClient | null;
  error: string | null;
} {
  if (cachedClient === undefined) {
    const { configuration, error } = parseBackendConfiguration(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    );
    cachedError = error;
    cachedClient = configuration
      ? createClient(configuration.url, configuration.publishableKey, {
          auth: {
            flowType: "pkce",
            detectSessionInUrl: false,
            persistSession: true,
            autoRefreshToken: true,
          },
        })
      : null;
  }
  return { client: cachedClient, error: cachedError };
}

export function authRedirectUrl(recovery = false): string {
  const url = new URL(import.meta.env.BASE_URL, window.location.origin);
  if (recovery) url.searchParams.set("recovery", "1");
  return url.href;
}
