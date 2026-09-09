import { useId, useState, type KeyboardEvent } from "react";
import { PanelBottomCloseIcon, XIcon } from "lucide-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Button } from "../components/ui/button";
import { usePanelAnimationSettings, usePanelPresence } from "../panelAnimations";
import {
  selectThreadExtensionDock,
  useRightPanelStore,
  type ExtensionDockState,
} from "../rightPanelStore";
import { WorkspaceExtensionSurface, useWorkspaceSurfaceTitles } from "./workspaceRegistry";

export function GenericExtensionDock({ threadRef }: { threadRef: ScopedThreadRef }) {
  const dock = useRightPanelStore((state) =>
    selectThreadExtensionDock(state.extensionDockByThreadKey, threadRef),
  );
  return dock.surfaces.length ? (
    <ThreadExtensionDock key={scopedThreadKey(threadRef)} threadRef={threadRef} dock={dock} />
  ) : null;
}

function ThreadExtensionDock({
  threadRef,
  dock,
}: {
  threadRef: ScopedThreadRef;
  dock: ExtensionDockState;
}) {
  const scope = scopedThreadKey(threadRef);
  const titles = useWorkspaceSurfaceTitles(threadRef.environmentId);
  const panelId = useId();
  const selected = dock.surfaces.find((surface) => surface.id === dock.activeSurfaceId);
  const [retained, setRetained] = useState(dock.isOpen ? selected : undefined);
  // A hidden selection cannot activate a cold factory. Only retain a still-open viewer.
  if (dock.isOpen && retained !== selected) setRetained(selected);
  const rendered = dock.isOpen
    ? selected
    : dock.surfaces.find(
        (surface) =>
          surface.id === retained?.id && surface.viewerGeneration === retained.viewerGeneration,
      );
  const animations = usePanelAnimationSettings();
  const presence = usePanelPresence(
    dock.isOpen,
    true,
    animations.active,
    scope,
    animations.durationMs,
  );
  const selectedIndex = dock.surfaces.findIndex((surface) => surface.id === dock.activeSurfaceId);
  const activate = (index: number) => {
    const surface = dock.surfaces[index];
    if (surface) useRightPanelStore.getState().activateDockExtension(threadRef, surface.id);
  };
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % dock.surfaces.length;
    else if (event.key === "ArrowLeft")
      next = (index + dock.surfaces.length - 1) % dock.surfaces.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = dock.surfaces.length - 1;
    else return;
    event.preventDefault();
    activate(next);
    const tabs = event.currentTarget
      .closest('[role="tablist"]')
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[next]?.focus();
  };
  return (
    <aside
      aria-label="Extension dock"
      aria-hidden={!dock.isOpen}
      inert={!dock.isOpen}
      hidden={!presence.present}
      className="flex min-h-0 min-w-0 shrink flex-col overflow-hidden border-t border-border/80 bg-background"
      style={{
        display: presence.present ? undefined : "none",
        height: dock.isOpen ? "min(16rem, 25vh)" : 0,
        maxHeight: "25%",
        transition: animations.active ? `height ${animations.durationMs}ms ease-out` : "none",
      }}
    >
      <div className="flex min-w-0 shrink-0 items-center gap-1 border-b border-border/60 px-1">
        <div
          role="tablist"
          aria-label="Extension dock views"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        >
          {dock.surfaces.map((surface, index) => {
            const title = titles.get(surface.record.surfaceId) ?? surface.record.fallback;
            const active = surface.id === selected?.id;
            return (
              <div key={surface.id} className="flex shrink-0 items-center">
                <Button
                  id={`${panelId}-tab-${index}`}
                  role="tab"
                  aria-selected={active}
                  aria-controls={panelId}
                  tabIndex={active ? 0 : -1}
                  variant={active ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => activate(index)}
                  onKeyDown={(event) => moveFocus(event, index)}
                >
                  {title}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Close ${title}`}
                  onClick={() =>
                    useRightPanelStore.getState().closeDockExtension(threadRef, surface.id)
                  }
                >
                  <XIcon className="size-3" />
                </Button>
              </div>
            );
          })}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Hide extension dock"
          onClick={() => useRightPanelStore.getState().hideExtensionDock(threadRef)}
        >
          <PanelBottomCloseIcon className="size-4" />
        </Button>
      </div>
      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={`${panelId}-tab-${selectedIndex}`}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        {rendered ? (
          <WorkspaceExtensionSurface
            key={JSON.stringify([scope, "bottom-dock", rendered.id, rendered.viewerGeneration])}
            record={rendered.record}
            visible={dock.isOpen}
            onRecordChange={(record) =>
              useRightPanelStore
                .getState()
                .updateExtensionRecord(threadRef, record, rendered.viewerGeneration)
            }
          />
        ) : null}
      </div>
    </aside>
  );
}
