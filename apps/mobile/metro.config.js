const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import("expo/metro-config").MetroConfig} */
const config = getDefaultConfig(__dirname);
const workspaceRoot = path.resolve(__dirname, "../..");

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
