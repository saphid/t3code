import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Button } from "~/components/ui/button";

import { PanelErrorBoundary } from "./PanelErrorBoundary";

const fault = { active: false };
const events: string[] = [];

function Body({ name }: { name: string }) {
  if (fault.active) throw new Error(`${name} crashed`);
  useEffect(() => {
    events.push(`mount ${name}`);
    return () => {
      events.push(`dispose ${name}`);
    };
  }, [name]);
  return null;
}

function ChatViewSibling() {
  useEffect(() => {
    events.push("mount chat");
    return () => {
      events.push("dispose chat");
    };
  }, []);
  return null;
}

function tree(resourceKey: string) {
  return (
    <>
      <ChatViewSibling />
      <PanelErrorBoundary resourceKey={resourceKey} title="Diff">
        <Body name={resourceKey} />
      </PanelErrorBoundary>
    </>
  );
}

afterEach(() => {
  fault.active = false;
  events.length = 0;
  vi.restoreAllMocks();
});

describe("PanelErrorBoundary", () => {
  it("contains a crash, then recovers on retry or when the scoped resource changes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(tree("env-a:thread-1:diff:diff"));
    });
    expect(events).toEqual(["mount chat", "mount env-a:thread-1:diff:diff"]);

    // A crash on the same resource shows the fallback and leaves the chat view mounted.
    fault.active = true;
    await act(async () => {
      renderer.update(tree("env-a:thread-1:diff:diff"));
    });
    expect(events.at(-1)).toBe("dispose env-a:thread-1:diff:diff");
    expect(events).not.toContain("dispose chat");

    // Retry while still faulty stays contained; retry after the fault clears remounts.
    await act(async () => {
      renderer.root.findByType(Button).props.onClick();
    });
    expect(renderer.root.findAllByType(Button)).toHaveLength(1);
    fault.active = false;
    await act(async () => {
      renderer.root.findByType(Button).props.onClick();
    });
    expect(events.at(-1)).toBe("mount env-a:thread-1:diff:diff");

    // The same thread id in another environment is a different resource and resets on its own.
    fault.active = true;
    await act(async () => {
      renderer.update(tree("env-a:thread-1:diff:diff"));
    });
    fault.active = false;
    await act(async () => {
      renderer.update(tree("env-b:thread-1:diff:diff"));
    });
    expect(events.at(-1)).toBe("mount env-b:thread-1:diff:diff");
    expect(events).not.toContain("dispose chat");
  });
});
