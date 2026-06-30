/** A single parsed test-case outcome from a JUnit XML report. */
export interface TestOutcome {
  /** Stable identifier: "<classname> > <name>" (or just name if no class). */
  id: string;
  name: string;
  classname: string;
  /** Source file, when the reporter records it. */
  file?: string;
  status: "pass" | "fail" | "skip";
  /** Reported duration in seconds, when present. */
  time?: number;
}

const TESTCASE = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
const ATTR = /([\w:-]+)\s*=\s*"([^"]*)"/g;

/**
 * Parse a JUnit XML report (the format Vitest, Jest and most runners emit with
 * `--reporter=junit`) into per-test outcomes. Dependency-free and tolerant of
 * the common `<testsuites>`/`<testsuite>` nesting and self-closing cases.
 */
export function parseJUnit(xml: string): TestOutcome[] {
  const out: TestOutcome[] = [];
  TESTCASE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TESTCASE.exec(xml)) !== null) {
    const attrs = parseAttrs(m[1] ?? "");
    const body = m[3] ?? "";
    const name = decode(attrs.name ?? "");
    if (!name) continue;
    const classname = decode(attrs.classname ?? "");
    const id = classname ? `${classname} > ${name}` : name;

    let status: TestOutcome["status"] = "pass";
    if (/<(failure|error)\b/.test(body)) status = "fail";
    else if (/<skipped\b/.test(body)) status = "skip";

    const time = attrs.time != null ? Number(attrs.time) : undefined;
    out.push({
      id,
      name,
      classname,
      file: attrs.file ? decode(attrs.file) : undefined,
      status,
      time: Number.isFinite(time) ? time : undefined,
    });
  }
  return out;
}

function parseAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(s)) !== null) attrs[m[1]!] = m[2]!;
  return attrs;
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}
