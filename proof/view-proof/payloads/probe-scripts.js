// Tries to execute bytes the host never hashed.
(async () => {
  const { port, init } = await window.t3View.port;
  const results = [];
  const violations = [];
  document.addEventListener("securitypolicyviolation", (event) => {
    violations.push(event.effectiveDirective + " " + (event.blockedURI || "inline"));
  });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const sentinel = async (name, key, run) => {
    try {
      await run();
    } catch (error) {
      results.push({ name, outcome: "blocked", detail: error.name + ": " + error.message });
      return;
    }
    await wait(300);
    results.push(window[key] ? { name, outcome: "LEAKED", detail: "sentinel set" } : { name, outcome: "blocked", detail: "sentinel unset" });
  };
  const tag = "scr" + "ipt";
  await sentinel("external script src", "__external", () => {
    const element = document.createElement(tag);
    element.src = init.serverOrigin + "/view-proof-external.js";
    document.head.append(element);
  });
  await sentinel("injected inline script", "__inline", () => {
    const element = document.createElement(tag);
    element.textContent = "window.__inline = 1";
    document.head.append(element);
  });
  await sentinel("eval", "__eval", () => eval("window.__eval = 1"));
  await sentinel("new Function", "__fn", () => new Function("window.__fn = 1")());
  await sentinel("setTimeout(string)", "__timer", () => setTimeout("window.__timer = 1", 0));
  await sentinel("dynamic import data:", "__import", () => import("data:text/javascript,window.__import=1"));
  await sentinel("blob Worker", "__worker", () => new Promise((resolve, reject) => {
    const worker = new Worker(URL.createObjectURL(new Blob(["postMessage(1)"], { type: "text/javascript" })));
    worker.onmessage = () => { window.__worker = 1; resolve(); };
    worker.onerror = () => reject(new Error("worker error"));
  }));
  await sentinel("nested srcdoc iframe", "__nested", () => {
    const frame = document.createElement("iframe");
    frame.srcdoc = "<" + tag + ">parent.__nested = 1</" + tag + ">";
    document.body.append(frame);
  });
  await sentinel("WebAssembly.compile", "__wasm", async () => {
    await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    window.__wasm = 1;
  });
  await sentinel("javascript: URL navigation in nested anchor", "__jsurl", () => {
    const anchor = document.createElement("a");
    anchor.href = "javascript:window.__jsurl=1";
    document.body.append(anchor);
    anchor.click();
  });
  // Last: document.write after load replaces the document.
  await sentinel("document.write script", "__written", () => document.write("<" + tag + ">window.__written = 1</" + tag + ">"));
  port.postMessage({ type: "report", results, violations });
})();
