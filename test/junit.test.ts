import { describe, it, expect } from "vitest";
import { parseJUnit } from "../src/junit.js";

describe("parseJUnit", () => {
  it("parses passing, failing and skipped cases", () => {
    const xml = `
      <testsuites>
        <testsuite name="suite">
          <testcase classname="src/a.test.ts" name="adds" time="0.01"/>
          <testcase classname="src/a.test.ts" name="subtracts">
            <failure message="boom">stack</failure>
          </testcase>
          <testcase classname="src/b.test.ts" name="pending">
            <skipped/>
          </testcase>
        </testsuite>
      </testsuites>`;
    const out = parseJUnit(xml);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ id: "src/a.test.ts > adds", status: "pass", time: 0.01 });
    expect(out[1]).toMatchObject({ id: "src/a.test.ts > subtracts", status: "fail" });
    expect(out[2]).toMatchObject({ id: "src/b.test.ts > pending", status: "skip" });
  });

  it("treats <error> as a failure", () => {
    const xml = `<testcase classname="c" name="t"><error/></testcase>`;
    expect(parseJUnit(xml)[0]!.status).toBe("fail");
  });

  it("falls back to name when classname is absent", () => {
    const xml = `<testcase name="standalone"/>`;
    expect(parseJUnit(xml)[0]!.id).toBe("standalone");
  });

  it("decodes XML entities in attributes", () => {
    const xml = `<testcase classname="c" name="a &amp; b"/>`;
    expect(parseJUnit(xml)[0]!.name).toBe("a & b");
  });

  it("captures the file attribute when present", () => {
    const xml = `<testcase classname="c" name="t" file="src/x.test.ts"/>`;
    expect(parseJUnit(xml)[0]!.file).toBe("src/x.test.ts");
  });

  it("returns an empty array for no test cases", () => {
    expect(parseJUnit(`<testsuites></testsuites>`)).toEqual([]);
  });
});
