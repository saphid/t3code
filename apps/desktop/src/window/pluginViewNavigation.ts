/**
 * Main-process navigation veto for isolated plugin view frames (view proof).
 *
 * A view is an opaque-origin `about:srcdoc` frame. Its own CSP cannot stop it
 * navigating itself, so the main process refuses any navigation of a frame in a
 * view subtree unless the app's main frame started it (mounting a srcdoc,
 * blanking on dispose). Loading `about:srcdoc` stays allowed so a policy wrapper
 * can mount its view.
 */

export interface NavigationFrame {
  readonly url: string;
  readonly origin: string;
  readonly frameToken: string;
  readonly parent: NavigationFrame | null;
}

const isViewDocument = (frame: NavigationFrame) =>
  frame.url === "about:srcdoc" && frame.origin === "null";

export function shouldVetoViewFrameNavigation(input: {
  readonly url: string;
  readonly frame: NavigationFrame | null;
  readonly initiator: NavigationFrame | null | undefined;
  readonly mainFrame: NavigationFrame;
}): boolean {
  let insideView = false;
  for (let frame = input.frame; frame !== null; frame = frame.parent) {
    if (isViewDocument(frame)) insideView = true;
  }
  if (!insideView || input.url === "about:srcdoc") return false;
  return input.initiator?.frameToken !== input.mainFrame.frameToken;
}
