import { describe, it, expect } from "vitest";
import { buildGraph, affectedBy } from "../src/graph.js";
import { DEFAULT_EXTENSIONS } from "../src/config.js";
import type { ResolveContext } from "../src/resolve.js";

const ROOT = "/proj";

/** Build a graph over a virtual file system: { relPath: sourceText }. */
function graphFor(vfs: Record<string, string>) {
  const known = new Set(Object.keys(vfs).map((p) => `${ROOT}/${p}`));
  const ctx: ResolveContext = {
    known,
    extensions: DEFAULT_EXTENSIONS,
    aliases: { baseUrl: null, paths: [] },
  };
  const parseable = [...known];
  return buildGraph({
    parseable,
    ctx,
    readFile: (abs) => vfs[abs.slice(ROOT.length + 1)] ?? "",
  });
}

describe("buildGraph", () => {
  it("records forward and reverse edges for in-project imports", () => {
    const { forward, reverse } = graphFor({
      "src/a.ts": `import "./b";`,
      "src/b.ts": ``,
    });
    expect([...forward.get(`${ROOT}/src/a.ts`)!]).toEqual([`${ROOT}/src/b.ts`]);
    expect([...reverse.get(`${ROOT}/src/b.ts`)!]).toEqual([`${ROOT}/src/a.ts`]);
  });

  it("ignores edges to node_modules", () => {
    const { forward } = graphFor({ "src/a.ts": `import "react";` });
    expect(forward.get(`${ROOT}/src/a.ts`)!.size).toBe(0);
  });

  it("does not record self-edges", () => {
    const { forward } = graphFor({ "src/a.ts": `import "./a";` });
    expect(forward.get(`${ROOT}/src/a.ts`)!.size).toBe(0);
  });
});

describe("affectedBy", () => {
  // a.test.ts -> a.ts -> util.ts ; b.test.ts -> b.ts (independent)
  const { reverse } = graphFor({
    "src/util.ts": ``,
    "src/a.ts": `import "./util";`,
    "src/b.ts": ``,
    "test/a.test.ts": `import "../src/a";`,
    "test/b.test.ts": `import "../src/b";`,
  });

  it("includes the seed itself", () => {
    const out = affectedBy([`${ROOT}/src/a.ts`], reverse);
    expect(out.has(`${ROOT}/src/a.ts`)).toBe(true);
  });

  it("walks transitive importers", () => {
    const out = affectedBy([`${ROOT}/src/util.ts`], reverse);
    expect(out).toContain(`${ROOT}/src/util.ts`);
    expect(out).toContain(`${ROOT}/src/a.ts`);
    expect(out).toContain(`${ROOT}/test/a.test.ts`);
    // b's chain is untouched
    expect(out).not.toContain(`${ROOT}/test/b.test.ts`);
  });

  it("does not over-select across independent subgraphs", () => {
    const out = affectedBy([`${ROOT}/src/b.ts`], reverse);
    expect(out).toContain(`${ROOT}/test/b.test.ts`);
    expect(out).not.toContain(`${ROOT}/test/a.test.ts`);
  });

  it("handles cycles without infinite looping", () => {
    const { reverse: rev } = graphFor({
      "src/x.ts": `import "./y";`,
      "src/y.ts": `import "./x";`,
    });
    const out = affectedBy([`${ROOT}/src/x.ts`], rev);
    expect(out).toContain(`${ROOT}/src/x.ts`);
    expect(out).toContain(`${ROOT}/src/y.ts`);
  });
});
