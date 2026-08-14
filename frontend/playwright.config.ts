import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:4174/",
    headless: true,
  },
  webServer: {
    command:
      "npm run build && npx vite preview --host 127.0.0.1 --port 4174 --strictPort",
    port: 4174,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
