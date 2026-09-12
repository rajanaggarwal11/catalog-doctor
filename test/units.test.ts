import { describe, expect, it } from "vitest";
import { catalogNameOf, isRegistrySpec, packageNameOfImport } from "../src/deps.js";
import { importsIn } from "../src/rules/phantom-dependency.js";
import { aliasMatcher, stripJsonc } from "../src/tsconfig.js";

describe("catalogNameOf", () => {
  it("treats the bare protocol as the default catalog", () => {
    expect(catalogNameOf("catalog:")).toBe("default");
    expect(catalogNameOf("catalog:default")).toBe("default");
    expect(catalogNameOf("catalog:react17")).toBe("react17");
  });
});

describe("isRegistrySpec", () => {
  it("accepts ranges that resolve from the registry", () => {
    for (const spec of ["^1.0.0", "~2.3.4", "1.2.3", "*", ">=3 <5", "latest"]) {
      expect(isRegistrySpec(spec), spec).toBe(true);
    }
  });

  it("rejects anything that resolves somewhere else", () => {
    for (const spec of [
      "workspace:*",
      "catalog:",
      "link:../x",
      "file:./y",
      "npm:other@^1",
      "github:owner/repo",
      "https://example.com/x.tgz",
      "owner/repo",
    ]) {
      expect(isRegistrySpec(spec), spec).toBe(false);
    }
  });
});

describe("packageNameOfImport", () => {
  it("keeps the scope and drops the subpath", () => {
    expect(packageNameOfImport("@scope/pkg/sub/deep")).toBe("@scope/pkg");
    expect(packageNameOfImport("pkg/sub")).toBe("pkg");
    expect(packageNameOfImport("pkg")).toBe("pkg");
  });

  it("ignores anything that is not a package", () => {
    for (const specifier of ["./local", "../up", "/abs", "node:fs", "#internal", "data:text/js,"]) {
      expect(packageNameOfImport(specifier), specifier).toBeUndefined();
    }
  });

  it("ignores `@/` — an npm scope is never empty", () => {
    expect(packageNameOfImport("@/lib/helper")).toBeUndefined();
    expect(packageNameOfImport("@/app")).toBeUndefined();
  });
});

describe("importsIn", () => {
  it("finds every import form", () => {
    const source = [
      `import a from "one";`,
      `import "two";`,
      `import type { T } from "three";`,
      `import {\n  x,\n  y,\n} from "four";`,
      `export { z } from "five";`,
      `export * from "six";`,
      `const s = await import("seven");`,
      `const r = require("eight");`,
    ].join("\n");

    expect(importsIn(source).sort()).toEqual([
      "eight",
      "five",
      "four",
      "one",
      "seven",
      "six",
      "three",
      "two",
    ]);
  });

  it("ignores a `from` attribute in JSX", () => {
    const source = `<input name="from" defaultValue={f.from ?? ""} className="x" />`;
    expect(importsIn(source)).toEqual([]);
  });

  it("ignores the word import inside rendered copy", () => {
    const source = [
      "<p>",
      "  You can import those from a document, or paste them in.",
      "</p>",
      '<form data-testid="import-upload">',
    ].join("\n");
    expect(importsIn(source)).toEqual([]);
  });

  it("ignores commented-out imports", () => {
    const source = ['// import old from "removed";', 'import kept from "kept";'].join("\n");
    expect(importsIn(source)).toEqual(["kept"]);
  });
});

describe("stripJsonc", () => {
  it("removes line and block comments", () => {
    const input = '{\n  // a\n  /* b */\n  "x": 1\n}';
    expect(JSON.parse(stripJsonc(input))).toEqual({ x: 1 });
  });

  it("removes trailing commas", () => {
    expect(JSON.parse(stripJsonc('{ "a": [1, 2,], "b": 3, }'))).toEqual({ a: [1, 2], b: 3 });
  });

  it("leaves slashes inside strings alone", () => {
    // A naive strip cuts the config in half here.
    const input = '{ "url": "https://example.com/x", "path": "./src/*" }';
    expect(JSON.parse(stripJsonc(input))).toEqual({
      url: "https://example.com/x",
      path: "./src/*",
    });
  });

  it("survives an escaped quote", () => {
    expect(JSON.parse(stripJsonc('{ "q": "say \\"hi\\"" }'))).toEqual({ q: 'say "hi"' });
  });
});

describe("aliasMatcher", () => {
  it("matches wildcard prefixes and exact keys", () => {
    const matches = aliasMatcher(["@/*", "~utils/*", "exact-name"]);
    expect(matches("@/lib/x")).toBe(true);
    expect(matches("~utils/format")).toBe(true);
    expect(matches("exact-name")).toBe(true);
    expect(matches("react")).toBe(false);
  });

  it("never matches everything, even given a bare wildcard", () => {
    // A `"*"` key would otherwise silence the rule entirely.
    const matches = aliasMatcher(["*"]);
    expect(matches("react")).toBe(false);
  });
});
