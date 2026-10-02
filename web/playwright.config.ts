import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:8010";

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "python -m rulekeeper serve --port 8010",
    cwd: "..",
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { RULEKEEPER_PROVIDER: "evidence", RULEKEEPER_MODEL_THREADS: "2" },
  },
});
