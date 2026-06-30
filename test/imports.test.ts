import { describe, it, expect } from "vitest";
import { extractImports } from "../src/imports.js";

describe("extractImports", () => {
  it("captures default, named, namespace and side-effect imports", () => {
    const src = `
      import a from "./a";
      import { b, c } from "./b";
      import * as ns from "./ns";
      import "./side-effect";
    `;
    expect(new Set(extractImports(src))).toEqual(
      new Set(["./a", "./b", "./ns", "./side-effect"]),
    );
  });

  it("captures type-only imports", () => {
    const src = `import type { T } from "./types";`;
    expect(extractImports(src)).toContain("./types");
  });

  it("captures re-exports", () => {
    const src = `
      export { x } from "./x";
      export * from "./y";
      export * as z from "./z";
      export type { T } from "./t";
    `;
    expect(new Set(extractImports(src))).toEqual(
      new Set(["./x", "./y", "./z", "./t"]),
    );
  });

  it("captures require and dynamic import", () => {
    const src = `
      const m = require("./cjs");
      const d = await import("./dyn");
    `;
    expect(new Set(extractImports(src))).toEqual(
      new Set(["./cjs", "./dyn"]),
    );
  });

  it("ignores commented-out imports", () => {
    const src = `
      // import gone from "./commented";
      /* import alsoGone from "./block"; */
      import real from "./real";
    `;
    const found = extractImports(src);
    expect(found).toContain("./real");
    expect(found).not.toContain("./commented");
    expect(found).not.toContain("./block");
  });

  it("deduplicates specifiers", () => {
    const src = `import a from "./dup"; import { b } from "./dup";`;
    expect(extractImports(src)).toEqual(["./dup"]);
  });

  it("captures bare/package specifiers (resolver filters them later)", () => {
    const src = `import { render } from "react-dom";`;
    expect(extractImports(src)).toContain("react-dom");
  });

  it("handles multi-line import clauses", () => {
    const src = `import {\n  a,\n  b,\n} from "./multi";`;
    expect(extractImports(src)).toContain("./multi");
  });
});
