import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { join, relative, sep } from "node:path";
import { glob } from "tinyglobby";
import { aliasMatcher, readPathAliases } from "../tsconfig.js";
import { DEP_TYPES } from "../types.js";
import { packageNameOfImport } from "../deps.js";
import type { Finding, Rule, RuleContext, Workspace, WorkspacePackage } from "../types.js";

const SOURCE_GLOB = "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,svelte,vue,astro}";

const IGNORED_DIRS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/.turbo/**",
  "**/.svelte-kit/**",
  "**/*.d.ts",
];

const BUILTINS = new Set(builtinModules);

/** How many offending files to name under a finding before saying "and N more". */
const EXAMPLES = 3;

/*
 * Anchored on the `import` / `export` keyword rather than on `from`, because a
 * bare /\bfrom\s*["']/ also matches JSX like `name="from" value={f.from ?? ""}`
 * and reports the markup between the quotes as a package name.
 *
 * The clause between the keyword and the specifier is restricted to the characters
 * a real import clause can contain — identifiers, braces, commas, `*`, whitespace.
 * That is what stops prose from matching: rendered copy such as
 *
 *     <p>You can import those from a document</p>
 *     <form data-testid="import-upload">
 *
 * begins with the word `import` at the head of a line, and without the restriction
 * the clause runs on across the markup into the next quoted attribute and reports
 * `import-upload` as a dependency. Punctuation in the markup now ends the match.
 */
const CLAUSE = "[A-Za-z0-9_$@{},*\\s]{0,300}?";

const PATTERNS = [
  // import x from "pkg" · import "pkg" · import type {A} from "pkg"
  new RegExp(`(?:^|[;}\\n])[ \\t]*import\\b${CLAUSE}(?:from[ \\t\\r\\n]*)?["']([^"']+)["']`, "g"),
  // export * from "pkg" · export {a} from "pkg"
  new RegExp(`(?:^|[;}\\n])[ \\t]*export\\b${CLAUSE}from[ \\t\\r\\n]*["']([^"']+)["']`, "g"),
  // import("pkg") · require("pkg")
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];

/**
 * A lexical scan, not a parse. It skips comment lines, which removes the common
 * false positives, and accepts that a specifier inside a string literal could
 * still be picked up — cheap, and wrong in the safe direction.
 */
export function importsIn(source: string): string[] {
  const code = source
    .split("\n")
    .filter((line) => {
      const t = line.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

  const found = new Set<string>();
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) {
      if (match[1]) found.add(match[1]);
    }
  }
  return [...found];
}

function declaredNames(pkg: WorkspacePackage): Set<string> {
  const names = new Set<string>([pkg.name]);
  for (const depType of DEP_TYPES) {
    const block = pkg.manifest[depType];
    if (!block || typeof block !== "object") continue;
    for (const name of Object.keys(block)) names.add(name);
  }
  return names;
}

/**
 * An import of a package the importing manifest never declares. It works right up
 * until it doesn't: a hoisted node_modules, a transitive dependency that happens to
 * be present, a lockfile that changes under you. Then it fails in CI and nowhere else.
 */
export const phantomDependency: Rule = {
  id: "phantom-dependency",
  title: "Imported but not declared",
  description: "A package imported in source that the importing package.json does not declare.",
  defaultSeverity: "error",
  fixable: false,

  async check(workspace: Workspace, context: RuleContext): Promise<Finding[]> {
    const findings: Finding[] = [];

    // A root package at "." contains every other package, so exclude their
    // directories from its own scan or every nested import looks like the root's.
    const nestedDirs = workspace.packages
      .filter((p) => p.relDir !== ".")
      .map((p) => `${p.relDir}/**`);

    for (const pkg of workspace.packages) {
      // User excludes are written against the workspace root; tinyglobby runs with
      // the package directory as cwd, so strip the package prefix off each one.
      const userIgnores = context.exclude.flatMap((pattern) => {
        if (pkg.relDir === ".") return [pattern];
        const prefix = `${pkg.relDir}/`;
        return pattern.startsWith(prefix) ? [pattern.slice(prefix.length)] : [pattern];
      });
      const ignore = [...IGNORED_DIRS, ...userIgnores, ...(pkg.relDir === "." ? nestedDirs : [])];
      const files = await glob(SOURCE_GLOB, {
        cwd: pkg.dir,
        absolute: true,
        onlyFiles: true,
        ignore,
      });
      if (files.length === 0) continue;

      const declared = declaredNames(pkg);

      // Imports that resolve through a tsconfig `paths` alias are internal, not
      // dependencies. Without this every aliased import in the package is reported.
      const aliasKeys = (
        await Promise.all(
          ["tsconfig.json", "jsconfig.json"].map((name) => readPathAliases(join(pkg.dir, name))),
        )
      ).flat();
      const isAlias = aliasMatcher(aliasKeys);

      // dep name -> the files that import it
      const phantom = new Map<string, string[]>();

      for (const file of files.sort()) {
        let source: string;
        try {
          source = await readFile(file, "utf8");
        } catch {
          continue;
        }
        for (const specifier of importsIn(source)) {
          if (isAlias(specifier)) continue;
          const name = packageNameOfImport(specifier);
          if (!name) continue;
          if (BUILTINS.has(name)) continue;
          if (declared.has(name)) continue;

          const rel = relative(workspace.root, file).split(sep).join("/");
          const list = phantom.get(name);
          if (list) {
            if (!list.includes(rel)) list.push(rel);
          } else {
            phantom.set(name, [rel]);
          }
        }
      }

      for (const [dep, usedIn] of [...phantom].sort(([a], [b]) => a.localeCompare(b))) {
        const shown = usedIn.slice(0, EXAMPLES);
        const detail = shown.map((f) => `imported in ${f}`);
        if (usedIn.length > shown.length) {
          const rest = usedIn.length - shown.length;
          detail.push(`and ${rest} more ${rest === 1 ? "file" : "files"}`);
        }
        if (workspace.packageNames.has(dep)) {
          detail.push(`${dep} is a workspace package — add it as \`workspace:*\``);
        }

        findings.push({
          rule: phantomDependency.id,
          severity: phantomDependency.defaultSeverity,
          dep,
          message: `${pkg.name} imports ${dep} without declaring it`,
          sites: [{ packageName: pkg.name, file: pkg.relManifestPath }],
          detail,
          // We know the name, never the range the author intends.
          fixable: false,
        });
      }
    }

    return findings;
  },
};
