import type { ClientProviderCaller } from "@t3tools/contracts";
import type { MobileThemeId, MobileThemeMode } from "../../lib/mobileTheme";

export interface MobileThemePreferencePatch {
  readonly themeId?: MobileThemeId;
  readonly lightThemeId?: MobileThemeId;
  readonly darkThemeId?: MobileThemeId;
  readonly themeMode?: MobileThemeMode;
}

export interface MobileExtensionThemeOwner extends ClientProviderCaller {
  readonly environmentId: string;
  readonly projectId?: string;
}

export interface MobileExtensionThemeOverlay {
  readonly owner: MobileExtensionThemeOwner;
  readonly patch: MobileThemePreferencePatch;
}

function sameOwner(a: MobileExtensionThemeOwner, b: MobileExtensionThemeOwner) {
  return (
    a.environmentId === b.environmentId &&
    a.installationId === b.installationId &&
    a.contentHash === b.contentHash &&
    a.installationGeneration === b.installationGeneration
  );
}

/** The device paints one theme. Stale environment teardown cannot clear a newer writer's preview. */
export function createMobileExtensionThemeOverlayStore() {
  let snapshot: MobileExtensionThemeOverlay | null = null;
  const listeners = new Set<() => void>();
  const publish = () => {
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next: MobileExtensionThemeOverlay) => {
      snapshot = next;
      publish();
    },
    clear: (owner?: MobileExtensionThemeOwner) => {
      if (!snapshot || (owner && !sameOwner(snapshot.owner, owner))) return;
      snapshot = null;
      publish();
    },
  };
}

export const mobileExtensionThemeOverlayStore = createMobileExtensionThemeOverlayStore();
