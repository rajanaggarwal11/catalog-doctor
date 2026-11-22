---
"catalog-doctor": patch
---

`--fix` refuses edits for a dependency or catalog named `__proto__`, and reports those findings as skipped. It also only rewrites a dependency the manifest really declares, so an edit can no longer add an entry for a name such as `toString` that the manifest object only inherits. Real packages named `constructor` or `prototype` are fixed as usual.

A catalog named `__proto__` in `pnpm-workspace.yaml` is now read as a catalog. Before, it became the prototype of the catalog map and disappeared. Catalog and dependency lookups no longer resolve inherited names, so `catalog:toString` is now reported as a missing catalog instead of passing.
