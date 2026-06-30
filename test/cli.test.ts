import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeRepo, type TempRepo } from "./helpers.js";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const built = fs.existsSync(CLI);
const d = built ? describe : describe.skip;

let repo: TempRepo;
afterEach(() => repo?.cleanup());

function run(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
  });
}

const FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "fixture", version: "1.0.0" }),
  "src/a.ts": `export const a = () => 1;`,
  "src/b.ts": `export const b = () => 2;`,
  "test/a.test.ts": `import { a } from "../src/a";\nexport const t = a();`,
  "test/b.test.ts": `import { b } from "../src/b";\nexport const t = b();`,
};

d("pare CLI (built binary)", () => {
  it("prints only the affected test to stdout", () => {
    repo = makeRepo(FILES);
    repo.commitAll("init");
    repo.write("src/a.ts", `export const a = () => 11;`);
    const out = run(repo.root, ["--since", "HEAD"]);
    expect(out.status).toBe(0);
    expect(out.stdout.trim()).toBe("test/a.test.ts");
    // Diagnostics land on stderr, keeping stdout clean for $(...).
    expect(out.stderr).toContain("selected 1/2");
  });

  it("emits a JSON report with --json", () => {
    repo = makeRepo(FILES);
    repo.commitAll("init");
    repo.write("src/b.ts", `export const b = () => 22;`);
    const out = run(repo.root, ["--since", "HEAD", "--json"]);
    const report = JSON.parse(out.stdout);
    expect(report.selectedTests).toEqual(["test/b.test.ts"]);
    expect(report.fellBackToFullSuite).toBe(false);
    expect(report.reasonText).toBe("pared selection");
  });

  it("run skips execution when nothing is affected", () => {
    repo = makeRepo(FILES);
    repo.commitAll("init");
    repo.write("README.md", "# docs");
    const out = run(repo.root, [
      "run",
      "--since",
      "HEAD",
      "--",
      process.execPath,
      "-e",
      "process.exit(7)",
    ]);
    // The inner command must NOT run, so exit code is 0, not 7.
    expect(out.status).toBe(0);
    expect(out.stderr).toContain("no affected tests");
  });

  it("run forwards selected tests to the command", () => {
    repo = makeRepo(FILES);
    repo.commitAll("init");
    repo.write("src/a.ts", `export const a = () => 111;`);
    const out = run(repo.root, [
      "run",
      "--since",
      "HEAD",
      "--",
      process.execPath,
      "-e",
      "console.log(process.argv.slice(1).join('\\n'))",
    ]);
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("test/a.test.ts");
    expect(out.stdout).not.toContain("test/b.test.ts");
  });

  it("exits non-zero on unknown options", () => {
    repo = makeRepo(FILES);
    repo.commitAll("init");
    const out = run(repo.root, ["--bogus"]);
    expect(out.status).toBe(2);
    expect(out.stderr).toContain("Unknown option");
  });
});
