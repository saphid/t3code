import { getSchema } from "@tiptap/core";
import { closeHistory, history, redo, redoDepth, undo, undoDepth } from "@tiptap/pm/history";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vite-plus/test";

import {
  createComposerContextHistory,
  updateComposerContextHistory,
} from "./composer-context-history";

const schema = getSchema([StarterKit]);
const ids = (state: EditorState) => new Set(state.doc.textContent.match(/file_\d+/g) ?? []);

function editor() {
  let state = EditorState.create({ schema, plugins: [history()] });
  const contexts = createComposerContextHistory(ids(state));
  let reachable: ReadonlySet<string> = contexts.current;
  const dispatch = (tr: Transaction) => {
    state = state.apply(tr);
    reachable = updateComposerContextHistory(contexts, {
      contextIds: ids(state),
      undoDepth: undoDepth(state),
      redoDepth: redoDepth(state),
    });
  };
  // Compare against documents the real history commands can actually reach.
  const check = () => {
    const expected = new Set(ids(state));
    for (const command of [undo, redo]) {
      let copy = state;
      while (
        command(copy, (tr) => {
          copy = copy.apply(tr);
        })
      ) {
        for (const id of ids(copy)) expected.add(id);
      }
    }
    expect(reachable).toEqual(expected);
  };
  return {
    rewrite(text: string, ownGroup = true) {
      const tr = state.tr.replaceWith(
        0,
        state.doc.content.size,
        schema.node("paragraph", null, text ? [schema.text(text)] : []),
      );
      dispatch(ownGroup ? closeHistory(tr) : tr);
      check();
    },
    undo() {
      undo(state, dispatch);
      check();
    },
    redo() {
      redo(state, dispatch);
      check();
    },
    reachable: () => reachable,
  };
}

describe("composer context history", () => {
  it("releases ids as the real undo history trims old groups", () => {
    const composer = editor();
    for (let index = 0; index < 200; index += 1) {
      composer.rewrite(`file_${index}`);
      composer.rewrite("");
    }
    expect(composer.reachable().has("file_0")).toBe(false);
    expect(composer.reachable().has("file_199")).toBe(true);
  });

  it("keeps redo payloads until the branch is abandoned", () => {
    const composer = editor();
    composer.rewrite("file_1");
    composer.rewrite("");
    composer.undo();
    composer.undo();
    expect(composer.reachable().has("file_1")).toBe(true);
    composer.redo();
    composer.redo();
    composer.undo();
    composer.undo();
    composer.rewrite("new draft");
    expect(composer.reachable().size).toBe(0);
  });

  it("does not retain intermediate documents inside a single undo group", () => {
    const composer = editor();
    composer.rewrite("file_1");
    composer.rewrite("", false);
    expect(composer.reachable().size).toBe(0);
  });

  it("expires a deleted attachment after text-only edits age it out", () => {
    const composer = editor();
    composer.rewrite("file_1");
    composer.rewrite("");
    for (let index = 0; index < 150; index += 1) composer.rewrite(`text ${index}`);
    expect(composer.reachable().size).toBe(0);
  });
});
