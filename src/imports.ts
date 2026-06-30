import { stripComments } from "./util.js";

/**
 * Extract every module specifier referenced by a source file. Covers the
 * static and dynamic forms that matter for impact analysis:
 *
 *   import x from "a";        import { y } from "a";   import "a";
 *   import type { T } from "a";                        import * as ns from "a";
 *   export { z } from "a";    export * from "a";
 *   const m = require("a");   const m = await import("a");
 *
 * Comments are stripped first so commented-out imports do not create edges.
 * Bare/external specifiers are returned too; the resolver decides what is
 * in-project.
 */
export function extractImports(source: string): string[] {
  const code = stripComments(source);
  const found = new Set<string>();

  for (const re of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      const spec = m[1];
      if (spec) found.add(spec);
    }
  }
  return [...found];
}

const PATTERNS: RegExp[] = [
  // import ... from "spec"  /  import type ... from "spec"
  /\bimport\s+(?:type\s+)?[^;"'`]*?\bfrom\s*["'`]([^"'`]+)["'`]/g,
  // import "spec"  (side-effect only)
  /\bimport\s*["'`]([^"'`]+)["'`]/g,
  // export ... from "spec"  /  export * from "spec"
  /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[A-Za-z0-9_$]+)?|\{[^}]*\})\s*\bfrom\s*["'`]([^"'`]+)["'`]/g,
  // require("spec")
  /\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
  // import("spec")  (dynamic)
  /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
];
