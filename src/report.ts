import type { FallbackReason } from "./types.js";

/** Render a fallback reason as a short, human-readable explanation. */
export function describeReason(reason: FallbackReason): string {
  switch (reason.kind) {
    case "none":
      return "pared selection";
    case "global-config":
      return `global config changed (${reason.files.join(", ")}) — running full suite`;
    case "untracked-source":
      return `source outside the dependency graph changed (${reason.files.join(", ")}) — running full suite`;
    case "no-base-graph":
      return "no dependency information available — running full suite";
  }
}
