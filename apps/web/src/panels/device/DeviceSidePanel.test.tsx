import {
  EnvironmentId,
  ThreadId,
  type DeviceServiceState,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { create } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import type { RightPanelSurface } from "~/rightPanelStore";

import { PanelHostContext, type PanelHost } from "../panelHost";
import DeviceSidePanel from "./DeviceSidePanel";

type OpenResult =
  | { _tag: "Success"; value: { hostId: string; deviceId: string } }
  | { _tag: "Failure"; cause: unknown };
const mocks = vi.hoisted(() => ({
  open: vi.fn<(request: unknown) => Promise<OpenResult>>(),
  openDevice: vi.fn(),
}));
const deviceState: DeviceServiceState = {
  hosts: [
    {
      id: "local",
      kind: "local",
      label: "This Mac",
      platforms: [{ platform: "ios", available: true }],
      hubInstalled: true,
      agentDeviceInstalled: true,
    },
  ],
  hostStatus: "ready",
  hostStatuses: { local: { status: "ready" } },
  devices: [
    {
      hostId: "local",
      id: "phone",
      name: "Phone",
      platform: "ios",
      version: "iOS 19",
      booted: false,
      physical: false,
    },
  ],
  sessions: [],
  onboardingCompleted: true,
  agentAccessEnabled: true,
  hubBasePath: "/api/device-hub",
  revision: 1,
};
vi.mock("~/state/device", () => ({
  deviceEnvironment: { list: "list", open: "open", close: "close" },
  useDeviceState: () => ({ state: deviceState, loaded: true }),
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: string) =>
    command === "open" ? mocks.open : () => Promise.resolve({ _tag: "Success", value: {} }),
}));
vi.mock("~/rightPanelStore", () => ({
  useRightPanelStore: { getState: () => ({ openDevice: mocks.openDevice }) },
}));
vi.mock("~/components/device/DeviceHostUpdates", () => ({ DeviceHostUpdates: () => null }));
vi.mock("~/components/device/DeviceLoadingView", () => ({ DeviceLoadingView: () => null }));
vi.mock("~/components/device/DeviceWorkspace", () => ({ DeviceWorkspace: () => null }));
vi.mock("~/components/preview/PreviewPanelShell", () => ({
  PreviewPanelShell: ({ children }: { children: ReactNode }) => children,
}));

const hostFor = (threadRef: ScopedThreadRef): PanelHost => ({
  threadRef,
  surfaceId: "device",
  visible: true,
  composerDraftTarget: threadRef,
  workspaceMutationId: null,
  sendAnnotation: () => undefined,
});
const surface: Extract<RightPanelSurface, { kind: "device" }> = { id: "device", kind: "device" };

describe("DeviceSidePanel", () => {
  it("opens a picked device in the picking thread after the host moves on", async () => {
    let settle!: (result: OpenResult) => void;
    mocks.open.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    // Same thread id in another environment: the picker surface id collides,
    // so the panel stays mounted across the switch.
    const picking = {
      environmentId: EnvironmentId.make("environment-a"),
      threadId: ThreadId.make("thread-1"),
    };
    const next = { environmentId: EnvironmentId.make("environment-b"), threadId: picking.threadId };
    const render = (threadRef: ScopedThreadRef) => (
      <PanelHostContext value={hostFor(threadRef)}>
        <DeviceSidePanel key={surface.id} surface={surface} onDismissSetup={() => undefined} />
      </PanelHostContext>
    );
    const renderer = await act(async () => create(render(picking)));

    await act(async () => {
      renderer.root.findByProps({ "aria-label": "Start Phone" }).props.onClick();
    });
    expect(mocks.open).toHaveBeenCalledWith({
      environmentId: picking.environmentId,
      input: { threadId: picking.threadId, hostId: "local", deviceId: "phone", platform: "ios" },
    });

    await act(async () => renderer.update(render(next)));
    await act(async () => {
      settle({ _tag: "Success", value: { hostId: "local", deviceId: "phone" } });
    });
    expect(mocks.openDevice).toHaveBeenCalledExactlyOnceWith(picking, {
      hostId: "local",
      deviceId: "phone",
      platform: "ios",
      name: "Phone",
    });
  });
});
