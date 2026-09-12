---
"catalog-doctor": minor
---

First release.

Seven rules over a pnpm workspace: `missing-catalog-entry`, `unpinned-workspace-dep`, `version-mismatch`, `catalog-drift`, `phantom-dependency`, `catalog-candidate` and `unused-catalog-entry`. Four of them carry the edits that resolve them, applied by `--fix` — which declines anything that needs a human to choose a version.

`--json` for CI, `--only` / `--ignore` / `--exclude` for scoping, and documented exit codes.
