// A tool plugin for PluginTools.test.ts and the lane's live proof.
export function activate(context) {
  const { handle } = context.proposed;
  handle("t3.tools.describe", () => ({
    tools: [
      {
        name: "word_count",
        title: "Count words",
        description: "Count the words in a text.",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string", maxLength: 10000 } },
          required: ["text"],
        },
        sideEffect: "read",
      },
      {
        name: "echo_context",
        description: "Return the input and the session context the host passed.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        sideEffect: "read",
      },
      {
        name: "wait_for_cancel",
        description: "Wait until the call is cancelled.",
        inputSchema: { type: "object", properties: {} },
        sideEffect: "write",
        openWorld: true,
      },
      {
        name: "big_result",
        description: "Return a string of the given length.",
        inputSchema: {
          type: "object",
          properties: { length: { type: "integer", minimum: 0 } },
          required: ["length"],
        },
        sideEffect: "read",
      },
    ],
  }));
  handle("t3.tool.word_count", ({ input }) => ({
    words: input.text.split(/\s+/).filter(Boolean).length,
  }));
  handle("t3.tool.echo_context", (call) => call);
  handle(
    "t3.tool.wait_for_cancel",
    (_call, { signal }) =>
      new Promise((_resolve, reject) => {
        context.log.info("wait-started");
        signal.addEventListener("abort", () => reject(new Error("cancelled")));
      }),
  );
  handle("t3.tool.big_result", ({ input }) => "x".repeat(input.length));
}
