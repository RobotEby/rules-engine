import { types } from "node:util";

export const VALIDATION_LIMITS = Object.freeze({
  maxDepth: 64,
  maxRules: 1_000,
  maxConditions: 10_000,
  maxValues: 100_000,
});

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || types.isProxy(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return !Array.isArray(value) && (proto === Object.prototype || proto === null);
}

export function propertyPath(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${path ? `${path}.` : ""}${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

export function validateData(input: unknown, allowUndefined: boolean, root: string): string[] {
  const ancestors = new Set<object>();
  let visited = 0;
  function visit(value: unknown, path: string, depth: number): string | undefined {
    if (++visited > VALIDATION_LIMITS.maxValues) return `${path}: limite de ${VALIDATION_LIMITS.maxValues} valores excedido`;
    if (depth > VALIDATION_LIMITS.maxDepth) return `${path}: profundidade máxima ${VALIDATION_LIMITS.maxDepth} excedida`;
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number") return Number.isFinite(value) ? undefined : `${path}: número deve ser finito`;
    if (value === undefined && allowUndefined) return;
    if (typeof value !== "object") return `${path}: valor fora do domínio ${allowUndefined ? "JSON + undefined" : "JSON"}`;
    if (types.isProxy(value)) return `${path}: proxies não são suportados`;
    if (ancestors.has(value)) return `${path}: referência cíclica não suportada`;
    const array = Array.isArray(value);
    const proto: unknown = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype && proto !== null : !isPlainObject(value)) {
      return `${path}: use objetos simples ou arrays densos`;
    }
    const keys = Reflect.ownKeys(value);
    // Cada propriedade será uma visita; impede examinar containers gigantes.
    const childCount = keys.length - (array ? 1 : 0);
    if (visited + childCount > VALIDATION_LIMITS.maxValues) return `${path}: limite de ${VALIDATION_LIMITS.maxValues} valores excedido`;
    if (array && value.length !== childCount) return `${path}: array deve ser denso e sem propriedades extras`;
    ancestors.add(value);
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key === "symbol") return `${path}: propriedades symbol não são suportadas`;
      const next = array ? `${path}[${key}]` : propertyPath(path, key);
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) return `${next}: propriedade extra em array`;
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in descriptor)) return `${next}: accessors não são suportados`;
      if (!descriptor.enumerable) return `${next}: propriedade deve ser enumerável`;
      const error = visit(descriptor.value, next, depth + 1);
      if (error) return error;
    }
    ancestors.delete(value);
    return;
  }
  const error = visit(input, root, 0);
  return error ? [error] : [];
}

export function copyData<T>(value: T, copies = new Map<object, object>()): T {
  if (value === null || typeof value !== "object") return value;
  const previous = copies.get(value);
  if (previous) return previous as T;
  const proto: object | null = Object.getPrototypeOf(value) as object | null;
  const result: object = Array.isArray(value) ? [] : (Object.create(proto) as object);
  if (Array.isArray(value) && proto === null) Object.setPrototypeOf(result, null);
  copies.set(value, result);
  for (const key of Object.keys(value)) {
    Object.defineProperty(result, key, {
      value: copyData(Object.getOwnPropertyDescriptor(value, key)!.value, copies),
      enumerable: true, configurable: true, writable: true,
    });
  }
  return result as T;
}

export function freezeData<T>(value: T, seen = new Set<object>()): T {
  if (value !== null && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const key of Object.keys(value)) freezeData(Object.getOwnPropertyDescriptor(value, key)!.value, seen);
    Object.freeze(value);
  }
  return value;
}
