import { formatContextSnapshot, readableContextPrompt } from "@t3tools/extension-sdk/context";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $copyNode,
  $getRoot,
  $isElementNode,
  PASTE_COMMAND,
  KEY_BACKSPACE_COMMAND,
  type LexicalEditor,
} from "lexical";
import { act, createRef } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { collapseExpandedComposerCursor, expandCollapsedComposerCursor } from "../composer-logic";
import {
  ComposerPromptEditor,
  ComposerExtensionContextNode,
  type ComposerPromptEditorHandle,
} from "./ComposerPromptEditor";

vi.mock("./chat/FileTagChip", () => ({
  FILE_TAG_CHIP_CLASS_NAME: "",
  FileTagChipContent: () => null,
}));
vi.mock("./chat/ComposerPendingTerminalContexts", () => ({
  ComposerPendingTerminalContextChip: () => null,
}));
vi.mock("./chat/AssistantCitationChip", () => ({ AssistantCitationChip: () => null }));

let lexicalEditor: LexicalEditor;
// Keep the real composer, registered nodes, updates, and snapshot API. Only the
// DOM view is omitted so Lexical runs headlessly in this component test.
vi.mock("@lexical/react/LexicalPlainTextPlugin", () => ({
  PlainTextPlugin: function HeadlessEditor() {
    [lexicalEditor] = useLexicalComposerContext();
    return null;
  },
}));

let renderer: ReactTestRenderer | undefined;
const editorRef = createRef<ComposerPromptEditorHandle>();

function composer(value: string) {
  return (
    <ComposerPromptEditor
      value={value}
      cursor={collapseExpandedComposerCursor(value, value.length)}
      terminalContexts={[]}
      skills={[]}
      disabled={false}
      placeholder="Write a prompt"
      onRemoveTerminalContext={() => {}}
      onChange={() => {}}
      onPaste={() => {}}
      editorRef={editorRef}
    />
  );
}

async function renderPrompt(value: string) {
  await act(() => {
    if (renderer) renderer.update(composer(value));
    else renderer = create(composer(value));
  });
}

function $firstMention() {
  const paragraph = $getRoot().getFirstChildOrThrow();
  if (!$isElementNode(paragraph)) throw new Error("Expected a composer paragraph");
  const mention = paragraph.getFirstChildOrThrow();
  if (mention.getType() !== "composer-mention") throw new Error("Expected a mention");
  return mention;
}

class TestClipboardEvent extends Event {
  readonly clipboardData: DataTransfer;

  constructor(text: string) {
    super("paste", { cancelable: true });
    this.clipboardData = {
      files: [],
      getData: (type: string) => (type === "text/plain" ? text : ""),
    } as unknown as DataTransfer;
  }
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", { activeElement: null });
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("composer mention serialization", () => {
  it.each([
    "@README.md control",
    "@terminal-1:3 Explain this output\n\n<terminal_context>\n- Terminal 1 line 3:\n  3 | output\n</terminal_context>",
    '@"docs/My \\"File\\".md" please',
    '@"docs/雪 👋.md" please',
    "[README.md](README.md) control",
    "[config#draft?.json](config%23draft%3f.json) control",
    "Plain text\n  Keep indentation 👋",
  ])("preserves the initial prompt %s", async (prompt) => {
    await renderPrompt(prompt);
    expect(editorRef.current?.readSnapshot().value).toBe(prompt);
  });

  it("preserves original source when replacing the controlled prompt", async () => {
    for (const prompt of ["", "@README.md control", "Older plain control", "@README.md control"]) {
      await renderPrompt(prompt);
      expect(editorRef.current?.readSnapshot()).toMatchObject({
        value: prompt,
        expandedCursor: prompt.length,
      });
      if (prompt === "@README.md control") {
        expect(lexicalEditor.getEditorState().read(() => $firstMention().isInline())).toBe(true);
      }
    }
  });

  it("preserves source when Lexical clones the mention and reloads exported state", async () => {
    const prompt = '@"docs/雪 👋.md" remains a chip';
    await renderPrompt(prompt);
    const originalKey = lexicalEditor.getEditorState().read(() => $firstMention().getKey());

    await act(() => {
      lexicalEditor.update(
        () => {
          const mention = $firstMention();
          mention.replace($copyNode(mention));
        },
        { discrete: true },
      );
    });
    expect(lexicalEditor.getEditorState().read(() => $firstMention().getKey())).not.toBe(
      originalKey,
    );
    expect(editorRef.current?.readSnapshot().value).toBe(prompt);
    const exportedState = lexicalEditor.getEditorState().toJSON();

    await renderPrompt("");
    await act(() => {
      lexicalEditor.setEditorState(lexicalEditor.parseEditorState(exportedState));
    });
    expect(editorRef.current?.readSnapshot().value).toBe(prompt);
    expect(lexicalEditor.getEditorState().read(() => $firstMention().isInline())).toBe(true);
  });

  it("keeps canonical serialization when importing legacy mention JSON without source", async () => {
    await renderPrompt("");
    await act(() => {
      lexicalEditor.setEditorState(
        lexicalEditor.parseEditorState(
          JSON.stringify({
            root: {
              type: "root",
              version: 1,
              children: [
                {
                  type: "paragraph",
                  version: 1,
                  children: [{ type: "composer-mention", version: 1, path: "README.md" }],
                },
              ],
            },
          }),
        ),
      );
    });
    expect(editorRef.current?.readSnapshot().value).toBe("[README.md](README.md)");
    expect(lexicalEditor.getEditorState().read(() => $firstMention().isInline())).toBe(true);
  });

  it("still serializes a newly inserted mention canonically", async () => {
    vi.stubGlobal("ClipboardEvent", TestClipboardEvent);
    await renderPrompt("");
    const event = new TestClipboardEvent("@README.md ");
    await act(() => {
      lexicalEditor.update(
        () => {
          $getRoot().selectEnd();
          lexicalEditor.dispatchCommand(PASTE_COMMAND, event as ClipboardEvent);
        },
        { discrete: true },
      );
    });
    expect(event.defaultPrevented).toBe(true);
    expect(editorRef.current?.readSnapshot().value).toBe("[README.md](README.md) ");
    expect(lexicalEditor.getEditorState().read(() => $firstMention().isInline())).toBe(true);
  });
});

describe("captured extension context serialization", () => {
  const snapshot = {
    version: 1 as const,
    id: "opaque-fixture-id",
    contributionId: "example.issue-context/select",
    extensionVersion: "1.0.0",
    capturedAt: "2026-09-09T00:00:00.000Z",
    origin: {
      namespace: "t3.composer",
      id: "thread",
      environmentId: "env",
      projectId: "project",
      threadId: "thread",
    },
    title: "Issue snapshot (fixture)",
    sourceUrl: "https://example.com/issues/fixture",
    text: "Unicode 選択 🌈 with @README.md and $skill kept as captured text.",
  };
  const prompt = formatContextSnapshot(snapshot);
  it("shows a core chip while preserving exact source through snapshot, clone, and JSON export/import", async () => {
    await renderPrompt(prompt);
    expect(editorRef.current?.readSnapshot()).toMatchObject({
      value: prompt,
      cursor: 1,
      expandedCursor: prompt.length,
    });
    const exported = lexicalEditor.getEditorState().read(() => {
      const paragraph = $getRoot().getFirstChildOrThrow();
      if (!$isElementNode(paragraph)) throw new Error("Expected paragraph");
      const node = paragraph.getFirstChildOrThrow();
      if (!(node instanceof ComposerExtensionContextNode))
        throw new Error("Expected captured context chip");
      expect((node.decorate().props as { children: string }).children).toBe(snapshot.title);
      return lexicalEditor.getEditorState().toJSON();
    });
    await renderPrompt("");
    await act(() => lexicalEditor.setEditorState(lexicalEditor.parseEditorState(exported)));
    expect(editorRef.current?.readSnapshot().value).toBe(prompt);
    expect(readableContextPrompt(prompt)).toContain(snapshot.text);
    expect(readableContextPrompt(prompt)).not.toContain(snapshot.id);
    expect(readableContextPrompt(prompt)).not.toContain('"origin"');
  });
  it("pastes captured source as a core chip without exposing transport metadata", async () => {
    vi.stubGlobal("ClipboardEvent", TestClipboardEvent);
    await renderPrompt("");
    await act(() => {
      lexicalEditor.update(
        () => {
          const paragraph = $getRoot().getFirstChildOrThrow();
          if (!$isElementNode(paragraph)) throw new Error("Expected paragraph");
          paragraph.selectEnd();
          expect(lexicalEditor.dispatchCommand(PASTE_COMMAND, new TestClipboardEvent(prompt))).toBe(
            true,
          );
        },
        { discrete: true },
      );
    });
    expect(editorRef.current?.readSnapshot().value).toBe(prompt);
    expect(
      lexicalEditor.getEditorState().read(() => {
        const paragraph = $getRoot().getFirstChildOrThrow();
        if (!$isElementNode(paragraph)) throw new Error("Expected paragraph");
        return paragraph.getFirstChildOrThrow().getType();
      }),
    ).toBe("composer-extension-context");
  });
  it("maps collapsed cursor offsets and deletes the whole captured block with native backspace", async () => {
    await renderPrompt(prompt);
    expect(collapseExpandedComposerCursor(prompt, prompt.length)).toBe(1);
    expect(expandCollapsedComposerCursor(prompt, 1)).toBe(prompt.length);
    await act(() => {
      lexicalEditor.update(
        () => {
          const paragraph = $getRoot().getFirstChildOrThrow();
          if (!$isElementNode(paragraph)) throw new Error("Expected paragraph");
          paragraph.selectEnd();
          expect(
            lexicalEditor.dispatchCommand(
              KEY_BACKSPACE_COMMAND,
              new Event("keydown", { cancelable: true }) as KeyboardEvent,
            ),
          ).toBe(true);
        },
        { discrete: true },
      );
    });
    expect(editorRef.current?.readSnapshot().value).toBe("");
  });
});
