import { defineConfig } from "tsup";

/**
 * No runtime dependencies: the CLI, the rules, the IRIS writer and the MCP server are this
 * package's own code, so `npx` installs one package and nothing in it opens a network connection.
 */
export default defineConfig({
  entry: { cli: "src/cli.ts", index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  dts: { entry: { index: "src/index.ts" } },
  sourcemap: true,
  clean: true,
  splitting: false,
});
