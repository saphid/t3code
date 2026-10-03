// Keeps sending after the host replaces or revokes it; the host must drop everything.
(async () => {
  const { port, generation } = await window.t3View.port;
  let tick = 0;
  setInterval(() => { tick += 1; port.postMessage({ type: "tick", tick, generation }); }, 20);
})();
