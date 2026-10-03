import { useEffect, useRef, useState } from "react";

import { usePrimaryEnvironmentId } from "~/state/environments";

import { type ProofRow, runViewProof } from "./runViewProof";
import type { ViewNavigationPolicy } from "./viewDocument";

/** Dev-only harness: `/view-proof?root=<absolute payload directory on the environment host>&nav=none|wrapper`. */
export function ViewProofPage({
  root,
  navigationPolicy,
}: {
  readonly root: string | null;
  readonly navigationPolicy: ViewNavigationPolicy;
}) {
  const environmentId = usePrimaryEnvironmentId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<ReadonlyArray<ProofRow>>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (environmentId === null || container === null || root === null) return;
    const run = runViewProof({ environmentId, root, navigationPolicy, container, onRows: setRows });
    return run.dispose;
  }, [environmentId, root, navigationPolicy]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-4 text-sm">
      <h1 className="font-semibold">
        Isolated plugin view proof (navigation policy: {navigationPolicy})
      </h1>
      {root === null ? <p>Missing ?root= payload directory.</p> : null}
      <div ref={containerRef} className="grid grid-cols-4 gap-2" />
      <table className="w-full text-left" data-testid="view-proof-results">
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              data-outcome={row.outcome}
              className="border-t border-border align-top"
            >
              <td className="pr-2">{row.view}</td>
              <td className="pr-2">{row.name}</td>
              <td className={row.outcome === "LEAKED" ? "pr-2 font-bold text-destructive" : "pr-2"}>
                {row.outcome}
              </td>
              <td className="break-all text-muted-foreground">{row.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
