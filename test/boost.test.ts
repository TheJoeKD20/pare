import { describe, it, expect } from "vitest";
import { applyLlmBooster } from "../src/boost.js";
import type { LlmClient, LlmInput } from "../src/llm.js";
import type { SelectionResult } from "../src/types.js";

const ROOT = "/proj";

function baseResult(over: Partial<SelectionResult> = {}): SelectionResult {
  return {
    base: "main",
    changedFiles: ["src/registry.ts"],
    selectedTests: ["test/a.test.ts"],
    llmSuggested: [],
    allTests: ["test/a.test.ts", "test/b.test.ts", "test/c.test.ts"],
    fellBackToFullSuite: false,
    reason: { kind: "none" },
    durationMs: 1,
    ...over,
  };
}

function fakeClient(suggest: (i: LlmInput) => string[]): LlmClient {
  return {
    async suggest(input) {
      return suggest(input).map((test) => ({ test, reason: "dynamic link" }));
    },
  };
}

const readFile = () => "export const registry = {};";

describe("applyLlmBooster", () => {
  it("adds suggested candidate tests, flagged separately", async () => {
    const client = fakeClient(() => ["test/b.test.ts"]);
    const out = await applyLlmBooster(baseResult(), client, { root: ROOT, readFile });
    expect(out.llmSuggested).toEqual(["test/b.test.ts"]);
    expect(out.selectedTests).toEqual(["test/a.test.ts"]); // unchanged
  });

  it("only offers candidates not already selected", async () => {
    const seen: string[] = [];
    const client: LlmClient = {
      async suggest(input) {
        seen.push(...input.candidateTests);
        return [];
      },
    };
    await applyLlmBooster(baseResult(), client, { root: ROOT, readFile });
    expect(seen).toEqual(["test/b.test.ts", "test/c.test.ts"]);
    expect(seen).not.toContain("test/a.test.ts");
  });

  it("drops suggestions that are not real candidates", async () => {
    const client = fakeClient(() => ["test/b.test.ts", "test/made-up.test.ts", "test/a.test.ts"]);
    const out = await applyLlmBooster(baseResult(), client, { root: ROOT, readFile });
    expect(out.llmSuggested).toEqual(["test/b.test.ts"]);
  });

  it("returns unchanged on a full-suite fallback (never calls the client)", async () => {
    let called = false;
    const client: LlmClient = {
      async suggest() {
        called = true;
        return [];
      },
    };
    const result = baseResult({ fellBackToFullSuite: true });
    const out = await applyLlmBooster(result, client, { root: ROOT, readFile });
    expect(called).toBe(false);
    expect(out).toBe(result);
  });

  it("returns unchanged when there are no candidate tests", async () => {
    const result = baseResult({ allTests: ["test/a.test.ts"] });
    const out = await applyLlmBooster(result, fakeClient(() => []), { root: ROOT, readFile });
    expect(out.llmSuggested).toEqual([]);
  });

  it("only sends excerpts for parseable source files", async () => {
    let received: LlmInput | undefined;
    const client: LlmClient = {
      async suggest(input) {
        received = input;
        return [];
      },
    };
    const result = baseResult({ changedFiles: ["src/registry.ts", "docs/readme.md"] });
    await applyLlmBooster(result, client, { root: ROOT, readFile });
    expect(received!.changedFiles.map((f) => f.path)).toEqual(["src/registry.ts"]);
  });
});
