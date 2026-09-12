import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

/** How many `extends` hops to follow before giving up on a cycle or a deep chain. */
const MAX_EXTENDS = 8;

interface TsconfigShape {
  extends?: string | string[];
  compilerOptions?: { paths?: Record<string, unknown> };
}

/**
 * Strips comments and trailing commas so JSON.parse can read a tsconfig.
 *
 * String-aware, because a tsconfig path can legitimately contain `//` and a naive
 * strip would cut a config in half at the first URL-looking value.
 */
export function stripJsonc(input: string): string {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    const next = input[i + 1];

    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\") {
        // Copy the escaped character verbatim so a \" cannot end the string.
        const escaped = input[i + 1];
        if (escaped !== undefined) out += escaped;
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    out += ch;
  }

  return out.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Collects the `paths` keys of a tsconfig, following relative `extends` chains.
 *
 * A package-name `extends` (`@acme/config/tsconfig.json`) is not followed: resolving
 * it means resolving a module, and a missed alias only costs a false positive we
 * would rather have than a wrong dependency on module resolution.
 */
export async function readPathAliases(configPath: string): Promise<string[]> {
  const keys = new Set<string>();
  const seen = new Set<string>();
  let current: string | undefined = configPath;

  for (let hop = 0; current && hop < MAX_EXTENDS; hop++) {
    if (seen.has(current)) break;
    seen.add(current);

    let parsed: TsconfigShape;
    try {
      parsed = JSON.parse(stripJsonc(await readFile(current, "utf8"))) as TsconfigShape;
    } catch {
      break;
    }

    const paths = parsed.compilerOptions?.paths;
    if (paths && typeof paths === "object") {
      for (const key of Object.keys(paths)) keys.add(key);
    }

    const parent = Array.isArray(parsed.extends) ? parsed.extends[0] : parsed.extends;
    if (!parent || !(parent.startsWith(".") || isAbsolute(parent))) break;
    const base: string = resolve(dirname(current), parent);
    current = base.endsWith(".json") ? base : `${base}.json`;
  }

  return [...keys];
}

/**
 * Turns tsconfig `paths` keys into a predicate over import specifiers.
 * `@/*` matches anything under `@/`; a key without `*` matches exactly.
 */
export function aliasMatcher(keys: readonly string[]): (specifier: string) => boolean {
  const prefixes: string[] = [];
  const exact = new Set<string>();

  for (const key of keys) {
    const star = key.indexOf("*");
    if (star === -1) exact.add(key);
    else prefixes.push(key.slice(0, star));
  }

  return (specifier) =>
    exact.has(specifier) || prefixes.some((p) => p !== "" && specifier.startsWith(p));
}
