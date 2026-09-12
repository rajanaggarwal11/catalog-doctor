import { catalogNameOf, eachDepOf, isCatalogSpec } from "../deps.js";
import type { Finding, Rule, Workspace } from "../types.js";

/**
 * A package points at a catalog entry that does not exist. `pnpm install` fails on
 * this, so it is always an error — but it hides easily in a branch where the
 * manifest change landed and the workspace file change did not.
 */
export const missingCatalogEntry: Rule = {
  id: "missing-catalog-entry",
  title: "Catalog reference has no entry",
  description: "A package declares `catalog:` for a dependency the named catalog does not define.",
  defaultSeverity: "error",
  fixable: false,

  check(workspace: Workspace): Finding[] {
    const findings: Finding[] = [];

    for (const entry of eachDepOf(workspace.packages)) {
      if (!isCatalogSpec(entry.spec)) continue;

      const catalogName = catalogNameOf(entry.spec);
      const catalog = workspace.catalogs[catalogName];
      if (catalog && catalog[entry.name]) continue;

      const known = Object.keys(workspace.catalogs);
      const detail = catalog
        ? [`catalog ${catalogName} exists but defines no ${entry.name}`]
        : [
            `there is no catalog named ${catalogName}`,
            known.length ? `defined catalogs: ${known.join(", ")}` : "no catalogs are defined",
          ];

      findings.push({
        rule: missingCatalogEntry.id,
        severity: missingCatalogEntry.defaultSeverity,
        dep: entry.name,
        message: `${entry.pkg.name} declares ${entry.name}: ${entry.spec}, which resolves to nothing`,
        sites: [
          { packageName: entry.pkg.name, file: entry.pkg.relManifestPath, depType: entry.depType },
        ],
        detail,
        fixable: false,
      });
    }

    return findings;
  },
};
