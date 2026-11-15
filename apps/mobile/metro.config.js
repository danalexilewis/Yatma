const path = require("node:path");
const fs = require("node:fs");
const { getDefaultConfig } = require("expo/metro-config");
const { withDevelopmentStorageReset } = require("./development/resetStorage");

/** @type {import("expo/metro-config").MetroConfig} */
const config = getDefaultConfig(__dirname);
const workspaceRoot = path.resolve(__dirname, "../..");
const tlsCert = process.env.SSL_CRT_FILE || path.join(workspaceRoot, ".certs/localhost.pem");
const tlsKey = process.env.SSL_KEY_FILE || path.join(workspaceRoot, ".certs/localhost-key.pem");
if (fs.existsSync(tlsCert) && fs.existsSync(tlsKey)) {
  // Expo 58's --https flag alone does not configure Metro's TLS listener.
  config.server.tls = { key: fs.readFileSync(tlsKey), cert: fs.readFileSync(tlsCert) };
} else if (!process.argv.includes("export")) {
  throw new Error(
    "HTTPS certificates are required. Run pnpm dev or pnpm dev:web from the repository root to create them.",
  );
}
const previousEnhanceMiddleware = config.server.enhanceMiddleware;

config.server.enhanceMiddleware = function enhanceDevelopmentMiddleware(middleware, server) {
  const enhanced = previousEnhanceMiddleware
    ? previousEnhanceMiddleware(middleware, server)
    : middleware;
  return withDevelopmentStorageReset(enhanced);
};

config.watchFolders = [...new Set([...(config.watchFolders ?? []), workspaceRoot])];

const previousResolveRequest = config.resolver.resolveRequest;
const assetExts = new Set(config.resolver.assetExts ?? []);
assetExts.add("wasm");
const sourceExts = (config.resolver.sourceExts ?? []).filter((ext) => ext !== "wasm");

config.resolver = {
  ...config.resolver,
  assetExts: [...assetExts],
  sourceExts,
  nodeModulesPaths: [
    path.resolve(__dirname, "node_modules"),
    path.resolve(workspaceRoot, "node_modules"),
  ],
  // Allow resolving package-local transitive deps (needed for react-native-web on pnpm).
  disableHierarchicalLookup: false,
  resolveRequest(context, moduleName, platform) {
    if (
      platform === "web" &&
      moduleName === "react-native" &&
      !context.originModulePath.includes(`${path.sep}react-native-web${path.sep}`)
    ) {
      return context.resolveRequest(context, "react-native-web", platform);
    }
    if (previousResolveRequest) {
      return previousResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

// Uniwind's web wrappers crash under Metro (`import * as RN from "react-native"`).
// Re-enable withUniwindConfig for native once web is solid; className is ignored on web for now.
module.exports = config;
