import { describe, it, expect } from "vitest";
import { resolveSpecifier, type ResolveContext } from "../src/resolve.js";
import { DEFAULT_EXTENSIONS } from "../src/config.js";

const ROOT = "/proj";

function ctx(files: string[], aliases?: ResolveContext["aliases"]): ResolveContext {
  return {
    known: new Set(files.map((f) => `${ROOT}/${f}`)),
    extensions: DEFAULT_EXTENSIONS,
    aliases: aliases ?? { baseUrl: null, paths: [] },
  };
}

describe("resolveSpecifier (relative)", () => {
  it("resolves a relative import with an added extension", () => {
    const c = ctx(["src/a.ts", "src/b.ts"]);
    expect(resolveSpecifier("./b", `${ROOT}/src/a.ts`, c)).toBe(`${ROOT}/src/b.ts`);
  });

  it("resolves a directory import to index", () => {
    const c = ctx(["src/a.ts", "src/utils/index.ts"]);
    expect(resolveSpecifier("./utils", `${ROOT}/src/a.ts`, c)).toBe(
      `${ROOT}/src/utils/index.ts`,
    );
  });

  it("resolves parent-relative imports", () => {
    const c = ctx(["src/a/x.ts", "src/b.ts"]);
    expect(resolveSpecifier("../b", `${ROOT}/src/a/x.ts`, c)).toBe(
      `${ROOT}/src/b.ts`,
    );
  });

  it("maps a .js specifier onto a .ts source (NodeNext style)", () => {
    const c = ctx(["src/a.ts", "src/b.ts"]);
    expect(resolveSpecifier("./b.js", `${ROOT}/src/a.ts`, c)).toBe(
      `${ROOT}/src/b.ts`,
    );
  });

  it("respects extension priority (.ts before .js)", () => {
    const c = ctx(["src/a.ts", "src/b.ts", "src/b.js"]);
    expect(resolveSpecifier("./b", `${ROOT}/src/a.ts`, c)).toBe(`${ROOT}/src/b.ts`);
  });

  it("resolves imports of non-code assets when known", () => {
    const c = ctx(["src/a.ts", "src/data.json"]);
    expect(resolveSpecifier("./data.json", `${ROOT}/src/a.ts`, c)).toBe(
      `${ROOT}/src/data.json`,
    );
  });

  it("returns null for unresolved relative imports", () => {
    const c = ctx(["src/a.ts"]);
    expect(resolveSpecifier("./missing", `${ROOT}/src/a.ts`, c)).toBeNull();
  });
});

describe("resolveSpecifier (bare / aliases)", () => {
  it("returns null for node_modules packages", () => {
    const c = ctx(["src/a.ts"]);
    expect(resolveSpecifier("react", `${ROOT}/src/a.ts`, c)).toBeNull();
  });

  it("resolves tsconfig wildcard path aliases", () => {
    const c = ctx(["src/lib/foo.ts"], {
      baseUrl: ROOT,
      paths: [
        {
          prefix: "@lib/",
          suffix: "",
          hasWildcard: true,
          targets: [`${ROOT}/src/lib/*`],
        },
      ],
    });
    expect(resolveSpecifier("@lib/foo", `${ROOT}/src/a.ts`, c)).toBe(
      `${ROOT}/src/lib/foo.ts`,
    );
  });

  it("resolves exact (non-wildcard) aliases", () => {
    const c = ctx(["src/config.ts"], {
      baseUrl: null,
      paths: [
        {
          prefix: "@config",
          suffix: "",
          hasWildcard: false,
          targets: [`${ROOT}/src/config`],
        },
      ],
    });
    expect(resolveSpecifier("@config", `${ROOT}/src/a.ts`, c)).toBe(
      `${ROOT}/src/config.ts`,
    );
  });

  it("resolves baseUrl-relative bare imports", () => {
    const c = ctx(["components/Button.tsx"], {
      baseUrl: ROOT,
      paths: [],
    });
    expect(resolveSpecifier("components/Button", `${ROOT}/src/a.ts`, c)).toBe(
      `${ROOT}/components/Button.tsx`,
    );
  });
});
