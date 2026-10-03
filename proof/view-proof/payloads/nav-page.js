// Navigates its own frame to the fixture page, whose script reports to the fixture server.
(async () => {
  const target = "http://127.0.0.1:7391/page.html?case=nav-page";
  const { port } = await window.t3View.port;
  setTimeout(() => location.assign(target), 100);
  setTimeout(() => port.postMessage({ type: "still-alive", target }), 1500);
})();
