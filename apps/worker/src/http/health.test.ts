import { createClient } from "@eddy-works/never-rest/client";
import { describe, expect, it } from "@effect/vitest";
import { healthContract } from "@yatma/contracts/health";

import { createHealthApi } from "./health.ts";

describe("health HTTP boundary", () => {
  it("serves the shared contract to a typed client on both existing paths", async () => {
    const api = createHealthApi("testers");
    const client = createClient(healthContract, {
      baseUrl: "https://yatma.test",
      fetch: (input, init) => api(new Request(input, init), undefined),
    });
    const results = await Promise.all([client.getHealth({}), client.getRoot({})]);
    for (const result of results) {
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual({ ok: true, service: "yatma", stage: "testers" });
      }
    }
  });

  it("does not claim sibling transport paths", async () => {
    const api = createHealthApi("dev");
    const result = await api.handle(new Request("https://yatma.test/api/sync/events"), undefined);
    expect(result).toEqual({ matched: false });
  });

  it("rejects undeclared health methods with a typed host failure", async () => {
    const api = createHealthApi("dev");
    const response = await api(
      new Request("https://yatma.test/health", { method: "POST" }),
      undefined,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "route_not_found" });
  });
});
