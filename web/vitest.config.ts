import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": here,
    },
  },
  test: {
    environment: "node",
    // Vitest resolves test-file imports through its own alias table; keep it
    // in sync with resolve.alias so "@/..." works inside route handlers too.
    alias: {
      "@": here,
    },
  },
});
