import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Generate project-local TLS credentials; never installs a CA into an OS trust store. */
export function ensureDevTls() {
  const directory = fileURLToPath(new URL("../.certs/", import.meta.url));
  const ca = join(directory, "dev-ca.pem");
  const cert = join(directory, "localhost.pem");
  const key = join(directory, "localhost-key.pem");
  if (existsSync(cert) && existsSync(key) && existsSync(ca)) return { ca, cert, key };
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  function openssl(...args) {
    execFileSync("openssl", args, { stdio: "pipe" });
  }
  if (!existsSync(ca)) {
    openssl(
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(directory, "dev-ca-key.pem"),
      "-out",
      ca,
      "-days",
      "3650",
      "-subj",
      "/CN=Yatma local development CA",
      "-addext",
      "basicConstraints=critical,CA:TRUE",
    );
    chmodSync(join(directory, "dev-ca-key.pem"), 0o600);
  }
  openssl(
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    key,
    "-out",
    join(directory, "localhost.csr"),
    "-subj",
    "/CN=localhost",
  );
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry?.family === "IPv4")
    .map((entry) => `IP:${entry.address}`);
  const extensions = join(directory, "localhost.ext");
  writeFileSync(
    extensions,
    `basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${[...new Set(["DNS:localhost", "IP:127.0.0.1", "IP:::1", ...addresses])].join(",")}\n`,
  );
  openssl(
    "x509",
    "-req",
    "-in",
    join(directory, "localhost.csr"),
    "-CA",
    ca,
    "-CAkey",
    join(directory, "dev-ca-key.pem"),
    "-CAcreateserial",
    "-out",
    cert,
    "-days",
    "90",
    "-extfile",
    extensions,
  );
  chmodSync(key, 0o600);
  return { ca, cert, key };
}
