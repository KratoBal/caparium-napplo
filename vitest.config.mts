import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      { resolve: { alias }, test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" } },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          // one database: files run one after another
          fileParallelism: false,
          globalSetup: ["tests/integration/global-setup.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
