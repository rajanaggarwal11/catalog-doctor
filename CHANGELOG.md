# catalog-doctor

## 0.2.0

### Minor Changes

- [`9ca3452`](https://github.com/rajanaggarwal11/catalog-doctor/commit/9ca34523799c0b2277fd06d7224288500e06fbe6) Thanks [@rajanaggarwal11](https://github.com/rajanaggarwal11)! - First release.

  Seven rules over a pnpm workspace: `missing-catalog-entry`, `unpinned-workspace-dep`, `version-mismatch`, `catalog-drift`, `phantom-dependency`, `catalog-candidate` and `unused-catalog-entry`. Four of them carry the edits that resolve them, applied by `--fix` — which declines anything that needs a human to choose a version.

  `--json` for CI, `--only` / `--ignore` / `--exclude` for scoping, and documented exit codes.
