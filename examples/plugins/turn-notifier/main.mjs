// Shows a notification on every connected client when a turn finishes, naming the
// thread and how the turn ended. The notification offers to open the thread.
const OUTCOMES = {
  completed: { verb: "finished", tone: "success" },
  failed: { verb: "failed", tone: "error" },
  interrupted: { verb: "was interrupted", tone: "warning" },
  cancelled: { verb: "was cancelled", tone: "neutral" },
};

export function activate(context) {
  const { onEvent, notify } = context.proposed;
  onEvent(async (event) => {
    // Ignore event types this plugin does not know; new ones may be added.
    if (event.type !== "run.finalized") return;
    const outcome = OUTCOMES[event.outcome] ?? { verb: "ended", tone: "neutral" };
    const thread = event.thread?.title || "A thread";
    try {
      await notify({
        title: `${thread} ${outcome.verb}`,
        tone: outcome.tone,
        threadId: event.threadId,
      });
    } catch (error) {
      // Notifications are rate limited. Skip this one instead of throwing, which would
      // fail the page and deliver the same events again.
      context.log.warn(`Skipped a notification: ${error.message}`);
    }
  });
}
