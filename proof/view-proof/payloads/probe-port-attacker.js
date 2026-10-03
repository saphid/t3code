// Sibling view: tries to hand other views a forged port and to spoof the host handshake.
(async () => {
  const { port } = await window.t3View.port;
  const results = [];
  let forgedPortsAccepted = 0;
  // With a policy wrapper the host is the grandparent and each sibling view is a wrapper's child.
  const host = parent.frames.length === 1 && parent !== top ? parent.parent : parent;
  const targets = [];
  for (let index = 0; index < host.frames.length; index += 1) {
    targets.push(host.frames[index]);
    if (host.frames[index].length > 0) targets.push(host.frames[index][0]);
  }
  targets.forEach((target, index) => {
    const forged = new MessageChannel();
    forged.port1.onmessage = () => { forgedPortsAccepted += 1; };
    try {
      target.postMessage({ type: "t3-view:connect", generation: 999, init: { forged: true } }, "*", [forged.port2]);
    } catch (error) {
      results.push({ name: "post forged port to frame " + index, outcome: "blocked", detail: error.message });
    }
  });
  host.postMessage({ type: "t3-view:ready" }, "*");
  host.postMessage({ type: "report", view: "port-victim", results: [{ name: "spoofed", outcome: "LEAKED" }] }, "*");
  await new Promise((resolve) => setTimeout(resolve, 500));
  results.push({ name: "forged port received messages", outcome: forgedPortsAccepted > 0 ? "LEAKED" : "blocked", detail: String(forgedPortsAccepted) });
  port.postMessage({ type: "report", results });
})();
