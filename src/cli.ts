#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { selectTests, testsToRun } from "./select.js";
import { describeReason } from "./report.js";
import { repoRoot } from "./git.js";
import { applyLlmBooster } from "./boost.js";
import { createAnthropicClient } from "./llm.js";
import { parseJUnit } from "./junit.js";
import { recordRun, report as flakeReport } from "./flake.js";
import { loadStore, saveStore, clearStore } from "./flakeStore.js";
import type { SelectionResult } from "./types.js";

interface ParsedArgs {
  command: "select" | "run" | "explain" | "flake" | "help" | "version";
  base: string | null;
  json: boolean;
  safety: boolean;
  llm: boolean;
  cwd: string;
  nullSep: boolean;
  absolute: boolean;
  /** Remaining positional args (subcommand-specific). */
  positionals: string[];
  /** Command + args after `--`. */
  rest: string[];
  /** `flake` subcommand options. */
  runs: number;
  results: string | null;
  min: number | null;
}

const HELP = `pare — pare a test run down to just the tests a diff affects.

Usage
  pare [options]                 Print affected test files (one per line)
  pare run [options] -- <cmd...> Run <cmd> with affected tests appended
  pare explain [options]         Print a human-readable selection summary
  pare flake <subcommand>        Track and report flaky tests (see below)

Selection options
  -s, --since <ref>    Diff against <ref> (e.g. main). Uses the merge-base.
  -b, --base <ref>     Alias for --since.
      --json           Emit a JSON report instead of a plain list.
      --safety         Fall back to the full suite when impact is unbounded.
      --no-safety      Disable the safety fallback (select strictly).
      --llm            Augment selection with the optional LLM booster
                       (heuristic; needs ANTHROPIC_API_KEY; never removes tests).
      --cwd <dir>      Run as if from <dir>.
  -0, --null           Separate output paths with NUL (for xargs -0).
      --absolute       Print absolute paths instead of cwd-relative ones.
  -h, --help           Show this help.
  -v, --version        Show the version.

flake subcommands
  pare flake record <junit.xml...>   Fold JUnit result files into the history
  pare flake report [--json] [--min <score>]
                                     Rank tests by flakiness (0..1 flip rate)
  pare flake run --results <path> [--runs <n>] -- <cmd...>
                                     Run <cmd> <n> times, recording <path> each
                                     time, then report
  pare flake clear                   Delete the local flake history

Examples
  vitest run $(pare --since main)
  pare run --since origin/main -- npx vitest run
  pare flake run --runs 5 --results junit.xml -- npx vitest run --reporter=junit

Safety
  Safety mode (on by default) runs the entire suite when a change could affect
  arbitrary tests — a lockfile, tsconfig, or test-runner config change, or a
  source file outside the dependency graph. Pare never silently skips tests it
  cannot reason about. The --llm booster only ever ADDS heuristic suggestions.`;

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    command: "select",
    base: null,
    json: false,
    safety: true,
    llm: false,
    cwd: process.cwd(),
    nullSep: false,
    absolute: false,
    positionals: [],
    rest: [],
    runs: 3,
    results: null,
    min: null,
  };

  let i = 0;
  const first = argv[0];
  if (first === "run" || first === "explain" || first === "flake") {
    args.command = first;
    i = 1;
  }

  for (; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      args.rest = argv.slice(i + 1);
      break;
    }
    switch (arg) {
      case "-h":
      case "--help":
        args.command = "help";
        return args;
      case "-v":
      case "--version":
        args.command = "version";
        return args;
      case "-s":
      case "--since":
      case "-b":
      case "--base":
        args.base = requireValue(argv, ++i, arg);
        break;
      case "--json":
        args.json = true;
        break;
      case "--safety":
        args.safety = true;
        break;
      case "--no-safety":
        args.safety = false;
        break;
      case "--llm":
        args.llm = true;
        break;
      case "--cwd":
        args.cwd = path.resolve(requireValue(argv, ++i, arg));
        break;
      case "-0":
      case "--null":
        args.nullSep = true;
        break;
      case "--absolute":
        args.absolute = true;
        break;
      case "--runs":
        args.runs = Number(requireValue(argv, ++i, arg));
        if (!Number.isInteger(args.runs) || args.runs < 1) fail("--runs must be a positive integer.");
        break;
      case "--results":
        args.results = requireValue(argv, ++i, arg);
        break;
      case "--min":
        args.min = Number(requireValue(argv, ++i, arg));
        if (!Number.isFinite(args.min)) fail("--min must be a number.");
        break;
      default:
        if (arg.startsWith("-")) {
          fail(`Unknown option: ${arg}\nRun \`pare --help\` for usage.`);
        } else {
          args.positionals.push(arg);
        }
    }
  }
  return args;
}

function requireValue(argv: string[], idx: number, flag: string): string {
  const v = argv[idx];
  if (v === undefined || v.startsWith("-")) fail(`Option ${flag} requires a value.`);
  return v as string;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function readVersion(): string {
  try {
    const url = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(fs.readFileSync(url, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function displayPaths(
  tests: string[],
  root: string,
  cwd: string,
  absolute: boolean,
): string[] {
  return tests.map((rel) => {
    const abs = path.resolve(root, rel);
    if (absolute) return abs;
    return path.relative(cwd, abs).split(path.sep).join("/");
  });
}

async function maybeBoost(
  result: SelectionResult,
  root: string,
  enabled: boolean,
): Promise<SelectionResult> {
  if (!enabled) return result;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      "pare: --llm set but ANTHROPIC_API_KEY is not set; using static selection only.\n",
    );
    return result;
  }
  try {
    const client = createAnthropicClient({
      apiKey,
      model: process.env.PARE_LLM_MODEL,
      baseUrl: process.env.PARE_LLM_BASE_URL,
    });
    return await applyLlmBooster(result, client, { root });
  } catch (err) {
    // The booster never breaks a run — fall back to static selection.
    process.stderr.write(`pare: LLM booster failed (${(err as Error).message}); using static selection only.\n`);
    return result;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help") {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (args.command === "version") {
    process.stdout.write(`${readVersion()}\n`);
    return;
  }
  if (args.command === "flake") {
    runFlake(args);
    return;
  }

  let root: string;
  let result: SelectionResult;
  try {
    root = repoRoot(args.cwd);
    result = selectTests({ cwd: args.cwd, base: args.base, safety: args.safety });
  } catch (err) {
    fail(`pare: ${(err as Error).message}`);
  }

  result = await maybeBoost(result, root, args.llm);

  if (args.command === "explain") {
    printExplain(result);
    return;
  }

  const run = testsToRun(result);

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify({ ...result, testsToRun: run, reasonText: describeReason(result.reason) }, null, 2)}\n`,
    );
    if (args.command === "run") runCommand(args, result, run, root);
    return;
  }

  if (args.command === "run") {
    runCommand(args, result, run, root);
    return;
  }

  const paths = displayPaths(run, root, args.cwd, args.absolute);
  if (paths.length) {
    process.stdout.write(paths.join(args.nullSep ? "\0" : "\n"));
    if (!args.nullSep) process.stdout.write("\n");
  }
  printSummary(result, run);
}

function printSummary(result: SelectionResult, run: string[]): void {
  if (result.fellBackToFullSuite) {
    process.stderr.write(
      `pare: ${describeReason(result.reason)} (${result.allTests.length} tests)\n`,
    );
    return;
  }
  const llmNote = result.llmSuggested.length
    ? ` (+${result.llmSuggested.length} from --llm)`
    : "";
  process.stderr.write(
    `pare: selected ${run.length}/${result.allTests.length} tests${llmNote}` +
      ` from ${result.changedFiles.length} changed files in ${result.durationMs}ms\n`,
  );
}

function printExplain(result: SelectionResult): void {
  const out = process.stdout;
  const run = testsToRun(result);
  out.write(`Base:           ${result.base ?? "(working tree)"}\n`);
  out.write(`Changed files:  ${result.changedFiles.length}\n`);
  for (const f of result.changedFiles) out.write(`  ~ ${f}\n`);
  out.write(`Decision:       ${describeReason(result.reason)}\n`);
  out.write(`Static tests:   ${result.selectedTests.length}/${result.allTests.length}\n`);
  for (const t of result.selectedTests) out.write(`  > ${t}\n`);
  if (result.llmSuggested.length) {
    out.write(`LLM-suggested:  ${result.llmSuggested.length} (heuristic)\n`);
    for (const t of result.llmSuggested) out.write(`  ? ${t}\n`);
  }
  out.write(`To run:         ${run.length}\n`);
  out.write(`Took:           ${result.durationMs}ms\n`);
}

function runCommand(
  args: ParsedArgs,
  result: SelectionResult,
  run: string[],
  root: string,
): void {
  if (args.rest.length === 0) {
    fail("pare run: missing command. Usage: pare run -- <cmd> [args...]");
  }
  const [cmd, ...rest] = args.rest;

  if (result.fellBackToFullSuite) {
    process.stderr.write(
      `pare: ${describeReason(result.reason)} — running the command unfiltered\n`,
    );
    exec(cmd!, rest, args.cwd);
    return;
  }

  if (run.length === 0) {
    process.stderr.write("pare: no affected tests for this change — skipping the run.\n");
    process.exit(0);
  }

  const testArgs = run.map((rel) => path.resolve(root, rel));
  process.stderr.write(`pare: running ${run.length}/${result.allTests.length} tests\n`);
  exec(cmd!, [...rest, ...testArgs], args.cwd);
}

function exec(cmd: string, cmdArgs: string[], cwd: string): never {
  const child = spawnSync(cmd, cmdArgs, { cwd, stdio: "inherit" });
  if (child.error) fail(`pare: failed to run ${cmd}: ${child.error.message}`);
  process.exit(child.status ?? 1);
}

function runFlake(args: ParsedArgs): void {
  let root: string;
  try {
    root = repoRoot(args.cwd);
  } catch (err) {
    fail(`pare: ${(err as Error).message}`);
  }
  const sub = args.positionals[0];

  switch (sub) {
    case "record": {
      const files = args.positionals.slice(1);
      if (files.length === 0) fail("pare flake record: provide one or more JUnit XML files.");
      const store = loadStore(root);
      let total = 0;
      for (const f of files) {
        const abs = path.resolve(args.cwd, f);
        const outcomes = parseJUnit(readOrFail(abs));
        recordRun(store, outcomes);
        total += outcomes.length;
        process.stderr.write(`pare: recorded ${outcomes.length} results from ${f}\n`);
      }
      saveStore(root, store);
      process.stderr.write(`pare: flake history updated (${total} outcomes across ${files.length} file(s))\n`);
      return;
    }
    case "report": {
      const store = loadStore(root);
      const rows = flakeReport(store, args.min != null ? { minScore: args.min } : {});
      if (args.json) {
        process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
        return;
      }
      printFlakeTable(rows);
      return;
    }
    case "run": {
      if (!args.results) fail("pare flake run: --results <path> is required.");
      if (args.rest.length === 0) fail("pare flake run: missing command after --.");
      const [cmd, ...rest] = args.rest;
      const store = loadStore(root);
      const resultsAbs = path.resolve(args.cwd, args.results);
      for (let r = 1; r <= args.runs; r++) {
        process.stderr.write(`pare: flake run ${r}/${args.runs}\n`);
        spawnSync(cmd!, rest, { cwd: args.cwd, stdio: "inherit" });
        if (fs.existsSync(resultsAbs)) {
          recordRun(store, parseJUnit(fs.readFileSync(resultsAbs, "utf8")));
        } else {
          process.stderr.write(`pare: warning — results file not found at ${args.results}\n`);
        }
      }
      saveStore(root, store);
      printFlakeTable(flakeReport(store, args.min != null ? { minScore: args.min } : {}));
      return;
    }
    case "clear": {
      const cleared = clearStore(root);
      process.stderr.write(cleared ? "pare: flake history cleared.\n" : "pare: no flake history to clear.\n");
      return;
    }
    default:
      fail(`pare flake: unknown subcommand '${sub ?? ""}'. Try record | report | run | clear.`);
  }
}

function readOrFail(abs: string): string {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    fail(`pare: cannot read ${abs}`);
  }
}

function printFlakeTable(
  rows: Array<{ flakeScore: number; failRate: number; runs: number; confidence: string; id: string }>,
): void {
  if (rows.length === 0) {
    process.stdout.write("No flaky tests recorded above the threshold.\n");
    return;
  }
  process.stdout.write("score  fails  runs  conf    test\n");
  for (const r of rows) {
    const score = r.flakeScore.toFixed(2).padStart(5);
    const fails = r.failRate.toFixed(2).padStart(5);
    const runs = String(r.runs).padStart(4);
    const conf = r.confidence.padEnd(6);
    process.stdout.write(`${score}  ${fails}  ${runs}  ${conf}  ${r.id}\n`);
  }
}

main().catch((err) => fail(`pare: ${(err as Error).message}`));
