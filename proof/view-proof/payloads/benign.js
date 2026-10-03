// A well-behaved view: renders, round-trips one request over its port.
(async () => {
  const { port, generation } = await window.t3View.port;
  document.body.textContent = "Hello from an isolated view (generation " + generation + ")";
  const results = [];
  port.onmessage = (event) => {
    if (event.data && event.data.type === "pong") {
      results.push({ name: "bridge round trip", outcome: "works", detail: "pong " + event.data.nonce });
      port.postMessage({ type: "oversize", blob: "x".repeat(70000) });
      port.postMessage({ type: "report", results });
    }
  };
  port.postMessage({ type: "ping", nonce: "n1" });
})();
