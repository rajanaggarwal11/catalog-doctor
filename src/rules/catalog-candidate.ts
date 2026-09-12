import {
  indexByDep,
  isCatalogSpec,
  isRegistrySpec,
  isVersionedDepType,
  packagesOf,
} from "../deps.js";
import type { Finding, Rule, Workspace } from "../types.js";

/**
 * A dependency pinned to the same range in several packages, none of which use the
 * catalog. Nothing is broken today — but the next upgrade has to touch every
 * manifest, and the day one gets missed is the day the versions diverge.
 */
export const catalogCandidate: Rule = {
  id: "catalog-candidate",
  title: "Dependency should be a catalog entry",
  description:
    "A dependency declared with the same version in two or more packages, with no catalog entry.",
  defaultSeverity: "warn",
  fixable: true,

  check(workspace: Workspace): Finding[] {
    const findings: Finding[] = [];

    for (const [dep, entries] of indexByDep(workspace.packages)) {
      if (workspace.packageNames.has(dep)) continue; // internal, handled elsewhere
      if (entries.some((e) => isCatalogSpec(e.spec))) continue; // drift, not a candidate

      const registry = entries.filter(
        (e) => isRegistrySpec(e.spec) && isVersionedDepType(e.depType),
      );
      if (registry.length < 2) continue;

      const packages = packagesOf(registry);
      if (packages.length < 2) continue; // same package, two dep blocks

      const specs = new Set(registry.map((e) => e.spec));
      if (specs.size !== 1) continue; // they disagree — version-mismatch owns this

      const [spec] = [...specs];
      findings.push({
        rule: catalogCandidate.id,
        severity: catalogCandidate.defaultSeverity,
        dep,
        message: `${dep} is declared as ${spec} in ${packages.length} packages but is not in the catalog`,
        sites: registry.map((e) => ({
          packageName: e.pkg.name,
          file: e.pkg.relManifestPath,
          depType: e.depType,
        })),
        detail: [`add \`${dep}: ${spec}\` to the catalog and replace each spec with \`catalog:\``],
        fixable: true,
        fix: {
          catalogs: [{ catalog: "default", dep, spec: spec ?? "" }],
          manifests: registry.map((e) => ({
            file: e.pkg.relManifestPath,
            depType: e.depType,
            dep,
            spec: "catalog:",
          })),
        },
      });
    }

    return findings.sort((a, b) => (a.dep ?? "").localeCompare(b.dep ?? ""));
  },
};
