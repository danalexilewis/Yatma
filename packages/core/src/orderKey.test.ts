// Copyright (c) T3 Tools / MIT — adapted for Yatma
import { describe, expect, it } from "vite-plus/test";

import {
  generateSpreadOrderKeys,
  isValidOrderKey,
  orderKeyBetween,
  orderKeyMidpoint,
} from "./orderKey.ts";

describe("orderKeyBetween", () => {
  it("places a key between two neighbors", () => {
    const key = orderKeyBetween("f", "t");
    expect(key).not.toBeNull();
    expect(key! > "f").toBe(true);
    expect(key! < "t").toBe(true);
  });

  it("places a key at the top when before is null", () => {
    const key = orderKeyBetween(null, "m");
    expect(key).not.toBeNull();
    expect(key! < "m").toBe(true);
  });

  it("places a key at the bottom when after is null", () => {
    const key = orderKeyBetween("m", null);
    expect(key).not.toBeNull();
    expect(key! > "m").toBe(true);
  });

  it("returns null for corrupt or out-of-order bounds", () => {
    expect(orderKeyBetween("t", "f")).toBeNull();
    expect(orderKeyBetween("a", "m")).toBeNull();
    expect(orderKeyBetween("!", "m")).toBeNull();
  });
});

describe("isValidOrderKey", () => {
  it("accepts base-26 keys that are not trailing-minimum", () => {
    expect(isValidOrderKey("m")).toBe(true);
    expect(isValidOrderKey("nb")).toBe(true);
  });

  it("rejects empty, non-digit, and trailing-minimum keys", () => {
    expect(isValidOrderKey("")).toBe(false);
    expect(isValidOrderKey("A")).toBe(false);
    expect(isValidOrderKey("ma")).toBe(false);
  });
});

describe("orderKeyMidpoint", () => {
  it("returns the middle of the alphabet for open bounds", () => {
    expect(orderKeyMidpoint("", "")).toBe("n");
  });
});

describe("generateSpreadOrderKeys", () => {
  it("produces sorted, valid, unique keys", () => {
    for (const count of [1, 3, 10, 40]) {
      const keys = generateSpreadOrderKeys(count);
      expect(keys).toHaveLength(count);
      for (let i = 0; i < keys.length; i += 1) {
        expect(isValidOrderKey(keys[i]!)).toBe(true);
        if (i > 0) expect(keys[i]! > keys[i - 1]!).toBe(true);
        if (i + 1 < keys.length) {
          const between = orderKeyBetween(keys[i]!, keys[i + 1]!);
          expect(between).not.toBeNull();
        }
      }
    }
  });
});
