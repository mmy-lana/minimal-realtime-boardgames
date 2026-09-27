import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Node by default. UI suites opt into jsdom with a
    // `@vitest-environment jsdom` docblock on the first line of the file.
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./tests/setup.ts"],
    restoreMocks: true,
  },
});
