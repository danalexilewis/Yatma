import { Repo } from "@automerge/automerge-repo";
import { WebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";

/** Bundle probe only: a successful bundle does not prove execution on Hermes. */
export function createNativeProbe(url: string) {
  if (!url.startsWith("wss://")) throw new Error("WSS required");
  return new Repo({ network: [new WebSocketClientAdapter(url)] });
}
