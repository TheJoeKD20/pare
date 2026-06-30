import path from "node:path";

/** Convert any platform path to forward-slash form for stable matching/output. */
export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** Project-relative, forward-slash path for `abs` under `root`. */
export function relPosix(root: string, abs: string): string {
  return toPosix(path.relative(root, abs));
}

/** Absolute, normalized path from a (possibly relative) project path. */
export function absFrom(root: string, p: string): string {
  return path.resolve(root, p);
}

/**
 * Strip `// line` and `/* block *\/` comments from source while leaving string
 * and template-literal contents intact, so import specifiers survive but
 * commented-out imports do not produce false edges. Removed regions are
 * replaced with spaces/newlines to preserve byte offsets and line counts.
 */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  type State = "code" | "line" | "block" | "single" | "double" | "template";
  let state: State = "code";

  while (i < n) {
    const c = src[i]!;
    const next = src[i + 1];
    switch (state) {
      case "code":
        if (c === "/" && next === "/") {
          state = "line";
          out += "  ";
          i += 2;
        } else if (c === "/" && next === "*") {
          state = "block";
          out += "  ";
          i += 2;
        } else if (c === "'") {
          state = "single";
          out += c;
          i++;
        } else if (c === '"') {
          state = "double";
          out += c;
          i++;
        } else if (c === "`") {
          state = "template";
          out += c;
          i++;
        } else {
          out += c;
          i++;
        }
        break;
      case "line":
        if (c === "\n") {
          state = "code";
          out += c;
          i++;
        } else {
          out += " ";
          i++;
        }
        break;
      case "block":
        if (c === "*" && next === "/") {
          state = "code";
          out += "  ";
          i += 2;
        } else {
          out += c === "\n" ? "\n" : " ";
          i++;
        }
        break;
      case "single":
      case "double": {
        const quote = state === "single" ? "'" : '"';
        if (c === "\\") {
          out += c + (next ?? "");
          i += 2;
        } else if (c === quote || c === "\n") {
          state = "code";
          out += c;
          i++;
        } else {
          out += c;
          i++;
        }
        break;
      }
      case "template":
        if (c === "\\") {
          out += c + (next ?? "");
          i += 2;
        } else if (c === "`") {
          state = "code";
          out += c;
          i++;
        } else {
          // Template-literal interpolations are left as-is; rare to embed
          // imports there, and treating them as text is safe for our regexes.
          out += c;
          i++;
        }
        break;
    }
  }
  return out;
}
