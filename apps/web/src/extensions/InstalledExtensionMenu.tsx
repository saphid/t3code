import { installedSurfaceRecord } from "./installedContext";
import { useState } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import { Button } from "../components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { useRightPanelStore } from "../rightPanelStore";
import { useInstalledExtensions } from "./installedEnvironment";

export function InstalledExtensionMenu({
  threadRef,
  context,
}: {
  threadRef: ScopedThreadRef;
  context: ViewContext;
}) {
  const snapshot = useInstalledExtensions(threadRef.environmentId);
  const [error, setError] = useState<string | null>(null);
  const surfaces = snapshot.installations
    .filter(
      (item) =>
        item.enabled && item.grants.projectIds.some((id) => id === context.resource.projectId),
    )
    .flatMap((item) =>
      item.package.manifest.surfaces
        .filter((surface) => surface.clients.includes(context.client))
        .flatMap((surface) =>
          surface.placements
            .filter((placement) => placement === "side-panel" || placement === "bottom-dock")
            .map((placement) => ({ item, surface, placement })),
        ),
    );
  if (!surfaces.length) return null;
  return (
    <Menu>
      <MenuTrigger render={<Button variant="ghost" size="sm" />}>Extensions</MenuTrigger>
      <MenuPopup align="end">
        {surfaces.map(({ item, surface, placement }) => (
          <MenuItem
            key={surface.id + placement}
            onClick={() => {
              const record = installedSurfaceRecord(item.id, surface, placement, context);
              try {
                if (!useRightPanelStore.getState().openExtension(threadRef, record))
                  throw new Error("Could not open extension in this workspace");
                setError(null);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Extension unavailable");
              }
            }}
          >
            Open {surface.title} · {placement === "side-panel" ? "Side panel" : "Bottom dock"}
          </MenuItem>
        ))}
        {error ? (
          <p role="alert" className="max-w-64 px-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
