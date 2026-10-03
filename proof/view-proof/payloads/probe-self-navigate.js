// Navigates its own frame to a document the host never verified.
(async () => {
  const { port } = await window.t3View.port;
  port.postMessage({ type: "navigating" });
  setTimeout(() => location.replace("about:blank"), 50);
})();
