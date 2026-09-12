/** The four dependency blocks catalog-doctor inspects, in the order pnpm resolves them. */
export const DEP_TYPES = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

export type DepType = (typeof DEP_TYPES)[number];

/**
 * The blocks that state a version the workspace has to agree on.
 *
 * `peerDependencies` is deliberately absent. A peer range is a compatibility
 * statement — "I work with any React 19" — not a pin, so holding it against a
 * dependency range reports disagreement where there is none. The rules that
 * compare versions use this list; the rules that check a reference resolves
 * (`missing-catalog-entry`, `unused-catalog-entry`) still read every block.
 */
export const VERSIONED_DEP_TYPES = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
] as const satisfies readonly DepType[];

export interface Manifest {
  name?: string;
  version?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [key: string]: unknown;
}

export interface WorkspacePackage {
  /** The manifest `name`, or the directory name when the manifest has none. */
  name: string;
  /** Absolute path to the package directory. */
  dir: string;
  /** Path relative to the workspace root, POSIX-separated. Used in every message. */
  relDir: string;
  /** Relative path to the manifest, e.g. `packages/db/package.json`. */
  relManifestPath: string;
  manifest: Manifest;
  /** The manifest exactly as it sits on disk, so `--fix` can rewrite it in place. */
  raw: string;
}

/**
 * A catalog as pnpm models it: the unnamed `catalog:` plus any number of named
 * catalogs addressed as `catalog:<name>`. The default catalog is keyed `default`
 * whether it was written as `catalog:` or `catalogs.default:`.
 */
export type Catalogs = Record<string, Record<string, string>>;

export interface Workspace {
  /** Absolute path to the directory holding `pnpm-workspace.yaml`. */
  root: string;
  packages: WorkspacePackage[];
  catalogs: Catalogs;
  /** Relative path to `pnpm-workspace.yaml`. */
  relWorkspacePath: string;
  /** The workspace file exactly as it sits on disk. */
  rawWorkspace: string;
  /** Every workspace package name, for fast internal-dependency lookups. */
  packageNames: Set<string>;
}

export type RuleId =
  | "catalog-candidate"
  | "catalog-drift"
  | "version-mismatch"
  | "missing-catalog-entry"
  | "unused-catalog-entry"
  | "unpinned-workspace-dep"
  | "phantom-dependency";

export type Severity = "error" | "warn";

/** Where a finding lives, precise enough to fix it without guessing. */
export interface FindingSite {
  /** Package name. Absent for findings that live in `pnpm-workspace.yaml` itself. */
  packageName?: string;
  /** Relative path to the file the finding is in. */
  file: string;
  depType?: DepType;
}

/** A single dependency spec to rewrite inside one package.json. */
export interface ManifestEdit {
  /** Relative path to the manifest, matching `WorkspacePackage.relManifestPath`. */
  file: string;
  depType: DepType;
  dep: string;
  /** The spec to write. */
  spec: string;
}

/** A single catalog entry to add, change or remove in `pnpm-workspace.yaml`. */
export interface CatalogEdit {
  /** Catalog name; `default` is the unnamed `catalog:` block. */
  catalog: string;
  dep: string;
  /** The version to write, or null to delete the entry. */
  spec: string | null;
}

/**
 * Everything `--fix` needs to resolve a finding. Rules emit it while they still
 * have the context; the fixer only applies edits, it never re-derives them.
 */
export interface Fix {
  manifests?: ManifestEdit[];
  catalogs?: CatalogEdit[];
}

export interface Finding {
  rule: RuleId;
  severity: Severity;
  /** The dependency the finding is about, when it is about one. */
  dep?: string;
  /** One line, stated as the problem — not as advice. */
  message: string;
  /** Every place the problem occurs. Always at least one entry. */
  sites: FindingSite[];
  /** Extra lines printed underneath, e.g. the conflicting specs. */
  detail?: string[];
  /** Whether `--fix` can resolve this finding without a human choosing something. */
  fixable: boolean;
  /** The edits that resolve it. Present whenever `fixable` is true. */
  fix?: Fix;
}

export interface RuleMeta {
  id: RuleId;
  title: string;
  /** One sentence for `--list-rules` and the README table. */
  description: string;
  defaultSeverity: Severity;
  fixable: boolean;
}

/** Everything a rule needs beyond the workspace itself. */
export interface RuleContext {
  /**
   * Globs, relative to the workspace root, whose files no rule should read.
   *
   * Test fixtures are the reason this exists: a fixture is a deliberately broken
   * workspace, so a tool that reads it reports the breakage as real.
   */
  exclude: readonly string[];
}

export interface Rule extends RuleMeta {
  check(workspace: Workspace, context: RuleContext): Finding[] | Promise<Finding[]>;
}

export interface DiagnoseOptions {
  /** Run only these rules. Empty or undefined means every rule. */
  only?: RuleId[];
  /** Skip these rules. Applied after `only`. */
  ignore?: RuleId[];
  /** Globs, relative to the workspace root, to keep out of source scanning. */
  exclude?: string[];
}

export interface DiagnoseResult {
  workspace: Workspace;
  findings: Finding[];
  /** Rules that actually ran, after `only`/`ignore` were applied. */
  rulesRun: RuleId[];
}
