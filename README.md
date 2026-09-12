# catalog-doctor

**Health check for pnpm workspaces.** Finds the dependency drift a monorepo accumulates quietly — half-adopted catalogs, two versions of the same library, internal packages that can resolve to the registry, imports nothing declares — and fixes the ones that have only one correct answer.

[![CI](https://github.com/rajanaggarwal11/catalog-doctor/actions/workflows/ci.yml/badge.svg)](https://github.com/rajanaggarwal11/catalog-doctor/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/catalog-doctor.svg)](https://www.npmjs.com/package/catalog-doctor)
[![license](https://img.shields.io/npm/l/catalog-doctor.svg)](./LICENSE)

```bash
npx catalog-doctor
```

No config, no install, no setup. It finds `pnpm-workspace.yaml` by walking up from wherever you run it.

## Why

pnpm catalogs are the right answer to version drift, and they work — right up until adoption is partial. Then you have the worst of both worlds: the catalog _looks_ like the source of truth, while two packages quietly resolve a different copy of the same library. That is the bug that reproduces in one app and not the other, and it does not show up in `pnpm install`, in your typechecker, or in your tests.

Nothing here is exotic. It is all the stuff you'd catch in review if review caught everything.

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
      packages/web/package.json · dependencies
      packages/api/package.json · dependencies

 error  catalog-drift
  ✗ zod resolves through the catalog in 1 place and directly in 1
      catalog default pins zod to ^3.23.8
      @acme/api declares ^3.22.0 directly
      packages/web/package.json · dependencies
      packages/api/package.json · dependencies

 warn  catalog-candidate
  ! date-fns is declared as ^3.6.0 in 2 packages but is not in the catalog
      add `date-fns: ^3.6.0` to the catalog and replace each spec with `catalog:`
      packages/web/package.json · dependencies
      packages/api/package.json · dependencies

 warn  unused-catalog-entry
  ! left-pad (^1.3.0) sits in the default catalog but no package references it
      pnpm-workspace.yaml

────────────────────────────────────────────────
7 findings: 4 errors, 3 warnings
5 fixable — run catalog-doctor --fix
```

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

## License

[MIT](./LICENSE) © Rajan Aggarwal
