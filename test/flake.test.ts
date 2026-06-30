import { describe, it, expect } from "vitest";
import { emptyStore, recordRun, report, assess } from "../src/flake.js";
import type { TestOutcome } from "../src/junit.js";

function run(...statuses: Array<"pass" | "fail" | "skip">): TestOutcome[] {
  return statuses.map((status, i) => ({
    id: `t${i}`,
    name: `t${i}`,
    classname: "",
    status,
  }));
}

function outcome(id: string, status: "pass" | "fail" | "skip"): TestOutcome {
  return { id, name: id, classname: "", status };
}

describe("recordRun / assess", () => {
  it("accumulates counts across runs", () => {
    const store = emptyStore();
    recordRun(store, [outcome("a", "pass")]);
    recordRun(store, [outcome("a", "fail")]);
    const rec = store.tests["a"]!;
    expect(rec.runs).toBe(2);
    expect(rec.pass).toBe(1);
    expect(rec.fail).toBe(1);
  });

  it("counts pass<->fail flips", () => {
    const store = emptyStore();
    for (const s of ["pass", "fail", "pass", "fail"] as const) {
      recordRun(store, [outcome("a", s)]);
    }
    // p->f, f->p, p->f = 3 flips over 3 opportunities = score 1.0
    const a = assess("a", store.tests["a"]!);
    expect(store.tests["a"]!.flips).toBe(3);
    expect(a.flakeScore).toBe(1);
  });

  it("a consistently passing test is not flaky", () => {
    const store = emptyStore();
    for (let i = 0; i < 5; i++) recordRun(store, [outcome("a", "pass")]);
    expect(assess("a", store.tests["a"]!).flakeScore).toBe(0);
  });

  it("a consistently failing test is broken, not flaky", () => {
    const store = emptyStore();
    for (let i = 0; i < 5; i++) recordRun(store, [outcome("a", "fail")]);
    const a = assess("a", store.tests["a"]!);
    expect(a.flakeScore).toBe(0);
    expect(a.failRate).toBe(1);
  });

  it("skips do not break a pass/fail streak", () => {
    const store = emptyStore();
    for (const s of ["pass", "skip", "pass"] as const) {
      recordRun(store, [outcome("a", s)]);
    }
    expect(store.tests["a"]!.flips).toBe(0);
  });

  it("reports confidence based on run count", () => {
    const store = emptyStore();
    recordRun(store, [outcome("a", "pass")]);
    expect(assess("a", store.tests["a"]!).confidence).toBe("low");
    for (let i = 0; i < 4; i++) recordRun(store, [outcome("a", "pass")]);
    expect(assess("a", store.tests["a"]!).confidence).toBe("medium");
    for (let i = 0; i < 6; i++) recordRun(store, [outcome("a", "pass")]);
    expect(assess("a", store.tests["a"]!).confidence).toBe("high");
  });
});

describe("report", () => {
  it("ranks flakier tests first and filters by minScore", () => {
    const store = emptyStore();
    // t0 flaky (alternating), t1 stable pass, t2 always fail
    for (const r of [run("pass", "pass", "pass"), run("fail", "pass", "fail")]) {
      // shape: index 0 = t0, etc. — record two runs worth
      void r;
    }
    recordRun(store, [outcome("flaky", "pass")]);
    recordRun(store, [outcome("flaky", "fail")]);
    recordRun(store, [outcome("flaky", "pass")]);
    recordRun(store, [outcome("stable", "pass")]);
    recordRun(store, [outcome("stable", "pass")]);

    const ranked = report(store, { minScore: 0.01 });
    expect(ranked[0]!.id).toBe("flaky");
    expect(ranked.find((r) => r.id === "stable")).toBeUndefined();
  });
});
