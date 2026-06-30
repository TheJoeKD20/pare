import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export interface TempRepo {
  /** The git work tree root, as git reports it (realpath-normalised). */
  root: string;
  write(rel: string, content: string): void;
  remove(rel: string): void;
  git(...args: string[]): string;
  commitAll(message: string): void;
  cleanup(): void;
}

/** Create an isolated git repository seeded with the given files. */
export function makeRepo(files: Record<string, string> = {}): TempRepo {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pare-repo-"));

  const git = (...args: string[]): string =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  const write = (rel: string, content: string): void => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };

  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");

  for (const [rel, content] of Object.entries(files)) write(rel, content);

  // The work tree root may be symlink-resolved (e.g. /tmp -> /private/tmp).
  const root = git("rev-parse", "--show-toplevel");

  const repo: TempRepo = {
    root,
    write,
    remove: (rel) => fs.rmSync(path.join(dir, rel), { force: true }),
    git,
    commitAll: (message) => {
      git("add", "-A");
      git("commit", "-q", "-m", message);
    },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };

  return repo;
}
