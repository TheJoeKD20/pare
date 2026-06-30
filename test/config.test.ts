import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseJsonc, loadConfig, DEFAULT_TEST_MATCH } from "../src/config.js";

describe("parseJsonc", () => {
  it("parses plain JSON", () => {
    expect(parseJsonc<{ a: number }>(`{"a": 1}`)).toEqual({ a: 1 });
  });

  it("strips line and block comments", () => {
    const text = `{
      // a comment
      "a": 1, /* inline */
      "b": 2
    }`;
    expect(parseJsonc(text)).toEqual({ a: 1, b: 2 });
  });

  it("tolerates trailing commas", () => {
    expect(parseJsonc(`{"a": 1, "b": [1, 2,],}`)).toEqual({ a: 1, b: [1, 2] });
  });

  it("keeps // inside string values", () => {
    expect(parseJsonc(`{"url": "https://x/y"}`)).toEqual({
      url: "https://x/y",
    });
  });
});

describe("loadConfig", () => {
  it("returns defaults with no config file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pare-cfg-"));
    const cfg = loadConfig(dir);
    expect(cfg.testMatch).toEqual(DEFAULT_TEST_MATCH);
    expect(cfg.root).toBe(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("merges user overrides from pare.config.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pare-cfg-"));
    fs.writeFileSync(
      path.join(dir, "pare.config.json"),
      JSON.stringify({ testMatch: ["**/*.check.ts"] }),
    );
    const cfg = loadConfig(dir);
    expect(cfg.testMatch).toEqual(["**/*.check.ts"]);
    // Unspecified fields fall back to defaults.
    expect(cfg.ignore).toContain("node_modules");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
