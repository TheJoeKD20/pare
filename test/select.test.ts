import { describe, it, expect } from "vitest";
import { performance } from "node:perf_hooks";
import { computeSelection, type ComputeInput } from "../src/select.js";
import { buildGraph } from "../src/graph.js";
import {
  DEFAULT_EXTENSIONS,
  DEFAULT_TEST_MATCH,
  DEFAULT_IGNORE,
  DEFAULT_GLOBAL_CONFIG_FILES,
} from "../src/config.js";
import type { PareConfig } from "../src/types.js";
import type { ChangedFile } from "../src/git.js";

const ROOT = "/proj";

const CONFIG: PareConfig = {
  root: ROOT,
  extensions: DEFAULT_EXTENSIONS,
  testMatch: DEFAULT_TEST_MATCH,
  ignore: DEFAULT_IGNORE,
  globalConfigFiles: DEFAULT_GLOBAL_CONFIG_FILES,
};

// Project layout:
//   src/util.ts   <- src/a.ts <- test/a.test.ts
//                 \- src/b.ts <- test/b.test.ts
const VFS: Record<string, string> = {
  "src/util.ts": ``,
  "src/a.ts": `import "./util";`,
  "src/b.ts": `import "./util";`,
  "test/a.test.ts": `import "../src/a";`,
  "test/b.test.ts": `import "../src/b";`,
};

function setup(
  changes: Array<{ path: string; deleted?: boolean }>,
  base: string | null = "main",
  safety = true,
): ComputeInput {
  const abs = (p: string) => `${ROOT}/${p}`;
  const known = new Set(Object.keys(VFS).map(abs));
  const { reverse } = buildGraph({
    parseable: [...known],
    ctx: {
      known,
      extensions: DEFAULT_EXTENSIONS,
      aliases: { baseUrl: null, paths: [] },
    },
    readFile: (a) => VFS[a.slice(ROOT.length + 1)] ?? "",
  });
  const tests = [abs("test/a.test.ts"), abs("test/b.test.ts")];
  const files: ChangedFile[] = changes.map((c) => ({
    path: c.path,
    deleted: c.deleted ?? false,
  }));
  return {
    config: CONFIG,
    tests,
    known,
    reverse,
    changes: { base, files },
    safety,
    startedAt: performance.now(),
  };
}

describe("computeSelection", () => {
  it("selects only tests downstream of a changed leaf module", () => {
    const r = computeSelection(setup([{ path: "src/a.ts" }]));
    expect(r.selectedTests).toEqual(["test/a.test.ts"]);
    expect(r.fellBackToFullSuite).toBe(false);
  });

  it("selects all dependent tests of a shared module", () => {
    const r = computeSelection(setup([{ path: "src/util.ts" }]));
    expect(r.selectedTests).toEqual(["test/a.test.ts", "test/b.test.ts"]);
  });

  it("selects a changed test file itself", () => {
    const r = computeSelection(setup([{ path: "test/a.test.ts" }]));
    expect(r.selectedTests).toEqual(["test/a.test.ts"]);
  });

  it("selects nothing when no files changed", () => {
    const r = computeSelection(setup([]));
    expect(r.selectedTests).toEqual([]);
    expect(r.fellBackToFullSuite).toBe(false);
  });

  it("selects nothing when an unrelated non-code file changes", () => {
    const r = computeSelection(setup([{ path: "README.md" }]));
    expect(r.selectedTests).toEqual([]);
    expect(r.fellBackToFullSuite).toBe(false);
  });

  it("reports the full suite as allTests", () => {
    const r = computeSelection(setup([{ path: "src/a.ts" }]));
    expect(r.allTests).toEqual(["test/a.test.ts", "test/b.test.ts"]);
  });

  describe("safety mode", () => {
    it("falls back to the full suite on global config change", () => {
      const r = computeSelection(setup([{ path: "package.json" }]));
      expect(r.fellBackToFullSuite).toBe(true);
      expect(r.reason.kind).toBe("global-config");
      expect(r.selectedTests).toEqual(r.allTests);
    });

    it("falls back to the full suite on tsconfig change", () => {
      const r = computeSelection(setup([{ path: "tsconfig.json" }]));
      expect(r.fellBackToFullSuite).toBe(true);
      expect(r.reason.kind).toBe("global-config");
    });

    it("falls back when a source file outside the graph changes", () => {
      const r = computeSelection(
        setup([{ path: "src/deleted.ts", deleted: true }]),
      );
      expect(r.fellBackToFullSuite).toBe(true);
      expect(r.reason.kind).toBe("untracked-source");
    });

    it("does not fall back for non-code files outside the graph", () => {
      const r = computeSelection(setup([{ path: "docs/guide.md" }]));
      expect(r.fellBackToFullSuite).toBe(false);
    });

    it("falls back when a deleted file has an importable non-JS/TS extension", () => {
      // .json is in the resolvable extension set: a source file may import it,
      // so its deletion has an unknowable blast radius.
      const r = computeSelection(
        setup([{ path: "src/data.json", deleted: true }]),
      );
      expect(r.fellBackToFullSuite).toBe(true);
      expect(r.reason.kind).toBe("untracked-source");
    });
  });

  describe("strict mode (--no-safety)", () => {
    it("does not fall back on global config change", () => {
      const r = computeSelection(
        setup([{ path: "package.json" }], "main", false),
      );
      expect(r.fellBackToFullSuite).toBe(false);
      expect(r.selectedTests).toEqual([]);
    });

    it("ignores deleted source instead of running everything", () => {
      const r = computeSelection(
        setup([{ path: "src/deleted.ts", deleted: true }], "main", false),
      );
      expect(r.fellBackToFullSuite).toBe(false);
      expect(r.selectedTests).toEqual([]);
    });
  });

  it("preserves the base ref in the result", () => {
    const r = computeSelection(setup([{ path: "src/a.ts" }], "origin/main"));
    expect(r.base).toBe("origin/main");
  });
});
