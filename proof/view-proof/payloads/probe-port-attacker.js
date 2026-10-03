// Sibling view: tries to hand other views a forged port and to spoof the host handshake.
(async () => {
  const { port } = await window.t3View.port;
  const results = [];
  let forgedPortsAccepted = 0;
  for (let index = 0; index < parent.frames.length; index += 1) {
    const forged = new MessageChannel();
    forged.port1.onmessage = () => { forgedPortsAccepted += 1; };
    try {
      parent.frames[index].postMessage({ type: "t3-view:connect", generation: 999, init: { forged: true } }, "*", [forged.port2]);
    } catch (error) {
      results.push({ name: "post forged port to frame " + index, outcome: "blocked", detail: error.message });
    }
  }
  parent.postMessage({ type: "t3-view:ready" }, "*");
  parent.postMessage({ type: "report", view: "port-victim", results: [{ name: "spoofed", outcome: "LEAKED" }] }, "*");
  await new Promise((resolve) => setTimeout(resolve, 500));
  results.push({ name: "forged port received messages", outcome: forgedPortsAccepted > 0 ? "LEAKED" : "blocked", detail: String(forgedPortsAccepted) });
  port.postMessage({ type: "report", results });
})();
