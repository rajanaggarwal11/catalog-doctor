import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { diagnose } from "../src/index.js";
import type { Finding, RuleId } from "../src/types.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const rulesIn = (findings: Finding[]): RuleId[] => [...new Set(findings.map((f) => f.rule))].sort();
const forRule = (findings: Finding[], rule: RuleId) => findings.filter((f) => f.rule === rule);
const depsFor = (findings: Finding[], rule: RuleId) =>
  forRule(findings, rule)
    .map((f) => f.dep)
    .sort();

describe("a workspace with nothing wrong", () => {
  it("reports nothing", async () => {
    const { findings } = await diagnose({ cwd: fixture("clean") });
    expect(findings).toEqual([]);
  });

  it("still loads the packages it inspected", async () => {
    const { workspace } = await diagnose({ cwd: fixture("clean") });
    expect(workspace.packages.map((p) => p.name).sort()).toEqual(["@clean/app", "@clean/core"]);
    expect(workspace.catalogs.default).toEqual({ zod: "^3.23.8" });
  });
});

describe("a workspace with one of everything", () => {
  it("finds every rule that applies and no others", async () => {
    const { findings } = await diagnose({ cwd: fixture("messy"), ignore: ["phantom-dependency"] });
    expect(rulesIn(findings)).toEqual([
      "catalog-candidate",
      "catalog-drift",
      "missing-catalog-entry",
      "unpinned-workspace-dep",
      "unused-catalog-entry",
      "version-mismatch",
    ]);
  });

  it("names the half-adopted catalog entry", async () => {
    const { findings } = await diagnose({ cwd: fixture("messy") });
    expect(depsFor(findings, "catalog-drift")).toEqual(["zod"]);
    expect(forRule(findings, "catalog-drift")[0]?.fixable).toBe(true);
  });

  it("proposes a catalog entry only when every package agrees on the version", async () => {
    const { findings } = await diagnose({ cwd: fixture("messy") });
    // date-fns is ^3.6.0 in both packages; lodash disagrees, so it is a mismatch instead.
    expect(depsFor(findings, "catalog-candidate")).toEqual(["date-fns"]);
    expect(depsFor(findings, "version-mismatch")).toEqual(["lodash"]);
  });

  it("will not guess which version wins a mismatch", async () => {
    const { findings } = await diagnose({ cwd: fixture("messy") });
    expect(forRule(findings, "version-mismatch")[0]?.fixable).toBe(false);
  });

  it("ignores peerDependencies when comparing versions", async () => {
    const { findings } = await diagnose({ cwd: fixture("messy") });
    // @messy/b peer-depends on lodash "*". Counting that as a third version would
    // make every published package in a workspace look broken.
    const mismatch = forRule(findings, "version-mismatch")[0];
    expect(mismatch?.detail?.join("\n")).not.toContain("*");
    expect(mismatch?.sites.every((s) => s.depType !== "peerDependencies")).toBe(true);
  });

  it("flags an internal package referenced by a registry range", async () => {
    const { findings } = await diagnose({ cwd: fixture("messy") });
    const finding = forRule(findings, "unpinned-workspace-dep")[0];
    expect(finding?.dep).toBe("@messy/b");
    expect(finding?.fix?.manifests?.[0]?.spec).toBe("workspace:*");
  });

  it("flags a catalog reference that resolves to nothing", async () => {
    const { findings } = await diagnose({ cwd: fixture("messy") });
    const finding = forRule(findings, "missing-catalog-entry")[0];
    expect(finding?.dep).toBe("missing-thing");
    expect(finding?.fixable).toBe(false);
    expect(finding?.detail?.join(" ")).toContain("no catalog named nope");
  });

  it("flags catalog entries nothing points at, in named catalogs too", async () => {
    const { findings } = await diagnose({ cwd: fixture("messy") });
    expect(depsFor(findings, "unused-catalog-entry")).toEqual(["left-pad", "react"]);
  });

  it("puts errors before warnings", async () => {
    const { findings } = await diagnose({ cwd: fixture("messy") });
    const firstWarning = findings.findIndex((f) => f.severity === "warn");
    const lastError = findings.map((f) => f.severity).lastIndexOf("error");
    expect(lastError).toBeLessThan(firstWarning);
  });
});

describe("rule selection", () => {
  it("runs only what --only names", async () => {
    const result = await diagnose({ cwd: fixture("messy"), only: ["version-mismatch"] });
    expect(result.rulesRun).toEqual(["version-mismatch"]);
    expect(rulesIn(result.findings)).toEqual(["version-mismatch"]);
  });

  it("drops what --ignore names", async () => {
    const result = await diagnose({ cwd: fixture("messy"), ignore: ["version-mismatch"] });
    expect(result.rulesRun).not.toContain("version-mismatch");
    expect(rulesIn(result.findings)).not.toContain("version-mismatch");
  });
});

describe("phantom dependencies", () => {
  it("reports an import the manifest never declares", async () => {
    const { findings } = await diagnose({
      cwd: fixture("aliases"),
      only: ["phantom-dependency"],
    });
    expect(depsFor(findings, "phantom-dependency")).toEqual(["undeclared-package"]);
  });

  it("does not report imports that resolve through a tsconfig paths alias", async () => {
    const { findings } = await diagnose({ cwd: fixture("aliases"), only: ["phantom-dependency"] });
    const deps = depsFor(findings, "phantom-dependency");
    expect(deps).not.toContain("@/lib");
    expect(deps).not.toContain("~utils");
  });

  it("does not mistake prose in JSX for an import statement", async () => {
    // Regression: `<p>You can import those from a document</p>` followed by
    // `data-testid="import-upload"` used to be read as `import … from "import-upload"`.
    const { findings } = await diagnose({ cwd: fixture("aliases"), only: ["phantom-dependency"] });
    expect(depsFor(findings, "phantom-dependency")).not.toContain("import-upload");
  });

  it("honours exclude globs, so test fixtures can be kept out", async () => {
    const { findings } = await diagnose({
      cwd: fixture("aliases"),
      only: ["phantom-dependency"],
      exclude: ["packages/web/src/**"],
    });
    expect(findings).toEqual([]);
  });

  it("does not report a package the manifest does declare", async () => {
    const { findings } = await diagnose({ cwd: fixture("aliases"), only: ["phantom-dependency"] });
    expect(depsFor(findings, "phantom-dependency")).not.toContain("react");
  });
});
