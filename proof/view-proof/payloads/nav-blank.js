// Navigates its own frame to about:blank, then reports if the verified document survived.
(async () => {
  const target = "about:blank";
  const { port } = await window.t3View.port;
  setTimeout(() => location.assign(target), 100);
  setTimeout(() => port.postMessage({ type: "still-alive", target }), 1500);
})();
