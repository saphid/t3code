import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useLayoutEffect, useState, StrictMode, Activity } from "react";
import { describe, expect, it } from "vite-plus/test";
import type { ViewRecord } from "@t3tools/extension-sdk/contracts";
import { createNativeSurfaceBridge } from "./nativeBridge";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const record: ViewRecord = {
  version: 1,
  surfaceId: "test.native/view",
  stateVersion: 1,
  placement: "side-panel",
  restoreState: null,
  fallback: "Missing native view",
  context: {
    client: "web",
    resource: {
      namespace: "test.resource",
      id: "one",
      environmentId: "env",
      projectId: "project",
      threadId: "thread",
    },
  },
};
describe("native surface bridge", () => {
  it.each([true, false])(
    "reconnects Activity effects without addressing a disposed host (visible=%s)",
    async (visible) => {
      let created = 0;
      let disposed = 0;
      const bridge = createNativeSurfaceBridge(() => ({
        manifest: {
          id: "test.native",
          apiVersion: 1,
          version: "1.0.0",
          surfaces: [
            {
              id: "test.native/view",
              title: "Activity view",
              placements: ["side-panel"],
              clients: ["web"],
              scope: "thread",
              capabilities: [],
              stateVersion: 1,
            },
          ],
        },
        surfaces: [
          {
            id: "test.native/view",
            validateRestore: (state) => state === null,
            createView(session) {
              expect(session.restoring).toBe(true);
              const generation = ++created;
              return {
                renderer: () => <span>ready {generation}</span>,
                dispose() {
                  disposed++;
                },
              };
            },
          },
        ],
      }));
      let root!: ReactTestRenderer;
      const render = (mode: "visible" | "hidden") => (
        <Activity mode={mode}>
          <bridge.Surface bindings={null} record={record} visible={visible} />
        </Activity>
      );
      try {
        await act(async () => {
          root = create(render("visible"));
        });
        expect(root.root.findByType("span").children.join("")).toBe("ready 1");
        await act(async () => {
          root.update(render("hidden"));
        });
        expect(disposed).toBe(1);
        await act(async () => {
          root.update(render("visible"));
        });
        expect(root.root.findByType("span").children.join("")).toBe("ready 2");
        expect(created).toBe(2);
        expect(disposed).toBe(1);
        await act(async () => {
          root.update(render("hidden"));
        });
        await act(async () => {
          root.update(render("visible"));
        });
        expect(root.root.findByType("span").children.join("")).toBe("ready 3");
        expect(created).toBe(3);
        expect(disposed).toBe(2);
      } finally {
        await act(async () => {
          root?.unmount();
        });
      }
      expect(disposed).toBe(created);
    },
  );

  it("saves outgoing layout cleanup through its own record generation", async () => {
    const savedA: ViewRecord[] = [];
    const savedB: ViewRecord[] = [];
    const bridge = createNativeSurfaceBridge(() => ({
      manifest: {
        id: "test.native",
        apiVersion: 1,
        version: "1.0.0",
        surfaces: [
          {
            id: "test.native/view",
            title: "Test",
            placements: ["side-panel"],
            clients: ["web"],
            scope: "thread",
            capabilities: [],
            stateVersion: 1,
          },
        ],
      },
      surfaces: [
        {
          id: "test.native/view",
          validateRestore: () => true,
          createView: (session) => ({
            renderer: function SaveOnUnmount() {
              useLayoutEffect(
                () => () => {
                  session.save({ resource: session.context.resource.id });
                },
                [],
              );
              return <span>{session.context.resource.id}</span>;
            },
          }),
        },
      ],
    }));
    const nextRecord: ViewRecord = {
      ...record,
      context: {
        ...record.context,
        resource: { ...record.context.resource, id: "two", threadId: "other" },
      },
    };
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(
        <bridge.Surface
          bindings={null}
          record={record}
          visible
          onRecordChange={(next) => savedA.push(next)}
        />,
      );
    });
    await act(async () => {
      root.update(
        <bridge.Surface
          bindings={null}
          record={nextRecord}
          visible
          onRecordChange={(next) => savedB.push(next)}
        />,
      );
    });
    expect(savedA).toHaveLength(1);
    expect(savedA[0]?.context.resource.id).toBe("one");
    expect(savedA[0]?.restoreState).toEqual({ resource: "one" });
    expect(savedB).toEqual([]);
    await act(async () => {
      root.unmount();
    });
    expect(savedB).toHaveLength(1);
    expect(savedB[0]?.context.resource.id).toBe("two");
    expect(savedB[0]?.restoreState).toEqual({ resource: "two" });
  });
  it("keeps state and fresh bindings while hidden, and disposes on scoped replacement", async () => {
    let created = 0;
    let disposed = 0;
    const bridge = createNativeSurfaceBridge((useBindings: () => { label: string }) => ({
      manifest: {
        id: "test.native",
        apiVersion: 1,
        version: "1.0.0",
        surfaces: [
          {
            id: "test.native/view",
            title: "Test",
            placements: ["side-panel"],
            clients: ["web"],
            scope: "thread",
            capabilities: [],
            stateVersion: 1,
          },
        ],
      },
      surfaces: [
        {
          id: "test.native/view",
          validateRestore: (state) => state === null,
          createView(session) {
            expect(session.restoring).toBe(true);
            created++;
            return {
              dispose() {
                disposed++;
              },
              renderer: function Counter() {
                const { label } = useBindings();
                const [count, setCount] = useState(0);
                return (
                  <button onClick={() => setCount(count + 1)}>
                    {label}:{count}
                  </button>
                );
              },
            };
          },
        },
      ],
    }));
    let root!: ReactTestRenderer;
    const render = (label: string, visible: boolean, resource = record) => (
      <bridge.Surface bindings={{ label }} record={resource} visible={visible} />
    );
    await act(async () => {
      root = create(render("first", true));
    });
    await act(async () => {
      root.root.findByType("button").props.onClick();
    });
    await act(async () => {
      root.update(render("second", false));
    });
    expect(root.root.findByType("button").children.join("")).toBe("second:1");
    expect(root.root.findAllByType("div").some((node) => node.props.hidden === true)).toBe(true);
    await act(async () => {
      root.update(render("third", true));
    });
    expect(root.root.findByType("button").children.join("")).toBe("third:1");
    await act(async () => {
      root.update(
        <bridge.Surface
          bindings={{ label: "exit" }}
          record={record}
          visible={false}
          retainHiddenPresentation
        />,
      );
    });
    expect(root.root.findByType("button").children.join("")).toBe("exit:1");
    const exitWrapper = root.root.findAllByType("div").find((node) => node.props.inert);
    expect(exitWrapper?.props.hidden).toBe(false);
    expect(exitWrapper?.props["aria-hidden"]).toBe(true);
    expect(created).toBe(1);
    expect(disposed).toBe(0);
    await act(async () => {
      root.update(
        render("new", true, {
          ...record,
          context: {
            ...record.context,
            resource: { ...record.context.resource, environmentId: "other" },
          },
        }),
      );
    });
    expect(root.root.findByType("button").children.join("")).toBe("new:0");
    expect(created).toBe(2);
    expect(disposed).toBe(1);
    await act(async () => {
      root.unmount();
    });
    expect(disposed).toBe(2);
  });
  it("survives StrictMode effect replay without publishing a disposed host", async () => {
    let disposed = 0;
    const bridge = createNativeSurfaceBridge(() => ({
      manifest: {
        id: "test.native",
        apiVersion: 1,
        version: "1.0.0",
        surfaces: [
          {
            id: "test.native/view",
            title: "Test",
            placements: ["side-panel"],
            clients: ["web"],
            scope: "thread",
            capabilities: [],
            stateVersion: 1,
          },
        ],
      },
      surfaces: [
        {
          id: "test.native/view",
          validateRestore: () => true,
          createView: () => ({
            renderer: () => <span>ready</span>,
            dispose: () => {
              disposed++;
            },
          }),
        },
      ],
    }));
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(
        <StrictMode>
          <bridge.Surface bindings={null} record={record} visible />
        </StrictMode>,
      );
    });
    expect(root.root.findByType("span").children).toEqual(["ready"]);
    await act(async () => {
      root.unmount();
    });
    expect(disposed).toBeGreaterThanOrEqual(1);
  });
});
