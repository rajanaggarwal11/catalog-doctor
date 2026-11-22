---
"catalog-doctor": patch
---

`--fix` refuses edits for a dependency or catalog named `__proto__`, `constructor` or `prototype`; those findings are reported as skipped instead. It also only rewrites a dependency the manifest really declares, so an edit can no longer add an entry for a name such as `constructor` or `toString` that the manifest object only inherits.
