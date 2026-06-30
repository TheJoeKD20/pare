import { describe, it, expect } from "vitest";
import { globToRegExp, matchesAny, compileGlobs } from "../src/glob.js";

describe("globToRegExp", () => {
  const cases: Array<[string, string, boolean]> = [
    ["*.ts", "a.ts", true],
    ["*.ts", "a.tsx", false],
    ["*.ts", "dir/a.ts", false], // single star does not cross slashes
    ["**/*.ts", "a.ts", true], // leading **/ matches zero segments
    ["**/*.ts", "src/a.ts", true],
    ["**/*.ts", "src/deep/a.ts", true],
    ["**/*.{test,spec}.ts", "src/foo.test.ts", true],
    ["**/*.{test,spec}.ts", "src/foo.spec.ts", true],
    ["**/*.{test,spec}.ts", "src/foo.ts", false],
    ["**/__tests__/**/*.ts", "pkg/__tests__/x.ts", true],
    ["**/__tests__/**/*.ts", "pkg/__tests__/deep/x.ts", true],
    ["**/__tests__/**/*.ts", "pkg/src/x.ts", false],
    ["tsconfig*.json", "tsconfig.json", true],
    ["tsconfig*.json", "tsconfig.build.json", true],
    ["tsconfig*.json", "src/tsconfig.json", false],
    ["vitest.config.*", "vitest.config.ts", true],
    ["vitest.config.*", "vitest.config.mjs", true],
    ["a?c.ts", "abc.ts", true],
    ["a?c.ts", "ac.ts", false],
    ["src/[ab].ts", "src/a.ts", true],
    ["src/[ab].ts", "src/c.ts", false],
  ];

  for (const [pattern, input, expected] of cases) {
    it(`${pattern} ${expected ? "matches" : "rejects"} ${input}`, () => {
      expect(globToRegExp(pattern).test(input)).toBe(expected);
    });
  }

  it("anchors fully (no partial matches)", () => {
    expect(globToRegExp("*.ts").test("a.ts.map")).toBe(false);
  });
});

describe("matchesAny", () => {
  it("returns true if any pattern matches", () => {
    const res = compileGlobs(["**/*.test.ts", "**/*.spec.ts"]);
    expect(matchesAny("src/a.test.ts", res)).toBe(true);
    expect(matchesAny("src/a.spec.ts", res)).toBe(true);
    expect(matchesAny("src/a.ts", res)).toBe(false);
  });
});
