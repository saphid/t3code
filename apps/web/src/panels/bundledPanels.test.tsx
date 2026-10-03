import { EnvironmentId, ProjectId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { act, Suspense } from "react";
import { create } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

const loaded = vi.hoisted(() => ({
  diff: 0,
  preview: 0,
  pullRequest: 0,
  pullRequests: 0,
  previewRenders: [] as unknown[],
}));
vi.mock("./diff/DiffSidePanel", () => {
  loaded.diff += 1;
  return { default: () => null };
});
vi.mock("./preview/PreviewSidePanel", () => {
  loaded.preview += 1;
  return {
    default: function PreviewSidePanel(props: unknown) {
      loaded.previewRenders.push({ props, host: usePanelHost() });
      return null;
    },
  };
});

vi.mock("./pullRequest/PullRequestSidePanel", () => {
  loaded.pullRequest += 1;
  return { default: () => null };
});
vi.mock("./pullRequest/PullRequestsSidePanel", () => {
  loaded.pullRequests += 1;
  return { default: () => null };
});

import { RegisteredSidePanel } from "./bundledPanels";
import { PanelHostContext, usePanelHost, type PanelHost } from "./panelHost";

const threadRef: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment-a"),
  threadId: ThreadId.make("thread-a"),
};
const host: PanelHost = {
  threadRef,
  surfaceId: "preview:1",
  visible: true,
  composerDraftTarget: threadRef,
  workspaceMutationId: null,
  sendAnnotation: () => undefined,
};

describe("bundled side panels", () => {
  it("loads only the selected panel body and lends it the host", async () => {
    expect(loaded).toMatchObject({ diff: 0, preview: 0, pullRequest: 0, pullRequests: 0 });
    await act(async () => {
      create(
        <PanelHostContext value={host}>
          <Suspense fallback={null}>
            <RegisteredSidePanel id="preview" tabId="tab-1" />
          </Suspense>
        </PanelHostContext>,
      );
    });
    expect(loaded).toMatchObject({ diff: 0, preview: 1, pullRequest: 0, pullRequests: 0 });
    expect(loaded.previewRenders).toEqual([{ props: { tabId: "tab-1" }, host }]);
  });
});

// Never called. The project typecheck compiles these pairings, and each
// expect-error directive fails it if a wrong pairing starts to compile.
export function typeFixtures(widenedId: "diff" | "preview") {
  const reference = { projectId: ProjectId.make("project"), repository: "owner/repo", number: 7 };
  const pullRequest = {
    reference,
    context: "thread" as const,
    shortcutsEnabled: true,
    getShortcutContext: () => ({
      terminalFocus: false,
      terminalOpen: false,
      previewFocus: false,
      previewOpen: false,
      isWeb: true,
      isDesktop: false,
    }),
  };
  return (
    <>
      <RegisteredSidePanel id="diff" />
      <RegisteredSidePanel id="preview" tabId="tab-1" configuredUrls={["http://localhost:3000"]} />
      <RegisteredSidePanel id="pull-request" {...pullRequest} onBack={undefined} />
      <RegisteredSidePanel id="pull-requests" />
      {/* @ts-expect-error Pull request detail needs its reference and shortcut inputs. */}
      <RegisteredSidePanel id="pull-request" context="thread" />
      {/* @ts-expect-error Pull request props on the linked list. */}
      <RegisteredSidePanel id="pull-requests" reference={reference} />
      {/* @ts-expect-error Pull request props on Preview. */}
      <RegisteredSidePanel id="preview" shortcutsEnabled />
      {/* @ts-expect-error The host owns the composer draft target. */}
      <RegisteredSidePanel id="pull-request" {...pullRequest} composerDraftTarget={threadRef} />
      {/* @ts-expect-error Preview props on Diff. */}
      <RegisteredSidePanel id="diff" tabId="tab-1" />
      {/* @ts-expect-error The host owns the thread; panels do not take it as a prop. */}
      <RegisteredSidePanel id="preview" threadRef={threadRef} />
      {/* @ts-expect-error Wrong input shape. */}
      <RegisteredSidePanel id="preview" configuredUrls="http://localhost:3000" />
      {/* @ts-expect-error Unknown id. */}
      <RegisteredSidePanel id="terminal" />
      {/* @ts-expect-error A widened id cannot borrow one panel's props. */}
      <RegisteredSidePanel id={widenedId} tabId="tab-1" />
    </>
  );
}
