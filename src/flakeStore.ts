import fs from "node:fs";
import path from "node:path";
import type { FlakeStore } from "./flake.js";
import { emptyStore } from "./flake.js";

const CACHE_DIR = ".pare-cache";
const STORE_FILE = "flake.json";

function storePath(root: string): string {
  return path.join(root, CACHE_DIR, STORE_FILE);
}

/** Load the flake history for a project, or an empty store if none exists. */
export function loadStore(root: string): FlakeStore {
  const file = storePath(root);
  if (!fs.existsSync(file)) return emptyStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as FlakeStore;
    if (parsed && parsed.version === 1 && parsed.tests) return parsed;
  } catch {
    // Corrupt cache — start fresh rather than failing the run.
  }
  return emptyStore();
}

/** Persist the flake history under <root>/.pare-cache/flake.json. */
export function saveStore(root: string, store: FlakeStore): void {
  const file = storePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`);
}

/** Remove the flake history cache, if present. */
export function clearStore(root: string): boolean {
  const file = storePath(root);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
}
