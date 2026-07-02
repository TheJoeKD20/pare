/** Resolved configuration used throughout a Pare run. */
export interface PareConfig {
  /** Absolute path to the project root (the git work tree root by default). */
  root: string;
  /** File extensions, in priority order, used during module resolution. */
  extensions: string[];
  /** Glob patterns identifying test files. */
  testMatch: string[];
  /** Directory names skipped while walking the project tree. */
  ignore: string[];
  /**
   * Files whose change should, under safety mode, trigger a full-suite run
   * because they can affect arbitrary tests (lockfiles, build/test config...).
   * Matched as globs against project-relative paths.
   */
  globalConfigFiles: string[];
}

/** Why Pare decided to run the entire suite instead of a pared-down set. */
export type FallbackReason =
  | { kind: "none" }
  | { kind: "global-config"; files: string[] }
  | { kind: "untracked-source"; files: string[] }
  | { kind: "no-base-graph"; detail?: string };

export interface SelectionResult {
  /** The base ref the diff was computed against, or null for working-tree-only. */
  base: string | null;
  /** Project-relative paths of files that changed. */
  changedFiles: string[];
  /** Project-relative paths of the test files selected by static analysis. */
  selectedTests: string[];
  /**
   * Additional tests proposed by the optional LLM booster — heuristic, for
   * dynamic links static analysis cannot see. Empty unless `--llm` is used.
   */
  llmSuggested: string[];
  /** Project-relative paths of every test file discovered (the full suite). */
  allTests: string[];
  /** Whether Pare fell back to running the whole suite. */
  fellBackToFullSuite: boolean;
  /** Human-readable explanation when a fallback occurred. */
  reason: FallbackReason;
  /** Wall-clock duration of the selection in milliseconds. */
  durationMs: number;
}

/** A forward dependency edge map: file -> files it imports (within the project). */
export type ForwardGraph = Map<string, Set<string>>;
/** A reverse dependency edge map: file -> files that import it. */
export type ReverseGraph = Map<string, Set<string>>;
