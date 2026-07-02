import fs from "node:fs";
import path from "node:path";
import { parseJsonc } from "./config.js";

export interface PathAliases {
  /** Absolute base directory for non-relative resolution (tsconfig baseUrl). */
  baseUrl: string | null;
  /** Compiled tsconfig `paths` entries, with `*` captured as a wildcard. */
  paths: AliasEntry[];
}

interface AliasEntry {
  /** e.g. "@app/*" -> { prefix: "@app/", suffix: "", hasWildcard: true } */
  prefix: string;
  suffix: string;
  hasWildcard: boolean;
  /** Absolute target templates, with `*` preserved for substitution. */
  targets: string[];
}

interface RawTsconfig {
  /** TS 5.0+ allows an array of configs to extend. */
  extends?: string | string[];
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
}

/**
 * Read tsconfig/jsconfig path aliases for a project, following a chain of
 * `extends`. Returns empty aliases when no config is present.
 */
export function loadPathAliases(root: string): PathAliases {
  const file =
    firstExisting(root, ["tsconfig.json", "jsconfig.json"]) ?? null;
  if (!file) return { baseUrl: null, paths: [] };

  const seen = new Set<string>();
  const merged = readWithExtends(file, seen);
  const opts = merged.compilerOptions ?? {};

  // baseUrl is resolved relative to the tsconfig that declared it; we keep it
  // simple and resolve against the file that owns the merged options' dir.
  const configDir = path.dirname(file);
  const baseUrl =
    opts.baseUrl != null ? path.resolve(configDir, opts.baseUrl) : null;
  const aliasBase = baseUrl ?? configDir;

  const paths: AliasEntry[] = [];
  for (const [pattern, targets] of Object.entries(opts.paths ?? {})) {
    const starIdx = pattern.indexOf("*");
    const hasWildcard = starIdx !== -1;
    const prefix = hasWildcard ? pattern.slice(0, starIdx) : pattern;
    const suffix = hasWildcard ? pattern.slice(starIdx + 1) : "";
    paths.push({
      prefix,
      suffix,
      hasWildcard,
      targets: targets.map((t) => path.resolve(aliasBase, t)),
    });
  }

  return { baseUrl, paths };
}

function readWithExtends(file: string, seen: Set<string>): RawTsconfig {
  const abs = path.resolve(file);
  if (seen.has(abs) || !fs.existsSync(abs)) return {};
  seen.add(abs);

  let raw: RawTsconfig;
  try {
    raw = parseJsonc<RawTsconfig>(fs.readFileSync(abs, "utf8"));
  } catch {
    return {};
  }

  if (!raw.extends) return raw;

  // TS 5.0+ `extends` may be an array: later entries override earlier ones,
  // and the extending file overrides them all — fold left in that order.
  const chain = Array.isArray(raw.extends) ? raw.extends : [raw.extends];
  let merged: RawTsconfig = {};
  for (const ext of chain) {
    const parentPath = resolveExtends(ext, path.dirname(abs));
    const parent = parentPath ? readWithExtends(parentPath, seen) : {};
    merged = mergeTsconfigs(merged, parent);
  }
  return { extends: raw.extends, ...mergeTsconfigs(merged, raw) };
}

function mergeTsconfigs(base: RawTsconfig, override: RawTsconfig): RawTsconfig {
  return {
    compilerOptions: {
      ...base.compilerOptions,
      ...override.compilerOptions,
      paths: override.compilerOptions?.paths ?? base.compilerOptions?.paths,
    },
  };
}

const warnedPackageExtends = new Set<string>();

function resolveExtends(ext: string, fromDir: string): string | null {
  if (!ext.startsWith(".") && !path.isAbsolute(ext)) {
    // Package-name extends (e.g. "@tsconfig/node18") are not resolved yet —
    // say so once rather than silently dropping any aliases it defines.
    if (!warnedPackageExtends.has(ext)) {
      warnedPackageExtends.add(ext);
      process.stderr.write(
        `pare: tsconfig extends "${ext}" is a package reference, which Pare does not resolve yet — any path aliases it defines are ignored.\n`,
      );
    }
    return null;
  }
  const candidate = path.resolve(fromDir, ext);
  if (fs.existsSync(candidate)) return candidate;
  if (fs.existsSync(`${candidate}.json`)) return `${candidate}.json`;
  return null;
}

function firstExisting(root: string, names: string[]): string | null {
  for (const name of names) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Resolve a non-relative specifier through tsconfig path aliases / baseUrl,
 * returning candidate absolute base paths (without extensions) to probe.
 */
export function aliasCandidates(
  specifier: string,
  aliases: PathAliases,
): string[] {
  const out: string[] = [];

  for (const entry of aliases.paths) {
    if (entry.hasWildcard) {
      if (
        specifier.startsWith(entry.prefix) &&
        specifier.endsWith(entry.suffix) &&
        specifier.length >= entry.prefix.length + entry.suffix.length
      ) {
        const star = specifier.slice(
          entry.prefix.length,
          specifier.length - entry.suffix.length,
        );
        for (const target of entry.targets) {
          out.push(target.replace("*", star));
        }
      }
    } else if (specifier === entry.prefix) {
      out.push(...entry.targets);
    }
  }

  if (aliases.baseUrl) {
    out.push(path.resolve(aliases.baseUrl, specifier));
  }

  return out;
}
