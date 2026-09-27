import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import { bindApi } from "@t3tools/extension-sdk/capabilities";
import { uiNotificationsApi } from "@t3tools/extension-sdk/catalogue";

import {
  captureOutcomeMessage,
  captureOutcomeToast,
  captureToChat,
  captureUnavailableReason,
  reportCaptureOutcome,
  runBrowserCapture,
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
    NodeAssert.equal(captureOutcomeMessage("page", outcome), "Page screenshot added to chat.");
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
    NodeAssert.equal(captureOutcomeMessage("element", outcome), null);
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
    NodeAssert.equal(outcome.stage, "request");
    NodeAssert.equal(
      captureOutcomeMessage("page", outcome),
      "Capture failed — grant-denied (missing grant: t3.browser/capture): needs grant",
    );
    NodeAssert.equal(host.calls.invoke.length, 0);
  });

  NodeTest.it("tells a lost image apart from a picker that failed", async () => {
    const run = (failure) =>
      captureToChat(
        fakeHost({ capture: () => ({ ok: false, failure }) }),
        context,
        held,
        "element",
        new AbortController().signal,
      );
    for (const reason of ["capture-failed", "too-large", "upload-failed"])
      NodeAssert.equal((await run({ reason, detail: "x" })).stage, "image");
    for (const reason of ["not-presented", "busy", "epoch-changed", "session-invalid"])
      NodeAssert.equal((await run({ reason, detail: "x" })).stage, "request");
    const threw = await captureToChat(
      fakeHost({
        capture: () => {
          throw new Error("webview navigated");
        },
      }),
      context,
      held,
      "element",
      new AbortController().signal,
    );
    NodeAssert.equal(threw.kind, "failed");
    NodeAssert.equal(threw.stage, "request");
  });

  NodeTest.it("says the capture exists when the composer refuses it", async () => {
    const host = fakeHost({
      insert: () => {
        throw new Error("client-provider-unsupported-version");
      },
    });
    const outcome = await captureToChat(host, context, held, "page", new AbortController().signal);
    NodeAssert.equal(outcome.kind, "failed");
    NodeAssert.equal(outcome.stage, "insert");
    NodeAssert.match(
      captureOutcomeMessage("page", outcome),
      /^Captured, but it could not be added to chat/,
    );
  });

  NodeTest.it("reports an element capture already in the draft", () => {
    NodeAssert.equal(
      captureOutcomeMessage("element", {
        kind: "added",
        artifact: { ...artifact, target: "element" },
        inserted: false,
      }),
      "Element capture is already in chat.",
    );
  });
});

const failed = {
  kind: "failed",
  stage: "request",
  message: "Capture failed — engine-error: tab gone",
};
const cropLost = {
  kind: "failed",
  stage: "image",
  message: "Capture failed — capture-failed: the picker kept no crop",
};
const pageAdded = { kind: "added", artifact, inserted: true };
const elementAdded = {
  kind: "added",
  artifact: { ...artifact, target: "element" },
  inserted: true,
};

NodeTest.describe("captureOutcomeToast", () => {
  NodeTest.it("uses native's screenshot titles and lifetime for page outcomes", () => {
    NodeAssert.deepEqual(captureOutcomeToast("page", pageAdded), {
      severity: "success",
      title: "Screenshot saved",
      durationMs: 5_000,
    });
    NodeAssert.deepEqual(captureOutcomeToast("page", failed), {
      severity: "error",
      title: "Unable to capture screenshot",
      body: failed.message,
      durationMs: 5_000,
    });
  });

  NodeTest.it("toasts a pick only when it loses its image, like native", () => {
    NodeAssert.deepEqual(captureOutcomeToast("element", cropLost), {
      severity: "error",
      title: "Could not capture the picked element",
      body: cropLost.message,
      durationMs: 5_000,
    });
    NodeAssert.deepEqual(
      captureOutcomeToast("element", { ...cropLost, stage: "insert" })?.title,
      "Could not capture the picked element",
    );
    NodeAssert.equal(captureOutcomeToast("element", elementAdded), null);
  });

  NodeTest.it("treats a failed picker as a silent cancel, like native", () => {
    NodeAssert.equal(captureOutcomeToast("element", failed), null);
    NodeAssert.equal(captureOutcomeMessage("element", failed), null);
  });

  NodeTest.it("stays silent on a cancel", () => {
    NodeAssert.equal(captureOutcomeToast("page", { kind: "cancelled" }), null);
    NodeAssert.equal(captureOutcomeToast("element", { kind: "cancelled" }), null);
  });
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A notifications client whose answer the test settles, or that never answers. */
function notifier(answer) {
  const calls = [];
  const client = {
    invokeApi: (request, signal) => {
      calls.push(request);
      if (answer === "hang")
        return new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason)),
        );
      if (answer instanceof Error) return Promise.reject(answer);
      if (answer && typeof answer.then === "function") return answer;
      return Promise.resolve(answer);
    },
  };
  return { calls, client, api: bindApi(uiNotificationsApi, client, context) };
}

NodeTest.describe("reportCaptureOutcome", () => {
  const signal = new AbortController().signal;

  NodeTest.it("toasts on this thread and owes no status line", async () => {
    const { calls, api } = notifier({ notificationId: "n-1" });
    const report = reportCaptureOutcome(api, "thread-a", "page", failed, signal);
    NodeAssert.equal(report.inline, null);
    NodeAssert.equal(await report.fallback, null);
    NodeAssert.equal(calls.length, 1);
    NodeAssert.equal(calls[0].id, "t3.ui/notifications");
    NodeAssert.equal(calls[0].method, "notify");
    NodeAssert.deepEqual(calls[0].input, {
      severity: "error",
      title: "Unable to capture screenshot",
      body: failed.message,
      durationMs: 5_000,
      threadId: "thread-a",
      anchor: "thread",
    });
  });

  NodeTest.it("falls back to the status line when notify definitely failed", async () => {
    const { calls, api } = notifier(new Error("grant t3.ui/notify missing"));
    const report = reportCaptureOutcome(api, "thread-a", "page", pageAdded, signal);
    NodeAssert.equal(report.inline, null);
    NodeAssert.equal(await report.fallback, "Page screenshot added to chat.");
    NodeAssert.equal(calls.length, 1);
  });

  NodeTest.it("does not report twice when notify's ack times out", async () => {
    const { calls, api } = notifier("hang");
    const report = reportCaptureOutcome(api, "thread-a", "page", pageAdded, signal, 0);
    NodeAssert.equal(await report.fallback, null);
    NodeAssert.equal(calls.length, 1);
  });

  NodeTest.it("keeps untoasted outcomes on the status line without notifying", async () => {
    const { calls, api } = notifier({ notificationId: "n-1" });
    NodeAssert.equal(
      reportCaptureOutcome(api, "thread-a", "element", elementAdded, signal).inline,
      "Element capture added to chat.",
    );
    NodeAssert.equal(
      reportCaptureOutcome(api, "thread-a", "page", { kind: "cancelled" }, signal).inline,
      null,
    );
    NodeAssert.equal(calls.length, 0);
  });
});

NodeTest.describe("runBrowserCapture", () => {
  const session = { context, signal: new AbortController().signal };
  const hostWithNotify = (answer) => {
    const host = fakeHost({
      capture: () => ({
        ok: false,
        failure: { reason: "capture-failed", detail: "engine lost it" },
      }),
    });
    const notify = notifier(answer);
    return { host: { ...host, invokeApi: notify.client.invokeApi }, calls: notify.calls };
  };

  NodeTest.it("releases capture state before notify settles", async () => {
    const pending = deferred();
    const { host, calls } = hostWithNotify(pending.promise);
    const states = [];
    const run = runBrowserCapture(
      host,
      session,
      held,
      "page",
      () => true,
      (s) => states.push(s),
    );
    await Promise.race([run, new Promise((resolve) => setImmediate(resolve))]);
    // notify is still pending, yet the buttons are already free.
    NodeAssert.equal(calls.length, 1);
    NodeAssert.deepEqual(states, [{ kind: "done", message: null }]);
    pending.reject(new Error("provider-unavailable"));
    await run;
    NodeAssert.equal(states.length, 2);
    NodeAssert.match(states[1].message, /engine lost it/);
  });

  NodeTest.it("drops a fallback once a newer run has started", async () => {
    const pending = deferred();
    const { host } = hostWithNotify(pending.promise);
    const states = [];
    let current = true;
    const run = runBrowserCapture(
      host,
      session,
      held,
      "page",
      () => current,
      (s) => states.push(s),
    );
    await Promise.race([run, new Promise((resolve) => setImmediate(resolve))]);
    current = false;
    pending.reject(new Error("provider-unavailable"));
    await run;
    NodeAssert.deepEqual(states, [{ kind: "done", message: null }]);
  });
});
