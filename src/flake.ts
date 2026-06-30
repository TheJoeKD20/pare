import type { TestOutcome } from "./junit.js";

/** Per-test historical record accumulated across runs. */
export interface FlakeRecord {
  runs: number;
  pass: number;
  fail: number;
  skip: number;
  /** Number of pass<->fail transitions across recorded runs. */
  flips: number;
  /** The most recent statuses (capped), oldest first. */
  recent: Array<"pass" | "fail" | "skip">;
  /** Display name of the test, kept for reporting. */
  name: string;
  file?: string;
}

export interface FlakeStore {
  version: 1;
  tests: Record<string, FlakeRecord>;
}

/** A computed flakiness assessment for one test. */
export interface FlakeAssessment {
  id: string;
  name: string;
  file?: string;
  runs: number;
  failRate: number;
  /** 0..1 — fraction of run-to-run transitions between pass and fail. */
  flakeScore: number;
  /** Low until we have enough runs to trust the score. */
  confidence: "low" | "medium" | "high";
}

const MAX_RECENT = 25;

export function emptyStore(): FlakeStore {
  return { version: 1, tests: {} };
}

/**
 * Fold a run's outcomes into the store, updating counts and the pass/fail
 * flip count that drives the flakiness estimate. Skips don't break a streak.
 */
export function recordRun(store: FlakeStore, outcomes: TestOutcome[]): FlakeStore {
  for (const o of outcomes) {
    const rec =
      store.tests[o.id] ??
      ({
        runs: 0,
        pass: 0,
        fail: 0,
        skip: 0,
        flips: 0,
        recent: [],
        name: o.name,
      } satisfies FlakeRecord);

    if (o.file) rec.file = o.file;
    rec.name = o.name;
    rec.runs += 1;
    rec[o.status] += 1;

    if (o.status !== "skip") {
      const prev = lastDecisive(rec.recent);
      if (prev && prev !== o.status) rec.flips += 1;
    }

    rec.recent.push(o.status);
    if (rec.recent.length > MAX_RECENT) rec.recent.shift();

    store.tests[o.id] = rec;
  }
  return store;
}

function lastDecisive(
  recent: Array<"pass" | "fail" | "skip">,
): "pass" | "fail" | undefined {
  for (let i = recent.length - 1; i >= 0; i--) {
    const s = recent[i]!;
    if (s !== "skip") return s;
  }
  return undefined;
}

/** Flakiness assessment for a single record. */
export function assess(id: string, rec: FlakeRecord): FlakeAssessment {
  const decisive = rec.pass + rec.fail;
  const failRate = decisive ? rec.fail / decisive : 0;
  // Flakiness is inconsistency, not constant failure: a test that always fails
  // is broken, not flaky. The flip rate captures pass<->fail oscillation.
  const opportunities = Math.max(1, decisive - 1);
  const flakeScore = decisive >= 2 ? rec.flips / opportunities : 0;

  let confidence: FlakeAssessment["confidence"] = "low";
  if (rec.runs >= 10) confidence = "high";
  else if (rec.runs >= 4) confidence = "medium";

  return {
    id,
    name: rec.name,
    file: rec.file,
    runs: rec.runs,
    failRate: round(failRate),
    flakeScore: round(flakeScore),
    confidence,
  };
}

/**
 * Rank tests by flakiness, most flaky first. `minScore` filters out tests
 * below the threshold (default: any non-zero flakiness).
 */
export function report(
  store: FlakeStore,
  opts: { minScore?: number } = {},
): FlakeAssessment[] {
  const min = opts.minScore ?? Number.MIN_VALUE;
  return Object.entries(store.tests)
    .map(([id, rec]) => assess(id, rec))
    .filter((a) => a.flakeScore >= min)
    .sort(
      (a, b) =>
        b.flakeScore - a.flakeScore ||
        b.failRate - a.failRate ||
        a.id.localeCompare(b.id),
    );
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
