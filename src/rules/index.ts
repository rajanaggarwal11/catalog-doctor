import { catalogCandidate } from "./catalog-candidate.js";
import { catalogDrift } from "./catalog-drift.js";
import { missingCatalogEntry } from "./missing-catalog-entry.js";
import { phantomDependency } from "./phantom-dependency.js";
import { unpinnedWorkspaceDep } from "./unpinned-workspace-dep.js";
import { unusedCatalogEntry } from "./unused-catalog-entry.js";
import { versionMismatch } from "./version-mismatch.js";
import type { Rule, RuleId } from "../types.js";

/** Every rule, ordered the way the report reads: breakage first, hygiene last. */
export const ALL_RULES: readonly Rule[] = [
  missingCatalogEntry,
  unpinnedWorkspaceDep,
  versionMismatch,
  catalogDrift,
  phantomDependency,
  catalogCandidate,
  unusedCatalogEntry,
];

export const RULE_IDS: readonly RuleId[] = ALL_RULES.map((r) => r.id);

export function isRuleId(value: string): value is RuleId {
  return (RULE_IDS as readonly string[]).includes(value);
}

export {
  catalogCandidate,
  catalogDrift,
  missingCatalogEntry,
  phantomDependency,
  unpinnedWorkspaceDep,
  unusedCatalogEntry,
  versionMismatch,
};
