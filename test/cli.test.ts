import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

interface Captured {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs the CLI with its streams captured, so a test never prints the report. */
async function cli(...argv: string[]): Promise<Captured> {
  let stdout = "";
  let stderr = "";
  const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  const err = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  try {
    const code = await run(argv);
    return { code, stdout, stderr };
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

afterEach(() => vi.restoreAllMocks());

describe("exit codes", () => {
  it("exits 0 on a clean workspace", async () => {
    const { code, stdout } = await cli("--cwd", fixture("clean"));
    expect(code).toBe(0);
    expect(stdout).toContain("No problems found");
  });

  it("exits 1 when an error-severity finding remains", async () => {
    const { code } = await cli("--cwd", fixture("messy"));
    expect(code).toBe(1);
  });

  it("exits 0 for warnings alone, and 1 for the same run under --strict", async () => {
    const warnOnly = ["--cwd", fixture("messy"), "--only", "catalog-candidate"];
    expect((await cli(...warnOnly)).code).toBe(0);
    expect((await cli(...warnOnly, "--strict")).code).toBe(1);
  });

  it("exits 2 when there is no workspace to inspect", async () => {
    // Must be outside the repo: findWorkspaceRoot walks up, and this repo has one.
    const empty = await mkdtemp(join(tmpdir(), "catalog-doctor-empty-"));
    try {
      const { code, stderr } = await cli("--cwd", empty);
      expect(code).toBe(2);
      expect(stderr).toContain("pnpm-workspace.yaml");
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("exits 2 on an unknown rule id", async () => {
    const { code, stderr } = await cli("--cwd", fixture("clean"), "--only", "no-such-rule");
    expect(code).toBe(2);
    expect(stderr).toContain("Unknown rule");
  });

  it("exits 2 on an unknown flag", async () => {
    const { code } = await cli("--cwd", fixture("clean"), "--nope");
    expect(code).toBe(2);
  });
});

describe("output", () => {
  it("--json emits the documented shape", async () => {
    const { stdout, code } = await cli("--cwd", fixture("messy"), "--json");
    expect(code).toBe(1);

    const report = JSON.parse(stdout) as {
      version: number;
      summary: { total: number; errors: number; warnings: number; fixable: number };
      findings: { rule: string; severity: string; fixable: boolean }[];
      rulesRun: string[];
    };

    expect(report.version).toBe(1);
    expect(report.summary.total).toBe(report.findings.length);
    expect(report.summary.errors + report.summary.warnings).toBe(report.summary.total);
    expect(report.rulesRun.length).toBeGreaterThan(0);
  });

  it("--list-rules names every rule and exits 0", async () => {
    const { code, stdout } = await cli("--list-rules");
    expect(code).toBe(0);
    for (const id of ["catalog-drift", "phantom-dependency", "version-mismatch"]) {
      expect(stdout).toContain(id);
    }
  });

  it("--help documents the exit codes it actually uses", async () => {
    const { code, stdout } = await cli("--help");
    expect(code).toBe(0);
    expect(stdout).toContain("Exit codes");
    expect(stdout).toContain("--fix");
  });

  it("--version prints a version", async () => {
    const { code, stdout } = await cli("--version");
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("suggests --fix only when it has not just run", async () => {
    const { stdout } = await cli("--cwd", fixture("messy"));
    expect(stdout).toContain("--fix");
  });
});

describe("--fix --dry-run", () => {
  it("reports the edits without touching the fixture", async () => {
    const { stdout, code } = await cli("--cwd", fixture("messy"), "--fix", "--dry-run");
    expect(stdout).toContain("would change");
    // The fixture is unchanged, so the findings are all still there.
    expect(code).toBe(1);
  });
});
