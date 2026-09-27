import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import { compareVersions, parseVersion, rangeFloor } from "../dist/semver.js";

const format = (version) =>
  version &&
  version.release.join(".") + (version.prerelease.length ? "-" + version.prerelease.join(".") : "");

NodeTest.test("compareVersions follows SemVer 2.0 precedence", () => {
  // Each row sorts strictly before the next.
  const ascending = [
    "0.0.0-0",
    "0.0.0",
    "1.0.0-0",
    "1.0.0-2",
    "1.0.0-10",
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
    "1.0.9",
    "1.0.10",
    "1.0.20260927",
    "1.0.9007199254740993",
    "1.0.9007199254740994",
    "1.0.99999999999999999999",
    "1.1.0-rc.1",
    "1.1.0",
    "1.2.0",
    "1.10.0",
    "2.0.0",
    "10.0.0",
  ];
  for (let i = 0; i < ascending.length; i++)
    for (let j = 0; j < ascending.length; j++) {
      const result = compareVersions(parseVersion(ascending[i]), parseVersion(ascending[j]));
      NodeAssert.equal(Math.sign(result), Math.sign(i - j), `${ascending[i]} vs ${ascending[j]}`);
    }
  for (const [a, b] of [
    ["1.1.0+build.1", "1.1.0"],
    ["1.1.0+a", "1.1.0+b"],
    ["1.2.0-rc.1+build.5", "1.2.0-rc.1"],
  ])
    NodeAssert.equal(compareVersions(parseVersion(a), parseVersion(b)), 0, `${a} vs ${b}`);
});

NodeTest.test("parseVersion accepts SemVer 2.0 and nothing else", () => {
  for (const version of ["1.0.0", "1.1.0+build.1", "1.2.0-rc.1", "1.0.0-x-y.0.a1+b.c-d"])
    NodeAssert.ok(parseVersion(version), version);
  for (const version of ["1.0", "01.0.0", "1.0.0-01", "1.0.0-", "1.0.0+", "v1.0.0", "^1.0.0", ""])
    NodeAssert.equal(parseVersion(version), null, version);
});

NodeTest.test("rangeFloor finds the lowest admitted version or refuses", () => {
  for (const [range, floor] of [
    ["1.1.0", "1.1.0"],
    ["=1.1.0", "1.1.0"],
    ["v1.1.0", "1.1.0"],
    ["1.1.0+build.1", "1.1.0"],
    [">=1.1.0", "1.1.0"],
    [">1.1.0", "1.1.0"],
    [">=1.1.0 <2.0.0", "1.1.0"],
    ["<2.0.0 >=1.1.0", "1.1.0"],
    ["<=1.4.0", "0.0.0"],
    ["^1.1.0", "1.1.0"],
    ["~1.1.0", "1.1.0"],
    ["^1.1", "1.1.0"],
    ["~1", "1.0.0"],
    ["^0.2.3", "0.2.3"],
    ["1.1.x", "1.1.0"],
    ["1.1.*", "1.1.0"],
    ["1.X", "1.0.0"],
    ["1.1", "1.1.0"],
    ["1", "1.0.0"],
    ["*", "0.0.0"],
    [">=1.x", "1.0.0"],
    [">=1.1.0-rc.1", "1.1.0-rc.1"],
    ["^1.1.0-rc.1", "1.1.0-rc.1"],
    ["~1.1.0-0 <1.2.0", "1.1.0-0"],
    [">=1.0.20260927", "1.0.20260927"],
    ["^1.0.99999999999999999999", "1.0.99999999999999999999"],
    ["^1.1.0 || ^1.2.0", "1.1.0"],
    ["^1.2.0 || 1.1.x", "1.1.0"],
    ["^1.2.0 || >=1.1.0-beta", "1.1.0-beta"],
    ["^1.1.0 || <1.0.5", "0.0.0"],
  ])
    NodeAssert.equal(format(rangeFloor(range)), floor, range);
  for (const range of [
    "1.1.0 - 2.0.0",
    ">= 1.1.0",
    "~>1.1.0",
    "1.1-rc.1",
    "01.1.0",
    ">=",
    "latest",
    "^1.1.0 || nope",
  ])
    NodeAssert.equal(rangeFloor(range), null, range);
});
