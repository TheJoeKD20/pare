/**
 * Optional LLM booster — the v0.2 heuristic layer.
 *
 * Static analysis cannot see dynamic links: reflection, dependency injection,
 * string-keyed registries, config-driven wiring. The booster asks a model
 * which *additional* tests a change might affect, strictly as a suggestion on
 * top of the deterministic selection. It is off by default, never gates
 * adoption (no key, no booster, no error), and its output is always flagged as
 * heuristic.
 *
 * Zero runtime dependencies: it talks to the Anthropic Messages API over
 * `fetch` and forces a `tool_use` call for structured, parseable output.
 */

export interface ChangedFileContext {
  path: string;
  /** A truncated excerpt of the file's current contents. */
  excerpt: string;
}

export interface LlmInput {
  changedFiles: ChangedFileContext[];
  /** Tests static analysis did NOT already select — the booster's choices. */
  candidateTests: string[];
}

export interface LlmSuggestion {
  test: string;
  reason: string;
}

/** Pluggable booster backend. The CLI uses the Anthropic implementation; tests inject a fake. */
export interface LlmClient {
  suggest(input: LlmInput): Promise<LlmSuggestion[]>;
}

export interface AnthropicClientOptions {
  apiKey: string;
  model?: string;
  /** Injectable fetch for testing; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Override the API base (e.g. a proxy). */
  baseUrl?: string;
  maxCandidates?: number;
}

const DEFAULT_MODEL = "claude-opus-4-8";
const API_VERSION = "2023-06-01";
const TOOL_NAME = "report_affected_tests";

const SYSTEM_PROMPT = `You assist a static test-impact analyser called Pare.
Pare has already selected every test reachable through the static import graph.
Your job is to flag ADDITIONAL tests that a change could affect through links
static analysis cannot see: reflection, dependency injection, string-keyed
registries, dynamic requires, config-driven wiring, or runtime plugin loading.

Rules:
- Only choose tests from the provided candidate list. Never invent paths.
- Be conservative: suggest a test only when there is a concrete, nameable
  reason a dynamic link ties it to a changed file. Omit speculative picks.
- It is correct to return an empty list when nothing dynamic is implicated.`;

/** Build the Anthropic-backed booster client. */
export function createAnthropicClient(opts: AnthropicClientOptions): LlmClient {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("No fetch implementation available (Node 18+ required).");
  }
  const model = opts.model ?? DEFAULT_MODEL;
  const baseUrl = (opts.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  const maxCandidates = opts.maxCandidates ?? 400;

  return {
    async suggest(input: LlmInput): Promise<LlmSuggestion[]> {
      const candidates = input.candidateTests.slice(0, maxCandidates);
      if (candidates.length === 0) return [];
      const candidateSet = new Set(candidates);

      const body = {
        model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: TOOL_NAME,
            description:
              "Report tests that may be affected by the change through dynamic links static analysis cannot see.",
            input_schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                tests: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      test: { type: "string", description: "A path from the candidate list" },
                      reason: { type: "string", description: "Why this test may be affected" },
                    },
                    required: ["test", "reason"],
                  },
                },
              },
              required: ["tests"],
            },
          },
        ],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [{ role: "user", content: buildUserPrompt(input, candidates) }],
      };

      const res = await fetchImpl(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": opts.apiKey,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await safeText(res);
        throw new Error(`Anthropic API ${res.status}: ${text}`);
      }

      const json = (await res.json()) as AnthropicResponse;
      const tool = json.content?.find(
        (b) => b.type === "tool_use" && b.name === TOOL_NAME,
      );
      const tests = (tool?.input?.tests ?? []) as Array<{ test?: string; reason?: string }>;

      const seen = new Set<string>();
      const out: LlmSuggestion[] = [];
      for (const t of tests) {
        const test = (t.test ?? "").trim();
        // Trust nothing: the suggestion must be a real, not-already-selected test.
        if (candidateSet.has(test) && !seen.has(test)) {
          seen.add(test);
          out.push({ test, reason: (t.reason ?? "").trim() || "heuristic match" });
        }
      }
      return out;
    },
  };
}

function buildUserPrompt(input: LlmInput, candidates: string[]): string {
  const files = input.changedFiles
    .map((f) => `### ${f.path}\n\`\`\`\n${f.excerpt}\n\`\`\``)
    .join("\n\n");
  return [
    "Changed files in this diff:",
    files || "(no source excerpts available)",
    "",
    "Candidate tests (choose only from these exact paths):",
    candidates.map((c) => `- ${c}`).join("\n"),
    "",
    `Call ${TOOL_NAME} with the subset of candidate tests that dynamic links tie to the changes.`,
  ].join("\n");
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "(no body)";
  }
}

interface AnthropicResponse {
  content?: Array<{
    type: string;
    name?: string;
    input?: { tests?: unknown };
  }>;
}
