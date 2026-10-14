import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Organization homepage repository: https://<organization>.github.io/.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  // Fail before bundling: a runtime check would expose a privileged key first.
  if (url || key) {
    if (!url || !key)
      throw new Error(
        "Configure both Supabase public environment variables, or leave both unset.",
      );
    const parsed = new URL(url);
    if (
      (parsed.protocol !== "https:" &&
        !(
          parsed.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(parsed.hostname)
        )) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/"
    ) {
      throw new Error(
        "Invalid Supabase project URL. Use HTTPS or a local development endpoint.",
      );
    }
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
      let role: string | undefined;
      try {
        const parts = key.split(".");
        if (parts.length === 3)
          role = JSON.parse(
            atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
          ).role;
      } catch {
        /* Reject invalid or privileged keys without printing their value. */
      }
      if (role !== "anon")
        throw new Error(
          "Refusing to bundle a secret or invalid Supabase key. Supply a publishable key or legacy anon key only.",
        );
    }
  }
  return {
    plugins: [react()],
    base: "/",
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            math: ["katex"],
            supabase: ["@supabase/supabase-js"],
          },
        },
      },
    },
  };
});
