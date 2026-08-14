import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  base: mode === "github-pages" ? "/TextMosaic/" : "/",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
}));
