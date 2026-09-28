import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
// A namespace import, so a missing export fails each test on its own assertion.
import * as ViewModel from "./prsViewModel.ts";

const control = (detail, handoff = null) => {
  NodeAssert.equal(typeof ViewModel.prsResolveConflictsControl, "function");
  return ViewModel.prsResolveConflictsControl(detail, handoff);
};
const receipt = (task, outcome, mode) => {
  NodeAssert.equal(typeof ViewModel.prsHandoffReceipt, "function");
  return ViewModel.prsHandoffReceipt(task, outcome, mode);
};
const conflicting = { state: "open", mergeability: "conflicting" };

NodeTest.describe("resolve conflicts", () => {
  NodeTest.it("shows only on an open pull request that conflicts with its base", () => {
    NodeAssert.equal(control({ state: "open", mergeability: "mergeable" }).visible, false);
    NodeAssert.equal(control({ state: "open", mergeability: "unknown" }).visible, false);
    NodeAssert.equal(control({ state: "merged", mergeability: "conflicting" }).visible, false);
    NodeAssert.equal(control({ state: "closed", mergeability: "conflicting" }).visible, false);
    NodeAssert.deepEqual(control(conflicting), {
      visible: true,
      label: "Resolve conflicts",
      disabled: false,
    });
  });

  NodeTest.it("reads Preparing... while its own handoff runs, and waits for any other", () => {
    NodeAssert.deepEqual(control(conflicting, "conflicts"), {
      visible: true,
      label: "Preparing...",
      disabled: true,
    });
    NodeAssert.deepEqual(control(conflicting, "checkout:worktree"), {
      visible: true,
      label: "Resolve conflicts",
      disabled: true,
    });
  });

  NodeTest.it("reports a task handed to the thread beside it in native's words", () => {
    NodeAssert.deepEqual(receipt("resolve-conflicts", { ok: true, value: { status: "drafted" } }), {
      tone: "success",
      title: "Added to the composer",
      description: "The task is in the composer — read it over, then send.",
    });
  });

  NodeTest.it("reports a checkout that carries the task as native's Checkout ready", () => {
    const ready = {
      status: "ready",
      branch: "feat/x",
      worktreePath: "/repo/.t3/worktrees/feat-x",
      isOnPullRequestHead: true,
    };
    NodeAssert.deepEqual(receipt("resolve-conflicts", { ok: true, value: ready }), {
      tone: "success",
      title: "Checkout ready",
      description: "The task is in the composer — read it over, then send.",
    });
    NodeAssert.deepEqual(receipt("checkout", { ok: true, value: ready }), {
      tone: "success",
      title: "Checked out",
      description: "The pull request is in its own worktree, with a thread open on it.",
    });
    NodeAssert.deepEqual(
      receipt("checkout", { ok: true, value: { ...ready, worktreePath: null } }, "local"),
      {
        tone: "success",
        title: "Checked out here",
        description: "This repository is on the pull request's branch, with a thread open on it.",
      },
    );
    NodeAssert.deepEqual(
      receipt("resolve-conflicts", {
        ok: true,
        value: { ...ready, isOnPullRequestHead: false },
      }),
      {
        tone: "warning",
        title: "Checked out, but the latest commits are unconfirmed",
        description:
          "The pull request's latest commits could not be confirmed or applied here, so this checkout may be behind the pull request.",
      },
    );
  });

  NodeTest.it("names each failed stage the way native's toasts do", () => {
    NodeAssert.deepEqual(
      receipt("resolve-conflicts", { ok: true, value: { status: "failed", stage: "thread" } }),
      {
        tone: "error",
        title: "Could not open a thread for the checkout",
        description: "Try again from the project, or open a thread first.",
      },
    );
    NodeAssert.deepEqual(
      receipt("checkout", {
        ok: true,
        value: { status: "failed", stage: "checkout", detail: "Branch is checked out elsewhere." },
      }),
      {
        tone: "error",
        title: "Could not prepare the pull request checkout",
        description: "Branch is checked out elsewhere.",
      },
    );
    NodeAssert.deepEqual(
      receipt("resolve-conflicts", {
        ok: true,
        value: { status: "failed", stage: "thread-move", branch: "feat/x" },
      }),
      {
        tone: "error",
        title: "Checked out, but the thread stayed where it was",
        description:
          "The checkout is ready on `feat/x`. Point a thread at it from the branch picker, then ask again.",
      },
    );
    NodeAssert.deepEqual(receipt("checkout", { ok: false, detail: "No client." }), {
      tone: "error",
      title: "Could not prepare the pull request checkout",
      description: "No client.",
    });
  });
});
