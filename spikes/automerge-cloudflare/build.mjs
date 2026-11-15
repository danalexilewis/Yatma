import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// Use the supported embedded-WASM entry point in a plain browser bundle.
await build({
  entryPoints: ["browser.ts"],
  bundle: true,
  format: "esm",
  outfile: "public/client.js",
  plugins: [
    {
      name: "automerge-browser-entry",
      setup(builder) {
        builder.onResolve({ filter: /^@automerge\/automerge$/ }, () => ({
          path: fileURLToPath(
            new URL(
              "node_modules/@automerge/automerge/dist/mjs/entrypoints/fullfat_base64.js",
              import.meta.url,
            ),
          ),
        }));
      },
    },
  ],
});
