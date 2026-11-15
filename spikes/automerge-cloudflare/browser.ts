import { Repo, type DocHandle, type AutomergeUrl } from "@automerge/automerge-repo";
import { WebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";

type Task = { title: string; completed: boolean };
if (location.protocol !== "https:") throw new Error("HTTPS required");
const network = new WebSocketClientAdapter(
  `wss://${location.host}/sync/poc?token=local-spike-only`,
);
const repo = new Repo({
  storage: new IndexedDBStorageAdapter("yatma-automerge-spike"),
  network: [network],
});
const documentInput = document.querySelector<HTMLInputElement>("#document")!;
const title = document.querySelector<HTMLInputElement>("#title")!;
const status = document.querySelector<HTMLElement>("#status")!;
const toggle = document.querySelector<HTMLButtonElement>("#toggle")!;
let handle: DocHandle<Task> | undefined;
let connected = true;
function render() {
  status.textContent = JSON.stringify(
    { connected, url: handle?.url, task: handle?.doc() },
    null,
    2,
  );
  title.value = handle?.doc()?.title ?? "";
}
async function attach(next: DocHandle<Task>) {
  handle = next;
  await handle.whenReady();
  documentInput.value = handle.url;
  localStorage.setItem("yatma-automerge-spike-document", handle.url);
  title.disabled = false;
  toggle.disabled = false;
  handle.on("change", render);
  render();
}
document
  .querySelector("#create")!
  .addEventListener(
    "click",
    () => void attach(repo.create<Task>({ title: "Plan the day", completed: false })),
  );
document.querySelector("#open")!.addEventListener(
  "click",
  () =>
    void repo
      .find<Task>(documentInput.value as AutomergeUrl)
      .then(attach)
      .catch((error) => {
        status.textContent = String(error);
      }),
);
title.addEventListener("change", () =>
  handle?.change((task) => {
    task.title = title.value;
  }),
);
toggle.addEventListener("click", () =>
  handle?.change((task) => {
    task.completed = !task.completed;
  }),
);
document.querySelector("#offline")!.addEventListener("click", () => {
  connected = !connected;
  if (connected) network.connect(repo.peerId);
  else network.disconnect();
  document.querySelector("#offline")!.textContent = connected
    ? "Disconnect sync"
    : "Reconnect sync";
  render();
});
const saved = localStorage.getItem("yatma-automerge-spike-document");
if (saved)
  void repo
    .find<Task>(saved as AutomergeUrl)
    .then(attach)
    .catch((error) => {
      status.textContent = String(error);
    });
else status.textContent = "Create a document to begin.";
