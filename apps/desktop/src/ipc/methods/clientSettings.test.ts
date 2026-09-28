import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { expect, vi } from "vite-plus/test";

const windows = vi.hoisted(() =>
  [1, 2, 3].map((id) => ({
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    webContents: { id, send: vi.fn() },
  })),
);
vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => windows } }));

import * as DesktopClientSettings from "../../settings/DesktopClientSettings.ts";
import * as DesktopSnapShot from "../../snapShot/DesktopSnapShot.ts";
import { CLIENT_SETTINGS_CHANGED_CHANNEL } from "../channels.ts";
import { setClientSettings } from "./clientSettings.ts";

it.effect("a save in one window reaches every other open window, after it is written", () => {
  const written: unknown[] = [];
  windows[2]!.destroyed = true;
  const settings = {
    ...DEFAULT_CLIENT_SETTINGS,
    browserProfiles: [{ id: "work", name: "Client work", kind: "persistent" as const }],
  };
  return Effect.gen(function* () {
    yield* setClientSettings.handler(settings, { sender: { id: 1 } });
    expect(written).toEqual([settings]);
    // The saving window already has them; a closed one gets nothing.
    expect(windows[0]!.webContents.send).not.toHaveBeenCalled();
    expect(windows[1]!.webContents.send).toHaveBeenCalledWith(
      CLIENT_SETTINGS_CHANGED_CHANNEL,
      settings,
    );
    expect(windows[2]!.webContents.send).not.toHaveBeenCalled();
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(DesktopClientSettings.DesktopClientSettings, {
          set: (value: unknown) => Effect.sync(() => void written.push(value)),
        } as unknown as DesktopClientSettings.DesktopClientSettings["Service"]),
        Layer.succeed(DesktopSnapShot.DesktopSnapShot, {
          configure: () => Effect.void,
        } as unknown as DesktopSnapShot.DesktopSnapShot["Service"]),
      ),
    ),
  );
});
