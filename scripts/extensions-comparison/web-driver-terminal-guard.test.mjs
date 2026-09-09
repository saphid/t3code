import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import { installTerminalInputGuard } from "./web-driver-terminal-guard.mjs";

NodeTest.test(
  "actual send guard blocks unowned writes and unknown envelopes before forwarding, including existing sockets",
  () => {
    const original = globalThis.WebSocket;
    const sent = [];
    class FixtureSocket {
      constructor(url) {
        this.url = url;
      }
      send(data) {
        sent.push(data);
      }
    }
    globalThis.WebSocket = FixtureSocket;
    const socket = new FixtureSocket("ws://localhost:8179/ws");
    const originalSend = FixtureSocket.prototype.send;
    const key = "__t3GuardUnit";
    try {
      installTerminalInputGuard({
        fixture: { threadId: "a", terminalId: "owned" },
        origin: "http://localhost:8179",
        key,
      });
      const frame = (payload) =>
        JSON.stringify({ _tag: "Request", tag: "terminal.write", payload });
      for (const data of [
        frame({ threadId: "a", terminalId: "other", data: "danger" }),
        frame({ threadId: "b", terminalId: "owned", data: "danger" }),
        frame({ threadId: "a", data: "danger" }),
        JSON.stringify({ tag: "terminal.write", payload: { threadId: "a", terminalId: "owned" } }),
        "unparseable",
        new Uint8Array([255]),
      ])
        NodeAssert.throws(() => socket.send(data));
      NodeAssert.equal(sent.length, 0);
      NodeAssert.equal(globalThis[key].state.violations.length, 6);
      const valid = frame({ threadId: "a", terminalId: "owned", data: "fixture" });
      socket.send(valid);
      socket.send(new TextEncoder().encode(valid));
      NodeAssert.equal(sent.length, 2);
      NodeAssert.equal(globalThis[key].state.forwardedWrites, 2);
      const foreign = new FixtureSocket("ws://localhost:9999/ws");
      NodeAssert.throws(() => foreign.send(valid));
      NodeAssert.equal(sent.length, 2);
      socket.send(JSON.stringify({ _tag: "Request", tag: "terminal.get", payload: {} }));
      NodeAssert.equal(sent.length, 3);
      globalThis[key].restore();
      NodeAssert.equal(FixtureSocket.prototype.send, originalSend);
    } finally {
      globalThis.WebSocket = original;
      delete globalThis[key];
    }
  },
);
NodeTest.test(
  "one invalid request blocks an entire batched frame before any valid write escapes",
  () => {
    const original = globalThis.WebSocket;
    const sent = [];
    class FixtureSocket {
      constructor() {
        this.url = "ws://localhost:8179/ws";
      }
      send(data) {
        sent.push(data);
      }
    }
    globalThis.WebSocket = FixtureSocket;
    const key = "__t3GuardBatch";
    try {
      installTerminalInputGuard({
        fixture: { threadId: "a", terminalId: "owned" },
        origin: "http://localhost:8179",
        key,
      });
      const request = (terminalId) => ({
        _tag: "Request",
        tag: "terminal.write",
        payload: { threadId: "a", terminalId, data: "x" },
      });
      NodeAssert.throws(() =>
        new FixtureSocket().send(JSON.stringify([request("owned"), request("other")])),
      );
      NodeAssert.equal(sent.length, 0);
      NodeAssert.equal(globalThis[key].state.forwardedWrites, 0);
      NodeAssert.throws(() =>
        installTerminalInputGuard({ fixture: {}, origin: "http://localhost:8179", key }),
      );
      globalThis[key].restore();
    } finally {
      globalThis.WebSocket = original;
      delete globalThis[key];
    }
  },
);
