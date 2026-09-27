import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import {
  annotationControl,
  captureOutcomeMessage,
  captureToChat,
  captureUnavailableReason,
} from "./capture.ts";

const ARTIFACT_REF = "pending-0f1e2d3c-4b5a-4968-8776-655443322110";
const held = { tabId: "tab-1", serverEpoch: "epoch-1" };
const context = {
  client: "desktop",
  resource: {
    namespace: "t3.browser",
    id: "view",
    environmentId: "env-a",
    projectId: "project-a",
    threadId: "thread-a",
  },
};
const artifact = {
  artifactRef: ARTIFACT_REF,
  mimeType: "image/png",
  sizeBytes: 10,
  width: 1280,
  height: 800,
  target: "page",
  pageUrl: "http://localhost:5173/",
  pageTitle: "Home",
};

function fakeHost({ capture, insert } = {}) {
  const calls = { capture: [], invoke: [] };
  return {
    calls,
    browserCapture: {
      id: "t3.browser/capture",
      version: "1.0.0",
      support: { supported: true },
      async capture(request) {
        calls.capture.push(request);
        return capture ? capture(request) : { ok: true, artifact };
      },
    },
    async invokeApi(request) {
      calls.invoke.push(request);
      return insert ? insert(request) : { inserted: true, target: "env-a:thread-a" };
    },
  };
}

NodeTest.describe("captureUnavailableReason", () => {
  NodeTest.it("names each missing precondition", () => {
    const host = fakeHost();
    NodeAssert.match(captureUnavailableReason(host, held, undefined), /no thread/);
    NodeAssert.match(captureUnavailableReason({}, held, "thread-a"), /cannot capture/);
    NodeAssert.match(
      captureUnavailableReason(
        { browserCapture: { support: { supported: false, reason: "desktop-required" } } },
        held,
        "thread-a",
      ),
      /desktop app/,
    );
    NodeAssert.match(captureUnavailableReason(host, null, "thread-a"), /Open a page/);
    NodeAssert.equal(captureUnavailableReason(host, held, "thread-a"), null);
  });
});

NodeTest.describe("captureToChat", () => {
  NodeTest.it("inserts the captured artifactRef into this thread's draft", async () => {
    const host = fakeHost();
    const outcome = await captureToChat(host, context, held, "page", new AbortController().signal);
    NodeAssert.deepEqual(outcome, { kind: "added", artifact, inserted: true });
    NodeAssert.deepEqual(host.calls.capture[0].session, held);
    NodeAssert.equal(host.calls.capture[0].target, "page");
    const invoke = host.calls.invoke[0];
    NodeAssert.equal(invoke.id, "t3.composer/context");
    NodeAssert.equal(invoke.versionRange, "^1.2.0");
    NodeAssert.equal(invoke.method, "insertImage");
    // Only the ref crosses to the composer — never pixels.
    NodeAssert.deepEqual(invoke.input, { threadId: "thread-a", artifactRef: ARTIFACT_REF });
    NodeAssert.equal(captureOutcomeMessage(outcome), "Page screenshot added to chat.");
  });

  NodeTest.it("stays quiet on a dismissed picker and never inserts", async () => {
    const host = fakeHost({
      capture: () => ({ ok: false, failure: { reason: "cancelled", detail: "dismissed" } }),
    });
    const outcome = await captureToChat(
      host,
      context,
      held,
      "element",
      new AbortController().signal,
    );
    NodeAssert.deepEqual(outcome, { kind: "cancelled" });
    NodeAssert.equal(captureOutcomeMessage(outcome), null);
    NodeAssert.equal(host.calls.invoke.length, 0);
  });

  NodeTest.it("reports capture failures by reason and grant", async () => {
    const host = fakeHost({
      capture: () => ({
        ok: false,
        failure: { reason: "grant-denied", detail: "needs grant", grant: "t3.browser/capture" },
      }),
    });
    const outcome = await captureToChat(host, context, held, "page", new AbortController().signal);
    NodeAssert.equal(
      captureOutcomeMessage(outcome),
      "Capture failed — grant-denied (missing grant: t3.browser/capture): needs grant",
    );
    NodeAssert.equal(host.calls.invoke.length, 0);
  });

  NodeTest.it("says the capture exists when the composer refuses it", async () => {
    const host = fakeHost({
      insert: () => {
        throw new Error("client-provider-unsupported-version");
      },
    });
    const outcome = await captureToChat(host, context, held, "page", new AbortController().signal);
    NodeAssert.equal(outcome.kind, "failed");
    NodeAssert.match(
      captureOutcomeMessage(outcome),
      /^Captured, but it could not be added to chat/,
    );
  });

  NodeTest.it("reports an element capture already in the draft", () => {
    NodeAssert.equal(
      captureOutcomeMessage({
        kind: "added",
        artifact: { ...artifact, target: "element" },
        inserted: false,
      }),
      "Element capture is already in chat.",
    );
  });
});

NodeTest.test("annotationControl: a failed page disables pick with native's reason", () => {
  const reason = "Page didn't load — pick unavailable until the page renders";
  // Supported desktop host, held tab, idle capture: only the page failed.
  NodeAssert.deepEqual(
    annotationControl({ blockReason: null, capturing: null, pageFailed: true }),
    {
      disabled: true,
      picking: false,
      ariaLabel: "Annotate preview",
      tooltip: reason,
      hoverWhileDisabled: true,
    },
  );
  NodeAssert.deepEqual(
    annotationControl({ blockReason: null, capturing: null, pageFailed: false }),
    {
      disabled: false,
      picking: false,
      ariaLabel: "Annotate preview",
      tooltip: "Annotate elements, regions, and drawings",
      hoverWhileDisabled: false,
    },
  );
  // Other disabled states stay silent, as native's ordinary disabled buttons.
  const blocked = annotationControl({
    blockReason: "Open a page to capture it.",
    capturing: null,
    pageFailed: false,
  });
  NodeAssert.equal(blocked.disabled, true);
  NodeAssert.equal(blocked.hoverWhileDisabled, false);
  const picking = annotationControl({ blockReason: null, capturing: "element", pageFailed: false });
  NodeAssert.equal(picking.ariaLabel, "Cancel annotation");
  NodeAssert.equal(picking.tooltip, "Cancel annotation (Esc)");
});
