import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { act, Suspense } from "react";
import { create } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

const loaded = vi.hoisted(() => ({ diff: 0, preview: 0, previewProps: [] as unknown[] }));
vi.mock("./diff/DiffSidePanel", () => {
  loaded.diff += 1;
  return { default: () => null };
});
vi.mock("./preview/PreviewSidePanel", () => {
  loaded.preview += 1;
  return {
    default: (props: unknown) => {
      loaded.previewProps.push(props);
      return null;
    },
  };
});

import { RegisteredSidePanel } from "./bundledPanels";

const threadRef: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment-a"),
  threadId: ThreadId.make("thread-a"),
};

describe("bundled side panels", () => {
  it("loads only the selected panel body", async () => {
    expect(loaded).toMatchObject({ diff: 0, preview: 0 });
    await act(async () => {
      create(
        <Suspense fallback={null}>
          <RegisteredSidePanel id="preview" threadRef={threadRef} tabId="tab-1" visible />
        </Suspense>,
      );
    });
    expect(loaded).toMatchObject({ diff: 0, preview: 1 });
    expect(loaded.previewProps).toEqual([{ threadRef, tabId: "tab-1", visible: true }]);
  });
});

// Never called. The project typecheck compiles these pairings, and each
// expect-error directive fails it if a wrong pairing starts to compile.
export function typeFixtures(widenedId: "diff" | "preview") {
  return (
    <>
      <RegisteredSidePanel id="diff" composerDraftTarget={threadRef} workspaceMutationId={null} />
      <RegisteredSidePanel
        id="preview"
        threadRef={threadRef}
        visible
        onSendAnnotation={(annotation, image) => [annotation.comment, image?.id]}
      />
      {/* @ts-expect-error Preview props on Diff. */}
      <RegisteredSidePanel id="diff" threadRef={threadRef} visible />
      <RegisteredSidePanel
        id="preview"
        // @ts-expect-error Diff props on Preview.
        composerDraftTarget={threadRef}
        workspaceMutationId={null}
      />
      {/* @ts-expect-error Missing required threadRef. */}
      <RegisteredSidePanel id="preview" visible />
      <RegisteredSidePanel
        id="preview"
        threadRef={threadRef}
        visible
        // @ts-expect-error Wrong callback input shape.
        onSendAnnotation={(annotation: string) => annotation}
      />
      {/* @ts-expect-error Unknown id. */}
      <RegisteredSidePanel id="terminal" threadRef={threadRef} visible />
      {/* @ts-expect-error A widened id cannot borrow one panel's props. */}
      <RegisteredSidePanel
        id={widenedId}
        composerDraftTarget={threadRef}
        workspaceMutationId={null}
      />
    </>
  );
}
