import path from "node:path";
import { performance } from "node:perf_hooks";
import type {
  FallbackReason,
  PareConfig,
  ReverseGraph,
  SelectionResult,
} from "./types.js";
import { loadConfig } from "./config.js";
import { walkProject, PARSEABLE } from "./files.js";
import { buildGraph, affectedBy } from "./graph.js";
import { loadPathAliases } from "./tsconfig.js";
import { repoRoot, getChangedFiles, type GitChanges } from "./git.js";
import { compileGlobs, matchesAny } from "./glob.js";
import { relPosix } from "./util.js";

export interface SelectOptions {
  /** Directory to run from; the git work tree root is derived from it. */
  cwd?: string;
  /** Base ref to diff against (e.g. "main"). Null means working tree only. */
  base?: string | null;
  /** Fall back to the full suite when impact cannot be bounded. Default true. */
  safety?: boolean;
}

/** Run the full static selection pipeline against a real project on disk. */
export function selectTests(options: SelectOptions = {}): SelectionResult {
  const start = performance.now();
  const cwd = options.cwd ?? process.cwd();
  const safety = options.safety ?? true;
  const base = options.base ?? null;

  const root = repoRoot(cwd);
  const config = loadConfig(root);
  const { all, parseable, tests } = walkProject(config);
  const aliases = loadPathAliases(root);
  const known = new Set(all);

  const { reverse } = buildGraph({
    parseable,
    ctx: { known, extensions: config.extensions, aliases },
  });

  const changes = getChangedFiles(root, base);

  return computeSelection({
    config,
    tests,
    known,
    reverse,
    changes,
    safety,
    startedAt: start,
  });
}

export interface ComputeInput {
  config: PareConfig;
  /** Absolute paths of all test files. */
  tests: string[];
  /** Absolute paths of all known project files. */
  known: Set<string>;
  reverse: ReverseGraph;
  changes: GitChanges;
  safety: boolean;
  /** performance.now() timestamp at pipeline start. */
  startedAt: number;
}

/**
 * Pure selection logic over already-gathered inputs. Decides between a pared
 * test set and a full-suite fallback, and returns the final result.
 */
export function computeSelection(input: ComputeInput): SelectionResult {
  const { config, tests, known, reverse, changes, safety } = input;
  const root = config.root;

  const testSet = new Set(tests);
  const allTests = tests.map((t) => relPosix(root, t)).sort();
  const changedFiles = changes.files.map((f) => f.path).sort();

  const configRes = compileGlobs(config.globalConfigFiles);

  const globalConfigHits: string[] = [];
  const unknownSources: string[] = [];
  const seeds: string[] = [];

  for (const change of changes.files) {
    if (matchesAny(change.path, configRes)) {
      globalConfigHits.push(change.path);
      continue;
    }
    const abs = path.resolve(root, change.path);
    if (known.has(abs)) {
      seeds.push(abs);
    } else if (PARSEABLE.has(path.extname(change.path))) {
      // A source file we have no graph node for (deleted, or outside the
      // scanned tree): its blast radius is unknown.
      unknownSources.push(change.path);
    }
    // Other unknown files (docs, images, deleted assets) carry no test impact.
  }

  const fullSuite = (reason: FallbackReason): SelectionResult => ({
    base: changes.base,
    changedFiles,
    selectedTests: allTests,
    allTests,
    fellBackToFullSuite: true,
    reason,
    durationMs: elapsed(input.startedAt),
  });

  if (safety && globalConfigHits.length) {
    return fullSuite({ kind: "global-config", files: globalConfigHits.sort() });
  }
  if (safety && unknownSources.length) {
    return fullSuite({
      kind: "untracked-source",
      files: unknownSources.sort(),
    });
  }

  const affected = affectedBy(seeds, reverse);
  const selectedTests = [...affected]
    .filter((f) => testSet.has(f))
    .map((f) => relPosix(root, f))
    .sort();

  return {
    base: changes.base,
    changedFiles,
    selectedTests,
    allTests,
    fellBackToFullSuite: false,
    reason: { kind: "none" },
    durationMs: elapsed(input.startedAt),
  };
}

function elapsed(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 1000) / 1000;
}
