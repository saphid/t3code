import type { DraftId } from "./composerDraftStore";

const DEFAULT_MAX_PENDING_HANDOVERS = 8;

export interface PendingHandover {
  readonly handover: string;
  readonly draftId?: DraftId;
}

export interface PendingHandoverStore {
  readonly get: (sourceThreadKey: string) => PendingHandover | undefined;
  readonly has: (sourceThreadKey: string) => boolean;
  readonly save: (sourceThreadKey: string, handover: PendingHandover) => void;
  readonly delete: (sourceThreadKey: string) => void;
  readonly size: () => number;
}

export function createPendingHandoverStore(
  maxEntries = DEFAULT_MAX_PENDING_HANDOVERS,
): PendingHandoverStore {
  const entries = new Map<string, PendingHandover>();

  return {
    get: (sourceThreadKey) => entries.get(sourceThreadKey),
    has: (sourceThreadKey) => entries.has(sourceThreadKey),
    save: (sourceThreadKey, handover) => {
      entries.delete(sourceThreadKey);
      entries.set(sourceThreadKey, handover);
      while (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey === undefined) break;
        entries.delete(oldestKey);
      }
    },
    delete: (sourceThreadKey) => {
      entries.delete(sourceThreadKey);
    },
    size: () => entries.size,
  };
}
