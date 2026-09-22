// @effect-diagnostics globalDate:off - Fake lease mints carry epoch-ms expiries.
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { BrowserFrameAccess } from "./access.ts";
import { createBrowserFrameClient, MjpegDemuxer, type BrowserFrameSessionRef } from "./stream.ts";

const encoder = new TextEncoder();

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function mjpegPart(headers: Record<string, string>, jpeg: Uint8Array): Uint8Array {
  const lines = Object.entries({ "Content-Type": "image/jpeg", ...headers })
    .map(([name, value]) => `${name}: ${value}`)
    .join("\r\n");
  return concatBytes(
    encoder.encode(`--t3frame\r\n${lines}\r\nContent-Length: ${jpeg.byteLength}\r\n\r\n`),
    jpeg,
    encoder.encode("\r\n"),
  );
}

describe("MjpegDemuxer", () => {
  const jpeg = (seed: number, length: number) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = (seed + i) % 251;
    return out;
  };

  it("emits a complete part with parsed headers", () => {
    const demuxer = new MjpegDemuxer();
    const parts = demuxer.push(
      mjpegPart({ "X-Frame-Seq": "7", "X-Geometry-Seq": "3" }, jpeg(1, 128)),
    );
    expect(parts).toHaveLength(1);
    expect(parts[0]?.headers["x-frame-seq"]).toBe("7");
    expect(parts[0]?.headers["x-geometry-seq"]).toBe("3");
    expect(parts[0]?.jpeg).toEqual(jpeg(1, 128));
  });

  it("reassembles a part split across arbitrary chunk boundaries", () => {
    const demuxer = new MjpegDemuxer();
    const whole = mjpegPart({ "X-Frame-Seq": "1" }, jpeg(2, 4096));
    const emitted = [];
    let offset = 0;
    for (const size of [7, 1024, 33]) {
      emitted.push(...demuxer.push(whole.subarray(offset, offset + size)));
      expect(emitted).toHaveLength(0);
      offset += size;
    }
    emitted.push(...demuxer.push(whole.subarray(offset)));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.jpeg).toEqual(jpeg(2, 4096));
  });

  it("emits multiple parts from one push", () => {
    const demuxer = new MjpegDemuxer();
    const first = mjpegPart({ "X-Frame-Seq": "4" }, jpeg(3, 64));
    const second = mjpegPart({ "X-Frame-Seq": "5" }, jpeg(4, 64));
    const parts = demuxer.push(concatBytes(first, second));
    expect(parts).toHaveLength(2);
    expect(parts.map((part) => part.headers["x-frame-seq"])).toEqual(["4", "5"]);
  });

  it("uses Content-Length so boundary-like bytes inside a JPEG do not split it", () => {
    const demuxer = new MjpegDemuxer();
    const payload = concatBytes(encoder.encode("--t3frame\r\n"), jpeg(9, 96));
    const parts = demuxer.push(mjpegPart({ "X-Frame-Seq": "2" }, payload));
    expect(parts).toHaveLength(1);
    expect(parts[0]?.jpeg).toEqual(payload);
  });
});

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readonly url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  emit(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const session: BrowserFrameSessionRef = {
  environmentId: "env-1",
  threadId: "thread-1",
  serverEpoch: "epoch-1",
  tabId: "tab-1",
};

const access: BrowserFrameAccess = {
  httpBase: "http://env.test/api/browser-frames",
  wsBase: "ws://env.test/api/browser-frames",
  query: {},
  credentials: false,
};

function makeEvents() {
  return {
    onStatus: vi.fn(),
    onConfig: vi.fn(),
    onDropped: vi.fn(),
    onUnauthorized: vi.fn(),
    onInputConnected: vi.fn(),
    onInputRejected: vi.fn(),
  };
}

describe("createBrowserFrameClient input lane", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    );
    return () => {
      vi.unstubAllGlobals();
    };
  });

  it("sends seq/geometrySeq-fenced packets only after the bound notice", async () => {
    const openInput = vi.fn(async () => ({
      leaseId: "bfli.1",
      inputTicket: "bfv1.in.t",
      expiresAt: Date.now() + 60_000,
    }));
    const events = makeEvents();
    const client = createBrowserFrameClient({ access, session, openInput }, {}, events);
    client.start();

    client.sendPointer("down", 0.5, 0.5);
    await vi.waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1);
    });
    const socket = FakeWebSocket.instances[0]!;
    await vi.waitFor(() => {
      expect(socket.readyState).toBe(FakeWebSocket.OPEN);
    });
    // Nothing goes out before the hub's bound notice fixes geometrySeq.
    client.sendPointer("down", 0.5, 0.5);
    expect(socket.sent).toHaveLength(0);
    socket.emit({
      type: "bound",
      leaseId: "bfli.1",
      geometrySeq: 4,
      expiresAt: Date.now() + 60_000,
    });
    client.sendPointer("down", 0.25, 0.75, "right");
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      seq: 1,
      geometrySeq: 4,
      event: { type: "pointer", phase: "down", x: 0.25, y: 0.75, button: "right" },
    });
    socket.emit({ type: "geometry", geometrySeq: 5 });
    client.sendWheel(10, -20, 0.5, 0.5);
    expect(JSON.parse(socket.sent[1]!)).toMatchObject({ seq: 2, geometrySeq: 5 });
    client.stop();
  });

  it("re-mints the lease through openInput when the socket dies", async () => {
    let mints = 0;
    const openInput = vi.fn(async () => ({
      leaseId: `bfli.${++mints}`,
      inputTicket: `bfv1.in.${mints}`,
      expiresAt: Date.now() + 60_000,
    }));
    const events = makeEvents();
    const client = createBrowserFrameClient({ access, session, openInput }, {}, events);
    client.start();
    client.sendPointer("move", 0.1, 0.1);
    await vi.waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1);
    });
    FakeWebSocket.instances[0]!.close();
    await vi.waitFor(
      () => {
        expect(openInput).toHaveBeenCalledTimes(2);
      },
      { timeout: 5_000, interval: 50 },
    );
    client.stop();
  });
});
