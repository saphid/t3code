// Navigates while the document is still parsing: before its first load and before it has a port.
location.assign("http://127.0.0.1:7391/page.html?case=nav-early");
(async () => {
  const { port } = await window.t3View.port;
  setTimeout(() => port.postMessage({ type: "still-alive", target: "fixture page, during parse" }), 1500);
})();
