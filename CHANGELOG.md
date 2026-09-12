# catalog-doctor

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
