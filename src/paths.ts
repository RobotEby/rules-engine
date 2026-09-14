import { types } from "node:util";

const RESERVED = new Set(["__proto__", "prototype", "constructor"]);

export function isValidPath(path: string): boolean {
  return path.trim() !== "" && path.split(".").every(segment => segment !== "" && !RESERVED.has(segment));
}

/** Resolve somente propriedades próprias de dados, sem executar getters. */
export function resolvePath(obj: unknown, path: string): { found: boolean; value: unknown } {
  if (typeof path !== "string" || !isValidPath(path)) return { found: false, value: undefined };
  let value = obj;
  for (const key of path.split(".")) {
    if (value === null || typeof value !== "object" || types.isProxy(value)) return { found: false, value: undefined };
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return { found: false, value: undefined };
    value = descriptor.value;
  }
  return { found: true, value };
}
