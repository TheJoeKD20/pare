import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadStore, saveStore, clearStore } from "../src/flakeStore.js";
import { emptyStore, recordRun } from "../src/flake.js";

let dir: string | undefined;
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function tmp(): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pare-flake-"));
  return dir;
}

describe("flake store IO", () => {
  it("round-trips a store through disk", () => {
    const root = tmp();
    const store = emptyStore();
    recordRun(store, [{ id: "a", name: "a", classname: "", status: "fail" }]);
    saveStore(root, store);

    const loaded = loadStore(root);
    expect(loaded.tests["a"]!.fail).toBe(1);
    expect(fs.existsSync(path.join(root, ".pare-cache", "flake.json"))).toBe(true);
  });

  it("returns an empty store when none exists", () => {
    expect(loadStore(tmp()).tests).toEqual({});
  });

  it("recovers from a corrupt cache file", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, ".pare-cache"));
    fs.writeFileSync(path.join(root, ".pare-cache", "flake.json"), "{not json");
    expect(loadStore(root).tests).toEqual({});
  });

  it("clears the store", () => {
    const root = tmp();
    saveStore(root, emptyStore());
    expect(clearStore(root)).toBe(true);
    expect(clearStore(root)).toBe(false);
  });
});
