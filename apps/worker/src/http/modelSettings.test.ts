import { describe, expect, it } from "vite-plus/test";
import { createClient } from "@eddy-works/never-rest/client";
import { modelSettingsContract } from "@yatma/contracts/modelSettings";

import { createModelSettingsApi, type ModelSettingsApiContext } from "./modelSettings.ts";
import { corsHeaders } from "./cors.ts";

const status = {
  provider: "openrouter",
  model: "openai/gpt-4o-mini",
  source: "personal",
  canSaveKey: true,
} as const;

describe("model settings HTTP boundary", () => {
  it("routes every typed operation to the verified account and never returns its key", async () => {
    const calls: string[] = [];
    const context: ModelSettingsApiContext = {
      getModelSettings: async (id) => {
        calls.push(`get:${id}`);
        return status;
      },
      saveModelSettings: async (id) => {
        calls.push(`save:${id}`);
        return status;
      },
      removeModelSettings: async (id) => {
        calls.push(`remove:${id}`);
        return { ...status, source: "missing" };
      },
    };
    const api = createModelSettingsApi({ userId: "verified" });
    const client = createClient(modelSettingsContract, {
      baseUrl: "https://api.test",
      fetch: async (input, init) => {
        const result = await api.handle(new Request(input, init), context);
        if (!result.matched) throw new Error("unmatched");
        return result.response;
      },
    });
    expect((await client.getModelSettings({})).isOk()).toBe(true);
    const saved = await client.saveModelSettings({
      body: { apiKey: "sk-or-v1-secret-test", model: status.model },
    });
    expect(saved.isOk()).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("sk-or-v1-secret-test");
    expect((await client.removeModelSettings({})).isOk()).toBe(true);
    expect(calls).toEqual(["get:verified", "save:verified", "remove:verified"]);
  });

  it("rejects signed-out and malformed requests before persistence and masks failures", async () => {
    let calls = 0;
    const key = "sk-or-v1-private-secret";
    const context: ModelSettingsApiContext = {
      getModelSettings: async () => status,
      saveModelSettings: async () => {
        calls++;
        throw new Error(key);
      },
      removeModelSettings: async () => status,
    };
    function request(body: unknown) {
      return new Request("https://api.test/api/settings/model?userId=attacker", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    const input = { apiKey: key, model: status.model };
    const unauthorized = await createModelSettingsApi(null).handle(request(input), context);
    expect(unauthorized.matched && unauthorized.response.status).toBe(401);
    const api = createModelSettingsApi({ userId: "verified" });
    const invalid = await api.handle(request({ ...input, model: "not a provider/model" }), context);
    expect(invalid.matched && invalid.response.status).toBe(400);
    expect(calls).toBe(0);
    const failed = await api.handle(request(input), context);
    expect(failed.matched && failed.response.status).toBe(503);
    expect(failed.matched && (await failed.response.text())).not.toContain(key);
    const invalidKey = await api.handle(request({ ...input, apiKey: `${key} invalid` }), context);
    expect(invalidKey.matched && (await invalidKey.response.text())).not.toContain(key);
  });

  it("allows configured browser origins and local development, without cookie credentials", () => {
    const request = new Request("https://api.test/api/settings/model", {
      method: "OPTIONS",
      headers: { Origin: "https://localhost:8081" },
    });
    expect(corsHeaders(request, "dev", "")).toMatchObject({
      "Access-Control-Allow-Origin": "https://localhost:8081",
      "Access-Control-Allow-Methods": expect.stringContaining("PUT"),
    });
    expect(corsHeaders(request, "testers", "")).toBeNull();
    expect(corsHeaders(request, "testers", "https://localhost:8081")).not.toHaveProperty(
      "Access-Control-Allow-Credentials",
    );
    expect(corsHeaders(new Request("https://api.test"), "testers", "")).toEqual({});
  });
});
