import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { applyFixes, diagnose, loadWorkspace } from "../src/index.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Copies a fixture somewhere writable, so a fix test never edits the fixture itself. */
async function scratch(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "catalog-doctor-"));
  temps.push(dir);
  await cp(fixture(name), dir, { recursive: true });
  return dir;
}

const readJson = async (dir: string, rel: string) =>
  JSON.parse(await readFile(join(dir, rel), "utf8")) as {
    dependencies?: Record<string, string>;
  };

describe("--fix", () => {
  it("writes nothing under dryRun but still reports the files", async () => {
    const dir = await scratch("messy");
    const before = await readFile(join(dir, "packages/a/package.json"), "utf8");

    const { workspace, findings } = await diagnose({ cwd: dir });
    const result = await applyFixes(workspace, findings, { dryRun: true });

    expect(result.changedFiles.length).toBeGreaterThan(0);
    expect(await readFile(join(dir, "packages/a/package.json"), "utf8")).toBe(before);
  });

  it("pins an internal dependency to workspace:*", async () => {
    const dir = await scratch("messy");
    const { workspace, findings } = await diagnose({ cwd: dir });
    await applyFixes(workspace, findings);

    const a = await readJson(dir, "packages/a/package.json");
    expect(a.dependencies?.["@messy/b"]).toBe("workspace:*");
  });

  it("points a drifted dependency back at the catalog it already has", async () => {
    const dir = await scratch("messy");
    const { workspace, findings } = await diagnose({ cwd: dir });
    await applyFixes(workspace, findings);

    const b = await readJson(dir, "packages/b/package.json");
    expect(b.dependencies?.zod).toBe("catalog:");
  });

  it("moves an agreed version into the catalog and repoints every package", async () => {
    const dir = await scratch("messy");
    const { workspace, findings } = await diagnose({ cwd: dir });
    await applyFixes(workspace, findings);

    const yaml = await readFile(join(dir, "pnpm-workspace.yaml"), "utf8");
    expect(yaml).toContain("date-fns: ^3.6.0");

    const a = await readJson(dir, "packages/a/package.json");
    const b = await readJson(dir, "packages/b/package.json");
    expect(a.dependencies?.["date-fns"]).toBe("catalog:");
    expect(b.dependencies?.["date-fns"]).toBe("catalog:");
  });

  it("removes catalog entries nothing references", async () => {
    const dir = await scratch("messy");
    const { workspace, findings } = await diagnose({ cwd: dir });
    await applyFixes(workspace, findings);

    const yaml = await readFile(join(dir, "pnpm-workspace.yaml"), "utf8");
    expect(yaml).not.toContain("left-pad");
    expect(yaml).not.toContain("^17.0.2");
  });

  it("leaves the version mismatch alone, because picking a winner is a decision", async () => {
    const dir = await scratch("messy");
    const { workspace, findings } = await diagnose({ cwd: dir });
    await applyFixes(workspace, findings);

    const a = await readJson(dir, "packages/a/package.json");
    const b = await readJson(dir, "packages/b/package.json");
    expect(a.dependencies?.lodash).toBe("^4.17.21");
    expect(b.dependencies?.lodash).toBe("^4.17.20");
  });

  it("preserves the file's own indentation", async () => {
    const dir = await scratch("messy");
    const { workspace, findings } = await diagnose({ cwd: dir });
    await applyFixes(workspace, findings);

    const raw = await readFile(join(dir, "packages/a/package.json"), "utf8");
    expect(raw).toContain('\n  "dependencies": {');
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("resolves every fixable finding, so a second run has less to say", async () => {
    const dir = await scratch("messy");
    const first = await diagnose({ cwd: dir });
    await applyFixes(first.workspace, first.findings);

    const second = await diagnose({ workspace: await loadWorkspace(dir) });
    const remaining = [...new Set(second.findings.map((f) => f.rule))].sort();

    // What is left is exactly what needs a human: which lodash wins, and what
    // version `missing-thing` should be.
    expect(remaining).toEqual(["missing-catalog-entry", "version-mismatch"]);
    expect(second.findings.every((f) => !f.fixable)).toBe(true);
  });

  it("is idempotent", async () => {
    const dir = await scratch("messy");
    const first = await diagnose({ cwd: dir });
    await applyFixes(first.workspace, first.findings);
    const afterFirst = await readFile(join(dir, "pnpm-workspace.yaml"), "utf8");

    const second = await diagnose({ workspace: await loadWorkspace(dir) });
    const result = await applyFixes(second.workspace, second.findings);

    expect(result.changedFiles).toEqual([]);
    expect(await readFile(join(dir, "pnpm-workspace.yaml"), "utf8")).toBe(afterFirst);
  });
});
