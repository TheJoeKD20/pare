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

function git(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch (err) {
    throw new GitError(
      `git ${args.join(" ")} failed: ${(err as Error).message}`,
    );
  }
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
    const mergeBase = gitOrNull(["merge-base", "HEAD", base], cwd) ?? base;
    diffFrom = mergeBase;
    resolvedBase = base;
  }

  // Committed + staged + unstaged changes relative to the diff origin.
  const nameStatus = gitOrNull(
    ["diff", "--name-status", "--no-renames", diffFrom],
    cwd,
  );
  if (nameStatus) parseNameStatus(nameStatus, add);

  // Untracked files (new files not yet added) count as additions.
  const untracked = gitOrNull(
    ["ls-files", "--others", "--exclude-standard"],
    cwd,
  );
  if (untracked) {
    for (const line of splitLines(untracked)) add(line, false);
  }

  return { base: resolvedBase, files: [...files.values()] };
}

function parseNameStatus(
  output: string,
  add: (path: string, deleted: boolean) => void,
): void {
  for (const line of splitLines(output)) {
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const status = line.slice(0, tab).trim();
    const path = line.slice(tab + 1).trim();
    add(path, status.startsWith("D"));
  }
}

function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}
