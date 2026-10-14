import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  for (const key of Object.keys(env))
    if (key !== "VITE_SCIDA_API_URL")
      throw new Error(
        "Only VITE_SCIDA_API_URL is allowed in browser configuration.",
      );
  if (env.VITE_SCIDA_API_URL) {
    const url = new URL(env.VITE_SCIDA_API_URL);
    if (
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["127.0.0.1", "localhost"].includes(url.hostname)
        )) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error(
        "VITE_SCIDA_API_URL must be a public HTTPS backend origin or localhost.",
      );
  }
  return {
    plugins: [react()],
    base: "/",
    build: { rollupOptions: { output: { manualChunks: { math: ["katex"] } } } },
  };
});
