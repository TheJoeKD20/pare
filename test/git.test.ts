import { describe, it, expect, afterEach } from "vitest";
import {
  getChangedFiles,
  parseNameStatusZ,
  parseLsFilesZ,
  GitDiffError,
} from "../src/git.js";
import { makeRepo, type TempRepo } from "./helpers.js";

describe("parseNameStatusZ", () => {
  it("parses NUL-separated status/path records", () => {
    const out = parseNameStatusZ("M\0src/a.ts\0A\0src/b.ts\0D\0src/c.ts\0");
    expect(out).toEqual([
      { path: "src/a.ts", deleted: false },
      { path: "src/b.ts", deleted: false },
      { path: "src/c.ts", deleted: true },
    ]);
  });

  it("preserves quoted-unfriendly names: unicode, quotes, backslashes", () => {
    const names = ['src/über wichtig.ts', 'src/say "hi".ts', "src\\windows.ts", "src/日本語.ts"];
    const raw = names.map((n) => `M\0${n}\0`).join("");
    expect(parseNameStatusZ(raw).map((f) => f.path)).toEqual(names);
  });

  it("does not trim leading/trailing whitespace from filenames", () => {
    const out = parseNameStatusZ("M\0 padded name .ts\0");
    expect(out).toEqual([{ path: " padded name .ts", deleted: false }]);
  });

  it("returns nothing for empty output", () => {
    expect(parseNameStatusZ("")).toEqual([]);
  });

  it("defensively consumes both paths of a rename record", () => {
    const out = parseNameStatusZ("R100\0old.ts\0new.ts\0M\0other.ts\0");
    expect(out).toEqual([
      { path: "old.ts", deleted: true },
      { path: "new.ts", deleted: false },
      { path: "other.ts", deleted: false },
    ]);
  });
});

describe("parseLsFilesZ", () => {
  it("parses NUL-separated paths without trimming", () => {
    expect(parseLsFilesZ("a.ts\0süß & \"quoted\".ts\0 padded .md\0")).toEqual([
      "a.ts",
      'süß & "quoted".ts',
      " padded .md",
    ]);
  });

  it("returns nothing for empty output", () => {
    expect(parseLsFilesZ("")).toEqual([]);
  });
});

describe("getChangedFiles (against a real repo)", () => {
  let repo: TempRepo;
  afterEach(() => repo?.cleanup());

  it("throws GitDiffError for an unresolvable base ref instead of an empty diff", () => {
    repo = makeRepo({ "a.txt": "hello" });
    repo.commitAll("init");
    expect(() => getChangedFiles(repo.root, "no-such-ref")).toThrow(GitDiffError);
    expect(() => getChangedFiles(repo.root, "no-such-ref")).toThrow(/no-such-ref/);
  });

  it("reports quotePath-affected filenames verbatim", () => {
    repo = makeRepo({ "src/ümlaut.ts": "export const u = 1;" });
    repo.commitAll("init");
    repo.write("src/ümlaut.ts", "export const u = 2;");
    repo.write("src/nëw file.ts", "export const n = 1;"); // untracked
    const changes = getChangedFiles(repo.root, "HEAD");
    const paths = changes.files.map((f) => f.path).sort();
    expect(paths).toEqual(["src/nëw file.ts", "src/ümlaut.ts"]);
  });
});
