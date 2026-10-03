// Navigates its own frame to a fixture URL that redirects to the fixture page.
(async () => {
  const target = "http://127.0.0.1:7391/redirect?case=nav-redirect";
  const { port } = await window.t3View.port;
  setTimeout(() => location.assign(target), 100);
  setTimeout(() => port.postMessage({ type: "still-alive", target }), 1500);
})();
