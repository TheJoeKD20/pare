import fs from "node:fs";
import path from "node:path";
import type { SelectionResult } from "./types.js";
import type { ChangedFileContext, LlmClient } from "./llm.js";
import { PARSEABLE } from "./files.js";

export interface BoostOptions {
  /** Project root, for reading changed-file excerpts. */
  root: string;
  /** Max characters of each changed file to send as context. */
  excerptChars?: number;
  /** Injectable file reader for testing. */
  readFile?: (abs: string) => string;
}

/**
 * Augment a static selection with the optional LLM booster. Returns a new
 * result with `llmSuggested` populated. Pure with respect to the client: the
 * caller injects a fake in tests and the real Anthropic client in production.
 *
 * Degrades safely — when there's nothing to add (full-suite fallback, no
 * candidates) it returns the input unchanged.
 */
export async function applyLlmBooster(
  result: SelectionResult,
  client: LlmClient,
  opts: BoostOptions,
): Promise<SelectionResult> {
  if (result.fellBackToFullSuite) return result;

  const selected = new Set(result.selectedTests);
  const candidates = result.allTests.filter((t) => !selected.has(t));
  const candidateSet = new Set(candidates);
  if (candidates.length === 0 || result.changedFiles.length === 0) return result;

  const read = opts.readFile ?? ((abs) => fs.readFileSync(abs, "utf8"));
  const limit = opts.excerptChars ?? 4000;

  const changedFiles: ChangedFileContext[] = [];
  for (const rel of result.changedFiles) {
    if (!PARSEABLE.has(path.extname(rel))) continue;
    try {
      const text = read(path.resolve(opts.root, rel));
      changedFiles.push({ path: rel, excerpt: truncate(text, limit) });
    } catch {
      // Deleted or unreadable; skip its excerpt.
    }
  }

  const suggestions = await client.suggest({ changedFiles, candidateTests: candidates });

  // Trust nothing: a suggestion must be a real, not-already-selected test.
  const llmSuggested = [
    ...new Set(suggestions.map((s) => s.test).filter((t) => candidateSet.has(t))),
  ].sort();

  return { ...result, llmSuggested };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… (truncated)`;
}
