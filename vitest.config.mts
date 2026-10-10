import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // "server-only" throws outside a server bundle. Tests run the same files in plain Node.
      "server-only": path.resolve(import.meta.dirname, "src/test/serverOnlyStub.ts"),
    },
  },
  test: { include: ["src/**/*.test.ts"] },
});
