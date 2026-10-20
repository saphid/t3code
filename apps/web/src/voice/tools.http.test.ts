import {
  EnvironmentId,
  ORCHESTRATION_PROTOCOL_HEADER,
  ORCHESTRATION_PROTOCOL_VERSION_TEXT,
} from "@t3tools/contracts";
import {
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "@t3tools/client-runtime/connection";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import * as Session from "../state/session";
import { createWebVoiceToolHost } from "./tools";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("voice environment shell discovery", () => {
  it("loads the authenticated shell through the production voice host", async () => {
    const environmentId = EnvironmentId.make("voice-shell-environment");
    const prepared: PreparedConnection = {
      environmentId,
      label: "Voice environment",
      httpBaseUrl: "https://voice.example.test",
      socketUrl: "wss://voice.example.test/ws",
      httpAuthorization: null,
      target: new PrimaryConnectionTarget({
        environmentId,
        label: "Voice environment",
        httpBaseUrl: "https://voice.example.test",
        wsBaseUrl: "wss://voice.example.test/ws",
      }),
    };
    const snapshot = {
      schemaVersion: 1,
      snapshotSequence: 42,
      projects: [],
      threads: [],
      archivedThreads: [],
    };
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), init: init ?? {} });
      return Response.json(snapshot);
    };
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(Session, "readPreparedConnection").mockReturnValue(prepared);

    const access = createWebVoiceToolHost().openEnvironment(environmentId);
    expect(access).not.toBeNull();
    await expect(access!.shellSnapshot()).resolves.toEqual(snapshot);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://voice.example.test/api/orchestration/shell");
    expect(requests[0]!.init.method).toBe("GET");
    expect(requests[0]!.init.credentials).toBe("include");
    expect(new Headers(requests[0]!.init.headers).get(ORCHESTRATION_PROTOCOL_HEADER)).toBe(
      ORCHESTRATION_PROTOCOL_VERSION_TEXT,
    );
  });
});
