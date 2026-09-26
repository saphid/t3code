import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  BROWSER_ENGINE_FAVICON_MAX_LENGTH,
  BrowserEngineCommand,
  BrowserEngineHostCommandResultInput,
  BrowserEngineHostReportInput,
  BrowserEngineHostStreamEvent,
} from "./browserEngineHost.ts";

const decodeCommand = Schema.decodeUnknownSync(BrowserEngineCommand);
const decodeReport = Schema.decodeUnknownSync(BrowserEngineHostReportInput);
const decodeResult = Schema.decodeUnknownSync(BrowserEngineHostCommandResultInput);
const decodeStreamEvent = Schema.decodeUnknownSync(BrowserEngineHostStreamEvent);

const target = { threadId: "thread-1", tabId: "tab-1", serverEpoch: "epoch-1" };
const status = {
  navStatus: { _tag: "Success", url: "http://localhost:5173/", title: "App" },
  canGoBack: true,
  canGoForward: false,
  zoomFactor: 1.25,
  appearance: "dark",
  audioMuted: false,
  audible: true,
  favicon: null,
};

describe("BrowserEngineCommand", () => {
  it("accepts every ordinary page verb", () => {
    for (const command of [
      { _tag: "back" },
      { _tag: "forward" },
      { _tag: "reload" },
      { _tag: "hardReload" },
      { _tag: "zoom", zoomFactor: 1.5 },
      { _tag: "setAppearance", appearance: "light" },
      { _tag: "setAudioMuted", muted: true },
    ]) {
      expect(decodeCommand(command)).toEqual(command);
    }
  });

  it("rejects zoom factors off the fixed ladder and verbs outside the set", () => {
    expect(() => decodeCommand({ _tag: "zoom", zoomFactor: 1.3 })).toThrow();
    expect(() => decodeCommand({ _tag: "navigate", url: "https://example.com" })).toThrow();
    expect(() => decodeCommand({ _tag: "openDevTools" })).toThrow();
  });
});

describe("BrowserEngineHostReportInput", () => {
  it("carries the page status fields", () => {
    const input = {
      hostConnectionId: "host-1",
      target,
      engineGeneration: "42",
      status,
    };
    expect(decodeReport(input)).toEqual(input);
  });

  it("bounds favicon data", () => {
    expect(() =>
      decodeReport({
        hostConnectionId: "host-1",
        target,
        engineGeneration: "42",
        status: {
          ...status,
          favicon: {
            dataUrl: `data:image/png;base64,${"A".repeat(BROWSER_ENGINE_FAVICON_MAX_LENGTH)}`,
            pageUrl: "http://localhost:5173/",
          },
        },
      }),
    ).toThrow();
  });
});

describe("BrowserEngineHostCommandResultInput", () => {
  it("requires a closed rejection reason", () => {
    expect(() =>
      decodeResult({
        hostConnectionId: "host-1",
        commandId: "command-1",
        result: { outcome: "rejected", reason: "Error: boom" },
      }),
    ).toThrow();
    expect(
      decodeResult({
        hostConnectionId: "host-1",
        commandId: "command-1",
        result: { outcome: "rejected", reason: "stale-generation" },
      }).result,
    ).toEqual({ outcome: "rejected", reason: "stale-generation" });
  });
});

describe("BrowserEngineHostStreamEvent", () => {
  it("decodes command frames with their fence", () => {
    const event = {
      type: "command",
      commandId: "command-1",
      target,
      engineGeneration: "42",
      command: { _tag: "reload" },
    };
    expect(decodeStreamEvent(event)).toEqual(event);
  });
});
