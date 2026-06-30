import path from "node:path";
import { aliasCandidates, type PathAliases } from "./tsconfig.js";

export interface ResolveContext {
  /** Every file that exists in the project, as absolute paths. */
  known: Set<string>;
  /** Resolution extensions in priority order (with leading dots). */
  extensions: string[];
  /** tsconfig path aliases / baseUrl. */
  aliases: PathAliases;
}

const JS_TO_TS: Record<string, string[]> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};

/**
 * Resolve a module specifier imported from `importer` to an absolute project
 * file path, or null if it points outside the project (a bare dependency) or
 * cannot be resolved.
 */
export function resolveSpecifier(
  specifier: string,
  importer: string,
  ctx: ResolveContext,
): string | null {
  const bases = candidateBases(specifier, importer, ctx);
  for (const base of bases) {
    const hit = probe(base, ctx);
    if (hit) return hit;
  }
  return null;
}

function candidateBases(
  specifier: string,
  importer: string,
  ctx: ResolveContext,
): string[] {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return [path.resolve(path.dirname(importer), specifier)];
  }
  if (specifier.startsWith("/")) {
    // Bare absolute specifiers are unusual; treat as filesystem-absolute.
    return [specifier];
  }
  // Non-relative: try tsconfig aliases / baseUrl. If none match it is a
  // node_modules dependency and therefore out of project scope.
  return aliasCandidates(specifier, ctx.aliases);
}

/** Probe a base path (which may already include an extension) for a real file. */
function probe(base: string, ctx: ResolveContext): string | null {
  // 1. Exact path as written (handles specifiers that include an extension).
  if (ctx.known.has(base)) return base;

  // 2. A specifier ending in a JS extension may map to a TS source file
  //    (NodeNext-style "./foo.js" -> foo.ts).
  const ext = path.extname(base);
  if (ext && JS_TO_TS[ext]) {
    const stem = base.slice(0, -ext.length);
    for (const tsExt of JS_TO_TS[ext]!) {
      if (ctx.known.has(stem + tsExt)) return stem + tsExt;
    }
  }

  // 3. Append each configured extension.
  for (const e of ctx.extensions) {
    if (ctx.known.has(base + e)) return base + e;
  }

  // 4. Directory import -> index file.
  for (const e of ctx.extensions) {
    const idx = path.join(base, `index${e}`);
    if (ctx.known.has(idx)) return idx;
  }

  return null;
}
