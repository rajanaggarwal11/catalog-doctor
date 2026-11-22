# catalog-doctor

**Find and fix pnpm catalog drift:** half-adopted catalogs, duplicate versions, workspace deps that can resolve to the registry, and undeclared imports. It fixes the problems that have only one correct answer and reports the rest.

[![CI](https://github.com/rajanaggarwal11/catalog-doctor/actions/workflows/ci.yml/badge.svg)](https://github.com/rajanaggarwal11/catalog-doctor/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/catalog-doctor.svg)](https://www.npmjs.com/package/catalog-doctor)
[![license](https://img.shields.io/npm/l/catalog-doctor.svg)](./LICENSE)

```bash
npx catalog-doctor
```

No config, no install, no setup. It finds `pnpm-workspace.yaml` by walking up from wherever you run it.

## Why

pnpm catalogs fix version drift as long as every package uses them. Once adoption is partial, the catalog looks like the source of truth while two packages resolve different copies of the same library. That is the bug that reproduces in one app and not the other, and it does not show up in `pnpm install`, in your typechecker, or in your tests.

## What it finds

```
catalog-doctor · acme · 2 packages · 2 catalogs

 error  missing-catalog-entry
  ✗ @acme/api declares missing-thing: catalog:nope, which resolves to nothing
      there is no catalog named nope
      defined catalogs: default, react17
      packages/api/package.json · dependencies

 error  unpinned-workspace-dep
  ✗ @acme/web depends on the local package @acme/api as ^1.0.0
      @acme/api is a package in this workspace — declare it as `workspace:*` so it can never resolve to the registry
      packages/web/package.json · dependencies

 error  version-mismatch
  ✗ lodash is declared at 2 different versions
      ^4.17.20 — @acme/api
      ^4.17.21 — @acme/web
      packages/api/package.json · dependencies
      packages/web/package.json · dependencies

 error  catalog-drift
  ✗ zod resolves through the catalog in 1 place and directly in 1
      catalog default pins zod to ^3.23.8
      @acme/api declares ^3.22.0 directly
      packages/web/package.json · dependencies
      packages/api/package.json · dependencies

 warn  catalog-candidate
  ! date-fns is declared as ^3.6.0 in 2 packages but is not in the catalog
      add `date-fns: ^3.6.0` to the catalog and replace each spec with `catalog:`
      packages/api/package.json · dependencies
      packages/web/package.json · dependencies

 warn  unused-catalog-entry
  ! left-pad (^1.3.0) sits in the default catalog but no package references it
      pnpm-workspace.yaml
  ! react (^17.0.2) sits in catalog react17 but no package references it
      pnpm-workspace.yaml

────────────────────────────────────────────────
7 findings: 4 errors, 3 warnings
5 fixable — run catalog-doctor --fix
```

That is the exact output for a two-package workspace (`acme`, with `@acme/web` and `@acme/api`). One `unused-catalog-entry` finding lists two entries; each counts on its own, so 4 errors and 3 warnings, of which 5 can be fixed.

## The rules

| Rule                     | Severity | Fixable | What it means                                                                                                                                                             |
| ------------------------ | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `missing-catalog-entry`  | error    | —       | A package says `catalog:` for something the catalog does not define. `pnpm install` fails on this.                                                                        |
| `unpinned-workspace-dep` | error    | ✓       | An internal package referenced by a semver range. pnpm links the local copy while the range happens to match, and silently installs a published copy the moment it stops. |
| `version-mismatch`       | error    | —       | One dependency, two ranges. Two packages end up running different copies of the same library.                                                                             |
| `catalog-drift`          | error    | ✓       | Half-adopted catalog: some packages point at it, others still carry a literal range. The failure mode catalogs exist to prevent.                                          |
| `phantom-dependency`     | error    | —       | Imported in source, never declared. Works via hoisting until a lockfile changes, then fails in CI and nowhere else.                                                       |
| `catalog-candidate`      | warn     | ✓       | The same version in two or more packages with no catalog entry. Nothing is broken yet; the next upgrade has to touch every manifest.                                      |
| `unused-catalog-entry`   | warn     | ✓       | A catalog entry nothing points at. Accumulates after every package deletion.                                                                                              |

`catalog-doctor --list-rules` prints the same table in your terminal.

## `--fix`

```bash
npx catalog-doctor --fix
npx catalog-doctor --fix --dry-run   # show the edits, write nothing
```

It fixes what has exactly one correct answer, and refuses the rest:

- **`unpinned-workspace-dep`** → rewritten to `workspace:*`.
- **`catalog-drift`** → the literal ranges are repointed at the catalog entry that already exists.
- **`catalog-candidate`** → the agreed version is added to the catalog, and every package repointed at it.
- **`unused-catalog-entry`** → the entry is removed.

It will not touch **`version-mismatch`** (which range wins is a judgement about breaking changes), **`missing-catalog-entry`** or **`phantom-dependency`** (both need a version only you can choose). If two rules want different values in the same place, both are skipped and reported rather than one silently winning.

Edits preserve your formatting: `package.json` keeps its own indentation, and `pnpm-workspace.yaml` keeps its comments and ordering. Running `--fix` twice changes nothing the second time.

## In CI

```yaml
- run: npx catalog-doctor --strict
```

Exit codes are stable and documented:

| Code | Meaning                                                   |
| ---- | --------------------------------------------------------- |
| `0`  | Nothing to report                                         |
| `1`  | Findings remain — errors, or any finding under `--strict` |
| `2`  | Could not run — no workspace found, or a bad option       |

Without `--strict`, warnings report but do not fail the build. For a machine-readable report, `--json` emits a stable shape (`version: 1`) you can diff between runs.

## Options

```
--fix                Apply every fix that does not need a human decision
--dry-run            With --fix, report the edits without writing them
--json               Machine-readable output (stable shape, for CI)
--only <ids>         Run only these rules (comma-separated)
--ignore <ids>       Skip these rules (comma-separated)
--exclude <globs>    Paths to keep out of source scanning (comma-separated)
--strict             Exit non-zero on warnings too, not just errors
--cwd <path>         Start looking for pnpm-workspace.yaml here
--list-rules         Print every rule and what it checks
-v, --version        Print the version
-h, --help           Print this
```

If your repo has test fixtures that are deliberately broken workspaces, keep them out of the source scan:

```bash
npx catalog-doctor --exclude "test/fixtures/**"
```

## As a library

```ts
import { diagnose, applyFixes } from "catalog-doctor";

const { workspace, findings } = await diagnose({ cwd: process.cwd() });

for (const finding of findings) {
  console.log(finding.severity, finding.rule, finding.message);
}

// Every fixable finding carries the edits that resolve it.
await applyFixes(workspace, findings, { dryRun: true });
```

`Finding`, `Rule`, `Workspace` and the rest are exported as types. A custom rule is an object with a `check(workspace, context)` method; pass `rules` to `diagnose` to use your own set.

## How is this different from syncpack, sherif, manypkg or knip?

They overlap, and in a big monorepo you may want more than one.

- **[syncpack](https://syncpack.dev)** finds and fixes version mismatches across packages, and it handles pnpm catalogs: a version group with `"policy": "catalog"` reports dependencies that use a literal version instead of `catalog:` and rewrites them, and it can update catalog entries. Another version-group rule can require `workspace:*` for local packages. It is far more configurable than catalog-doctor. It reads `package.json` files, not source.
- **[sherif](https://github.com/QuiiBz/sherif)** is a zero-config linter with an autofix. Its `multiple-dependency-versions` rule overlaps with `version-mismatch`; its other rules cover root `package.json` hygiene, dependency ordering and `@types` placement. Its README lists no catalog or `workspace:` rule.
- **[manypkg](https://github.com/Thinkmill/manypkg)** checks external and internal version mismatches (including that an internal range matches the local version) and can require the `workspace:` protocol. Its README does not mention catalogs.
- **[knip](https://knip.dev)** finds unused files, exports and dependencies, and unlisted dependencies, which covers what `phantom-dependency` does with a real module graph. It also reports unused pnpm catalog entries and unresolved catalog references. It does not compare versions across packages.

catalog-doctor is narrower: pnpm only, built around catalogs, and with no configuration. Every rule overlaps with at least one tool above; syncpack, configured with catalog and `workspace:*` version groups, covers most of them. What catalog-doctor adds is that set of checks with no config: `catalog-drift` (a dependency that goes through the catalog in some packages and a literal range in others), `catalog-candidate` (the same version in several packages with no catalog entry), `unpinned-workspace-dep`, `version-mismatch`, and a lexical `phantom-dependency` scan, in one run.

## What it deliberately does not do

- **It does not read your lockfile.** Everything here is a statement about what your manifests _say_, which is what you edit and review. Resolution is pnpm's job.
- **It does not parse your source.** `phantom-dependency` is a lexical scan: it anchors on `import` / `export` / `require`, skips comment lines, and honours `tsconfig.json` path aliases. That is fast and needs no toolchain, and it can still be fooled by a specifier inside a string literal. `--exclude` and `--ignore phantom-dependency` are there for when it is.
- **It does not compare peer ranges.** A peer range is a compatibility statement, not a pin, so `peerDependencies` is excluded from the version-comparison rules. Only `missing-catalog-entry` and `unused-catalog-entry` read it.
- **It has no config file.** Flags only, so far. If that stops being enough, [open an issue](https://github.com/rajanaggarwal11/catalog-doctor/issues) — the shape of the config should come from a real workspace that needs it.

## Requirements

Node 22.13 or newer — Node 20 reached end-of-life in April 2026. pnpm workspaces only, since `catalog:` is a pnpm feature.

The package is **ESM-only**. As a CLI that makes no difference; as a library it means `import`, not `require`.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Every rule is one file in `src/rules/` with one fixture workspace in `test/fixtures/`, so a new rule is a small, self-contained pull request.

## Working with me

**Monorepo in a state?** I untangle pnpm workspaces — dependency drift, phantom imports, CI that lies — and leave the rules that keep it that way. Write to me: [aggarwal11.rajan05@gmail.com](mailto:aggarwal11.rajan05@gmail.com).

## License

[MIT](./LICENSE) © Rajan Aggarwal
