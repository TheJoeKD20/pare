import fs from "node:fs";
import type { ForwardGraph, ReverseGraph } from "./types.js";
import { extractImports } from "./imports.js";
import { resolveSpecifier, type ResolveContext } from "./resolve.js";

export interface DependencyGraph {
  forward: ForwardGraph;
  reverse: ReverseGraph;
}

export interface BuildGraphOptions {
  /** Absolute paths of files to parse for import edges. */
  parseable: string[];
  /** Resolution context (known files, extensions, aliases). */
  ctx: ResolveContext;
  /** Read a file's contents. Injectable for testing. */
  readFile?: (abs: string) => string;
}

/**
 * Build forward (file -> imports) and reverse (file -> importers) dependency
 * graphs across the project. Only in-project edges are recorded; specifiers
 * resolving to node_modules or unresolved targets are dropped.
 */
export function buildGraph(opts: BuildGraphOptions): DependencyGraph {
  const read = opts.readFile ?? defaultRead;
  const forward: ForwardGraph = new Map();
  const reverse: ReverseGraph = new Map();

  for (const file of opts.parseable) {
    const deps = forward.get(file) ?? new Set<string>();
    forward.set(file, deps);

    let source: string;
    try {
      source = read(file);
    } catch {
      continue;
    }

    for (const spec of extractImports(source)) {
      const target = resolveSpecifier(spec, file, opts.ctx);
      if (!target || target === file) continue;
      deps.add(target);
      let importers = reverse.get(target);
      if (!importers) {
        importers = new Set<string>();
        reverse.set(target, importers);
      }
      importers.add(file);
    }
  }

  return { forward, reverse };
}

function defaultRead(abs: string): string {
  return fs.readFileSync(abs, "utf8");
}

/**
 * Collect every file transitively affected by a change to any seed file:
 * the seeds themselves plus everything that (transitively) imports them.
 */
export function affectedBy(
  seeds: Iterable<string>,
  reverse: ReverseGraph,
): Set<string> {
  const affected = new Set<string>();
  const queue: string[] = [];

  for (const seed of seeds) {
    if (!affected.has(seed)) {
      affected.add(seed);
      queue.push(seed);
    }
  }

  while (queue.length) {
    const current = queue.shift()!;
    const importers = reverse.get(current);
    if (!importers) continue;
    for (const importer of importers) {
      if (!affected.has(importer)) {
        affected.add(importer);
        queue.push(importer);
      }
    }
  }

  return affected;
}
