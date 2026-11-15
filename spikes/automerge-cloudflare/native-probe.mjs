import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDevTls } from "../../scripts/dev-tls.mjs";

ensureDevTls();

const mobileRoot = fileURLToPath(new URL("../../apps/mobile/", import.meta.url));
const mobile = createRequire(new URL("../../apps/mobile/package.json", import.meta.url));
const expo = createRequire(mobile.resolve("expo/metro-config"));
const Metro = expo("@expo/metro/metro");
const directory = await mkdtemp(join(tmpdir(), "yatma-automerge-native-"));
try {
  const config = mobile(join(mobileRoot, "metro.config.js"));
  // This probe builds a bundle without opening a server. Metro's standalone
  // validator still expects boolean TLS, while Expo's server accepts TLS options.
  config.server = { ...config.server, tls: false };
  await Metro.runBuild(config, {
    entry: fileURLToPath(new URL("./native-probe.ts", import.meta.url)),
    platform: "ios",
    dev: true,
    minify: false,
    out: join(directory, "probe.js"),
  });
  console.log(
    "PASS: Expo iOS Metro bundle. Hermes execution and durable native storage remain unverified.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
