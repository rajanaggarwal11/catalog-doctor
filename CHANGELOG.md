# catalog-doctor

## 0.1.1

**Fixes `npx catalog-doctor` doing nothing.**

0.1.0 shipped a self-execute guard that compared `import.meta.url` against a raw
`process.argv[1]`. npm installs a bin as a symlink —
`node_modules/.bin/catalog-doctor -> ../catalog-doctor/dist/cli.js` — so the two
paths never matched, `run()` was never called, and the CLI exited 0 having parsed
nothing and printed nothing.

It was invisible in testing because every test invoked the CLI by its real path,
where the comparison holds. Both sides are now resolved through `realpath`, and
there is a test that executes the built binary through a symlink, which is the
only arrangement that reproduces it.

## 0.1.0

First release.

Seven rules over a pnpm workspace:

- `missing-catalog-entry` — a `catalog:` reference that resolves to nothing
- `unpinned-workspace-dep` — an internal package declared as a registry range
- `version-mismatch` — one dependency, two ranges
- `catalog-drift` — a half-adopted catalog
- `phantom-dependency` — imported in source, never declared
- `catalog-candidate` — an agreed version with no catalog entry
- `unused-catalog-entry` — an entry nothing points at

Four of them carry the edits that resolve them, applied by `--fix`, which declines
anything needing a human to choose a version. `--json` for CI, `--only` / `--ignore`
/ `--exclude` for scoping, and documented exit codes.

`peerDependencies` is excluded from the version-comparison rules: a peer range is a
compatibility statement, not a pin.
