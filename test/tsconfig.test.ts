import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPathAliases } from "../src/tsconfig.js";

let dir: string;
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function makeProject(files: Record<string, unknown>): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pare-tsconfig-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(content));
  }
  return dir;
}

describe("loadPathAliases", () => {
  it("follows a relative single-extends chain", () => {
    const root = makeProject({
      "base.json": { compilerOptions: { paths: { "@a/*": ["a/*"] } } },
      "tsconfig.json": { extends: "./base.json" },
    });
    const aliases = loadPathAliases(root);
    expect(aliases.paths).toHaveLength(1);
    expect(aliases.paths[0]!.prefix).toBe("@a/");
  });

  it("handles an extends ARRAY (TS 5.0+) without crashing, later entries winning", () => {
    const root = makeProject({
      "base-a.json": { compilerOptions: { paths: { "@a/*": ["a/*"] } } },
      "base-b.json": { compilerOptions: { paths: { "@b/*": ["b/*"] } } },
      "tsconfig.json": { extends: ["./base-a.json", "./base-b.json"] },
    });
    const aliases = loadPathAliases(root);
    // `paths` is a whole-object override in TS: the last entry that sets it wins.
    expect(aliases.paths.map((p) => p.prefix)).toEqual(["@b/"]);
  });

  it("lets the extending config override every entry in the array", () => {
    const root = makeProject({
      "base-a.json": {
        compilerOptions: { baseUrl: ".", paths: { "@a/*": ["a/*"] } },
      },
      "base-b.json": { compilerOptions: { paths: { "@b/*": ["b/*"] } } },
      "tsconfig.json": {
        extends: ["./base-a.json", "./base-b.json"],
        compilerOptions: { paths: { "@own/*": ["own/*"] } },
      },
    });
    const aliases = loadPathAliases(root);
    expect(aliases.paths.map((p) => p.prefix)).toEqual(["@own/"]);
    // baseUrl inherited from an earlier array entry no later config unsets.
    expect(aliases.baseUrl).toBe(root);
  });

  it("warns (once) about package-name extends instead of resolving them", () => {
    const writes: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    const root = makeProject({
      "tsconfig.json": {
        extends: "@tsconfig/node18/tsconfig.json",
        compilerOptions: { baseUrl: ".", paths: { "@x/*": ["src/x/*"] } },
      },
    });
    const first = loadPathAliases(root);
    const second = loadPathAliases(root); // same specifier: no second warning
    expect(first.paths.map((p) => p.prefix)).toEqual(["@x/"]);
    expect(second.paths.map((p) => p.prefix)).toEqual(["@x/"]);
    const warnings = writes.filter((w) => w.includes("@tsconfig/node18"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("does not resolve");
  });

  it("still resolves relative entries when an array mixes in a package ref", () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const root = makeProject({
      "base.json": { compilerOptions: { paths: { "@a/*": ["a/*"] } } },
      "tsconfig.json": { extends: ["some-preset-pkg", "./base.json"] },
    });
    const aliases = loadPathAliases(root);
    expect(aliases.paths.map((p) => p.prefix)).toEqual(["@a/"]);
  });
});
