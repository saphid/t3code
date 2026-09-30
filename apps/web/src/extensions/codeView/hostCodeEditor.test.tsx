import type { FileContents, SelectedLineRange, EditorState } from "@pierre/diffs";
import type { FileProps } from "@pierre/diffs/react";
import type { CodeViewEditorProps } from "@t3tools/extension-sdk/environment";
import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  files: [] as FileProps<undefined>[],
  editors: [] as {
    change: (contents: string) => void;
    file: FileContents | undefined;
    cleanUp: ReturnType<typeof vi.fn>;
    blur: ReturnType<typeof vi.fn>;
    getState: () => EditorState;
  }[],
}));
vi.mock("~/hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: (select: (settings: { wordWrap: boolean }) => unknown) =>
    select({ wordWrap: true }),
}));
vi.mock("~/components/DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@pierre/diffs/editor", () => ({
  Editor: class {
    file: FileContents | undefined;
    cleanUp = vi.fn();
    blur = vi.fn();
    setSelections = vi.fn();
    getState = vi.fn(() => ({
      selections: [
        { start: { line: 0, character: 0 }, end: { line: 1, character: 2 }, direction: 1 as const },
      ],
    }));
    constructor(readonly options: { onChange: (file: FileContents) => void }) {
      state.editors.push(this);
    }
    change = (contents: string) => {
      this.file = { name: "app.ts", contents, cacheKey: "live-edit" };
      this.options.onChange(this.file);
    };
    getFile() {
      return this.file;
    }
  },
}));
vi.mock("@pierre/diffs/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@pierre/diffs/react")>()),
  EditProvider: ({ children }: { children: ReactNode }) => children,
  Virtualizer: ({ children }: { children: ReactNode }) => children,
  File: (props: FileProps<undefined>) => {
    state.files.push(props);
    return null;
  },
}));

import { HostCodeEditor } from "./HostCodeViewRenderers";

let renderer: ReactTestRenderer | undefined;
const props = (): CodeViewEditorProps => ({
  documentId: "env:project:app.ts",
  path: "app.ts",
  contents: "one\ntwo\n",
  onChange: vi.fn(),
  onSave: vi.fn(),
  onSelectionChange: vi.fn(),
});
beforeEach(() => {
  state.files = [];
  state.editors = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it("retains the editor, its edit cache and native rendering options through buffer echoes", async () => {
  const initial = props();
  await act(async () => {
    renderer = create(<HostCodeEditor {...initial} />);
  });
  const original = state.editors[0]!;
  await act(async () => original.change("edited"));
  expect(initial.onChange).toHaveBeenCalledWith("edited");
  const updated = { ...initial, contents: "edited", onChange: vi.fn() };
  await act(async () => renderer!.update(<HostCodeEditor {...updated} />));
  expect(state.editors).toHaveLength(1);
  expect(state.files.at(-1)?.file.cacheKey).toBe("live-edit");
  expect(state.files.at(-1)?.contentEditable).toBe(true);
  expect(state.files.at(-1)?.options).toMatchObject({
    disableFileHeader: true,
    overflow: "wrap",
    themeType: "dark",
  });
  await act(async () => original.change("next edit"));
  expect(updated.onChange).toHaveBeenCalledWith("next edit");
  await act(async () =>
    renderer!.update(<HostCodeEditor {...updated} documentId="other:app.ts" />),
  );
  expect(original.cleanUp).toHaveBeenCalledOnce();
  expect(state.editors).toHaveLength(2);
});

it("flushes save without a native write and delivers normalized line selections", async () => {
  const initial = props();
  await act(async () => {
    renderer = create(<HostCodeEditor {...initial} />);
  });
  const surface = renderer!.root.findByProps({ "aria-label": "File editor" });
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  surface.props.onKeyDown({
    key: "s",
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    preventDefault,
    stopPropagation,
  });
  expect(initial.onSave).toHaveBeenCalledOnce();
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(stopPropagation).toHaveBeenCalledOnce();
  const onSelection = state.files.at(-1)!.options!.onLineSelectionChange!;
  await act(async () => onSelection({ start: 2, end: 1 } as SelectedLineRange));
  expect(initial.onSelectionChange).toHaveBeenCalledWith({ startLine: 1, endLine: 2 });
  surface.props.onKeyUp();
  expect(initial.onSelectionChange).toHaveBeenLastCalledWith({ startLine: 1, endLine: 2 });
  surface.props.onKeyDown({ key: "Escape", preventDefault, stopPropagation });
  expect(state.editors[0]!.blur).toHaveBeenCalledOnce();
});

it("supports Ctrl+S while leaving Alt-modified shortcuts alone", async () => {
  const initial = props();
  await act(async () => {
    renderer = create(<HostCodeEditor {...initial} />);
  });
  const surface = renderer!.root.findByProps({ "aria-label": "File editor" });
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  const event = {
    key: "S",
    metaKey: false,
    ctrlKey: true,
    altKey: false,
    preventDefault,
    stopPropagation,
  };
  surface.props.onKeyDown(event);
  surface.props.onKeyDown({ ...event, altKey: true });
  expect(initial.onSave).toHaveBeenCalledOnce();
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(stopPropagation).toHaveBeenCalledOnce();
});

it("excludes an untouched last line and preserves gutter selections through empty cursors", async () => {
  const initial = props();
  await act(async () => {
    renderer = create(<HostCodeEditor {...initial} />);
  });
  const surface = renderer!.root.findByProps({ "aria-label": "File editor" });
  const selectionState = vi.spyOn(state.editors[0]!, "getState");
  selectionState.mockReturnValue({
    selections: [
      { start: { line: 2, character: 0 }, end: { line: 0, character: 1 }, direction: -1 },
    ],
  });
  surface.props.onPointerUp();
  expect(initial.onSelectionChange).toHaveBeenLastCalledWith({ startLine: 1, endLine: 2 });
  selectionState.mockReturnValue({
    selections: [
      { start: { line: 1, character: 0 }, end: { line: 1, character: 0 }, direction: 1 },
    ],
  });
  surface.props.onKeyUp();
  expect(initial.onSelectionChange).toHaveBeenLastCalledWith(null);
  const onSelection = state.files.at(-1)!.options!.onLineSelectionChange!;
  await act(async () => onSelection({ start: 3, end: 2 } as SelectedLineRange));
  surface.props.onPointerUp();
  expect(initial.onSelectionChange).toHaveBeenLastCalledWith({ startLine: 2, endLine: 3 });
  await act(async () => onSelection(null));
  surface.props.onKeyUp();
  expect(initial.onSelectionChange).toHaveBeenLastCalledWith(null);
});
