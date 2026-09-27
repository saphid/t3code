// SemVer 2.0 ordering and range floors for the SDK's API version guard. Not a
// package export: bundled into packs, so it stays small instead of pulling in
// the runtime's `semver` dependency. Numeric components compare as digit
// strings, so large values keep exact order.

const NUMBER = "0|[1-9]\\d*";
const IDENTIFIER = `(?:${NUMBER}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
const BUILD = "(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?";
const VERSION = new RegExp(
  `^(${NUMBER})\\.(${NUMBER})\\.(${NUMBER})(?:-(${IDENTIFIER}(?:\\.${IDENTIFIER})*))?${BUILD}$`,
);
const PARTIAL = new RegExp(`^(${NUMBER}|[xX*])(?:\\.(${NUMBER}|[xX*]))?(?:\\.(${NUMBER}|[xX*]))?$`);

export interface Version {
  readonly release: readonly [string, string, string];
  readonly prerelease: readonly string[];
}

/** A strict SemVer 2.0 version, build metadata dropped, or null. */
export function parseVersion(text: string): Version | null {
  const match = VERSION.exec(text);
  if (!match) return null;
  return {
    release: [match[1]!, match[2]!, match[3]!],
    prerelease: match[4]?.split(".") ?? [],
  };
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const compareNumbers = (a: string, b: string) => Math.sign(a.length - b.length) || order(a, b);
const isNumber = (identifier: string) => /^\d+$/.test(identifier);

/** SemVer 2.0 precedence: negative, zero or positive as `a` sorts before, with or after `b`. */
export function compareVersions(a: Version, b: Version): number {
  for (let index = 0; index < 3; index++) {
    const result = compareNumbers(a.release[index]!, b.release[index]!);
    if (result) return result;
  }
  // A release outranks its prereleases.
  if (!a.prerelease.length || !b.prerelease.length)
    return Math.sign(b.prerelease.length - a.prerelease.length);
  for (let index = 0; index < Math.min(a.prerelease.length, b.prerelease.length); index++) {
    const x = a.prerelease[index]!;
    const y = b.prerelease[index]!;
    const result =
      isNumber(x) && isNumber(y)
        ? compareNumbers(x, y)
        : isNumber(x) !== isNumber(y)
          ? isNumber(x)
            ? -1
            : 1
          : order(x, y);
    if (result) return result;
  }
  return Math.sign(a.prerelease.length - b.prerelease.length);
}

const ZERO: Version = { release: ["0", "0", "0"], prerelease: [] };

/** A comparator's lower bound; ZERO for upper bounds; null when unrecognised. */
function comparatorFloor(comparator: string): Version | null {
  const [, operator = "", text = ""] = /^(<=|>=|<|>|=|\^|~)?v?(.*)$/.exec(comparator)!;
  let floor = parseVersion(text);
  if (!floor) {
    const partial = PARTIAL.exec(text);
    if (!partial) return null;
    // `1.2.x`, `1.2` and `1` start at their zero-filled release. `>1.2` really
    // starts at 1.3.0; a lower floor only refuses more.
    const parts = partial.slice(1, 4);
    const wildcard = parts.findIndex((part) => part === undefined || /^[xX*]$/.test(part));
    const release = parts.map((part, index) => (index < wildcard ? part! : "0"));
    floor = { release: release as [string, string, string], prerelease: [] };
  }
  // `>V` starts just above V, so V is a safe floor.
  return operator.startsWith("<") ? ZERO : floor;
}

/**
 * The lowest version a node-semver range admits, or null when the range has a
 * shape this parser does not know (hyphen ranges, spaced operators, …). A
 * returned floor may be lower than the true one, never higher.
 */
export function rangeFloor(range: string): Version | null {
  let lowest: Version | null = null;
  for (const set of range.split("||")) {
    let floor = ZERO;
    for (const comparator of set.trim().split(/\s+/).filter(Boolean)) {
      const bound = comparatorFloor(comparator);
      if (!bound) return null;
      if (compareVersions(bound, floor) > 0) floor = bound;
    }
    if (!lowest || compareVersions(floor, lowest) < 0) lowest = floor;
  }
  return lowest;
}
