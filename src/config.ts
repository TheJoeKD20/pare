import fs from "node:fs";
import path from "node:path";
import type { PareConfig } from "./types.js";
import { stripComments } from "./util.js";

export const DEFAULT_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
];

export const DEFAULT_TEST_MATCH = [
  "**/*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
  "**/__tests__/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
];

export const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".vercel",
  ".idea",
  ".vscode",
];

export const DEFAULT_GLOBAL_CONFIG_FILES = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "tsconfig*.json",
  "jsconfig*.json",
  "vitest.config.*",
  "vitest.workspace.*",
  "vite.config.*",
  "jest.config.*",
  "jest.setup.*",
  "babel.config.*",
  ".babelrc*",
  "pare.config.json",
];

interface UserConfig {
  extensions?: string[];
  testMatch?: string[];
  ignore?: string[];
  globalConfigFiles?: string[];
}

/**
 * Parse JSON that may contain comments and trailing commas (e.g. tsconfig.json).
 */
export function parseJsonc<T>(text: string): T {
  const noComments = stripComments(text);
  const noTrailingCommas = noComments.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(noTrailingCommas) as T;
}

/** Load and resolve configuration for a project rooted at `root`. */
export function loadConfig(root: string): PareConfig {
  const user = readUserConfig(root);
  return {
    root,
    extensions: user.extensions ?? DEFAULT_EXTENSIONS,
    testMatch: user.testMatch ?? DEFAULT_TEST_MATCH,
    ignore: user.ignore ?? DEFAULT_IGNORE,
    globalConfigFiles: user.globalConfigFiles ?? DEFAULT_GLOBAL_CONFIG_FILES,
  };
}

function readUserConfig(root: string): UserConfig {
  const file = path.join(root, "pare.config.json");
  if (!fs.existsSync(file)) return {};
  try {
    const text = fs.readFileSync(file, "utf8");
    const parsed = parseJsonc<UserConfig>(text);
    return parsed ?? {};
  } catch (err) {
    throw new Error(
      `Failed to parse pare.config.json: ${(err as Error).message}`,
    );
  }
}
