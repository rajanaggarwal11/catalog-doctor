#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pc from "picocolors";
import { diagnose } from "./index.js";
import { applyFixes } from "./fix.js";
import { ALL_RULES, isRuleId } from "./rules/index.js";
import { formatJson, formatReport } from "./report.js";
import { NotAWorkspaceError, findWorkspaceRoot, loadWorkspace } from "./workspace.js";
import type { RuleId } from "./types.js";

/** 0 clean · 1 findings · 2 could not run. Documented, because CI depends on it. */
const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
const EXIT_ERROR = 2;

function version(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    return (JSON.parse(raw) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const HELP = `
${pc.bold("catalog-doctor")} — health check for pnpm workspaces

${pc.bold("Usage")}
  catalog-doctor [options]

${pc.bold("Options")}
  --fix                Apply every fix that does not need a human decision
  --dry-run            With --fix, report the edits without writing them
  --json               Machine-readable output (stable shape, for CI)
  --only <ids>         Run only these rules (comma-separated)
  --ignore <ids>       Skip these rules (comma-separated)
  --exclude <globs>    Paths to keep out of source scanning (comma-separated)
  --strict             Exit non-zero on warnings too, not just errors
  --cwd <path>         Start looking for pnpm-workspace.yaml here
  --list-rules         Print every rule and what it checks
  -v, --version        Print the version
  -h, --help           Print this

${pc.bold("Exit codes")}
  0  nothing to report
  1  findings remain (errors, or any finding under --strict)
  2  could not run — no workspace, or a bad option

${pc.bold("Examples")}
  npx catalog-doctor
  npx catalog-doctor --fix
  npx catalog-doctor --only catalog-drift,version-mismatch
  npx catalog-doctor --exclude "test/fixtures/**"
  npx catalog-doctor --json > report.json
`;

function listRules(): string {
  const width = Math.max(...ALL_RULES.map((r) => r.id.length));
  const lines = ALL_RULES.map((rule) => {
    const tag = rule.defaultSeverity === "error" ? pc.red("error") : pc.yellow("warn ");
    const fix = rule.fixable ? pc.green(" [fixable]") : "";
    return `  ${pc.bold(rule.id.padEnd(width))}  ${tag}  ${rule.description}${fix}`;
  });
  return `\n${pc.bold("Rules")}\n${lines.join("\n")}\n`;
}

function parseRuleList(value: string | undefined, flag: string): RuleId[] {
  if (!value) return [];
  const ids = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = ids.filter((id) => !isRuleId(id));
  if (bad.length > 0) {
    throw new Error(
      `Unknown rule${bad.length > 1 ? "s" : ""} for ${flag}: ${bad.join(", ")}\n` +
        `Run catalog-doctor --list-rules to see the valid ids.`,
    );
  }
  return ids as RuleId[];
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<number> {
  let values: Record<string, unknown>;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        fix: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        only: { type: "string" },
        ignore: { type: "string" },
        exclude: { type: "string" },
        strict: { type: "boolean", default: false },
        cwd: { type: "string" },
        "list-rules": { type: "boolean", default: false },
        version: { type: "boolean", short: "v", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    process.stderr.write(`${pc.red("✗")} ${(error as Error).message}\n${HELP}`);
    return EXIT_ERROR;
  }

  if (values.help) {
    process.stdout.write(HELP);
    return EXIT_OK;
  }
  if (values.version) {
    process.stdout.write(`${version()}\n`);
    return EXIT_OK;
  }
  if (values["list-rules"]) {
    process.stdout.write(listRules());
    return EXIT_OK;
  }

  const asJson = Boolean(values.json);
  const wantsFix = Boolean(values.fix);
  const dryRun = Boolean(values["dry-run"]);

  try {
    const only = parseRuleList(values.only as string | undefined, "--only");
    const ignore = parseRuleList(values.ignore as string | undefined, "--ignore");
    const cwd = (values.cwd as string | undefined) ?? process.cwd();

    const exclude = ((values.exclude as string | undefined) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let result = await diagnose({ cwd, only, ignore, exclude });

    if (wantsFix && result.findings.some((f) => f.fixable)) {
      const fixed = await applyFixes(result.workspace, result.findings, { dryRun });

      if (!asJson) {
        const verb = dryRun ? "would change" : "changed";
        process.stdout.write(
          `${pc.green("✓")} ${fixed.applied.length} ` +
            `${fixed.applied.length === 1 ? "finding" : "findings"} fixed, ${verb} ` +
            `${fixed.changedFiles.length} ` +
            `${fixed.changedFiles.length === 1 ? "file" : "files"}\n`,
        );
        for (const file of fixed.changedFiles) {
          process.stdout.write(pc.dim(`    ${file}\n`));
        }
        for (const { finding, reason } of fixed.skipped) {
          process.stdout.write(
            pc.yellow(`  ! skipped ${finding.rule} (${finding.dep}): ${reason}\n`),
          );
        }
        process.stdout.write("\n");
      }

      // Re-read from disk so the report reflects what is actually there now.
      if (!dryRun) {
        const workspace = await loadWorkspace(findWorkspaceRoot(cwd));
        result = await diagnose({ workspace, only, ignore, exclude });
      }
    }

    process.stdout.write(
      asJson ? formatJson(result) : formatReport(result, { suggestFix: !wantsFix }),
    );

    const blocking = values.strict
      ? result.findings.length
      : result.findings.filter((f) => f.severity === "error").length;
    return blocking > 0 ? EXIT_FINDINGS : EXIT_OK;
  } catch (error) {
    if (error instanceof NotAWorkspaceError) {
      process.stderr.write(`${pc.red("✗")} ${error.message}\n`);
      return EXIT_ERROR;
    }
    process.stderr.write(`${pc.red("✗")} ${(error as Error).message}\n`);
    return EXIT_ERROR;
  }
}

/**
 * Whether this module is the program being run, as opposed to being imported.
 *
 * Both sides are resolved through realpath because npm installs a bin as a
 * SYMLINK — `node_modules/.bin/catalog-doctor -> ../catalog-doctor/dist/cli.js`.
 * Comparing `import.meta.url` against a raw `process.argv[1]` therefore compares
 * the real file against the link and never matches, so the CLI exits 0 having
 * done nothing. That is invisible when testing with `node dist/cli.js`, where the
 * two paths are identical, and total when installed.
 */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// Only self-execute as a binary; importing this module in a test must not exit.
if (isMainModule()) {
  run().then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${pc.red("✗")} ${String(error)}\n`);
      process.exit(EXIT_ERROR);
    },
  );
}
