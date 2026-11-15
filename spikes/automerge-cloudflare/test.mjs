import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Repo } from "@automerge/automerge-repo";
import { WebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";
import { ensureDevTls } from "../../scripts/dev-tls.mjs";

const tls = ensureDevTls();
if (process.env.YATMA_SPIKE_TLS !== "1") {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
    stdio: "inherit",
    env: { ...process.env, YATMA_SPIKE_TLS: "1", NODE_EXTRA_CA_CERTS: tls.ca },
  });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  process.exit(code ?? 1);
}

const port = Number(process.env.SPIKE_PORT ?? 8791);
const base = `https://localhost:${port}`;
const endpoint = `wss://localhost:${port}/sync/poc?token=local-spike-only`;
const directory = await mkdtemp(join(tmpdir(), "yatma-automerge-"));
const repos = [];
let server;
let output = "";
async function until(check, description) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(25);
  }
  throw new Error(`Timed out: ${description}\n${output.slice(-6000)}`);
}
async function start() {
  output = "";
  server = spawn(
    "./node_modules/.bin/wrangler",
    [
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--local-protocol",
      "https",
      "--https-cert-path",
      tls.cert,
      "--https-key-path",
      tls.key,
      "--persist-to",
      directory,
      "--inspector-port",
      "0",
    ],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
  );
  server.stdout.on("data", (data) => {
    output += data;
  });
  server.stderr.on("data", (data) => {
    output += data;
  });
  await until(async () => {
    try {
      return (await fetch(base)).ok;
    } catch {
      return false;
    }
  }, "Worker startup");
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  await exited;
}
function memoryStorage() {
  const values = new Map();
  return {
    async load(key) {
      return values.get(JSON.stringify(key));
    },
    async save(key, data) {
      values.set(JSON.stringify(key), data.slice());
    },
    async remove(key) {
      values.delete(JSON.stringify(key));
    },
    async loadRange(prefix) {
      return [...values]
        .filter(([key]) => prefix.every((part, index) => JSON.parse(key)[index] === part))
        .map(([key, data]) => ({ key: JSON.parse(key), data }));
    },
    async removeRange(prefix) {
      for (const { key } of await this.loadRange(prefix)) await this.remove(key);
    },
  };
}
function client() {
  const network = new WebSocketClientAdapter(endpoint);
  const storage = memoryStorage();
  const repo = new Repo({ storage, network: [network] });
  repos.push(repo);
  return { repo, network, storage };
}
try {
  await start();
  console.log("Worker started");
  assert.equal((await fetch(`${base}/sync/poc`)).status, 401);
  const first = client();
  const firstTask = first.repo.create({ title: "Original", completed: false, details: "" });
  await until(() => first.network.remotePeerId !== undefined, "first peer handshake");
  await first.repo.flush();
  console.log("First document created", firstTask.url);
  const second = client();
  const secondTask = await second.repo.find(firstTask.url);
  await secondTask.whenReady();
  await until(() => secondTask.doc()?.title === "Original", "initial replication");
  console.log("Initial replication passed");
  first.network.disconnect();
  second.network.disconnect();
  firstTask.change((task) => {
    task.title = "Edited offline";
  });
  secondTask.change((task) => {
    task.completed = true;
  });
  await first.repo.flush();
  await second.repo.flush();
  const reopened = new Repo({ storage: first.storage });
  repos.push(reopened);
  const offlineTask = await reopened.find(firstTask.url);
  await offlineTask.whenReady();
  assert.equal(offlineTask.doc().title, "Edited offline");
  first.network.connect(first.repo.peerId);
  second.network.connect(second.repo.peerId);
  await until(
    () => firstTask.doc()?.completed === true && secondTask.doc()?.title === "Edited offline",
    "two offline clients converge",
  );
  const agent = client();
  const agentTask = await agent.repo.find(firstTask.url);
  await agentTask.whenReady();
  const details = randomBytes(180000).toString("base64");
  agentTask.change((task) => {
    task.details = details;
  });
  await until(
    () => firstTask.doc()?.details === details && secondTask.doc()?.details === details,
    "third writer converges",
  );
  const flushed = await fetch(`${base}/flush/poc?token=local-spike-only`);
  assert.equal(flushed.status, 200);
  for (const repo of repos.splice(0)) await repo.shutdown();
  await stop();
  await start();
  const fresh = client();
  const recovered = await fresh.repo.find(firstTask.url);
  await recovered.whenReady();
  assert.deepEqual(recovered.doc(), { title: "Edited offline", completed: true, details });
  console.log(
    "PASS: unauthorized admission, offline writes/reopen, two-client convergence, third writer, chunked SQLite storage, full Worker restart and fresh-client recovery.",
  );
} catch (error) {
  console.error(output.slice(-6000));
  throw error;
} finally {
  for (const repo of repos) {
    try {
      await repo.shutdown();
    } catch {}
  }
  await stop();
  await rm(directory, { recursive: true, force: true });
}
