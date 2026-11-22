import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { applyFixes, diagnose, loadWorkspace } from "../src/index.js";
import type { Finding } from "../src/index.js";

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

  it("refuses edits keyed __proto__, reports them, and leaves the prototype alone", async () => {
    const dir = await scratch("messy");
    const { workspace } = await diagnose({ cwd: dir });
    const file = "packages/a/package.json";
    const before = await readFile(join(dir, file), "utf8");
    const yamlBefore = await readFile(join(dir, "pnpm-workspace.yaml"), "utf8");

    const finding = (dep: string, catalog = "default"): Finding => ({
      rule: "catalog-drift",
      severity: "error",
      dep,
      message: `malicious ${dep}`,
      sites: [{ file, depType: "dependencies" }],
      fixable: true,
      fix: {
        manifests: [{ file, depType: "dependencies", dep, spec: "catalog:" }],
        catalogs: [{ catalog, dep, spec: "1.0.0" }],
      },
    });

    const result = await applyFixes(workspace, [
      finding("__proto__"),
      finding("polluted", "__proto__"),
    ]);

    expect(result.applied).toEqual([]);
    expect(result.skipped.map((s) => [s.finding.dep, s.reason])).toEqual([
      ["__proto__", "the dependency or catalog name is __proto__"],
      ["polluted", "the dependency or catalog name is __proto__"],
    ]);
    expect(result.changedFiles).toEqual([]);
    expect(await readFile(join(dir, file), "utf8")).toBe(before);
    expect(await readFile(join(dir, "pnpm-workspace.yaml"), "utf8")).toBe(yamlBefore);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it("fixes drift on real packages named constructor and prototype", async () => {
    const dir = await mkdtemp(join(tmpdir(), "catalog-doctor-"));
    temps.push(dir);
    await writeFile(
      join(dir, "pnpm-workspace.yaml"),
      'packages:\n  - "packages/*"\n\ncatalog:\n  constructor: ^1.0.0\n  prototype: ^2.0.0\n',
    );
    const manifest = (name: string, spec: { constructor: string; prototype: string }) =>
      `${JSON.stringify({ name, version: "1.0.0", dependencies: spec }, null, 2)}\n`;
    for (const [pkg, spec] of [
      ["a", { constructor: "catalog:", prototype: "catalog:" }],
      ["b", { constructor: "^1.0.0", prototype: "^2.0.0" }],
    ] as const) {
      await mkdir(join(dir, "packages", pkg), { recursive: true });
      await writeFile(join(dir, "packages", pkg, "package.json"), manifest(`@x/${pkg}`, spec));
    }

    const { workspace, findings } = await diagnose({ cwd: dir });
    const drift = findings.filter((f) => f.rule === "catalog-drift").map((f) => f.dep);
    expect(drift.sort()).toEqual(["constructor", "prototype"]);

    const result = await applyFixes(workspace, findings);
    expect(result.skipped).toEqual([]);
    const b = JSON.parse(await readFile(join(dir, "packages/b/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(Object.entries(b.dependencies)).toEqual([
      ["constructor", "catalog:"],
      ["prototype", "catalog:"],
    ]);
  });

  it("never adds a dependency the manifest does not have, even one named like an Object method", async () => {
    const dir = await scratch("messy");
    const { workspace } = await diagnose({ cwd: dir });
    const file = "packages/a/package.json";
    const before = await readFile(join(dir, file), "utf8");

    const result = await applyFixes(workspace, [
      {
        rule: "unpinned-workspace-dep",
        severity: "error",
        dep: "toString",
        message: "toString",
        sites: [{ file, depType: "dependencies" }],
        fixable: true,
        fix: {
          manifests: [{ file, depType: "dependencies", dep: "toString", spec: "workspace:*" }],
        },
      },
    ]);

    expect(result.changedFiles).toEqual([]);
    expect(await readFile(join(dir, file), "utf8")).toBe(before);
  });
});

describe("catalog names from pnpm-workspace.yaml", () => {
  it("keeps a catalog named __proto__ as a catalog, not the prototype of the catalog map", async () => {
    const dir = await mkdtemp(join(tmpdir(), "catalog-doctor-"));
    temps.push(dir);
    await writeFile(
      join(dir, "pnpm-workspace.yaml"),
      'packages:\n  - "packages/*"\n\ncatalogs:\n  __proto__:\n    zod: ^3.23.8\n  react17:\n    react: ^17.0.2\n',
    );
    await mkdir(join(dir, "packages", "a"), { recursive: true });
    await writeFile(
      join(dir, "packages", "a", "package.json"),
      JSON.stringify({
        name: "@x/a",
        dependencies: { zod: "catalog:__proto__", react: "catalog:react17", x: "catalog:toString" },
      }),
    );

    const workspace = await loadWorkspace(dir);
    expect(Object.keys(workspace.catalogs).sort()).toEqual(["__proto__", "react17"]);
    expect(Object.getPrototypeOf(workspace.catalogs)).toBeNull();
    expect(workspace.catalogs["__proto__"]?.zod).toBe("^3.23.8");

    // catalog:__proto__ resolves; catalog:toString is not inherited from Object.
    const { findings } = await diagnose({ workspace });
    const missing = findings.filter((f) => f.rule === "missing-catalog-entry");
    expect(missing.map((f) => f.dep)).toEqual(["x"]);
  });
});
