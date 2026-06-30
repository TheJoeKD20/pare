/**
 * A small, dependency-free glob matcher covering the subset of patterns Pare
 * needs for test-file and config-file matching:
 *
 *   - a single star matches any run of characters except a slash
 *   - "?" matches a single character except a slash
 *   - a double star matches any number of characters including slashes
 *   - a double star followed by a slash matches zero or more leading segments
 *   - "{a,b,c}" matches any of the comma-separated alternatives
 *   - "[abc]" matches a single character from the set
 *
 * Patterns and paths are always compared using forward slashes.
 */

/** Convert a glob pattern into an anchored regular expression. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    switch (c) {
      case "*": {
        if (glob[i + 1] === "*") {
          // `**` — match across path separators.
          i++;
          if (glob[i + 1] === "/") {
            // `**/` — also allow matching zero leading segments.
            i++;
            re += "(?:.*/)?";
          } else {
            re += ".*";
          }
        } else {
          re += "[^/]*";
        }
        break;
      }
      case "?":
        re += "[^/]";
        break;
      case "{": {
        const close = glob.indexOf("}", i);
        if (close === -1) {
          re += "\\{";
          break;
        }
        const alts = glob
          .slice(i + 1, close)
          .split(",")
          .map((a) => a.split("").map(escapeChar).join(""));
        re += `(?:${alts.join("|")})`;
        i = close;
        break;
      }
      case "[": {
        const close = glob.indexOf("]", i);
        if (close === -1) {
          re += "\\[";
          break;
        }
        re += `[${glob.slice(i + 1, close)}]`;
        i = close;
        break;
      }
      default:
        re += escapeChar(c);
    }
  }
  return new RegExp(`^${re}$`);
}

function escapeChar(c: string): string {
  if (/[.+^${}()|\\]/.test(c)) return `\\${c}`;
  return c;
}

/** True if `path` (project-relative, forward slashes) matches any pattern. */
export function matchesAny(path: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(path));
}

/** Compile a list of glob strings to regexes once for repeated matching. */
export function compileGlobs(globs: string[]): RegExp[] {
  return globs.map(globToRegExp);
}
