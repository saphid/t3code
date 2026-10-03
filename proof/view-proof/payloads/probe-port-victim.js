// Counts forged connects its bootstrap rejected while a sibling attacks it.
(async () => {
  const { port, generation, init } = await window.t3View.port;
  port.onmessage = (event) => {
    if (!event.data || event.data.type !== "finish") return;
    const rejected = window.t3View.rejectedConnects();
    port.postMessage({ type: "report", results: [
      { name: "forged connects rejected by bootstrap", outcome: rejected > 0 ? "blocked" : "unverified", detail: String(rejected) },
      { name: "kept host port and generation", outcome: generation === 1 && !init.forged ? "works" : "LEAKED", detail: "generation " + generation },
    ] });
  };
  port.postMessage({ type: "ready-for-attack" });
})();
