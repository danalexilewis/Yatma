import * as ExpoCrypto from "expo-crypto";

/**
 * Web APIs used by `@yatma/core` and the app that Hermes (Expo Go / native) lacks:
 * ES2023 array methods and `crypto.getRandomValues`. Each is installed only when missing,
 * so web and newer engines keep their native versions.
 */

function toSorted<T>(this: readonly T[], compare?: (a: T, b: T) => number): T[] {
  return Array.prototype.slice.call(this).sort(compare);
}

function toReversed<T>(this: readonly T[]): T[] {
  return Array.prototype.slice.call(this).reverse();
}

function findLastIndex<T>(
  this: readonly T[],
  predicate: (value: T, index: number, array: readonly T[]) => unknown,
): number {
  for (let index = this.length - 1; index >= 0; index -= 1) {
    if (predicate(this[index] as T, index, this)) return index;
  }
  return -1;
}

function findLast<T>(
  this: readonly T[],
  predicate: (value: T, index: number, array: readonly T[]) => unknown,
): T | undefined {
  const index = findLastIndex.call<readonly T[], [typeof predicate], number>(this, predicate);
  return index === -1 ? undefined : this[index];
}

function installArrayMethod(name: string, implementation: (...args: never[]) => unknown) {
  if (typeof (Array.prototype as unknown as Record<string, unknown>)[name] === "function") return;
  Object.defineProperty(Array.prototype, name, {
    value: implementation,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

function installCrypto() {
  if (typeof globalThis.crypto?.getRandomValues === "function") return;
  Object.defineProperty(globalThis, "crypto", {
    value: { getRandomValues: ExpoCrypto.getRandomValues, randomUUID: ExpoCrypto.randomUUID },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

installCrypto();
installArrayMethod("toSorted", toSorted);
installArrayMethod("toReversed", toReversed);
installArrayMethod("findLastIndex", findLastIndex);
installArrayMethod("findLast", findLast);
