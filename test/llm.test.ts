import { describe, it, expect } from "vitest";
import { createAnthropicClient } from "../src/llm.js";

function toolResponse(tests: Array<{ test: string; reason: string }>) {
  return new Response(
    JSON.stringify({
      content: [{ type: "tool_use", name: "report_affected_tests", input: { tests } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("createAnthropicClient", () => {
  it("sends a forced tool_use request with the right headers", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init: init! };
      return toolResponse([{ test: "test/b.test.ts", reason: "DI" }]);
    }) as unknown as typeof fetch;

    const client = createAnthropicClient({ apiKey: "sk-test", fetchImpl });
    const out = await client.suggest({
      changedFiles: [{ path: "src/x.ts", excerpt: "code" }],
      candidateTests: ["test/b.test.ts"],
    });

    expect(out).toEqual([{ test: "test/b.test.ts", reason: "DI" }]);
    expect(captured!.url).toBe("https://api.anthropic.com/v1/messages");
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(captured!.init.body as string);
    expect(body.model).toBe("claude-opus-4-8");
    expect(body.tool_choice).toEqual({ type: "tool", name: "report_affected_tests" });
    // No sampling params or thinking (rejected on Opus 4.8).
    expect(body.temperature).toBeUndefined();
    expect(body.thinking).toBeUndefined();
  });

  it("filters suggestions to the candidate list and dedups", async () => {
    const fetchImpl = (async () =>
      toolResponse([
        { test: "test/b.test.ts", reason: "x" },
        { test: "test/b.test.ts", reason: "dup" },
        { test: "test/not-a-candidate.test.ts", reason: "y" },
      ])) as unknown as typeof fetch;

    const client = createAnthropicClient({ apiKey: "k", fetchImpl });
    const out = await client.suggest({
      changedFiles: [],
      candidateTests: ["test/b.test.ts"],
    });
    expect(out).toEqual([{ test: "test/b.test.ts", reason: "x" }]);
  });

  it("returns [] without calling the API when there are no candidates", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return toolResponse([]);
    }) as unknown as typeof fetch;
    const client = createAnthropicClient({ apiKey: "k", fetchImpl });
    expect(await client.suggest({ changedFiles: [], candidateTests: [] })).toEqual([]);
    expect(called).toBe(false);
  });

  it("throws on a non-OK API response", async () => {
    const fetchImpl = (async () =>
      new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    const client = createAnthropicClient({ apiKey: "k", fetchImpl });
    await expect(
      client.suggest({ changedFiles: [], candidateTests: ["test/b.test.ts"] }),
    ).rejects.toThrow(/429/);
  });

  it("honours a custom model and base URL", async () => {
    let url = "";
    let model = "";
    const fetchImpl = (async (u: string | URL | Request, init?: RequestInit) => {
      url = String(u);
      model = JSON.parse(init!.body as string).model;
      return toolResponse([]);
    }) as unknown as typeof fetch;
    const client = createAnthropicClient({
      apiKey: "k",
      fetchImpl,
      model: "claude-sonnet-5",
      baseUrl: "https://proxy.example/",
    });
    await client.suggest({ changedFiles: [], candidateTests: ["test/b.test.ts"] });
    expect(url).toBe("https://proxy.example/v1/messages");
    expect(model).toBe("claude-sonnet-5");
  });
});
