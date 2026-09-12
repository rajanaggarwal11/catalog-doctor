import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Fix tests copy fixtures into their own temp directories, so they are safe
    // to run in parallel; the fixtures themselves are only ever read.
    environment: "node",
  },
});
