import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import { prsBranchChips, prsStackedOnBase } from "./prsViewModel.ts";

const stack = (numbers) => ({
  id: "s",
  number: 9,
  url: "https://github.com/o/r/stacks/9",
  base: "main",
  layers: numbers.map((number) => ({ number, headBranch: `b${number}`, state: "open" })),
});

NodeTest.describe("branch chips", () => {
  NodeTest.it("reads base ← head, each name on hover, the arrow named", () => {
    NodeAssert.deepEqual(prsBranchChips({ baseBranch: "main", headBranch: "feat/x" }, false), {
      base: { text: "main", tooltip: "main", stacked: false },
      head: { text: "feat/x", tooltip: "feat/x" },
      arrowLabel: "receives changes from",
    });
  });

  NodeTest.it("names a stacked base the way native's tooltip does", () => {
    const chips = prsBranchChips({ baseBranch: "b1", headBranch: "b2" }, true);
    NodeAssert.deepEqual(chips.base, { text: "b1", tooltip: "Stacked on b1", stacked: true });
  });

  NodeTest.it("is stacked only when a layer sits below it in the host's stack", () => {
    NodeAssert.equal(prsStackedOnBase(null, 3), false);
    NodeAssert.equal(prsStackedOnBase(stack([3, 4]), 3), false);
    NodeAssert.equal(prsStackedOnBase(stack([3, 4]), 4), true);
    NodeAssert.equal(prsStackedOnBase(stack([3, 4]), 7), false);
  });
});
