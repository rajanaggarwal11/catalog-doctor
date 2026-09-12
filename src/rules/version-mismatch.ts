import { indexByDep, isRegistrySpec, isVersionedDepType } from "../deps.js";
import type { Finding, Rule, Workspace } from "../types.js";

/**
 * The same dependency at two different ranges in one workspace. pnpm will happily
 * install both, so two packages end up running different copies of the same
 * library — which is how you get a bug that reproduces in one app and not another.
 */
export const versionMismatch: Rule = {
  id: "version-mismatch",
  title: "One dependency, two versions",
  description: "A dependency declared with conflicting version ranges across packages.",
  defaultSeverity: "error",
  fixable: false,

  check(workspace: Workspace): Finding[] {
    const findings: Finding[] = [];

    for (const [dep, entries] of indexByDep(workspace.packages)) {
      if (workspace.packageNames.has(dep)) continue;

      const registry = entries.filter(
        (e) => isRegistrySpec(e.spec) && isVersionedDepType(e.depType),
      );
      const specs = new Set(registry.map((e) => e.spec));
      if (specs.size < 2) continue;

      const bySpec = new Map<string, string[]>();
      for (const entry of registry) {
        const list = bySpec.get(entry.spec);
        if (list) list.push(entry.pkg.name);
        else bySpec.set(entry.spec, [entry.pkg.name]);
      }

      findings.push({
        rule: versionMismatch.id,
        severity: versionMismatch.defaultSeverity,
        dep,
        message: `${dep} is declared at ${specs.size} different versions`,
        sites: registry.map((e) => ({
          packageName: e.pkg.name,
          file: e.pkg.relManifestPath,
          depType: e.depType,
        })),
        detail: [...bySpec.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([spec, pkgs]) => `${spec} — ${[...new Set(pkgs)].join(", ")}`),
        // Which range wins is a judgement call about breaking changes, not a lookup.
        fixable: false,
      });
    }

    return findings.sort((a, b) => (a.dep ?? "").localeCompare(b.dep ?? ""));
  },
};
