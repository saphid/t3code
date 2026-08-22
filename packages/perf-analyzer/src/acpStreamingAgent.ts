// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - Standalone mock ACP agent the harness registers as a provider binary; runs outside the Effect runtime.
import * as NodeReadline from "node:readline";

/**
 * Minimal ACP agent (newline-delimited JSON-RPC over stdio) that streams
 * assistant deltas at a steady tick for a fixed duration, then ends the turn.
 * The streaming-turn-append scenario registers it as a Grok provider instance
 * (via a shell wrapper, see provisionStreamingProvider in launch.ts), so a
 * real thread.turn.start flows through the server's real Grok ACP adapter,
 * orchestration events, and WS push into the client timeline. Response shapes
 * mirror apps/server/scripts/acp-mock-agent.ts, the mock the Grok adapter's
 * own tests run against.
 *
 * The server's default assistant delivery is buffered (ProviderRuntimeIngestion
 * holds text deltas until the assistant segment completes; token-by-token
 * rendering is the legacy enableLegacyTokenStreaming opt-in), and a segment
 * completes when a tool call arrives. So this agent emits what a busy real
 * turn emits: a steady stream of text chunks punctuated by a completed tool
 * call every TOOL_EVERY_TICKS ticks, each of which flushes the accumulated
 * segment into the timeline and renders a tool card - the shipped append
 * cadence, not a synthetic token stream.
 *
 * Knobs (env): T3_PERF_STREAM_MS total stream length (default 20000),
 * T3_PERF_STREAM_TICK_MS delta cadence (default 40).
 */

// The provider health check runs `<binary> --version` before anything else.
if (process.argv.includes("--version")) {
  process.stdout.write("grok 9.9.9 (t3-perf streaming mock)\n");
  process.exit(0);
}

// The server closes the pipe mid-tick when it tears a session down; a plain
// exit beats an EPIPE crash trace in the adapter's stderr log.
process.stdout.on("error", () => process.exit(0));

const STREAM_MS = Number(process.env["T3_PERF_STREAM_MS"] ?? "20000");
const TICK_MS = Number(process.env["T3_PERF_STREAM_TICK_MS"] ?? "40");
/** A completed tool call (segment flush + tool card) every ~1.3s at 40ms ticks. */
const TOOL_EVERY_TICKS = 32;
/** The first flush lands early so scenario setup sees painted text fast. */
const FIRST_TOOL_TICK = 8;
const SESSION_ID = "perf-stream-session";

/** The scenario waits for this exact text to know the stream reached paint. */
const STREAM_MARKER = "perfstream begins";

const MODES = {
  currentModeId: "code",
  availableModes: [
    { id: "code", name: "Code", description: "Write and modify code with full tool access" },
  ],
};

const MODELS = {
  currentModelId: "grok-build",
  availableModels: [{ modelId: "grok-build", name: "Grok Build" }],
};

function write(message: unknown): void {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function respond(id: number | string, result: unknown): void {
  write({ jsonrpc: "2.0", id, result });
}

function notifyChunk(sessionId: string, text: string): void {
  write({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
    },
  });
}

/**
 * A tool call that starts and completes on one tick. Its arrival closes the
 * active assistant segment in the server's ACP runtime, which is what flushes
 * the buffered text into a visible timeline append under default (buffered)
 * assistant delivery.
 */
function notifyToolCall(sessionId: string, tick: number): void {
  const toolCallId = `perf-tool-${tick}`;
  write({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId,
        title: `Read perf fixture ${tick}`,
        kind: "read",
        status: "pending",
        rawInput: { path: `src/perf/module${tick}.ts` },
      },
    },
  });
  write({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "completed",
        rawOutput: { content: `module${tick} contents\n` },
      },
    },
  });
}

const WORDS =
  "checkpoint relay projector adapter turn receipt worktree pairing tunnel surface thread reactor decider schema socket render frame commit branch review".split(
    " ",
  );

/** Deterministic markdown-ish delta: prose with a code fence every 64 ticks. */
function chunkText(tick: number): string {
  if (tick % 64 === 32) {
    return `\n\n\`\`\`ts\nexport const stream${tick} = compute(${tick});\n\`\`\`\n\n`;
  }
  const words: Array<string> = [];
  for (let i = 0; i < 6; i++) words.push(WORDS[(tick * 7 + i * 3) % WORDS.length] ?? "thread");
  return (tick % 24 === 0 ? "\n\n" : "") + words.join(" ") + " ";
}

const cancelFinishersBySession = new Map<string, () => void>();

function startStream(id: number | string, sessionId: string): void {
  const startedAt = Date.now();
  let tick = 0;
  let done = false;
  const finish = (stopReason: string) => {
    if (done) return;
    done = true;
    clearInterval(timer);
    cancelFinishersBySession.delete(sessionId);
    respond(id, { stopReason });
  };
  const timer = setInterval(() => {
    if (Date.now() - startedAt >= STREAM_MS) {
      finish("end_turn");
      return;
    }
    if (tick === FIRST_TOOL_TICK || (tick > FIRST_TOOL_TICK && (tick - FIRST_TOOL_TICK) % TOOL_EVERY_TICKS === 0)) {
      notifyToolCall(sessionId, tick);
    } else {
      notifyChunk(sessionId, tick === 0 ? `${STREAM_MARKER}. ` : chunkText(tick));
    }
    tick++;
  }, TICK_MS);
  cancelFinishersBySession.set(sessionId, () => finish("cancelled"));
}

interface JsonRpcMessage {
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: { readonly sessionId?: string };
}

function handle(message: JsonRpcMessage): void {
  const sessionId = message.params?.sessionId ?? SESSION_ID;
  if (message.method === "session/cancel") {
    cancelFinishersBySession.get(sessionId)?.();
    if (message.id !== undefined) respond(message.id, {});
    return;
  }
  if (message.id === undefined || message.method === undefined) return;
  switch (message.method) {
    case "initialize":
      respond(message.id, { protocolVersion: 1, agentCapabilities: { loadSession: true } });
      return;
    case "authenticate":
      respond(message.id, {});
      return;
    case "session/new":
      respond(message.id, {
        sessionId: SESSION_ID,
        modes: MODES,
        models: MODELS,
        configOptions: [],
      });
      return;
    case "session/load":
      respond(message.id, { modes: MODES, models: MODELS, configOptions: [] });
      return;
    case "session/prompt":
      startStream(message.id, sessionId);
      return;
    case "session/set_config_option":
      respond(message.id, { configOptions: [] });
      return;
    default:
      // Permissive: setters and unknown extensions succeed with an empty
      // result so incidental adapter calls never wedge a perf run.
      respond(message.id, {});
      return;
  }
}

const rl = NodeReadline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (line.trim().length === 0) return;
  try {
    handle(JSON.parse(line) as JsonRpcMessage);
  } catch {
    // Ignore non-JSON noise on stdin.
  }
});
process.stdin.on("end", () => process.exit(0));
