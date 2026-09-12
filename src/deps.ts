import { DEP_TYPES, VERSIONED_DEP_TYPES } from "./types.js";
import type { DepType, WorkspacePackage } from "./types.js";

export interface DepEntry {
  pkg: WorkspacePackage;
  depType: DepType;
  name: string;
  spec: string;
}

/** Every declared dependency of a package, across all four dependency blocks. */
export function* eachDep(pkg: WorkspacePackage): Generator<DepEntry> {
  for (const depType of DEP_TYPES) {
    const block = pkg.manifest[depType];
    if (!block || typeof block !== "object") continue;
    for (const [name, spec] of Object.entries(block)) {
      if (typeof spec !== "string") continue;
      yield { pkg, depType, name, spec };
    }
  }
}

/** Every declared dependency across every package in the workspace. */
export function* eachDepOf(packages: readonly WorkspacePackage[]): Generator<DepEntry> {
  for (const pkg of packages) yield* eachDep(pkg);
}

export const CATALOG_PROTOCOL = "catalog:";
export const WORKSPACE_PROTOCOL = "workspace:";

export function isCatalogSpec(spec: string): boolean {
  return spec.startsWith(CATALOG_PROTOCOL);
}

export function isWorkspaceSpec(spec: string): boolean {
  return spec.startsWith(WORKSPACE_PROTOCOL);
}

/**
 * The catalog a spec points at. `catalog:` and `catalog:default` are the same
 * catalog, which pnpm calls the default one.
 */
export function catalogNameOf(spec: string): string {
  const name = spec.slice(CATALOG_PROTOCOL.length).trim();
  return name === "" ? "default" : name;
}

/**
 * Specs that carry a protocol resolve somewhere other than the registry, so they
 * can never move into a catalog. Everything else is treated as a registry range.
 */
const NON_REGISTRY_PROTOCOLS = [
  "workspace:",
  "catalog:",
  "link:",
  "file:",
  "portal:",
  "npm:",
  "git:",
  "git+ssh:",
  "git+https:",
  "http:",
  "https:",
  "github:",
  "bitbucket:",
  "gitlab:",
  "patch:",
];

/** Whether a spec is an ordinary registry range, and so a candidate for the catalog. */
export function isRegistrySpec(spec: string): boolean {
  const trimmed = spec.trim();
  if (trimmed === "") return false;
  if (NON_REGISTRY_PROTOCOLS.some((p) => trimmed.startsWith(p))) return false;
  // A bare `user/repo` shorthand is a GitHub dependency, not a registry range.
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed) && !trimmed.startsWith("@")) return false;
  return true;
}

/**
 * Turns an import specifier into the package name it resolves to.
 * `@scope/pkg/sub` -> `@scope/pkg`, `pkg/sub` -> `pkg`.
 * Returns undefined for relative, absolute and protocol imports.
 */
export function packageNameOfImport(specifier: string): string | undefined {
  if (specifier.length === 0) return undefined;
  if (specifier.startsWith(".") || specifier.startsWith("/")) return undefined;
  if (specifier.startsWith("#")) return undefined; // subpath import, resolves in-package
  if (/^[a-z][a-z\d+\-.]*:/i.test(specifier)) return undefined; // node:, data:, http: …

  const parts = specifier.split("/");
  if (specifier.startsWith("@")) {
    // `@/lib` is a path alias, never a package: an npm scope cannot be empty.
    if (parts.length < 2 || parts[0] === "@" || !parts[1]) return undefined;
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0];
}

/** Groups every declared dependency in the workspace by dependency name. */
export function indexByDep(packages: readonly WorkspacePackage[]): Map<string, DepEntry[]> {
  const index = new Map<string, DepEntry[]>();
  for (const entry of eachDepOf(packages)) {
    const list = index.get(entry.name);
    if (list) list.push(entry);
    else index.set(entry.name, [entry]);
  }
  return index;
}

/** Distinct package names among a set of entries — how many packages actually use a dep. */
export function packagesOf(entries: readonly DepEntry[]): string[] {
  return [...new Set(entries.map((e) => e.pkg.name))];
}

/** Whether a block states a version the workspace should agree on. See VERSIONED_DEP_TYPES. */
export function isVersionedDepType(depType: DepType): boolean {
  return (VERSIONED_DEP_TYPES as readonly DepType[]).includes(depType);
}
