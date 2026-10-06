import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "src/**/*.test.ts",
    ],
  },
});
