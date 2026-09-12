import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Exercises the BUILT binary the way npm actually installs it.
 *
 * npm links a package's bin rather than copying it:
 *
 *     node_modules/.bin/catalog-doctor -> ../catalog-doctor/dist/cli.js
 *
 * so `process.argv[1]` is the symlink while `import.meta.url` is the real file.
 * Version 0.1.0 shipped a self-execute guard that compared those two directly,
 * which meant `npx catalog-doctor` parsed nothing, printed nothing, and exited 0.
 * Every other test passed, because they all invoke the CLI by its real path.
 *
 * These tests run the binary through a symlink, which is the only arrangement
 * that reproduces it.
 */
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/messy", import.meta.url));

let linkDir: string;
let linked: string;

beforeAll(() => {
  linkDir = mkdtempSync(join(tmpdir(), "catalog-doctor-bin-"));
  linked = join(linkDir, "catalog-doctor");
  symlinkSync(cli, linked);
});

afterAll(() => {
  rmSync(linkDir, { recursive: true, force: true });
});

interface Run {
  status: number;
  stdout: string;
}

/** Runs the linked binary and captures its output, never throwing on exit codes. */
function run(...args: string[]): Run {
  try {
    const stdout = execFileSync(process.execPath, [linked, ...args], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    return { status: 0, stdout };
  } catch (error) {
    const e = error as { status?: number; stdout?: string };
    return { status: e.status ?? -1, stdout: e.stdout ?? "" };
  }
}

describe("the built binary, invoked through a symlink", () => {
  it("has been built", () => {
    // A clear failure beats every test below failing for a confusing reason.
    expect(existsSync(cli), `${cli} missing — run pnpm build first`).toBe(true);
  });

  it("actually runs and prints a report", () => {
    const { stdout } = run("--cwd", fixture, "--ignore", "phantom-dependency");
    expect(stdout).not.toBe("");
    expect(stdout).toContain("catalog-doctor");
    expect(stdout).toContain("findings");
  });

  it("exits 1 when errors remain", () => {
    const { status } = run("--cwd", fixture, "--ignore", "phantom-dependency");
    expect(status).toBe(1);
  });

  it("exits 0 on a clean workspace", () => {
    const clean = fileURLToPath(new URL("./fixtures/clean", import.meta.url));
    const { status, stdout } = run("--cwd", clean);
    expect(stdout).toContain("No problems found");
    expect(status).toBe(0);
  });

  it("prints help rather than silently succeeding", () => {
    const { status, stdout } = run("--help");
    expect(status).toBe(0);
    expect(stdout).toContain("Usage");
  });

  it("reports its version", () => {
    const { stdout } = run("--version");
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
