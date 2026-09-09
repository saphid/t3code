// This function is serialized into the owned page; keep all dependencies local.
export function installTerminalInputGuard({ fixture, origin, key }) {
  if (globalThis[key]) throw new Error("Terminal input guard already installed");
  const original = WebSocket.prototype.send;
  const state = { forwardedWrites: 0, violations: [] };
  const block = (reason) => {
    state.violations.push({ reason });
    throw new Error("Blocked terminal fixture input: " + reason);
  };
  function guarded(data) {
    const url = new URL(this.url);
    if (url.pathname !== "/ws") return original.call(this, data);
    let value;
    try {
      const text =
        typeof data === "string" ? data : new TextDecoder("utf-8", { fatal: true }).decode(data);
      value = JSON.parse(text);
    } catch {
      return block("Unparseable outbound RPC frame");
    }
    let writes = 0;
    function visit(item) {
      if (!item || typeof item !== "object") return;
      if (item.tag === "terminal.write") {
        if (item._tag !== "Request") block("Unknown terminal.write envelope");
        const payload = item.payload;
        if (
          url.host !== new URL(origin).host ||
          payload?.threadId !== fixture.threadId ||
          payload?.terminalId !== fixture.terminalId
        )
          block("Write targets unknown or unowned terminal");
        writes++;
      }
      for (const child of Object.values(item)) visit(child);
    }
    visit(value);
    const result = original.call(this, data);
    state.forwardedWrites += writes;
    return result;
  }
  WebSocket.prototype.send = guarded;
  globalThis[key] = {
    state,
    restore() {
      if (WebSocket.prototype.send !== guarded)
        throw new Error("Terminal send guard replaced during observation");
      WebSocket.prototype.send = original;
    },
  };
}
