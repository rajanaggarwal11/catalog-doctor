import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { glob } from "tinyglobby";
import { parse as parseYaml } from "yaml";
import type { Catalogs, Manifest, Workspace, WorkspacePackage } from "./types.js";

export const WORKSPACE_FILE = "pnpm-workspace.yaml";
const WORKSPACE_FILE_ALT = "pnpm-workspace.yml";

/** Thrown when there is no pnpm workspace to diagnose. The CLI prints this and exits 2. */
export class NotAWorkspaceError extends Error {
  constructor(from: string) {
    super(
      `No ${WORKSPACE_FILE} found in ${from} or any parent directory.\n` +
        `catalog-doctor only inspects pnpm workspaces.`,
    );
    this.name = "NotAWorkspaceError";
  }
}

/** Walks up from `from` looking for a pnpm workspace file. */
export function findWorkspaceRoot(from: string = process.cwd()): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, WORKSPACE_FILE)) || existsSync(join(dir, WORKSPACE_FILE_ALT))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new NotAWorkspaceError(resolve(from));
    dir = parent;
  }
}

/** Normalises a path to POSIX separators so messages read the same on every platform. */
function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

interface WorkspaceYaml {
  packages?: string[];
  catalog?: Record<string, string>;
  catalogs?: Record<string, Record<string, string>>;
}

/**
 * Reads the catalogs in the shape the rules want: one flat map keyed by catalog
 * name, with the unnamed `catalog:` block keyed `default`. If a workspace writes
 * both `catalog:` and `catalogs.default:`, they are merged with `catalogs.default`
 * winning — which is what pnpm itself does.
 */
function readCatalogs(doc: WorkspaceYaml): Catalogs {
  const catalogs: Catalogs = {};
  if (doc.catalog && typeof doc.catalog === "object") {
    catalogs.default = { ...doc.catalog };
  }
  if (doc.catalogs && typeof doc.catalogs === "object") {
    for (const [name, entries] of Object.entries(doc.catalogs)) {
      if (!entries || typeof entries !== "object") continue;
      catalogs[name] = { ...catalogs[name], ...entries };
    }
  }
  return catalogs;
}

async function readManifest(
  manifestPath: string,
  root: string,
): Promise<WorkspacePackage | undefined> {
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    return undefined;
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(raw) as Manifest;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${toPosix(relative(root, manifestPath))} is not valid JSON: ${reason}`, {
      cause: error,
    });
  }

  const dir = dirname(manifestPath);
  const relDir = toPosix(relative(root, dir)) || ".";
  return {
    name: manifest.name ?? relDir,
    dir,
    relDir,
    relManifestPath: toPosix(relative(root, manifestPath)),
    manifest,
    raw,
  };
}

/**
 * Loads every workspace package plus the catalogs.
 *
 * The root package is included when it declares dependencies, because a root
 * manifest drifts from the catalog exactly like any other package does.
 */
export async function loadWorkspace(root: string = findWorkspaceRoot()): Promise<Workspace> {
  const workspacePath = existsSync(join(root, WORKSPACE_FILE))
    ? join(root, WORKSPACE_FILE)
    : join(root, WORKSPACE_FILE_ALT);

  const rawWorkspace = await readFile(workspacePath, "utf8");
  const doc = (parseYaml(rawWorkspace) ?? {}) as WorkspaceYaml;
  const catalogs = readCatalogs(doc);

  const patterns = Array.isArray(doc.packages) ? doc.packages : [];
  const positive: string[] = [];
  const negative: string[] = [];
  for (const pattern of patterns) {
    if (typeof pattern !== "string" || pattern.length === 0) continue;
    if (pattern.startsWith("!")) negative.push(`${pattern.slice(1)}/package.json`);
    else positive.push(`${pattern}/package.json`);
  }

  const manifestPaths = positive.length
    ? await glob(positive, {
        cwd: root,
        absolute: true,
        onlyFiles: true,
        dot: false,
        ignore: ["**/node_modules/**", ...negative],
      })
    : [];

  // The root manifest is never matched by a `packages:` glob, so add it by hand.
  const rootManifest = join(root, "package.json");
  if (existsSync(rootManifest)) manifestPaths.push(rootManifest);

  const seen = new Set<string>();
  const packages: WorkspacePackage[] = [];
  for (const manifestPath of manifestPaths.sort()) {
    if (seen.has(manifestPath)) continue;
    seen.add(manifestPath);
    const pkg = await readManifest(manifestPath, root);
    if (pkg) packages.push(pkg);
  }

  return {
    root,
    packages,
    catalogs,
    relWorkspacePath: toPosix(relative(root, workspacePath)),
    rawWorkspace,
    packageNames: new Set(packages.map((p) => p.name)),
  };
}
