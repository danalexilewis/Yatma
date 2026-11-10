import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceFiles = (pattern) => globSync(pattern, { cwd: root, exclude: ["**/*.test.ts", "**/*.test.tsx"] });
const violations = [];

function checkImports(pattern, allowed, label) {
  for (const file of sourceFiles(pattern)) {
    const source = readFileSync(resolve(root, file), "utf8");
    for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*["']([^"']+)["']/g)) {
      const specifier = match[1];
      if (!allowed(specifier)) violations.push(`${file}: disallowed import ${specifier} (${label})`);
    }
  }
}

checkImports(
  "packages/core/src/**/*.ts",
  (specifier) => specifier.startsWith("./") || specifier.startsWith("../") || specifier === "effect" || specifier.startsWith("effect/"),
  "core may import only Effect and its own modules",
);
checkImports(
  "apps/mobile/src/**/*.ts",
  (specifier) => !specifier.startsWith("alchemy") && !specifier.startsWith("@clerk/backend") && !specifier.startsWith("@effect/sql-sqlite-do"),
  "mobile must not import Worker-only packages",
);
checkImports(
  "apps/mobile/src/**/*.tsx",
  (specifier) => !specifier.startsWith("alchemy") && !specifier.startsWith("@clerk/backend") && !specifier.startsWith("@effect/sql-sqlite-do"),
  "mobile must not import Worker-only packages",
);
checkImports(
  "packages/contracts/src/**/*.ts",
  (specifier) => specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("@yatma/core") || specifier.startsWith("@eddy-works/never-rest") || specifier === "effect" || specifier.startsWith("effect/"),
  "contracts may declare shared schemas but not runtime implementations",
);

if (violations.length > 0) {
  process.stderr.write(`${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Package boundaries are valid.\n");
}
