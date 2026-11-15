import { spawn } from "node:child_process";
import { ensureDevTls } from "../../scripts/dev-tls.mjs";

const tls = ensureDevTls();
console.log(`Trust the project-local CA on your test browser/device: ${tls.ca}`);
const child = spawn(
  "./node_modules/.bin/wrangler",
  [
    "dev",
    "--port",
    "8791",
    "--local-protocol",
    "https",
    "--https-cert-path",
    tls.cert,
    "--https-key-path",
    tls.key,
  ],
  { stdio: "inherit", env: { ...process.env, NODE_EXTRA_CA_CERTS: tls.ca } },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
