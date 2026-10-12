import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  allowed: true,
  updateSettings: vi.fn(),
  upsertKeybinding: vi.fn(),
  removeKeybinding: vi.fn(),
}));
vi.mock("../../env", () => ({ isElectron: false }));
vi.mock("../../state/session", () => ({ readEnvironmentScope: () => state.allowed }));
vi.mock("../../state/entities", () => ({ useProjects: () => [] }));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    updateSettings: "updateSettings",
    upsertKeybinding: "upsertKeybinding",
    removeKeybinding: "removeKeybinding",
  },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: "updateSettings" | "upsertKeybinding" | "removeKeybinding") =>
    state[command],
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: vi.fn() } }));

import { useProjectScriptSettings } from "./useProjectScriptSettings";

const environmentId = EnvironmentId.make("remote");
const command = "script.check.run" as const;
const previous: ResolvedKeybindingsConfig = [
  {
    command,
    shortcut: {
      key: "j",
      modKey: true,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    },
  },
];
let renderer: ReactTestRenderer | undefined;
let actions: ReturnType<typeof useProjectScriptSettings>;
function Harness({ bindings }: { bindings: ResolvedKeybindingsConfig }) {
  const settings = useProjectScriptSettings([
    {
      environmentId,
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        defaultProjectScripts: [
          {
            id: "check",
            name: "Check",
            command: "echo check",
            icon: "play",
            runOnWorktreeCreate: false,
          },
        ],
      },
      keybindings: bindings,
    },
  ]);
  useEffect(() => {
    actions = settings;
  }, [settings]);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.allowed = true;
  for (const fn of [state.updateSettings, state.upsertKeybinding, state.removeKeybinding])
    fn.mockResolvedValue(AsyncResult.success(undefined));
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});
it.each([
  ["add", [], "mod+k"],
  ["replace", previous, "mod+k"],
  ["clear", previous, null],
] as const)("saves browser shortcut changes: %s", async (kind, bindings, keybinding) => {
  await act(() => {
    renderer = create(<Harness bindings={bindings} />);
  });
  await act(async () => {
    const result = await actions.persist((current) => current, "check", keybinding);
    expect(result._tag).toBe("Success");
  });
  expect(state.updateSettings).toHaveBeenCalledOnce();
  if (kind === "clear") {
    expect(state.removeKeybinding).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { key: "mod+j", command },
    });
    expect(state.upsertKeybinding).not.toHaveBeenCalled();
  } else {
    expect(state.upsertKeybinding).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: {
        key: "mod+k",
        command,
        ...(kind === "replace" ? { replace: { key: "mod+j", command } } : {}),
      },
    });
    expect(state.removeKeybinding).not.toHaveBeenCalled();
  }
});
it("rejects browser shortcut changes without settings write access", async () => {
  state.allowed = false;
  await act(() => {
    renderer = create(<Harness bindings={[]} />);
  });
  await act(async () => {
    expect((await actions.persist((current) => current, "check", "mod+k"))._tag).toBe("Failure");
  });
  expect(state.updateSettings).not.toHaveBeenCalled();
  expect(state.upsertKeybinding).not.toHaveBeenCalled();
  expect(state.removeKeybinding).not.toHaveBeenCalled();
});
