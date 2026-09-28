import { type ClientSettings, ClientSettingsSchema } from "@t3tools/contracts";
import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopClientSettings from "../../settings/DesktopClientSettings.ts";
import * as DesktopSnapShot from "../../snapShot/DesktopSnapShot.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const getClientSettings = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_CLIENT_SETTINGS_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(ClientSettingsSchema),
  handler: Effect.fn("desktop.ipc.clientSettings.get")(function* () {
    const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
    return Option.getOrNull(yield* clientSettings.get);
  }),
});

const encodeClientSettings = Schema.encodeSync(ClientSettingsSchema);

/**
 * Each window holds its own copy of the client settings; a save in one is
 * sent to every other, so all of them (and the profile list each publishes
 * to the server) stay on the settings file's current contents. The saving
 * window already has them.
 */
export function broadcastClientSettings(settings: ClientSettings, senderId: number | undefined) {
  const encoded = encodeClientSettings(settings);
  for (const window of Electron.BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.id === senderId) continue;
    window.webContents.send(IpcChannels.CLIENT_SETTINGS_CHANGED_CHANNEL, encoded);
  }
}

export const setClientSettings = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_CLIENT_SETTINGS_CHANNEL,
  payload: ClientSettingsSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.clientSettings.set")(function* (settings, event) {
    const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
    const snapShot = yield* DesktopSnapShot.DesktopSnapShot;
    yield* clientSettings.set(settings);
    yield* snapShot.configure(settings);
    yield* Effect.sync(() => broadcastClientSettings(settings, event?.sender.id));
  }),
});
