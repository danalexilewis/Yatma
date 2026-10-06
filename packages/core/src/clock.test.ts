// Copyright (c) T3 Tools / MIT — adapted for Yatma
import { describe, expect, it } from "vite-plus/test";

import { DAY_MS, isTooFarAhead, nextAt } from "./clock.ts";

describe("nextAt", () => {
  it("returns now when nothing has been seen", () => {
    expect(nextAt(null, "2026-10-06T12:00:00.000Z")).toBe("2026-10-06T12:00:00.000Z");
    expect(nextAt(undefined, "2026-10-06T12:00:00.000Z")).toBe("2026-10-06T12:00:00.000Z");
  });

  it("advances one millisecond past lastSeenAt when now would go backwards", () => {
    expect(nextAt("2026-10-06T12:00:00.000Z", "2026-10-06T11:00:00.000Z")).toBe(
      "2026-10-06T12:00:00.001Z",
    );
  });

  it("keeps now when it is strictly after lastSeenAt", () => {
    expect(nextAt("2026-10-06T12:00:00.000Z", "2026-10-06T12:00:01.000Z")).toBe(
      "2026-10-06T12:00:01.000Z",
    );
  });

  it("never goes backwards when now equals lastSeenAt", () => {
    expect(nextAt("2026-10-06T12:00:00.000Z", "2026-10-06T12:00:00.000Z")).toBe(
      "2026-10-06T12:00:00.001Z",
    );
  });
});

describe("isTooFarAhead", () => {
  it("allows stamps within the day window", () => {
    expect(
      isTooFarAhead("2026-10-06T18:00:00.000Z", "2026-10-06T12:00:00.000Z", DAY_MS),
    ).toBe(false);
  });

  it("rejects stamps more than a day ahead", () => {
    expect(
      isTooFarAhead("2026-10-08T12:00:00.001Z", "2026-10-06T12:00:00.000Z", DAY_MS),
    ).toBe(true);
  });
});
