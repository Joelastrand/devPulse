import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // One jsdom worker per core starves the CPU when anything else runs
    // alongside the suite (another vitest run, tsc, eslint), which pushes
    // jsdom-heavy tests past the default 5s timeout intermittently. Capping at
    // half the cores trades some wall time for stable results.
    maxWorkers: "50%",
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "app/**/*.{test,spec}.{ts,tsx}",
    ],
    alias: {
      // Next.js resolves "server-only" to a throwing stub unless its
      // "react-server" bundler condition is set; Vitest never sets it, so
      // alias it to a no-op here instead of failing every server-only import.
      "server-only": fileURLToPath(
        new URL("./test/server-only-mock.ts", import.meta.url),
      ),
    },
  },
});
