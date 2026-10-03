import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type PreviewAnnotationPayload } from "@t3tools/contracts";
import { act } from "react";
import { create } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import { useScopedAnnotationSender, type PanelHost } from "./panelHost";

// Same thread id in two environments, so only the environment tells them apart.
const threadA = scopedThreadKey({
  environmentId: EnvironmentId.make("environment-a"),
  threadId: ThreadId.make("shared-thread"),
});
const threadB = scopedThreadKey({
  environmentId: EnvironmentId.make("environment-b"),
  threadId: ThreadId.make("shared-thread"),
});

const annotation: PreviewAnnotationPayload = {
  id: "annotation-1",
  pageUrl: "http://localhost:3000/",
  pageTitle: null,
  comment: "Make this bigger",
  elements: [],
  regions: [],
  strokes: [],
  styleChanges: [],
  screenshot: null,
  createdAt: "2026-10-03T00:00:00.000Z",
};

type Send = Parameters<typeof useScopedAnnotationSender>[1];

function renderHost(threadKey: string, send: Send) {
  const lent: PanelHost["sendAnnotation"][] = [];
  function Host(props: { threadKey: string; send: Send }) {
    lent.push(useScopedAnnotationSender(props.threadKey, props.send));
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Host threadKey={threadKey} send={send} />);
  });
  return {
    lent,
    rerender: (nextThreadKey: string, nextSend: Send) =>
      act(() => renderer.update(<Host threadKey={nextThreadKey} send={nextSend} />)),
    unmount: () => act(() => renderer.unmount()),
  };
}

// Mirrors PreviewView: the picker keeps the callback it started with and
// calls it once the desktop pick settles.
function startPick(sendAnnotation: PanelHost["sendAnnotation"]) {
  let resolve!: (picked: PreviewAnnotationPayload) => void;
  const settled = new Promise<PreviewAnnotationPayload>((settle) => {
    resolve = settle;
  }).then((picked) => sendAnnotation(picked, null));
  return { settle: (picked: PreviewAnnotationPayload) => (resolve(picked), settled) };
}

describe("useScopedAnnotationSender", () => {
  it("sends through the latest composer send of the same thread", async () => {
    const firstSend = vi.fn<Send>();
    const latestSend = vi.fn<Send>();
    const host = renderHost(threadA, firstSend);
    const pick = startPick(host.lent[0]!);

    host.rerender(threadA, latestSend);
    await pick.settle(annotation);

    expect(host.lent[1]).toBe(host.lent[0]);
    expect(firstSend).not.toHaveBeenCalled();
    expect(latestSend.mock.calls).toEqual([
      [undefined, "auto", "foreground", { annotation, image: null }],
    ]);
  });

  it("drops a pick that settles after moving to a colliding thread in another environment", async () => {
    const sendA = vi.fn<Send>();
    const sendB = vi.fn<Send>();
    const host = renderHost(threadA, sendA);
    const pick = startPick(host.lent[0]!);

    host.rerender(threadB, sendB);
    await pick.settle(annotation);

    expect(sendA).not.toHaveBeenCalled();
    expect(sendB).not.toHaveBeenCalled();

    // Thread B's own panel still sends through B.
    host.lent.at(-1)!(annotation, null);
    expect(sendB.mock.calls).toEqual([
      [undefined, "auto", "foreground", { annotation, image: null }],
    ]);
    expect(sendA).not.toHaveBeenCalled();
  });

  it("drops a pick that settles after leaving and returning to the thread", async () => {
    const sendA = vi.fn<Send>();
    const sendB = vi.fn<Send>();
    const sendAAgain = vi.fn<Send>();
    const host = renderHost(threadA, sendA);
    const pick = startPick(host.lent[0]!);

    host.rerender(threadB, sendB);
    host.rerender(threadA, sendAAgain);
    await pick.settle(annotation);

    expect(sendA).not.toHaveBeenCalled();
    expect(sendB).not.toHaveBeenCalled();
    expect(sendAAgain).not.toHaveBeenCalled();

    // A pick started on the return visit still sends through thread A.
    const returnPick = startPick(host.lent.at(-1)!);
    await returnPick.settle(annotation);
    expect(sendAAgain.mock.calls).toEqual([
      [undefined, "auto", "foreground", { annotation, image: null }],
    ]);
    expect(sendA).not.toHaveBeenCalled();
    expect(sendB).not.toHaveBeenCalled();
  });

  it("drops a pick that settles after the host unmounts", async () => {
    const send = vi.fn<Send>();
    const host = renderHost(threadA, send);
    const pick = startPick(host.lent[0]!);

    host.unmount();
    await pick.settle(annotation);

    expect(send).not.toHaveBeenCalled();
  });
});
