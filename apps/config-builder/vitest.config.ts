import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

export default defineConfig({
  resolve: {
    alias: {
      "@openclaw/config/schema.ts": path.resolve(here, "src/shims/config-schema.ts"),
      "@openclaw/config/zod-schema.ts": path.resolve(here, "src/shims/zod-schema.ts"),
      "@openclaw/config": path.resolve(repoRoot, "src/config"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
