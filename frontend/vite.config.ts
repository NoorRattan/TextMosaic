import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  base: mode === "github-pages" ? "/TextMosaic/" : "/",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
}));
