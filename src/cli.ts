#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { selectTests } from "./select.js";
import { describeReason } from "./report.js";
import { repoRoot } from "./git.js";
import type { SelectionResult } from "./types.js";

interface ParsedArgs {
  command: "select" | "run" | "explain" | "help" | "version";
  base: string | null;
  json: boolean;
  safety: boolean;
  cwd: string;
  nullSep: boolean;
  absolute: boolean;
  /** Command + args after `--`, for `pare run`. */
  runCmd: string[];
}

const HELP = `pare — pare a test run down to just the tests a diff affects.

Usage
  pare [options]                 Print affected test files (one per line)
  pare run [options] -- <cmd...> Run <cmd> with affected tests appended
  pare explain [options]         Print a human-readable selection summary

Options
  -s, --since <ref>    Diff against <ref> (e.g. main). Uses the merge-base.
  -b, --base <ref>     Alias for --since.
      --json           Emit a JSON report instead of a plain list.
      --safety         Fall back to the full suite when impact is unbounded.
      --no-safety      Disable the safety fallback (select strictly).
      --cwd <dir>      Run as if from <dir>.
  -0, --null           Separate output paths with NUL (for xargs -0).
      --absolute       Print absolute paths instead of cwd-relative ones.
  -h, --help           Show this help.
  -v, --version        Show the version.

Examples
  vitest run $(pare --since main)
  pare run --since origin/main -- npx vitest run
  pare --since main --json | jq .selectedTests

Safety
  Safety mode (on by default) runs the entire suite when a change could affect
  arbitrary tests — a lockfile, tsconfig, or test-runner config change, or a
  source file outside the dependency graph. Pare never silently skips tests it
  cannot reason about.`;

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    command: "select",
    base: null,
    json: false,
    safety: true,
    cwd: process.cwd(),
    nullSep: false,
    absolute: false,
    runCmd: [],
  };

  let i = 0;
  const first = argv[0];
  if (first === "run" || first === "explain") {
    args.command = first;
    i = 1;
  }

  for (; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      args.runCmd = argv.slice(i + 1);
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
      default:
        if (arg.startsWith("-")) {
          fail(`Unknown option: ${arg}\nRun \`pare --help\` for usage.`);
        } else {
          fail(`Unexpected argument: ${arg}\nRun \`pare --help\` for usage.`);
        }
    }
  }
  return args;
}

function requireValue(argv: string[], idx: number, flag: string): string {
  const v = argv[idx];
  if (v === undefined || v.startsWith("-")) {
    fail(`Option ${flag} requires a value.`);
  }
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

/** Map root-relative test paths to the requested display form. */
function displayPaths(
  result: SelectionResult,
  root: string,
  cwd: string,
  absolute: boolean,
): string[] {
  return result.selectedTests.map((rel) => {
    const abs = path.resolve(root, rel);
    if (absolute) return abs;
    const fromCwd = path.relative(cwd, abs);
    return fromCwd.split(path.sep).join("/");
  });
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help") {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (args.command === "version") {
    process.stdout.write(`${readVersion()}\n`);
    return;
  }

  let result: SelectionResult;
  let root: string;
  try {
    root = repoRoot(args.cwd);
    result = selectTests({
      cwd: args.cwd,
      base: args.base,
      safety: args.safety,
    });
  } catch (err) {
    fail(`pare: ${(err as Error).message}`);
  }

  if (args.command === "explain") {
    printExplain(result);
    return;
  }

  if (args.json) {
    const payload = {
      ...result,
      reasonText: describeReason(result.reason),
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    if (args.command === "run") runCommand(args, result, root);
    return;
  }

  if (args.command === "run") {
    runCommand(args, result, root);
    return;
  }

  // Default: print the selected test list. Diagnostics go to stderr so command
  // substitution stays clean.
  const paths = displayPaths(result, root, args.cwd, args.absolute);
  if (paths.length) {
    process.stdout.write(paths.join(args.nullSep ? "\0" : "\n"));
    if (!args.nullSep) process.stdout.write("\n");
  }
  printSummary(result);
}

function printSummary(result: SelectionResult): void {
  const { selectedTests, allTests, fellBackToFullSuite } = result;
  if (fellBackToFullSuite) {
    process.stderr.write(
      `pare: ${describeReason(result.reason)} (${allTests.length} tests)\n`,
    );
  } else {
    process.stderr.write(
      `pare: selected ${selectedTests.length}/${allTests.length} tests` +
        ` from ${result.changedFiles.length} changed files` +
        ` in ${result.durationMs}ms\n`,
    );
  }
}

function printExplain(result: SelectionResult): void {
  const out = process.stdout;
  out.write(`Base:           ${result.base ?? "(working tree)"}\n`);
  out.write(`Changed files:  ${result.changedFiles.length}\n`);
  for (const f of result.changedFiles) out.write(`  ~ ${f}\n`);
  out.write(`Decision:       ${describeReason(result.reason)}\n`);
  out.write(
    `Selected tests: ${result.selectedTests.length}/${result.allTests.length}\n`,
  );
  for (const t of result.selectedTests) out.write(`  > ${t}\n`);
  out.write(`Took:           ${result.durationMs}ms\n`);
}

function runCommand(
  args: ParsedArgs,
  result: SelectionResult,
  root: string,
): void {
  if (args.runCmd.length === 0) {
    fail("pare run: missing command. Usage: pare run -- <cmd> [args...]");
  }
  const [cmd, ...rest] = args.runCmd;

  if (result.fellBackToFullSuite) {
    process.stderr.write(
      `pare: ${describeReason(result.reason)} — running the command unfiltered\n`,
    );
    exec(cmd!, rest, args.cwd);
    return;
  }

  if (result.selectedTests.length === 0) {
    process.stderr.write(
      "pare: no affected tests for this change — skipping the run.\n",
    );
    process.exit(0);
  }

  const testArgs = result.selectedTests.map((rel) => path.resolve(root, rel));
  process.stderr.write(
    `pare: running ${result.selectedTests.length}/${result.allTests.length} tests\n`,
  );
  exec(cmd!, [...rest, ...testArgs], args.cwd);
}

function exec(cmd: string, cmdArgs: string[], cwd: string): never {
  const child = spawnSync(cmd, cmdArgs, { cwd, stdio: "inherit" });
  if (child.error) fail(`pare: failed to run ${cmd}: ${child.error.message}`);
  process.exit(child.status ?? 1);
}

main();
