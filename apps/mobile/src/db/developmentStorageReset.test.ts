import { createRequire } from "node:module";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const require = createRequire(import.meta.url);
const { withDevelopmentStorageReset } = require("../../development/resetStorage.js") as {
  readonly withDevelopmentStorageReset: (
    next: () => void,
  ) => (request: IncomingMessage, response: ServerResponse) => void;
};

afterEach(() => vi.unstubAllEnvs());

function request(overrides: Record<string, unknown> = {}) {
  return {
    url: "/_yatma/dev/reset-storage",
    method: "POST",
    socket: { remoteAddress: "127.0.0.1" },
    headers: {
      host: "localhost:8081",
      origin: "http://localhost:8081",
      "x-yatma-development-reset": "1",
    },
    ...overrides,
  } as unknown as IncomingMessage;
}

function send(req: IncomingMessage) {
  const next = vi.fn();
  const response = { writeHead: vi.fn(), end: vi.fn() };
  withDevelopmentStorageReset(next)(req, response as unknown as ServerResponse);
  return { next, ...response };
}

describe("development storage reset", () => {
  it("clears browser storage only for an explicit local development request", () => {
    vi.stubEnv("NODE_ENV", "development");
    const result = send(request());
    expect(result.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Clear-Site-Data": '"storage"', "Cache-Control": "no-store" }),
    );
  });

  it("is unavailable in production even from localhost", () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = send(request());
    expect(result.writeHead).toHaveBeenCalledWith(404);
    expect(result.writeHead.mock.calls.flat()).not.toContain('"storage"');
  });

  it.each([
    { socket: { remoteAddress: "192.168.1.20" } },
    { headers: { host: "yatma.example", "x-yatma-development-reset": "1" } },
    {
      headers: {
        host: "localhost:8081",
        origin: "https://other.example",
        "x-yatma-development-reset": "1",
      },
    },
  ])("rejects remote hosts and cross-origin requests: %j", (overrides) => {
    vi.stubEnv("NODE_ENV", "development");
    expect(send(request(overrides)).writeHead).toHaveBeenCalledWith(404);
  });

  it.each([{ method: "GET" }, { headers: { host: "localhost:8081" } }])(
    "rejects implicit reset requests: %j",
    (overrides) => {
      vi.stubEnv("NODE_ENV", "development");
      expect(send(request(overrides)).writeHead).toHaveBeenCalledWith(405, { Allow: "POST" });
    },
  );

  it("passes ordinary app requests through", () => {
    const result = send(request({ url: "/triage" }));
    expect(result.next).toHaveBeenCalledTimes(1);
    expect(result.writeHead).not.toHaveBeenCalled();
  });
});
