import { expect, it } from "vite-plus/test";
import { scheduledDateForPreset } from "./dates.ts";

it("uses Monday weeks across month/year boundaries without timezone drift", () => {
  expect(scheduledDateForPreset("2026-12-31", "today")).toBe("2026-12-31");
  expect(scheduledDateForPreset("2026-12-31", "this_week")).toBe("2027-01-03");
  expect(scheduledDateForPreset("2026-12-31", "next_week")).toBe("2027-01-04");
  expect(scheduledDateForPreset("2027-01-03", "this_week")).toBe("2027-01-03");
  expect(scheduledDateForPreset("2027-01-04", "next_week")).toBe("2027-01-11");
  expect(scheduledDateForPreset("2027-01-04", "later")).toBeNull();
});
