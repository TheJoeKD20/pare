import { execFileSync } from "node:child_process";

export interface ChangedFile {
  /** Repo-relative path (forward slashes, as git reports). */
  path: string;
  /** True when the change deletes the file. */
  deleted: boolean;
}

export interface GitChanges {
  /** Resolved base ref the diff was taken against, or null for working tree. */
  base: string | null;
  files: ChangedFile[];
}

class GitError extends Error {}

/**
 * Thrown when the set of changed files cannot be determined — most commonly an
 * unresolvable base ref (a typo, or a shallow CI clone that never fetched it).
 * Callers must not treat this as "no changes": under safety mode it should
 * trigger a full-suite fallback, and without safety it should fail the run.
 */
export class GitDiffError extends Error {}

function run(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr;
    const detail = stderr?.trim() || (err as Error).message;
    throw new GitError(`git ${args.join(" ")} failed: ${detail}`);
  }
}

function git(args: string[], cwd: string): string {
  return run(args, cwd).trim();
}

function gitOrNull(args: string[], cwd: string): string | null {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

/** Absolute path to the git work tree root containing `cwd`. */
export function repoRoot(cwd: string): string {
  return git(["rev-parse", "--show-toplevel"], cwd);
}

/**
 * Determine the set of changed files.
 *
 * With a `base`, the diff spans from the merge-base of HEAD and base up to the
 * current working tree (committed + staged + unstaged + untracked), matching
 * the intuition of "everything this branch changed relative to base".
 *
 * Without a `base`, only local changes (working tree vs HEAD) plus untracked
 * files are considered.
 *
 * Throws {@link GitDiffError} when git cannot produce the change list (e.g.
 * the base ref does not resolve) — an error is never reported as an empty
 * diff.
 */
export function getChangedFiles(cwd: string, base: string | null): GitChanges {
  const files = new Map<string, ChangedFile>();
  const add = (path: string, deleted: boolean) => {
    if (!path) return;
    const existing = files.get(path);
    // A path seen as both deleted and present is treated as present.
    if (existing) existing.deleted = existing.deleted && deleted;
    else files.set(path, { path, deleted });
  };

  let diffFrom = "HEAD";
  let resolvedBase: string | null = null;

  if (base) {
    // A failed merge-base alone is tolerable (e.g. shallow clone with no
    // common ancestor recorded) — the diff below still validates the ref.
    const mergeBase = gitOrNull(["merge-base", "HEAD", base], cwd) ?? base;
    diffFrom = mergeBase;
    resolvedBase = base;
  }

  // Committed + staged + unstaged changes relative to the diff origin.
  // -z gives NUL-separated raw paths, immune to core.quotePath mangling of
  // non-ASCII / quoted filenames. Output is used untrimmed: paths may contain
  // leading/trailing whitespace.
  let nameStatus: string;
  try {
    nameStatus = run(["diff", "--name-status", "--no-renames", "-z", diffFrom], cwd);
  } catch (err) {
    throw new GitDiffError(
      base
        ? `cannot diff against '${base}' — the ref may not exist or was not fetched ` +
          `(in CI, fetch the base branch, e.g. checkout with fetch-depth: 0). ${(err as Error).message}`
        : (err as Error).message,
    );
  }
  for (const file of parseNameStatusZ(nameStatus)) add(file.path, file.deleted);

  // Untracked files (new files not yet added) count as additions.
  let untracked: string;
  try {
    untracked = run(["ls-files", "--others", "--exclude-standard", "-z"], cwd);
  } catch (err) {
    throw new GitDiffError(`cannot list untracked files. ${(err as Error).message}`);
  }
  for (const path of parseLsFilesZ(untracked)) add(path, false);

  return { base: resolvedBase, files: [...files.values()] };
}

/**
 * Parse `git diff --name-status --no-renames -z` output: NUL-separated records
 * alternating status and path. Pure — exercised directly by tests.
 */
export function parseNameStatusZ(output: string): ChangedFile[] {
  const records = output.split("\0");
  const out: ChangedFile[] = [];
  let i = 0;
  while (i < records.length) {
    const status = records[i]!;
    if (status === "") {
      i++; // trailing NUL (or stray separator)
      continue;
    }
    const path = records[i + 1];
    if (path === undefined) break;
    // --no-renames means R/C never appear, but consume both sides defensively:
    // a rename/copy record carries a second (destination) path.
    if (status.startsWith("R") || status.startsWith("C")) {
      const dest = records[i + 2];
      out.push({ path, deleted: status.startsWith("R") });
      if (dest !== undefined && dest !== "") out.push({ path: dest, deleted: false });
      i += 3;
      continue;
    }
    out.push({ path, deleted: status.startsWith("D") });
    i += 2;
  }
  return out;
}

/**
 * Parse `git ls-files --others --exclude-standard -z` output: NUL-separated
 * raw paths. Pure — exercised directly by tests.
 */
export function parseLsFilesZ(output: string): string[] {
  return output.split("\0").filter((p) => p.length > 0);
}
