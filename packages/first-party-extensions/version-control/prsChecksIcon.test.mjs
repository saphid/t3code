import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import { prsChecksIcon, prsChecksStateFromChecks } from "./prsViewModel.ts";

const check = (status) => ({ name: status, status, description: null, url: null });

NodeTest.describe("checks status icon", () => {
  NodeTest.it("names each rollup with native's headline, glyph and tone", () => {
    NodeAssert.deepEqual(prsChecksIcon("passing"), {
      glyph: "✓",
      label: "All checks have passed",
      tone: "success",
    });
    NodeAssert.deepEqual(prsChecksIcon("failing"), {
      glyph: "✕",
      label: "Some checks were not successful",
      tone: "destructive",
    });
    NodeAssert.deepEqual(prsChecksIcon("pending"), {
      glyph: "●",
      label: "Some checks haven't completed yet",
      tone: "warning",
    });
  });

  NodeTest.it("draws nothing when the host reported no rollup", () => {
    NodeAssert.equal(prsChecksIcon(undefined), null);
    NodeAssert.equal(prsChecksIcon(null), null);
  });

  NodeTest.it("rolls a detail's checks up the way native's header does", () => {
    NodeAssert.equal(prsChecksStateFromChecks([]), null);
    NodeAssert.equal(prsChecksStateFromChecks([check("success"), check("skipped")]), "passing");
    NodeAssert.equal(prsChecksStateFromChecks([check("success"), check("pending")]), "pending");
    NodeAssert.equal(
      prsChecksStateFromChecks([check("success"), check("action-required")]),
      "pending",
    );
    NodeAssert.equal(prsChecksStateFromChecks([check("pending"), check("failure")]), "failing");
    NodeAssert.equal(prsChecksStateFromChecks([check("cancelled")]), "failing");
    // Only neutral/skipped results earned no tick.
    NodeAssert.equal(prsChecksStateFromChecks([check("neutral"), check("skipped")]), null);
  });
});

NodeTest.describe("checks rollup freshness", () => {
  const reconcile = async (...args) => {
    const { prsReconcileChecks } = await import("./prsViewModel.ts");
    return prsReconcileChecks?.(...args) ?? null;
  };

  NodeTest.it(
    "a newer failing list rollup beats an older passing detail, marked stale",
    async () => {
      NodeAssert.deepEqual(await reconcile([check("success")], "failing"), {
        state: "failing",
        stale: true,
      });
    },
  );

  NodeTest.it("keeps the detail's own rollup when the list says the same or nothing", async () => {
    NodeAssert.deepEqual(await reconcile([check("success")], "passing"), {
      state: "passing",
      stale: false,
    });
    NodeAssert.deepEqual(await reconcile([check("failure")], undefined), {
      state: "failing",
      stale: false,
    });
  });

  NodeTest.it("a run awaiting approval keeps it pending unless something failed", async () => {
    NodeAssert.deepEqual(await reconcile([check("action-required")], "passing"), {
      state: "pending",
      stale: false,
    });
    NodeAssert.deepEqual(await reconcile([check("action-required")], "failing"), {
      state: "failing",
      stale: true,
    });
  });
});
