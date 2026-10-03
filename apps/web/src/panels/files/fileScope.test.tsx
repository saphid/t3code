import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { create } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import type { ChatComposerHandle } from "~/components/chat/ChatComposer";
import type { AddToChatResult } from "~/components/files/FileBrowserPanel";
import { ComposerHandleContext, type ComposerHandleRef } from "~/composerHandleContext";

import { useScopedComposerInsert, useScopeLifetime } from "./fileScope";

// Same thread id in two environments, so only the environment tells them apart.
const threadA = scopedThreadKey({
  environmentId: EnvironmentId.make("environment-a"),
  threadId: ThreadId.make("shared-thread"),
});
const threadB = scopedThreadKey({
  environmentId: EnvironmentId.make("environment-b"),
  threadId: ThreadId.make("shared-thread"),
});
const otherThreadA = scopedThreadKey({
  environmentId: EnvironmentId.make("environment-a"),
  threadId: ThreadId.make("other-thread"),
});

function fakeComposer() {
  const insertTextAtEnd = vi.fn<ChatComposerHandle["insertTextAtEnd"]>(() => true);
  return { insertTextAtEnd, handle: { insertTextAtEnd } as unknown as ChatComposerHandle };
}

// The chat layout owns one composer ref; navigation swaps the composer behind it
// in the same commit that gives the Files panel its new scope.
function renderFiles(scopeKey: string, composer: ChatComposerHandle) {
  const composerRef: ComposerHandleRef = { current: composer };
  const lent: ((text: string) => AddToChatResult)[] = [];
  function Body(props: { scopeKey: string }) {
    lent.push(useScopedComposerInsert(useScopeLifetime(props.scopeKey)));
    return null;
  }
  const layout = (key: string) => (
    <ComposerHandleContext value={composerRef}>
      <Body scopeKey={key} />
    </ComposerHandleContext>
  );
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(layout(scopeKey));
  });
  return {
    lent,
    navigate: (nextScopeKey: string, nextComposer: ChatComposerHandle) =>
      act(() => {
        composerRef.current = nextComposer;
        renderer.update(layout(nextScopeKey));
      }),
    unmount: () => act(() => renderer.unmount()),
  };
}

// Mirrors the tree's context menu: the action captured when the menu opened
// runs once the native menu settles.
function openMenu(addToChat: (text: string) => AddToChatResult) {
  let choose!: (clicked: string) => void;
  const settled = new Promise<string>((resolve) => {
    choose = resolve;
  }).then((clicked) => (clicked === "add-to-chat" ? addToChat("@src/a.ts ") : null));
  return { choose: (clicked: string) => (choose(clicked), settled) };
}

describe("Files add to chat", () => {
  it("inserts into the composer of the thread the menu opened in", async () => {
    const composerA = fakeComposer();
    const files = renderFiles(threadA, composerA.handle);
    const menu = openMenu(files.lent.at(-1)!);

    await expect(menu.choose("add-to-chat")).resolves.toBe("inserted");

    expect(composerA.insertTextAtEnd).toHaveBeenCalledExactlyOnceWith("@src/a.ts ", {
      ensureLeadingBoundary: true,
    });
  });

  it("drops a late action after moving to the same thread id in another environment", async () => {
    const composerA = fakeComposer();
    const composerB = fakeComposer();
    const files = renderFiles(threadA, composerA.handle);
    const menu = openMenu(files.lent.at(-1)!);

    files.navigate(threadB, composerB.handle);

    await expect(menu.choose("add-to-chat")).resolves.toBe("dropped");
    expect(composerA.insertTextAtEnd).not.toHaveBeenCalled();
    expect(composerB.insertTextAtEnd).not.toHaveBeenCalled();

    // B's own menu still reaches B.
    await expect(openMenu(files.lent.at(-1)!).choose("add-to-chat")).resolves.toBe("inserted");
    expect(composerB.insertTextAtEnd).toHaveBeenCalledOnce();
  });

  it("drops a late action after moving to another thread or closing the panel", async () => {
    const composerA = fakeComposer();
    const composerOther = fakeComposer();
    const files = renderFiles(threadA, composerA.handle);
    const beforeNavigation = openMenu(files.lent.at(-1)!);

    files.navigate(otherThreadA, composerOther.handle);
    await expect(beforeNavigation.choose("add-to-chat")).resolves.toBe("dropped");

    const beforeClose = openMenu(files.lent.at(-1)!);
    files.unmount();
    await expect(beforeClose.choose("add-to-chat")).resolves.toBe("dropped");

    expect(composerA.insertTextAtEnd).not.toHaveBeenCalled();
    expect(composerOther.insertTextAtEnd).not.toHaveBeenCalled();
  });

  it("keeps a late action dropped after leaving and returning to the thread", async () => {
    const composerA = fakeComposer();
    const composerOther = fakeComposer();
    const files = renderFiles(threadA, composerA.handle);
    const menu = openMenu(files.lent.at(-1)!);

    files.navigate(otherThreadA, composerOther.handle);
    files.navigate(threadA, composerA.handle);

    await expect(menu.choose("add-to-chat")).resolves.toBe("dropped");
    expect(composerA.insertTextAtEnd).not.toHaveBeenCalled();
    expect(composerOther.insertTextAtEnd).not.toHaveBeenCalled();

    // A menu opened on the return visit still reaches A.
    await expect(openMenu(files.lent.at(-1)!).choose("add-to-chat")).resolves.toBe("inserted");
    expect(composerA.insertTextAtEnd).toHaveBeenCalledOnce();
  });

  it("keeps the action across re-renders within the same thread", async () => {
    const composerA = fakeComposer();
    const files = renderFiles(threadA, composerA.handle);
    const menu = openMenu(files.lent.at(-1)!);

    files.navigate(threadA, composerA.handle);

    await expect(menu.choose("add-to-chat")).resolves.toBe("inserted");
    expect(composerA.insertTextAtEnd).toHaveBeenCalledOnce();
  });
});
