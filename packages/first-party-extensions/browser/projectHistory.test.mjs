import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import {
  createProjectHistory,
  displayedHistory,
  projectHistoryErrorState,
  titleUpdate,
} from "./projectHistory.ts";
import { isLeaseUrl } from "./viewModel.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A fake bound API whose answers the test releases explicitly. */
function scriptedApi() {
  const calls = [];
  return {
    calls,
    invoke(method, input) {
      const answer = deferred();
      calls.push({ method, input, answer });
      return answer.promise;
    },
  };
}

/** Collects states; `next()` resolves on the next report — the receipt, never a sleep. */
function stateLog() {
  const states = [];
  let waiter = null;
  return {
    states,
    onState(state) {
      states.push(state);
      waiter?.resolve(state);
      waiter = null;
    },
    next() {
      waiter = deferred();
      return waiter.promise;
    },
  };
}

NodeTest.describe("createProjectHistory", () => {
  NodeTest.it("reports the project list, dropping corrupt entries", async () => {
    const api = scriptedApi();
    const log = stateLog();
    const history = createProjectHistory(api, new AbortController().signal, log.onState);
    history.refresh();
    NodeAssert.deepEqual(
      api.calls.map((call) => [call.method, call.input]),
      [["list", {}]],
    );
    const reported = log.next();
    api.calls[0].answer.resolve({
      entries: [
        { url: "https://b.test/", lastVisitedAt: 1 },
        { url: "https://a.test/", lastVisitedAt: 2, title: "A" },
        { url: 7, lastVisitedAt: 3 },
        { url: "https://no-time.test/", lastVisitedAt: "later" },
      ],
    });
    NodeAssert.deepEqual(await reported, {
      kind: "ready",
      entries: [
        { url: "https://a.test/", lastVisitedAt: 2, title: "A" },
        { url: "https://b.test/", lastVisitedAt: 1 },
      ],
    });
  });

  NodeTest.it("sends each write with its own input", () => {
    const api = scriptedApi();
    const history = createProjectHistory(api, new AbortController().signal, () => {});
    history.record("https://a.test/");
    history.setTitle("https://a.test/", "A");
    history.remove("https://a.test/");
    NodeAssert.deepEqual(
      api.calls.map((call) => [call.method, call.input]),
      [
        ["record", { url: "https://a.test/" }],
        ["setTitle", { url: "https://a.test/", title: "A" }],
        ["remove", { url: "https://a.test/" }],
      ],
    );
  });

  NodeTest.it("keeps the latest-issued answer when an older one lands late", async () => {
    const api = scriptedApi();
    const log = stateLog();
    const history = createProjectHistory(api, new AbortController().signal, log.onState);
    history.refresh();
    history.record("https://new.test/");
    const reported = log.next();
    api.calls[1].answer.resolve({ entries: [{ url: "https://new.test/", lastVisitedAt: 5 }] });
    await reported;
    api.calls[0].answer.resolve({ entries: [] });
    // The stale list answer settles without a report; a later op still reports.
    await api.calls[0].answer.promise;
    history.refresh();
    const again = log.next();
    api.calls[2].answer.resolve({ entries: [{ url: "https://new.test/", lastVisitedAt: 5 }] });
    await again;
    NodeAssert.equal(log.states.length, 2);
    NodeAssert.deepEqual(
      log.states.map((state) => state.entries.map((entry) => entry.url)),
      [["https://new.test/"], ["https://new.test/"]],
    );
  });

  NodeTest.it("reports nothing after the view's signal aborts", async () => {
    const api = scriptedApi();
    const log = stateLog();
    const controller = new AbortController();
    const history = createProjectHistory(api, controller.signal, log.onState);
    history.refresh();
    controller.abort();
    api.calls[0].answer.resolve({ entries: [] });
    await api.calls[0].answer.promise;
    NodeAssert.deepEqual(log.states, []);
  });

  NodeTest.it("names a denied grant or a missing provider", async () => {
    const api = scriptedApi();
    const log = stateLog();
    const history = createProjectHistory(api, new AbortController().signal, log.onState);
    history.record("https://a.test/");
    const denied = log.next();
    api.calls[0].answer.reject(new Error("API capability denied: t3.browser/record-history"));
    NodeAssert.deepEqual(await denied, {
      kind: "unavailable",
      message:
        "Showing this view's history only — this installation is missing the t3.browser/record-history grant.",
    });
    history.refresh();
    const missing = log.next();
    api.calls[1].answer.reject(
      new Error("client-provider-unavailable: No connected client registered this provider."),
    );
    const state = await missing;
    NodeAssert.equal(state.kind, "unavailable");
    NodeAssert.match(state.message, /project history is unavailable \(client-provider-unavailable/);
  });
});

NodeTest.describe("projectHistoryErrorState", () => {
  NodeTest.it("falls back to the op's grant when the denial names none", () => {
    NodeAssert.match(
      projectHistoryErrorState("list", new Error("capability denied")).message,
      /t3\.browser\/read-history grant/,
    );
  });
});

NodeTest.describe("displayedHistory", () => {
  const own = [{ url: "https://own.test/", lastVisitedAt: 1 }];
  NodeTest.it("shows the view's own rows until the project list arrives or when it cannot", () => {
    NodeAssert.equal(displayedHistory({ kind: "loading" }, own), own);
    NodeAssert.equal(displayedHistory({ kind: "unavailable", message: "x" }, own), own);
  });
  NodeTest.it("shows the project list once ready, even when it is empty", () => {
    NodeAssert.deepEqual(displayedHistory({ kind: "ready", entries: [] }, own), []);
  });
});

NodeTest.describe("titleUpdate", () => {
  const loaded = { kind: "loaded", url: "https://a.test/", title: "A" };
  NodeTest.it("writes back a loaded page's title", () => {
    NodeAssert.deepEqual(titleUpdate(loaded, false, isLeaseUrl), {
      url: "https://a.test/",
      title: "A",
    });
  });
  NodeTest.it("skips unloaded pages, blank titles, and workspace-file presentations", () => {
    NodeAssert.equal(titleUpdate({ ...loaded, kind: "loading" }, false, isLeaseUrl), null);
    NodeAssert.equal(titleUpdate({ ...loaded, title: "  " }, false, isLeaseUrl), null);
    NodeAssert.equal(titleUpdate(loaded, true, isLeaseUrl), null);
    NodeAssert.equal(titleUpdate(null, false, isLeaseUrl), null);
    NodeAssert.equal(
      titleUpdate(loaded, false, () => true),
      null,
    );
  });
});
