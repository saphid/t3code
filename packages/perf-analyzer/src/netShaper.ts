// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off - Host-side TCP relay used by the perf harness; runs outside the Effect runtime.
import * as NodeNet from "node:net";

/**
 * A chaos TCP relay between the client under test and the T3 server, after
 * toxiproxy's design. Sitting at the stream level it degrades HTTP and
 * WebSocket traffic identically (CDP throttling cannot add latency to an
 * established WebSocket), needs no privileges, and lives in the test process
 * so mid-scenario changes are plain method calls.
 *
 * Fidelity note: a stream relay cannot model literal packet loss, but over TCP
 * the app-observable effect of loss is retransmit-induced latency spikes and
 * stalls, which latency + jitter + stall model directly.
 */

export interface ShapeConfig {
  /** Added one-way delay per chunk, each direction. */
  latencyMs?: number;
  /** Uniform random extra delay on top of latencyMs. */
  jitterMs?: number;
  /** Cap on bytes per second, each direction. 0 or undefined = unlimited. */
  bytesPerSecond?: number;
}

interface Connection {
  readonly client: NodeNet.Socket;
  readonly upstream: NodeNet.Socket;
}

class Direction {
  #queue: Array<{ chunk: Buffer; deliverAt: number }> = [];
  #timer: NodeJS.Timeout | null = null;
  #tokens: number;
  #lastRefill = performance.now();
  #stalled = false;
  #ended = false;

  readonly #sink: NodeNet.Socket;
  readonly #shape: () => ShapeConfig;

  constructor(source: NodeNet.Socket, sink: NodeNet.Socket, shape: () => ShapeConfig) {
    this.#sink = sink;
    this.#shape = shape;
    this.#tokens = this.#capacity();
    source.on("data", (chunk: Buffer) => this.#enqueue(chunk));
    source.on("end", () => {
      this.#ended = true;
      this.#drain();
    });
    source.on("error", () => sink.destroy());
  }

  #capacity(): number {
    return this.#shape().bytesPerSecond ?? 0;
  }

  #enqueue(chunk: Buffer): void {
    const { latencyMs = 0, jitterMs = 0 } = this.#shape();
    const delay = latencyMs + (jitterMs > 0 ? Math.random() * jitterMs : 0);
    this.#queue.push({ chunk, deliverAt: performance.now() + delay });
    this.#drain();
  }

  setStalled(stalled: boolean): void {
    this.#stalled = stalled;
    if (!stalled) this.#drain();
  }

  #drain(): void {
    if (this.#timer !== null) return;
    const step = () => {
      this.#timer = null;
      if (this.#stalled) return; // Re-drained on resume.
      const now = performance.now();
      const rate = this.#capacity();
      if (rate > 0) {
        this.#tokens = Math.min(rate, this.#tokens + ((now - this.#lastRefill) / 1000) * rate);
      }
      this.#lastRefill = now;
      while (this.#queue.length > 0) {
        const head = this.#queue[0];
        if (head === undefined) break;
        if (head.deliverAt > now) {
          this.#timer = setTimeout(step, head.deliverAt - now);
          this.#timer.unref();
          return;
        }
        if (rate > 0 && this.#tokens < head.chunk.length) {
          const deficit = head.chunk.length - this.#tokens;
          this.#timer = setTimeout(step, Math.max(5, (deficit / rate) * 1000));
          this.#timer.unref();
          return;
        }
        if (rate > 0) this.#tokens -= head.chunk.length;
        this.#queue.shift();
        if (!this.#sink.destroyed) this.#sink.write(head.chunk);
      }
      if (this.#ended && !this.#sink.destroyed) this.#sink.end();
    };
    step();
  }
}

export class NetShaper {
  #server: NodeNet.Server | null = null;
  #connections = new Set<Connection>();
  #directions = new Set<Direction>();
  #shape: ShapeConfig = {};
  #refusing = false;

  /** Starts listening on 127.0.0.1:listenPort, relaying to upstreamPort. */
  async listen(listenPort: number, upstreamPort: number): Promise<void> {
    const server = NodeNet.createServer((client) => {
      if (this.#refusing) {
        client.destroy();
        return;
      }
      const upstream = NodeNet.connect(upstreamPort, "127.0.0.1");
      const connection: Connection = { client, upstream };
      this.#connections.add(connection);
      upstream.on("error", () => client.destroy());
      const forward = new Direction(client, upstream, () => this.#shape);
      const backward = new Direction(upstream, client, () => this.#shape);
      this.#directions.add(forward);
      this.#directions.add(backward);
      const cleanup = () => {
        this.#connections.delete(connection);
        this.#directions.delete(forward);
        this.#directions.delete(backward);
      };
      client.on("close", cleanup);
      upstream.on("close", cleanup);
    });
    this.#server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(listenPort, "127.0.0.1", resolve);
    });
  }

  /** Replaces the active shaping profile; applies to queued and future chunks. */
  set(shape: ShapeConfig): void {
    this.#shape = shape;
  }

  /** Freezes all traffic (a silent blackhole), reversible with resume(). */
  stall(): void {
    for (const direction of this.#directions) direction.setStalled(true);
  }

  resume(): void {
    for (const direction of this.#directions) direction.setStalled(false);
  }

  /** Kills every open connection; rst sends a real TCP reset. */
  dropAll(options?: { rst?: boolean }): void {
    for (const { client, upstream } of this.#connections) {
      if (options?.rst === true) {
        client.resetAndDestroy();
        upstream.resetAndDestroy();
      } else {
        client.destroy();
        upstream.destroy();
      }
    }
  }

  /** Models a server-down window for reconnect-storm scenarios. */
  refuseNewConnections(refuse: boolean): void {
    this.#refusing = refuse;
  }

  async close(): Promise<void> {
    this.dropAll();
    const server = this.#server;
    this.#server = null;
    if (server !== null) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
