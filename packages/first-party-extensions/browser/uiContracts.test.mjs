import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import { bindApi } from "@t3tools/extension-sdk/capabilities";
import { uiNotificationsApi, uiPanelsApi } from "@t3tools/extension-sdk/catalogue";
import {
  parseKeybindingShortcut,
  parseKeybindingWhenExpression,
} from "@t3tools/shared/keybindings";

import {
  BROWSER_GLOBAL_COMMANDS,
  BROWSER_SURFACE_ID,
  BROWSER_VIEW_COMMANDS,
  notifyToggleFailure,
  themeVarOverrides,
  togglePanelSurface,
} from "./uiContracts.ts";

const context = {
  client: "web",
  resource: {
    namespace: "t3.browser",
    id: BROWSER_SURFACE_ID,
    environmentId: "env",
    projectId: "project",
    threadId: "thread",
  },
};

/** A `bindApi`-compatible client that records invocations and answers per method. */
function fakeClient(answers, calls) {
  return {
    invokeApi: async (request) => {
      calls.push(request);
      const answer = answers[request.method];
      if (answer instanceof Error) throw answer;
      if (typeof answer === "function") return answer(request);
      return answer;
    },
  };
}

NodeTest.describe("themeVarOverrides", () => {
  const cssVars = {
    text: "--app-theme-text",
    mutedForeground: "--app-theme-muted-foreground",
    border: "--app-theme-border",
    canvas: "--app-theme-canvas",
  };

  NodeTest.it("republishes contract tokens as panel-scoped vars", () => {
    const overrides = themeVarOverrides(
      { text: "#101828", mutedForeground: "#98a2b3", border: "#eaecf0", canvas: "#ffffff" },
      cssVars,
    );
    NodeAssert.deepEqual(overrides, {
      "--t3-browser-text": "var(--app-theme-text, #101828)",
      "--t3-browser-muted-foreground": "var(--app-theme-muted-foreground, #98a2b3)",
      "--t3-browser-border": "var(--app-theme-border, #eaecf0)",
      "--t3-browser-canvas": "var(--app-theme-canvas, #ffffff)",
    });
  });

  NodeTest.it("skips roles the host did not resolve rather than overriding them", () => {
    NodeAssert.deepEqual(themeVarOverrides({ text: "#101828" }, cssVars), {
      "--t3-browser-text": "var(--app-theme-text, #101828)",
    });
  });

  NodeTest.it("falls back to the resolved value when no css var is advertised", () => {
    NodeAssert.deepEqual(themeVarOverrides({ mutedForeground: "#98a2b3" }, {}), {
      "--t3-browser-muted-foreground": "#98a2b3",
    });
  });

  NodeTest.it("ignores roles outside the panel's consumed set", () => {
    const overrides = themeVarOverrides(
      { mutedForeground: "#98a2b3", terminalBackground: "#000000", error: "#f04438" },
      { ...cssVars, terminalBackground: "--app-theme-terminal-background" },
    );
    NodeAssert.deepEqual(Object.keys(overrides), ["--t3-browser-muted-foreground"]);
  });
});

NodeTest.describe("command descriptors", () => {
  NodeTest.it("view commands are surface-scoped, focus-gated, and parse", () => {
    NodeAssert.equal(BROWSER_VIEW_COMMANDS.length, 2);
    for (const command of BROWSER_VIEW_COMMANDS) {
      NodeAssert.equal(command.scope, "surface");
      NodeAssert.equal(command.when, `extension.${BROWSER_SURFACE_ID}.focus`);
      NodeAssert.notEqual(parseKeybindingWhenExpression(command.when), null);
      NodeAssert.notEqual(parseKeybindingShortcut(command.defaultKey), null);
    }
    NodeAssert.deepEqual(
      BROWSER_VIEW_COMMANDS.map((command) => command.id),
      ["reload", "focusAddress"],
    );
  });

  NodeTest.it("the global toggle names its own surface for activation", () => {
    NodeAssert.equal(BROWSER_GLOBAL_COMMANDS.length, 1);
    const [toggle] = BROWSER_GLOBAL_COMMANDS;
    NodeAssert.equal(toggle.id, "toggle");
    NodeAssert.equal(toggle.scope, "global");
    NodeAssert.deepEqual(toggle.activation, {
      surfaceId: BROWSER_SURFACE_ID,
      placement: "side-panel",
    });
    NodeAssert.notEqual(parseKeybindingShortcut(toggle.defaultKey), null);
  });
});

NodeTest.describe("togglePanelSurface", () => {
  NodeTest.it("opens the surface when none is listed", async () => {
    const calls = [];
    const panels = bindApi(
      uiPanelsApi,
      fakeClient(
        { listSurfaces: { surfaces: [] }, openSurface: { surfaceId: BROWSER_SURFACE_ID } },
        calls,
      ),
      context,
    );
    NodeAssert.equal(
      await togglePanelSurface(panels, "thread", new AbortController().signal),
      "opened",
    );
    NodeAssert.deepEqual(
      calls.map((call) => call.method),
      ["listSurfaces", "openSurface"],
    );
    NodeAssert.deepEqual(calls[1].input, {
      surfaceId: BROWSER_SURFACE_ID,
      placement: "side-panel",
      threadId: "thread",
    });
  });

  NodeTest.it("activates a present but inactive surface", async () => {
    const calls = [];
    const panels = bindApi(
      uiPanelsApi,
      fakeClient(
        {
          listSurfaces: {
            surfaces: [
              { id: BROWSER_SURFACE_ID, title: "Browser", placement: "side-panel", active: false },
            ],
          },
          activateSurface: { applied: true },
        },
        calls,
      ),
      context,
    );
    NodeAssert.equal(
      await togglePanelSurface(panels, "thread", new AbortController().signal),
      "activated",
    );
    NodeAssert.deepEqual(
      calls.map((call) => call.method),
      ["listSurfaces", "activateSurface"],
    );
  });

  NodeTest.it("closes the surface when it is active", async () => {
    const calls = [];
    const panels = bindApi(
      uiPanelsApi,
      fakeClient(
        {
          listSurfaces: {
            surfaces: [
              { id: BROWSER_SURFACE_ID, title: "Browser", placement: "side-panel", active: true },
            ],
          },
          closeSurface: { applied: true },
        },
        calls,
      ),
      context,
    );
    NodeAssert.equal(
      await togglePanelSurface(panels, "thread", new AbortController().signal),
      "closed",
    );
    NodeAssert.deepEqual(
      calls.map((call) => call.method),
      ["listSurfaces", "closeSurface"],
    );
  });

  NodeTest.it("ignores other installations' surfaces in the listing", async () => {
    const calls = [];
    const panels = bindApi(
      uiPanelsApi,
      fakeClient(
        {
          listSurfaces: {
            surfaces: [
              { id: "t3.other/view", title: "Other", placement: "side-panel", active: true },
            ],
          },
          openSurface: { surfaceId: BROWSER_SURFACE_ID },
        },
        calls,
      ),
      context,
    );
    NodeAssert.equal(
      await togglePanelSurface(panels, "thread", new AbortController().signal),
      "opened",
    );
  });
});

NodeTest.describe("notifyToggleFailure", () => {
  NodeTest.it("posts a thread-anchored error toast with the failure detail", async () => {
    const calls = [];
    const notifications = bindApi(
      uiNotificationsApi,
      fakeClient({ notify: { notificationId: "ntf-1" } }, calls),
      context,
    );
    await notifyToggleFailure(
      notifications,
      "thread",
      new Error("Surface is not open"),
      new AbortController().signal,
    );
    NodeAssert.equal(calls.length, 1);
    NodeAssert.equal(calls[0].method, "notify");
    NodeAssert.deepEqual(calls[0].input, {
      severity: "error",
      title: "Unable to toggle the browser panel",
      body: "Surface is not open",
      threadId: "thread",
      anchor: "thread",
    });
  });

  NodeTest.it("omits the body for non-Error failures", async () => {
    const calls = [];
    const notifications = bindApi(
      uiNotificationsApi,
      fakeClient({ notify: { notificationId: "ntf-1" } }, calls),
      context,
    );
    await notifyToggleFailure(notifications, "thread", "denied", new AbortController().signal);
    NodeAssert.equal(calls[0].input.body, undefined);
  });
});
