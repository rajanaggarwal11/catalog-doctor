import { ALL_RULES } from "./rules/index.js";
import { findWorkspaceRoot, loadWorkspace } from "./workspace.js";
import type {
  DiagnoseOptions,
  DiagnoseResult,
  Finding,
  Rule,
  RuleContext,
  Workspace,
} from "./types.js";

export interface DiagnoseInput extends DiagnoseOptions {
  /** Where to start looking for `pnpm-workspace.yaml`. Defaults to the current directory. */
  cwd?: string;
  /** An already-loaded workspace, when you have one. Skips discovery and file reads. */
  workspace?: Workspace;
  /** Override the rule set entirely. Defaults to every built-in rule. */
  rules?: readonly Rule[];
}

function selectRules(rules: readonly Rule[], options: DiagnoseOptions): Rule[] {
  const only = options.only?.length ? new Set(options.only) : undefined;
  const ignore = new Set(options.ignore ?? []);
  return rules.filter((rule) => {
    if (only && !only.has(rule.id)) return false;
    return !ignore.has(rule.id);
  });
}

/** Severity first, then rule order, then dependency name — so the output reads worst-first. */
function orderFindings(findings: Finding[], ruleOrder: readonly string[]): Finding[] {
  return findings.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    const byRule = ruleOrder.indexOf(a.rule) - ruleOrder.indexOf(b.rule);
    if (byRule !== 0) return byRule;
    return (a.dep ?? "").localeCompare(b.dep ?? "");
  });
}

/**
 * Runs every selected rule over a pnpm workspace.
 *
 * Throws `NotAWorkspaceError` when there is no `pnpm-workspace.yaml` to be found,
 * because a silent empty result would read as a clean bill of health.
 */
export async function diagnose(input: DiagnoseInput = {}): Promise<DiagnoseResult> {
  const workspace = input.workspace ?? (await loadWorkspace(findWorkspaceRoot(input.cwd)));
  const rules = selectRules(input.rules ?? ALL_RULES, input);

  const context: RuleContext = { exclude: input.exclude ?? [] };

  const findings: Finding[] = [];
  for (const rule of rules) {
    findings.push(...(await rule.check(workspace, context)));
  }

  return {
    workspace,
    findings: orderFindings(
      findings,
      (input.rules ?? ALL_RULES).map((r) => r.id),
    ),
    rulesRun: rules.map((r) => r.id),
  };
}

export { applyFixes } from "./fix.js";
export { ALL_RULES, RULE_IDS, isRuleId } from "./rules/index.js";
export {
  findWorkspaceRoot,
  loadWorkspace,
  NotAWorkspaceError,
  WORKSPACE_FILE,
} from "./workspace.js";
export { formatReport, formatJson } from "./report.js";
export { DEP_TYPES } from "./types.js";
export type {
  Catalogs,
  CatalogEdit,
  DepType,
  DiagnoseOptions,
  DiagnoseResult,
  Finding,
  FindingSite,
  Fix,
  Manifest,
  ManifestEdit,
  Rule,
  RuleContext,
  RuleId,
  RuleMeta,
  Severity,
  Workspace,
  WorkspacePackage,
} from "./types.js";
export type { FixOptions, FixResult } from "./fix.js";
