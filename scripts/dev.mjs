import { spawn } from "node:child_process";
import { ensureDevTls } from "./dev-tls.mjs";

const tls = ensureDevTls();
console.log(
  `HTTPS development: trust ${tls.ca} on each browser/device you use. The CA is not installed automatically.`,
);
const child = spawn("pnpm", ["--filter", "@yatma/mobile", "dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    BROWSER: "none",
    SSL_CRT_FILE: tls.cert,
    SSL_KEY_FILE: tls.key,
    NODE_EXTRA_CA_CERTS: tls.ca,
  },
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
