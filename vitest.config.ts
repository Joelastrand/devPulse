import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
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
