/**
 * Pure view-model for the Browser panel skeleton (P08-A). Owns the
 * panel-local navigation state machine and the requested-targets history the
 * chrome row renders (inventory rows #4/#5/#7/#24 in
 * docs/internals/extensions/browser-binding-disposition.md).
 *
 * No browser engine is reachable through public SDK contracts yet, so an
 * accepted target is recorded — never presented as a loaded page. The
 * history stack keeps real browser traversal semantics (submitting drops
 * forward entries) so the model is ready to drive `t3.browser/sessions`
 * when the parent's shared prerequisites land.
 */
import { normalizePreviewUrl } from "@t3tools/shared/preview";

/** The normalized target the user asked for, or the rejection reason. */
export type NavigationStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "rejected"; readonly input: string; readonly message: string }
  | { readonly kind: "target"; readonly url: string };

export interface NavigationState {
  /** Accepted normalized targets in visit order; index points at the current one. */
  readonly history: readonly string[];
  readonly index: number;
  /**
   * Bumped on every accepted submit/reload so a re-request of the current
   * target is observable even though nothing about the URL changed.
   */
  readonly epoch: number;
  readonly status: NavigationStatus;
}

export const initialNavigationState: NavigationState = {
  history: [],
  index: -1,
  epoch: 0,
  status: { kind: "idle" },
};

export type AddressResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly message: string };

/**
 * The exact normalization the native panel runs (its PreviewView submits
 * through `@t3tools/shared/preview` `normalizePreviewUrl`): bare loopback → http,
 * bare host → https, http(s) only, `PreviewUrlNormalizationError` → a plain
 * message.
 */
export function normalizeAddress(raw: string): AddressResult {
  try {
    return { ok: true, url: normalizePreviewUrl(raw) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Address could not be parsed",
    };
  }
}

/**
 * Record a requested target. Invalid input becomes a named rejection and
 * never enters history; a valid URL truncates any forward entries and
 * becomes the current target — the same stack semantics the engine's
 * history would enforce.
 */
export function submitAddress(state: NavigationState, raw: string): NavigationState {
  const result = normalizeAddress(raw);
  if (!result.ok) {
    return {
      ...state,
      status: { kind: "rejected", input: raw, message: result.message },
    };
  }
  const history = [...state.history.slice(0, state.index + 1), result.url];
  return {
    history,
    index: history.length - 1,
    epoch: state.epoch + 1,
    status: { kind: "target", url: result.url },
  };
}

export function canGoBack(state: NavigationState): boolean {
  return state.index > 0;
}

export function canGoForward(state: NavigationState): boolean {
  return state.index >= 0 && state.index < state.history.length - 1;
}

export function goBack(state: NavigationState): NavigationState {
  if (!canGoBack(state)) return state;
  const index = state.index - 1;
  return { ...state, index, status: { kind: "target", url: state.history[index]! } };
}

export function goForward(state: NavigationState): NavigationState {
  if (!canGoForward(state)) return state;
  const index = state.index + 1;
  return { ...state, index, status: { kind: "target", url: state.history[index]! } };
}

/** Re-request the current target; idle/rejected states have nothing to reload. */
export function reload(state: NavigationState): NavigationState {
  if (state.status.kind !== "target") return state;
  return { ...state, epoch: state.epoch + 1 };
}

/** Current target's URL, or null when the panel has none. */
export function currentUrl(state: NavigationState): string | null {
  return state.index >= 0 ? (state.history[state.index] ?? null) : null;
}

/** Requested targets, most recent first — the skeleton's honest history list. */
export function recentTargets(state: NavigationState): readonly string[] {
  return state.history.toReversed();
}

/** Why the webview area shows no page — the deferred contract, named. */
export const ENGINE_UNAVAILABLE_NOTICE =
  "No page is rendered: the native browser engine is not reachable through public SDK contracts yet (t3.browser/sessions and the engine attachment are still pending — binding table rows #2/#5).";

/** Status line for the current navigation state. */
export function describeStatus(state: NavigationState): string {
  switch (state.status.kind) {
    case "idle":
      return "Enter an address — nothing requested yet";
    case "rejected":
      return `Rejected “${state.status.input}” — ${state.status.message}`;
    case "target":
      return `Recorded target ${state.status.url} (request ${state.epoch}) — awaiting the public browser engine`;
  }
}

/**
 * Browser-previewable workspace files — same rule as the native
 * `isBrowserPreviewFile` (the native openFileInPreview module, line 32).
 * Package-owned so the presentation provider and the view agree.
 */
export function isBrowserPreviewFile(path: string): boolean {
  return /\.(?:html?|pdf)$/i.test(path.split(/[?#]/, 1)[0] ?? "");
}
