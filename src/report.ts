import { basename } from "node:path";
import pc from "picocolors";
import type { DiagnoseResult, Finding, FindingSite } from "./types.js";

/** How many sites to list under one finding before collapsing the rest. */
const MAX_SITES = 6;

export interface ReportOptions {
  /** Name the fix flag in the summary. Set false when `--fix` already ran. */
  suggestFix?: boolean;
}

function siteLine(site: FindingSite): string {
  return site.depType ? `${site.file} · ${site.depType}` : site.file;
}

function countLabel(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function renderFinding(finding: Finding): string[] {
  const lines: string[] = [];
  const bullet = finding.severity === "error" ? pc.red("✗") : pc.yellow("!");
  lines.push(`  ${bullet} ${finding.message}`);

  for (const detail of finding.detail ?? []) {
    lines.push(pc.dim(`      ${detail}`));
  }

  const shown = finding.sites.slice(0, MAX_SITES);
  for (const site of shown) {
    lines.push(pc.dim(pc.gray(`      ${siteLine(site)}`)));
  }
  if (finding.sites.length > shown.length) {
    const rest = finding.sites.length - shown.length;
    lines.push(pc.dim(pc.gray(`      and ${countLabel(rest, "more place", "more places")}`)));
  }

  return lines;
}

/** The human-readable report. Returns the whole thing as one string; the CLI prints it. */
export function formatReport(result: DiagnoseResult, options: ReportOptions = {}): string {
  const { workspace, findings } = result;
  const out: string[] = [];

  const catalogCount = Object.keys(workspace.catalogs).length;
  out.push(
    [
      pc.bold("catalog-doctor"),
      pc.dim(basename(workspace.root)),
      pc.dim(countLabel(workspace.packages.length, "package", "packages")),
      pc.dim(countLabel(catalogCount, "catalog", "catalogs")),
    ].join(pc.dim(" · ")),
  );
  out.push("");

  if (findings.length === 0) {
    out.push(`${pc.green("✓")} No problems found.`);
    out.push("");
    return out.join("\n");
  }

  // Findings arrive severity-ordered; group them by rule without disturbing that.
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const list = groups.get(finding.rule);
    if (list) list.push(finding);
    else groups.set(finding.rule, [finding]);
  }

  for (const [rule, group] of groups) {
    const severity = group[0]?.severity ?? "warn";
    const tag =
      severity === "error" ? pc.bgRed(pc.black(" error ")) : pc.bgYellow(pc.black(" warn "));
    out.push(`${tag} ${pc.bold(rule)}`);
    for (const finding of group) out.push(...renderFinding(finding));
    out.push("");
  }

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.length - errors;
  const fixable = findings.filter((f) => f.fixable).length;

  out.push(pc.dim("─".repeat(48)));
  out.push(
    `${pc.bold(countLabel(findings.length, "finding", "findings"))}: ` +
      `${errors ? pc.red(countLabel(errors, "error", "errors")) : countLabel(errors, "error", "errors")}, ` +
      `${warnings ? pc.yellow(countLabel(warnings, "warning", "warnings")) : countLabel(warnings, "warning", "warnings")}`,
  );
  if (fixable > 0 && options.suggestFix !== false) {
    out.push(pc.dim(`${fixable} fixable — run ${pc.bold("catalog-doctor --fix")}`));
  }
  out.push("");

  return out.join("\n");
}

/** The machine-readable report, for `--json`. Shape is part of the public contract. */
export function formatJson(result: DiagnoseResult): string {
  const errors = result.findings.filter((f) => f.severity === "error").length;
  return `${JSON.stringify(
    {
      version: 1,
      root: result.workspace.root,
      packages: result.workspace.packages.length,
      catalogs: Object.keys(result.workspace.catalogs),
      rulesRun: result.rulesRun,
      summary: {
        total: result.findings.length,
        errors,
        warnings: result.findings.length - errors,
        fixable: result.findings.filter((f) => f.fixable).length,
      },
      findings: result.findings.map((f) => ({
        rule: f.rule,
        severity: f.severity,
        dep: f.dep,
        message: f.message,
        detail: f.detail ?? [],
        sites: f.sites,
        fixable: f.fixable,
      })),
    },
    null,
    2,
  )}\n`;
}
