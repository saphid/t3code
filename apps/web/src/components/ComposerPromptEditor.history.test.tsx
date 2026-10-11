// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import type { ComposerFileAttachment } from "../composerDraftStore";
import {
  clearRetainedAttachmentContextPayloads,
  forgetLiveAttachmentContextPayloads,
  reconcileAttachmentContextReferences,
  pruneRetainedAttachmentContextPayloads,
} from "./chat/composerContextUndo";
import { ComposerPromptEditor, type ComposerPromptEditorHandle } from "./ComposerPromptEditor";

it.each([false, true])(
  "keeps valid attachment undo/redo and releases history on an A-to-B switch (rich=%s)",
  async (richTextEnabled) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const editorRef = createRef<ComposerPromptEditorHandle>();
    const file = {
      type: "file",
      id: "history-file",
      name: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
      file: new File(["notes"], "notes.txt"),
    } satisfies ComposerFileAttachment;
    let files: ComposerFileAttachment[] = [file];
    const retained = {
      files: new Map<string, ComposerFileAttachment>(),
      previewAnnotations: new Map(),
    };
    const render = (historyScope: string, value: string) =>
      root.render(
        <ComposerPromptEditor
          historyScope={historyScope}
          richTextEnabled={richTextEnabled}
          value={value}
          cursor={0}
          contextRecords={new Map()}
          skills={[]}
          disabled={false}
          placeholder="Draft"
          onPaste={() => {}}
          editorRef={editorRef}
          onUndoHistoryReset={() => {
            clearRetainedAttachmentContextPayloads(retained);
          }}
          onUndoableContextIdsChange={(ids) => {
            pruneRetainedAttachmentContextPayloads(retained, ids);
          }}
          onChange={(_value, _cursor, _expanded, _adjacent, contextIds) => {
            const changes = reconcileAttachmentContextReferences({
              referencedContextIds: new Set(contextIds),
              files,
              images: [],
              previewAnnotations: [],
              retained,
              undoableContextIds: editorRef.current?.readUndoableContextIds(),
            });
            files = [
              ...files.filter((file) => !changes.filesToRemove.includes(file.id)),
              ...changes.filesToRestore,
            ];
            forgetLiveAttachmentContextPayloads(retained, files, []);
          }}
        />,
      );
    const editor = () =>
      (
        container.querySelector("[data-testid='composer-editor']") as HTMLElement & {
          editor: Editor;
        }
      ).editor;
    try {
      await act(async () => render("A", "[notes.txt](t3-context://v1/file/file_history-file)"));
      const oldEditor = editor();
      await act(async () => {
        oldEditor.commands.clearContent();
      });
      expect(files).toEqual([]);
      expect(retained.files.size).toBe(1);
      await act(async () => {
        oldEditor.commands.undo();
      });
      expect(files[0]?.file).toBe(file.file);
      expect(retained.files.size).toBe(0);
      await act(async () => {
        oldEditor.commands.redo();
      });
      expect(files).toEqual([]);
      expect(retained.files.size).toBe(1);
      const largeFiles = ["large-a", "large-b"].map((id) => ({
        ...file,
        id,
        file: new File([new Uint8Array(40 * 1024 * 1024)], `${id}.txt`),
        sizeBytes: 40 * 1024 * 1024,
      }));
      files = largeFiles;
      const largePrompt = largeFiles
        .map((file) => `[${file.name}](t3-context://v1/file/file_${file.id})`)
        .join(" ");
      await act(async () => render("A", `Keep this paragraph ${largePrompt}`));
      // Undoing a large picker insertion must leave both payloads redoable.
      await act(async () => {
        expect(oldEditor.commands.undo()).toBe(true);
      });
      expect(files).toEqual([]);
      expect(retained.files.has("file_large-a")).toBe(true);
      expect(retained.files.has("file_large-b")).toBe(true);
      await act(async () => {
        expect(oldEditor.commands.redo()).toBe(true);
      });
      expect(files.map((file) => file.file)).toEqual(largeFiles.map((file) => file.file));
      await act(async () => {
        oldEditor.commands.clearContent();
      });
      // Text/selection changes after a large deletion must preserve that deletion.
      await act(async () => {
        oldEditor.commands.insertContent("N");
      });
      await act(async () => {
        oldEditor.commands.setTextSelection(1);
      });
      await act(async () => {
        expect(oldEditor.commands.undo()).toBe(true);
      });
      expect(retained.files.has("file_large-a")).toBe(true);
      expect(retained.files.has("file_large-b")).toBe(true);
      expect(files).toEqual([]);
      await act(async () => {
        expect(oldEditor.commands.undo()).toBe(true);
      });
      expect(files.map((file) => file.file)).toEqual(largeFiles.map((file) => file.file));
      expect(oldEditor.getText()).toContain("Keep this paragraph");
      await act(async () => {
        expect(oldEditor.commands.redo()).toBe(true);
      });
      files = [file];
      await act(async () => render("A", "[notes.txt](t3-context://v1/file/file_history-file)"));
      await act(async () => {
        oldEditor.commands.clearContent();
      });
      expect(retained.files.get("file_history-file")).toBe(file);
      await act(async () => {
        oldEditor.view.focus();
      });
      expect(document.activeElement).toBe(oldEditor.view.dom);
      await act(async () => render("B", ""));
      expect(editor()).toBe(oldEditor);
      expect(document.activeElement).toBe(oldEditor.view.dom);
      expect(retained.files.size).toBe(0);
      expect(editor().commands.undo()).toBe(false);
      expect(editor().isEmpty).toBe(true);
      // Exercise the real editor's bounded history, with one sample per deletion.
      let peakBytes = 0;
      for (let index = 0; index < 200; index++) {
        const payload = new File([new Uint8Array(1024 * 1024)], `cycle-${index}.txt`);
        files = [{ ...file, id: `cycle-${index}`, file: payload, sizeBytes: payload.size }];
        await act(async () => render("B", `[file](t3-context://v1/file/file_cycle-${index})`));
        await act(async () => {
          editor().commands.clearContent();
        });
        const bytes = [...retained.files.values()].reduce((sum, file) => sum + file.file!.size, 0);
        peakBytes = Math.max(peakBytes, bytes);
      }
      expect(peakBytes).toBeLessThan(100 * 1024 * 1024);
      expect(retained.files.has("file_cycle-0")).toBe(false);
      await act(async () => {
        expect(editor().commands.undo()).toBe(true);
      });
      expect(files[0]?.file?.size).toBe(1024 * 1024);
      await act(async () => {
        expect(editor().commands.redo()).toBe(true);
      });
      expect(files).toEqual([]);
      oldEditor.view.dom.blur();
      files = [file];
      await act(async () =>
        render("C", "```\n[notes.txt](t3-context://v1/file/file_history-file)\n```"),
      );
      await act(async () => {
        editor().commands.clearContent();
      });
      expect(retained.files.size).toBe(1);
      await act(async () => {
        editor().commands.undo();
      });
      expect(files[0]?.file).toBe(file.file);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  },
);

it.each([false, true])(
  "a rejected restore lets the next undo reach older text (rich=%s)",
  async (richTextEnabled) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const editorRef = createRef<ComposerPromptEditorHandle>();
    let rejectRestores = false;
    let rejections = 0;
    let savedPrompt = "original";
    const render = (value: string, cursor = 0) =>
      root.render(
        <ComposerPromptEditor
          historyScope="rejection"
          richTextEnabled={richTextEnabled}
          value={value}
          cursor={cursor}
          contextRecords={new Map()}
          skills={[]}
          disabled={false}
          placeholder="Draft"
          onPaste={() => {}}
          editorRef={editorRef}
          onChange={(value, cursor, _expanded, _adjacent, ids) => {
            if (rejectRestores && ids.includes("file_rejected")) {
              rejections++;
              editorRef.current?.removeContextReferences(["file_rejected"]);
              const corrected = editorRef.current!.readSnapshot();
              savedPrompt = corrected.value;
              render(corrected.value, corrected.cursor);
            } else {
              savedPrompt = value;
              render(value, cursor);
            }
          }}
        />,
      );
    try {
      await act(async () => render("original"));
      const editor = (
        container.querySelector("[data-testid='composer-editor']") as HTMLElement & {
          editor: Editor;
        }
      ).editor;
      await act(async () => {
        editor.commands.setTextSelection(9);
        editor.commands.insertContent(" typed");
      });
      await act(async () => render("original typed [file](t3-context://v1/file/file_rejected)"));
      await act(async () => {
        let position = 0;
        editor.state.doc.descendants((node, pos) => {
          if (node.attrs.contextId === "file_rejected") position = pos;
        });
        editor.commands.deleteRange({ from: position, to: position + 1 });
      });
      rejectRestores = true;
      await act(async () => {
        expect(editor.commands.undo()).toBe(true);
      });
      expect(rejections).toBe(1);
      expect(savedPrompt).not.toContain("t3-context:");
      await act(async () => {
        expect(editor.commands.undo()).toBe(true);
      });
      expect(rejections).toBe(1);
      await act(async () => {
        expect(editor.commands.undo()).toBe(true);
      });
      expect(savedPrompt).toBe("original");
      expect(rejections).toBe(1);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  },
);
