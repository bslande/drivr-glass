import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          PUSH_TOKEN: "test-push-token",
          GLASS_SESSION_ID: "testsessionid01",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.spec.ts"],
    fileParallelism: false,
    sequence: { concurrent: false, shuffle: false },
  },
});
