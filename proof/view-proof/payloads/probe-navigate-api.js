// Navigates its own frame to an authenticated GET endpoint. CSP does not govern
// navigation, so the request may carry the app's cookie; the host must tear down.
(async () => {
  const { port, init } = await window.t3View.port;
  port.postMessage({ type: "navigating" });
  setTimeout(() => location.assign(init.serverOrigin + "/api/projects?frame-navigation=1"), 50);
})();
