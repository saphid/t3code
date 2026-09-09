import { useEffect, useRef, useState } from "react";
import type { Extension } from "@t3tools/extension-sdk/host";
import type { SurfaceRenderer } from "@t3tools/extension-sdk/react";
import type { Json } from "@t3tools/extension-sdk/contracts";

const capability = "t3.workspace/read-text";
function savedPath(state: Json): string | null {
  return state !== null &&
    !Array.isArray(state) &&
    typeof state === "object" &&
    Object.keys(state).length === 1 &&
    "relativePath" in state &&
    typeof state.relativePath === "string"
    ? state.relativePath
    : null;
}

/** Community package: only React and public SDK exports; no native bindings or app imports. */
export const workspaceReader: Extension<SurfaceRenderer> = {
  manifest: {
    id: "example.workspace-reader",
    apiVersion: 1,
    version: "1.0.0",
    surfaces: [
      {
        id: "example.workspace-reader/view",
        title: "Workspace text",
        scope: "project",
        clients: ["web"],
        placements: ["side-panel", "bottom-dock"],
        capabilities: [capability],
        stateVersion: 1,
      },
    ],
  },
  surfaces: [
    {
      id: "example.workspace-reader/view",
      validateRestore: (state) => state === null || savedPath(state) !== null,
      createView(session) {
        return {
          renderer: function WorkspaceReader() {
            const [path, setPath] = useState(savedPath(session.restoreState) ?? "README.md");
            const [contents, setContents] = useState("");
            const [status, setStatus] = useState("Choose a workspace file");
            const request = useRef(0);
            useEffect(() => {
              const stop = session.onVisibility((visible) => {
                request.current++;
                if (visible) setStatus("Ready to read");
              });
              return () => {
                request.current++;
                stop();
              };
            }, []);
            async function read() {
              const current = ++request.current;
              session.save({ relativePath: path });
              setContents("");
              setStatus("Reading");
              try {
                const value = await session.invoke(capability, { relativePath: path });
                if (current !== request.current || session.signal.aborted || !session.visible)
                  return;
                if (
                  !value ||
                  typeof value !== "object" ||
                  Array.isArray(value) ||
                  !("contents" in value) ||
                  !("truncated" in value) ||
                  typeof value.contents !== "string" ||
                  typeof value.truncated !== "boolean"
                )
                  throw new Error("Invalid workspace text response");
                setContents(value.contents);
                setStatus(value.truncated ? "Read complete (truncated)" : "Read complete");
              } catch (error) {
                if (current === request.current && !session.signal.aborted && session.visible)
                  setStatus(error instanceof Error ? error.message : "Read failed");
              }
            }
            return (
              <section aria-label="Workspace text reader">
                <label>
                  Workspace-relative path
                  <input
                    value={path}
                    onChange={(event) => {
                      request.current++;
                      setPath(event.target.value);
                      setContents("");
                      setStatus("Ready to read");
                    }}
                  />
                </label>
                <button onClick={() => void read()}>Read file</button>
                <p role="status">{status}</p>
                <pre>{contents}</pre>
              </section>
            );
          },
        };
      },
    },
  ],
};
