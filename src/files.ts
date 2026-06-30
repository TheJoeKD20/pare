import fs from "node:fs";
import path from "node:path";
import type { PareConfig } from "./types.js";
import { compileGlobs, matchesAny } from "./glob.js";
import { relPosix } from "./util.js";

/** Extensions whose contents we statically parse for import edges. */
const PARSEABLE = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

export interface ProjectFiles {
  /** Every discovered file, as absolute paths. */
  all: string[];
  /** Absolute paths of files we parse for imports (JS/TS sources & tests). */
  parseable: string[];
  /** Absolute paths of test files. */
  tests: string[];
}

/** Walk the project tree once, classifying files. */
export function walkProject(config: PareConfig): ProjectFiles {
  const ignore = new Set(config.ignore);
  const testRes = compileGlobs(config.testMatch);

  const all: string[] = [];
  const parseable: string[] = [];
  const tests: string[] = [];

  const stack: string[] = [config.root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (ignore.has(entry.name)) continue;
        stack.push(abs);
      } else if (entry.isFile()) {
        all.push(abs);
        const rel = relPosix(config.root, abs);
        if (PARSEABLE.has(path.extname(abs))) parseable.push(abs);
        if (matchesAny(rel, testRes)) tests.push(abs);
      }
    }
  }

  all.sort();
  parseable.sort();
  tests.sort();
  return { all, parseable, tests };
}

/** True when a project-relative path is a test file under this config. */
export function isTestFile(relPath: string, config: PareConfig): boolean {
  return matchesAny(relPath, compileGlobs(config.testMatch));
}

export { PARSEABLE };
