import { eachDepOf, isCatalogSpec, isVersionedDepType, isWorkspaceSpec } from "../deps.js";
import type { Finding, Rule, Workspace } from "../types.js";

/**
 * An internal package referenced by a registry range instead of `workspace:`.
 * pnpm links the local copy while the range happens to match — and silently
 * installs a published copy from the registry the moment it stops matching,
 * which is a genuinely baffling twenty minutes when it happens to you.
 */
export const unpinnedWorkspaceDep: Rule = {
  id: "unpinned-workspace-dep",
  title: "Internal package not pinned to workspace:",
  description: "A dependency on another workspace package declared as a registry range.",
  defaultSeverity: "error",
  fixable: true,

  check(workspace: Workspace): Finding[] {
    const findings: Finding[] = [];

    for (const entry of eachDepOf(workspace.packages)) {
      if (!workspace.packageNames.has(entry.name)) continue;
      // A published package legitimately peer-depends on a sibling by semver range.
      if (!isVersionedDepType(entry.depType)) continue;
      if (entry.name === entry.pkg.name) continue; // a package may reference itself in peerDeps
      if (isWorkspaceSpec(entry.spec) || isCatalogSpec(entry.spec)) continue;

      findings.push({
        rule: unpinnedWorkspaceDep.id,
        severity: unpinnedWorkspaceDep.defaultSeverity,
        dep: entry.name,
        message: `${entry.pkg.name} depends on the local package ${entry.name} as ${entry.spec}`,
        sites: [
          { packageName: entry.pkg.name, file: entry.pkg.relManifestPath, depType: entry.depType },
        ],
        detail: [
          `${entry.name} is a package in this workspace — declare it as \`workspace:*\` so it can never resolve to the registry`,
        ],
        fixable: true,
        fix: {
          manifests: [
            {
              file: entry.pkg.relManifestPath,
              depType: entry.depType,
              dep: entry.name,
              spec: "workspace:*",
            },
          ],
        },
      });
    }

    return findings;
  },
};
