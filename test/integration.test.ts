import { describe, it, expect, afterEach } from "vitest";
import { selectTests } from "../src/select.js";
import { makeRepo, type TempRepo } from "./helpers.js";

const BASE_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "fixture", version: "1.0.0" }),
  "src/util.ts": `export const add = (a: number, b: number) => a + b;`,
  "src/a.ts": `import { add } from "./util";\nexport const a = () => add(1, 2);`,
  "src/b.ts": `export const b = () => 42;`,
  "test/a.test.ts": `import { a } from "../src/a";\nexport const t = a();`,
  "test/b.test.ts": `import { b } from "../src/b";\nexport const t = b();`,
  "test/util.test.ts": `import { add } from "../src/util";\nexport const t = add(1, 1);`,
};

let repo: TempRepo;
afterEach(() => repo?.cleanup());

function freshRepo(): TempRepo {
  repo = makeRepo(BASE_FILES);
  repo.commitAll("initial");
  return repo;
}

describe("selectTests (end to end against git)", () => {
  it("selects only the test that depends on a changed module", () => {
    const r = freshRepo();
    r.write("src/a.ts", `import { add } from "./util";\nexport const a = () => add(2, 3);`);
    const result = selectTests({ cwd: r.root, base: "HEAD" });
    expect(result.selectedTests).toEqual(["test/a.test.ts"]);
    expect(result.fellBackToFullSuite).toBe(false);
    expect(result.allTests.length).toBe(3);
  });

  it("selects every test transitively depending on a shared module", () => {
    const r = freshRepo();
    r.write("src/util.ts", `export const add = (a: number, b: number) => a + b + 0;`);
    const result = selectTests({ cwd: r.root, base: "HEAD" });
    expect(result.selectedTests).toEqual([
      "test/a.test.ts",
      "test/util.test.ts",
    ]);
  });

  it("selects a newly added (untracked) test file", () => {
    const r = freshRepo();
    r.write("src/c.ts", `export const c = () => 1;`);
    r.write("test/c.test.ts", `import { c } from "../src/c";\nexport const t = c();`);
    const result = selectTests({ cwd: r.root, base: "HEAD" });
    expect(result.selectedTests).toContain("test/c.test.ts");
    expect(result.allTests).toContain("test/c.test.ts");
  });

  it("selects nothing when only docs change", () => {
    const r = freshRepo();
    r.write("README.md", `# hello`);
    const result = selectTests({ cwd: r.root, base: "HEAD" });
    expect(result.selectedTests).toEqual([]);
    expect(result.fellBackToFullSuite).toBe(false);
  });

  it("falls back to the full suite when package.json changes (safety)", () => {
    const r = freshRepo();
    r.write("package.json", JSON.stringify({ name: "fixture", version: "1.0.1" }));
    const result = selectTests({ cwd: r.root, base: "HEAD" });
    expect(result.fellBackToFullSuite).toBe(true);
    expect(result.selectedTests).toEqual(result.allTests);
    expect(result.reason.kind).toBe("global-config");
  });

  it("does not fall back on package.json change when safety is off", () => {
    const r = freshRepo();
    r.write("package.json", JSON.stringify({ name: "fixture", version: "1.0.1" }));
    const result = selectTests({ cwd: r.root, base: "HEAD", safety: false });
    expect(result.fellBackToFullSuite).toBe(false);
    expect(result.selectedTests).toEqual([]);
  });

  it("falls back to the full suite when a source file is deleted (safety)", () => {
    const r = freshRepo();
    r.remove("src/b.ts");
    const result = selectTests({ cwd: r.root, base: "HEAD" });
    expect(result.fellBackToFullSuite).toBe(true);
    expect(result.reason.kind).toBe("untracked-source");
  });

  it("resolves tsconfig path aliases when selecting", () => {
    repo = makeRepo({
      "package.json": JSON.stringify({ name: "aliased", version: "1.0.0" }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
      }),
      "src/core.ts": `export const core = () => 1;`,
      "test/core.test.ts": `import { core } from "@/core";\nexport const t = core();`,
    });
    repo.commitAll("initial");
    repo.write("src/core.ts", `export const core = () => 2;`);
    const result = selectTests({ cwd: repo.root, base: "HEAD" });
    expect(result.selectedTests).toEqual(["test/core.test.ts"]);
  });

  it("reports working-tree changes with no base ref", () => {
    const r = freshRepo();
    r.write("src/b.ts", `export const b = () => 43;`);
    const result = selectTests({ cwd: r.root, base: null });
    expect(result.base).toBeNull();
    expect(result.selectedTests).toEqual(["test/b.test.ts"]);
  });

  it("falls back to the full suite when the base ref is unresolvable (safety)", () => {
    const r = freshRepo();
    r.write("src/a.ts", `export const a = () => 3;`);
    const result = selectTests({ cwd: r.root, base: "no-such-ref" });
    expect(result.fellBackToFullSuite).toBe(true);
    expect(result.reason.kind).toBe("no-base-graph");
    expect(result.selectedTests).toEqual(result.allTests);
    expect(result.allTests.length).toBe(3);
  });

  it("throws on an unresolvable base ref when safety is off", () => {
    const r = freshRepo();
    expect(() =>
      selectTests({ cwd: r.root, base: "no-such-ref", safety: false }),
    ).toThrow(/no-such-ref/);
  });

  it("tracks changes to filenames git would quote (non-ASCII)", () => {
    repo = makeRepo({
      "package.json": JSON.stringify({ name: "fixture", version: "1.0.0" }),
      "src/ümlaut.ts": `export const u = () => 1;`,
      "test/u.test.ts": `import { u } from "../src/ümlaut";\nexport const t = u();`,
      "test/other.test.ts": `export const t = 1;`,
    });
    repo.commitAll("initial");
    repo.write("src/ümlaut.ts", `export const u = () => 2;`);
    const result = selectTests({ cwd: repo.root, base: "HEAD" });
    expect(result.changedFiles).toEqual(["src/ümlaut.ts"]);
    expect(result.selectedTests).toEqual(["test/u.test.ts"]);
    expect(result.fellBackToFullSuite).toBe(false);
  });

  it("falls back when an importable non-JS/TS file (e.g. .json) is deleted (safety)", () => {
    repo = makeRepo({
      "package.json": JSON.stringify({ name: "fixture", version: "1.0.0" }),
      "src/data.json": JSON.stringify({ answer: 42 }),
      "src/a.ts": `import data from "./data.json";\nexport const a = () => data;`,
      "test/a.test.ts": `import { a } from "../src/a";\nexport const t = a();`,
    });
    repo.commitAll("initial");
    repo.remove("src/data.json");
    const result = selectTests({ cwd: repo.root, base: "HEAD" });
    expect(result.fellBackToFullSuite).toBe(true);
    expect(result.reason.kind).toBe("untracked-source");
    expect(result.selectedTests).toContain("test/a.test.ts");
  });
});
