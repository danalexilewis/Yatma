import { describe, expect, it } from "@effect/vitest";

import { createGmailApi, type GmailApiContext } from "./gmail.ts";
import { createReviewApi, type ReviewApiContext } from "./review.ts";

function gmailContext(calls: string[]): GmailApiContext {
  return {
    gmailStatus: async (id) => {
      calls.push(id);
      return { configured: true, connected: false, email: null };
    },
    beginGmail: async (id) => {
      calls.push(id);
      return { authorizationUrl: "https://accounts.google.com" };
    },
    completeGmail: async (id) => {
      calls.push(id);
      return { connected: true, email: "person@example.com" };
    },
    importGmail: async (id) => {
      calls.push(id);
      return { received: 0, nextPageToken: null };
    },
    disconnectGmail: async (id) => {
      calls.push(id);
      return { connected: false };
    },
  };
}
describe("integration HTTP ownership", () => {
  it("rejects unauthenticated requests before touching a Gmail account", async () => {
    const calls: string[] = [];
    const result = await createGmailApi(null).handle(
      new Request("https://app.test/api/gmail/status"),
      gmailContext(calls),
    );
    expect(result.matched && result.response.status).toBe(401);
    expect(calls).toEqual([]);
  });
  it("uses the verified principal and validates completion before side effects", async () => {
    const calls: string[] = [];
    const api = createGmailApi({ userId: "verified" });
    const result = await api.handle(
      new Request("https://app.test/api/gmail/status?userId=other"),
      gmailContext(calls),
    );
    expect(result.matched && result.response.status).toBe(200);
    expect(calls).toEqual(["verified"]);
    calls.length = 0;
    const invalid = await api.handle(
      new Request("https://app.test/api/gmail/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "" }),
      }),
      gmailContext(calls),
    );
    expect(invalid.matched && invalid.response.status).toBe(400);
    expect(calls).toEqual([]);
  });
  it("validates schedule clock before persistence", async () => {
    const calls: string[] = [];
    const context: ReviewApiContext = {
      readReviewSchedule: async () => ({ enabled: false, localTime: "09:00", timezone: "UTC" }),
      saveReviewSchedule: async (id, input) => {
        calls.push(id);
        return input;
      },
    };
    const result = await createReviewApi({ userId: "verified" }).handle(
      new Request("https://app.test/api/review/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, localTime: "28:00", timezone: "UTC" }),
      }),
      context,
    );
    expect(result.matched && result.response.status).toBe(400);
    expect(calls).toEqual([]);
  });
});
