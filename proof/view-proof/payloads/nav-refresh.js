// Inserts a meta refresh to the fixture page: a navigation that is not a location call.
(async () => {
  const target = "http://127.0.0.1:7391/page.html?case=nav-refresh";
  const { port } = await window.t3View.port;
  setTimeout(() => {
    const meta = document.createElement("meta");
    meta.httpEquiv = "refresh";
    meta.content = "0;url=" + target;
    document.head.append(meta);
  }, 100);
  setTimeout(() => port.postMessage({ type: "still-alive", target }), 1500);
})();
