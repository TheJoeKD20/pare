import { describe, it, expect } from "vitest";
import { stripComments, toPosix } from "../src/util.js";

describe("stripComments", () => {
  it("removes line comments", () => {
    const out = stripComments(`const a = 1; // import './x'\nconst b = 2;`);
    expect(out).not.toContain("import './x'");
    expect(out).toContain("const a = 1;");
    expect(out).toContain("const b = 2;");
  });

  it("removes block comments", () => {
    const out = stripComments(`/* import './gone' */ const a = 1;`);
    expect(out).not.toContain("./gone");
    expect(out).toContain("const a = 1;");
  });

  it("preserves string contents", () => {
    const out = stripComments(`const url = "https://x/y"; // note`);
    expect(out).toContain('"https://x/y"');
    expect(out).not.toContain("note");
  });

  it("does not treat // inside strings as a comment", () => {
    const out = stripComments(`const s = "a // b"; const t = 1;`);
    expect(out).toContain('"a // b"');
    expect(out).toContain("const t = 1;");
  });

  it("keeps import specifiers in real code", () => {
    const out = stripComments(`import x from "./real"; /* c */`);
    expect(out).toContain('"./real"');
  });

  it("preserves line numbers", () => {
    const src = `a\n/* multi\nline */\nb`;
    expect(stripComments(src).split("\n").length).toBe(src.split("\n").length);
  });

  it("handles template literals", () => {
    const out = stripComments("const t = `a // not a comment`; const u = 1;");
    expect(out).toContain("// not a comment");
    expect(out).toContain("const u = 1;");
  });
});

describe("toPosix", () => {
  it("is identity for posix paths", () => {
    expect(toPosix("a/b/c.ts")).toBe("a/b/c.ts");
  });
});
