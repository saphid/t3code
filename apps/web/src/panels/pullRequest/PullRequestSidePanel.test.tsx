import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import type { ComponentProps } from "react";
import { act } from "react";
import { create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { PullRequestDetailPanel } from "~/components/pullRequest/PullRequestDetailPanel";
import { useRightPanelStore } from "~/rightPanelStore";

import { PanelHostContext, type PanelHost } from "../panelHost";

const rendered = vi.hoisted(() => ({
  detail: [] as ComponentProps<typeof PullRequestDetailPanel>[],
  ghost: 0,
  unavailable: [] as string[],
  pullRequestsByEnvironment: new Map<string, boolean | null>(),
}));
vi.mock("~/components/pullRequest/PullRequestDetailPanel", () => ({
  PullRequestDetailPanel: (props: ComponentProps<typeof PullRequestDetailPanel>) => {
    rendered.detail.push(props);
    return null;
  },
}));
vi.mock("~/components/pullRequest/PullRequestGhosts", () => ({
  PullRequestDetailGhost: () => {
    rendered.ghost += 1;
    return null;
  },
}));
vi.mock("~/components/pullRequest/PullRequestsUnavailableState", () => ({
  PullRequestsUnavailableState: ({ title }: { title: string }) => {
    rendered.unavailable.push(title);
    return null;
  },
}));
vi.mock("~/state/environments", () => ({
  useEnvironment: (environmentId: string) => {
    const pullRequests = rendered.pullRequestsByEnvironment.get(environmentId);
    return pullRequests === undefined || pullRequests === null
      ? null
      : { serverConfig: { environment: { capabilities: { pullRequests } } } };
  },
}));

import PullRequestSidePanel from "./PullRequestSidePanel";

// The same thread id on two environments is two threads.
const threadId = ThreadId.make("thread-a");
const refOn = (environmentId: string): ScopedThreadRef => ({
  environmentId: EnvironmentId.make(environmentId),
  threadId,
});
const hostFor = (threadRef: ScopedThreadRef): PanelHost => ({
  threadRef,
  surfaceId: "pull-request:project:owner%2Frepo:7",
  visible: true,
  composerDraftTarget: threadRef,
  workspaceMutationId: null,
  sendAnnotation: () => undefined,
});
const reference = { projectId: ProjectId.make("project"), repository: "owner/repo", number: 7 };

async function renderFor(threadRef: ScopedThreadRef) {
  await act(async () => {
    create(
      <PanelHostContext value={hostFor(threadRef)}>
        <PullRequestSidePanel
          reference={reference}
          context="thread"
          shortcutsEnabled
          getShortcutContext={() => ({
            terminalFocus: false,
            terminalOpen: false,
            previewFocus: false,
            previewOpen: false,
            isWeb: true,
            isDesktop: false,
          })}
        />
      </PanelHostContext>,
    );
  });
}

beforeEach(() => {
  rendered.detail = [];
  rendered.ghost = 0;
  rendered.unavailable = [];
  rendered.pullRequestsByEnvironment = new Map([
    ["environment-old", false],
    ["environment-new", true],
    ["environment-loading", null],
  ]);
  useRightPanelStore.setState({
    byThreadKey: {},
    threadPanelVisibilityByThreadKey: {},
    userActionRevisionByThreadKey: {},
  });
});

describe("PullRequestSidePanel", () => {
  it("gates on the host environment's capability", async () => {
    await renderFor(refOn("environment-loading"));
    await renderFor(refOn("environment-old"));
    expect(rendered).toMatchObject({ ghost: 1, unavailable: ["Pull requests unavailable"] });
    expect(rendered.detail).toEqual([]);

    const threadRef = refOn("environment-new");
    await renderFor(threadRef);
    expect(rendered.detail.at(-1)).toMatchObject({
      environmentId: threadRef.environmentId,
      threadRef,
      composerDraftTarget: threadRef,
      context: "thread",
      shortcutsEnabled: true,
    });
  });

  it("opens a selected pull request in the host's own thread", async () => {
    const threadRef = refOn("environment-new");
    await renderFor(threadRef);
    rendered.detail.at(-1)?.onSelectPullRequest?.({ ...reference, number: 8 });
    const { byThreadKey } = useRightPanelStore.getState();
    expect(byThreadKey[scopedThreadKey(threadRef)]?.surfaces).toMatchObject([
      { kind: "pull-request", number: 8 },
    ]);
    expect(byThreadKey[scopedThreadKey(refOn("environment-old"))]).toBeUndefined();
  });
});
