import {
  catalogNameOf,
  indexByDep,
  isCatalogSpec,
  isRegistrySpec,
  isVersionedDepType,
} from "../deps.js";
import type { Finding, Rule, Workspace } from "../types.js";

/**
 * Half-adopted catalog: some packages point at the catalog, others still carry a
 * literal range. This is the failure mode catalogs exist to prevent, and it is the
 * one people miss, because the catalog *looks* adopted.
 */
export const catalogDrift: Rule = {
  id: "catalog-drift",
  title: "Catalog adopted in some packages but not others",
  description:
    "A dependency that resolves through the catalog in one package and a literal version in another.",
  defaultSeverity: "error",
  fixable: true,

  check(workspace: Workspace): Finding[] {
    const findings: Finding[] = [];

    for (const [dep, entries] of indexByDep(workspace.packages)) {
      const versioned = entries.filter((e) => isVersionedDepType(e.depType));
      const viaCatalog = versioned.filter((e) => isCatalogSpec(e.spec));
      const literal = versioned.filter((e) => isRegistrySpec(e.spec));
      if (viaCatalog.length === 0 || literal.length === 0) continue;

      const catalogNames = [...new Set(viaCatalog.map((e) => catalogNameOf(e.spec)))];
      const detail: string[] = [];
      for (const name of catalogNames) {
        const pinned = workspace.catalogs[name]?.[dep];
        detail.push(
          pinned
            ? `catalog ${name} pins ${dep} to ${pinned}`
            : `catalog ${name} has no entry for ${dep}`,
        );
      }
      for (const entry of literal) {
        detail.push(`${entry.pkg.name} declares ${entry.spec} directly`);
      }

      // Only rewritable when every catalog reference agrees on one catalog that
      // already defines the dep; two catalogs means choosing one, which is a decision.
      const singleCatalog = catalogNames.length === 1 ? catalogNames[0] : undefined;
      const fixable = Boolean(singleCatalog && workspace.catalogs[singleCatalog]?.[dep]);

      findings.push({
        rule: catalogDrift.id,
        severity: catalogDrift.defaultSeverity,
        dep,
        message:
          `${dep} resolves through the catalog in ${viaCatalog.length} ` +
          `${viaCatalog.length === 1 ? "place" : "places"} and directly in ${literal.length}`,
        sites: [...viaCatalog, ...literal].map((e) => ({
          packageName: e.pkg.name,
          file: e.pkg.relManifestPath,
          depType: e.depType,
        })),
        detail,
        fixable,
        ...(fixable && singleCatalog
          ? {
              fix: {
                manifests: literal.map((e) => ({
                  file: e.pkg.relManifestPath,
                  depType: e.depType,
                  dep,
                  spec: singleCatalog === "default" ? "catalog:" : `catalog:${singleCatalog}`,
                })),
              },
            }
          : {}),
      });
    }

    return findings.sort((a, b) => (a.dep ?? "").localeCompare(b.dep ?? ""));
  },
};
